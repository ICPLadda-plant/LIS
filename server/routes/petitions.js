const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const Sample = require('../models/Sample');
const PhysicalResult = require('../models/PhysicalResult');
const Approval = require('../models/Approval');
const RealtimeDensity = require('../models/RealtimeDensity');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { buildSearchRankingStages } = require('../lib/searchRanking');
const {
  bellDescribe,
  isCollapsibleDuplicate,
  isRelevant,
  toNotification,
} = require('../lib/petitionNotifications');
const { maybeAdvancePhase } = require('../lib/phaseAdvance');
const QCTestResult = require('../models/QCTestResult');
const Parameter = require('../models/Parameter');
const LabRequest = require('../models/LabRequest');
const StandardTime = require('../models/StandardTime');
const { buildStatusLog, hasLabTrack, shouldSendItemToLab, isPetitionComplete } = require('../lib/petitionStatusLog');
const { notifyPetitionEvent } = require('../lib/lineNotify');
const { router: additionalSamplesRouter, changeAdditionalSampleState, currentUser, canTestSide } = require('./additionalSamples');
const { normalizeRoles } = require('../lib/roles');
const { serializePetitionWrite } = require('../lib/petitionWriteQueue');
const { pendingAdditionalSamples, additionalSampleCompletionError } = require('../lib/additionalSamples');
router.use(additionalSamplesRouter);
const { normalizeAnalysisName, canonicalAnalysisName } = require('../lib/analysisName');
const { buildProductionWorkflow } = require('../lib/productionWorkflow');
const { resolveEmployeeActor } = require('../lib/employeeResolver');
const {
  isResearchAndDevelopmentDepartment,
  normalizePetitionItems,
  requiresDeliveryAndBatch,
  requiresQcTrack,
  validatePetitionSubmission,
} = require('../lib/petitionSubmissionRules');

function sampleIdsFromPetition(petition) {
  if (!petition || !Array.isArray(petition.items)) return [];
  return petition.items
    .map((item) => item.sampleId || `${petition.petitionNo}-${item.seq}`)
    .filter(Boolean);
}

function logAudit(petition, payload) {
  if (!petition) return;
  PetitionAuditLog.create({
    petitionId: petition._id,
    petitionNo: petition.petitionNo,
    ...payload,
  }).catch((err) => {
    console.error('[audit-log] failed to write:', err.message);
  });
  // Fan out to LINE groups (fire-and-forget; no-op unless configured + groups bound).
  notifyPetitionEvent(petition, payload);
}

// Generate next petition number from DocumentNumberConfig (default: P-YYMM-####).
const { nextDocumentNumber } = require('../lib/documentNumber');
function nextPetitionNo() {
  return nextDocumentNumber('petition', Petition, 'petitionNo');
}

function badRequest(res, message) {
  return res.status(400).json({ error: { message } });
}

async function latestDeliverableRevision(petition) {
  let current = petition;
  for (let depth = 0; depth < 20 && current?.status === 'rejected'; depth += 1) {
    const query = Petition.findOne({
      revisionOf: current._id,
      status: { $ne: 'approved' },
    });
    const next = await (typeof query.sort === 'function'
      ? query.sort({ createdAt: -1 }).lean()
      : query.lean());
    if (!next || String(next._id) === String(current._id)) break;
    current = next;
  }
  return current;
}

async function additionalCompletionError(petition, sides) {
  if (!petition.additionalSampleRequests?.length) return null;
  const results = await QCTestResult.find({ petitionId: String(petition._id) }).lean();
  for (const side of sides) {
    const error = additionalSampleCompletionError(petition, side, results);
    if (error) return error;
  }
  return null;
}

async function additionalActor(req, res, petition, side, headOnly = false) {
  if (!petition.additionalSampleRequests?.length) return req.body?.actor || 'system';
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: { message: 'กรุณาเข้าสู่ระบบ' } });
    return null;
  }
  const allowed = headOnly ? normalizeRoles(user).some(role => role === 'admin' || role === side + '-head') : canTestSide(user, petition, side);
  if (!allowed) {
    res.status(403).json({ error: { message: 'ไม่มีสิทธิ์ยืนยันผลให้ฝ่ายนี้' } });
    return null;
  }
  return user.name || user.email;
}

function machineTypeOf(machine) {
  const text = `${machine?.code || ''} ${machine?.name || ''}`.toUpperCase();
  if (text.includes('HPLC')) return 'HPLC';
  if (text.includes('GC')) return 'GC';
  return '';
}

function queryStringList(value) {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => String(entry || '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function matchStandardTime(machine) {
  const commonName = normalizeAnalysisName(machine.commonName);
  const machineType = machineTypeOf(machine);
  if (!commonName || !machineType) return null;
  const exact = await StandardTime.findOne({
    machineType,
    normalizedAnalysisName: commonName,
    hasData: true,
  }).sort({ standardTimeMin: 1 }).lean();
  if (exact) return exact;

  const key = canonicalAnalysisName(commonName);
  const candidates = await StandardTime.find({ machineType, hasData: true })
    .select('_id instrument analysisName standardTimeMin')
    .sort({ standardTimeMin: 1 })
    .lean();
  return candidates.find((row) => canonicalAnalysisName(row.analysisName) === key) || null;
}

// GET /api/petitions?page=1&limit=20&status=&search=
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status = req.query.status;
    const dept = req.query.dept;
    const search = (req.query.search || '').trim();
    const assignedToEmployeeId = String(req.query.assignedToEmployeeId || '').trim();
    const assignedToNames = queryStringList(req.query.assignedToName);

    const q = {};
    if (dept && ['production', 'rm', 'fg'].includes(String(dept))) q.dept = dept;
    const andConditions = [];
    const assigneeConditions = [];
    if (assignedToEmployeeId) assigneeConditions.push({ 'assignedTo.employeeId': assignedToEmployeeId });
    assignedToNames.forEach((name) => assigneeConditions.push({ 'assignedTo.name': name }));
    if (assigneeConditions.length > 1) {
      andConditions.push({
        $or: assigneeConditions,
      });
    } else if (assigneeConditions.length === 1) Object.assign(q, assigneeConditions[0]);
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      andConditions.push({
        $or: [
          { petitionNo: rx },
          { prodOrderNos: rx },
          { 'productionWorkflow.requestNo': rx },
          { 'productionWorkflow.lisPetitionNo': rx },
          { 'submittedBy.name': rx },
          { 'items.batchNo': rx },
        ],
      });
    }
    if (andConditions.length === 1) Object.assign(q, andConditions[0]);
    else if (andConditions.length > 1) q.$and = andConditions;
    const summaryQ = { ...q };

    if (status) {
      const list = String(status).split(',').map((s) => s.trim()).filter(Boolean);
      q.status = list.length > 1 ? { $in: list } : list[0];
    }

    // ?ids=a,b,c → ดึงเฉพาะใบที่ระบุ (ใช้โดยการไฮไลท์จากแดชบอร์ด) — ไม่แบ่งหน้า
    const idsRaw = String(req.query.ids || '').trim();
    if (idsRaw) {
      const ids = idsRaw.split(',').map((s) => s.trim()).filter((s) => mongoose.isValidObjectId(s));
      if (ids.length === 0) return res.json({ items: [], total: 0, page: 1, limit: 0 });
      const docs = await Petition.find({ _id: { $in: ids } }).sort({ createdAt: -1 });
      const items = docs.map((doc) => doc.toObject());
      return res.json({ items, total: items.length, page: 1, limit: items.length });
    }

    if (req.query.awaitingLabApproval === 'true') {
      q.labCompletedAt = { $ne: null };
      q.labApprovedAt = null;
      q.status = 'inProgress';
    }
    if (req.query.labApproved === 'true') {
      q.labApprovedAt = { $ne: null };
    }

    const [docs, total, summaryTotal, statusCountRows] = await Promise.all([
      search
        ? Petition.aggregate([
          { $match: { ...q, deletedAt: null } },
          ...buildSearchRankingStages(search, {
            primary: ['petitionNo'],
            secondary: ['prodOrderNos', 'productionWorkflow.requestNo', 'productionWorkflow.lisPetitionNo', 'submittedBy.name', 'items.batchNo'],
          }, { createdAt: -1 }),
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ]).then((rows) => rows.map((row) => Petition.hydrate(row)))
        : Petition.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Petition.countDocuments(q),
      Petition.countDocuments(summaryQ),
      Petition.aggregate([
        { $match: summaryQ },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);
    const statusCounts = Object.fromEntries(statusCountRows.map((row) => [row._id, row.count]));
    // Lazy phase advance for petitions whose phase2DueAt has elapsed
    const now = new Date();
    const items = [];
    for (const doc of docs) {
      if (doc.currentPhase === 1 && doc.phase2DueAt && doc.phase2DueAt <= now) {
        await maybeAdvancePhase(doc);
      }
      items.push(doc.toObject());
    }
    res.json({ items, total, page, limit, summaryTotal, statusCounts });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

const { buildLiveSection, buildStatsSection } = require('../lib/execSummary');
const { buildQcParamBaseline } = require('../lib/qcParamBaseline');
const { computeAbnormalFlags } = require('../lib/abnormalFlags');

const EXEC_DAYS_ALLOWED = [1, 7, 30];
const EXEC_CACHE_MS = 60 * 1000;
const QC_BASELINE_CACHE_MS = 10 * 60 * 1000;
const QC_BASELINE_LOOKBACK_DAYS = 180;
const execCache = new Map();   // days → { at, payload }
let qcBaselineCache = null;    // { at, value } — ค่าเฉลี่ยย้อนหลัง 180 วัน ไม่ต้อง real-time

// ค่าเฉลี่ยเวลา QC ต่อ parameter สแกนงานย้อนหลัง 180 วัน จึงแพงเกินกว่าจะคิดใหม่ทุกนาที
async function loadQcBaseline(now) {
  if (qcBaselineCache && now - qcBaselineCache.at < QC_BASELINE_CACHE_MS) return qcBaselineCache.value;

  const baselineStart = new Date(now - QC_BASELINE_LOOKBACK_DAYS * 86400000);
  const baselineDocs = await Petition.find({ qcCompletedAt: { $gte: baselineStart } }, {
    items: 1, qcReceivedAt: 1, qcCompletedAt: 1, receivedAt: 1, labReceivedAt: 1,
  }).lean();

  const baselineIds = baselineDocs.map((p) => String(p._id));
  const baselineResults = baselineIds.length
    ? await QCTestResult.find(
      { petitionId: { $in: baselineIds } },
      { petitionId: 1, parameterId: 1, parameterName: 1, commonName: 1 },
    ).lean()
    : [];

  const value = buildQcParamBaseline(baselineDocs, baselineResults);
  qcBaselineCache = { at: now, value };
  return value;
}

// GET /api/petitions/exec-summary?days=1|7|30 — ตัวเลขสำหรับแดชบอร์ดผู้บริหาร
router.get('/exec-summary', async (req, res) => {
  try {
    const requested = Number(req.query.days);
    const days = EXEC_DAYS_ALLOWED.includes(requested) ? requested : 30;

    const cached = execCache.get(days);
    const now = Date.now();
    if (cached && now - cached.at < EXEC_CACHE_MS) return res.json(cached.payload);

    const windowStart = new Date(now - days * 86400000);

    const [openDocs, closedDocs, createdDocs, qcBaseline] = await Promise.all([
      // งานที่ยังไม่ปิด — query ไม่จำกัดช่วงเวลา เพราะงานค้างเก่าคือสิ่งที่หัวหน้าต้องเห็นที่สุด
      // (ตัวเลขสรุป/แถบด่านถูกย่อให้เหลือเฉพาะใบที่ยื่นในช่วงโดย buildLiveSection · คิว
      // "งานที่ต้องจัดการ" ยังกินทั้งหมด)
      Petition.find({ approvedAt: null, status: { $nin: ['approved', 'rejected'] } }).lean(),
      Petition.find({ approvedAt: { $gte: windowStart } }).lean(),
      // "created" series for throughput: a dedicated, provably-complete query on
      // sampleSentAt alone — งานเข้ามาตอนตัวอย่างถูกนำส่ง ไม่ใช่ตอนกรอกฟอร์ม. Rejected
      // petitions (status 'rejected', approvedAt null) sit in neither openDocs
      // (excluded by status) nor closedDocs (approvedAt never set) — they arrived and
      // were later sent back, but they DID arrive, and the inflow line must show that.
      // Project only sampleSentAt, the one field the throughput bucketing reads
      // (see buildStatsSection).
      Petition.find({ sampleSentAt: { $gte: windowStart } }, { sampleSentAt: 1 }).lean(),
      loadQcBaseline(now),
    ]);

    // abnormal flags ใช้สูตรเดียวกับ badge ในหน้ารายการ (lib เดียวกัน)
    // ดึง QCTestResult ครั้งเดียวสำหรับทั้ง flagIds — projection พก enteredBy/updatedBy
    // มาด้วยเพื่อสร้าง qcTesterNames จากผลชุดเดียวกัน ไม่ query ซ้ำ
    const flagIds = [...openDocs, ...closedDocs].map((p) => String(p._id));
    const flagResults = flagIds.length
      ? await QCTestResult.find(
        { petitionId: { $in: flagIds } },
        {
          petitionId: 1, parameterId: 1, itemSeq: 1, commonName: 1, values: 1, entries: 1,
          enteredBy: 1, updatedBy: 1,
        },
      ).lean()
      : [];
    const paramIds = Array.from(new Set(flagResults.map((d) => String(d.parameterId))));
    const params = paramIds.length
      ? await Parameter.find({ _id: { $in: paramIds } }, { valueFields: 1, multiEntry: 1 }).lean()
      : [];
    const abnormalFlags = computeAbnormalFlags({
      docs: flagResults,
      params,
      petitions: [...openDocs, ...closedDocs],
    });

    // ผู้บันทึกผล QC ต่อใบ — ตรรกะเดียวกับ /qc-results/testers (ผู้แก้ล่าสุดคือเจ้าของ)
    // credit เฉพาะใบในช่วงปิด (closedDocs) — ไม่รวมงานค้างที่ยังเปิดอยู่
    const qcTesterNames = {};
    const closedIdSet = new Set(closedDocs.map((p) => String(p._id)));
    for (const row of flagResults) {
      if (!closedIdSet.has(row.petitionId)) continue;
      qcTesterNames[row.petitionId] ??= [];
      const name = row.updatedBy?.name || row.enteredBy?.name;
      if (!name) continue;
      if (!qcTesterNames[row.petitionId].includes(name)) qcTesterNames[row.petitionId].push(name);
    }

    const payload = {
      generatedAt: new Date(now).toISOString(),
      days,
      live: buildLiveSection(openDocs, {
        now, qcBaseline, abnormalFlags, windowStart: windowStart.getTime(),
      }),
      // createdDocs is its own query (createdAt >= windowStart), independent of
      // open/closed status — see buildStatsSection's throughput "created" bucket.
      stats: buildStatsSection(closedDocs, createdDocs, { now, days, abnormalFlags, qcTesterNames }),
    };

    execCache.set(days, { at: now, payload });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/submitted-orders → list of prod_order_no values already submitted
router.get('/submitted-orders', async (_req, res) => {
  try {
    const docs = await Petition.find({ prodOrderNos: { $exists: true, $ne: [] } })
      .select('prodOrderNos')
      .lean();
    const set = new Set();
    for (const d of docs) for (const n of d.prodOrderNos || []) set.add(n);
    res.json(Array.from(set));
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/audit-logs?page=1&limit=20&search=&event=&status=&from=&to=
router.get('/audit-logs', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || '').trim();
    const event = String(req.query.event || '').trim();
    const status = String(req.query.status || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const q = {};
    if (event) q.event = event;
    if (status) q.toStatus = status;
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [
        { petitionNo: rx },
        { actor: rx },
        { note: rx },
      ];
    }
    if (from || to) {
      q.createdAt = {};
      if (from) {
        const start = new Date(from);
        if (!Number.isNaN(start.getTime())) q.createdAt.$gte = start;
      }
      if (to) {
        const end = new Date(to);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          q.createdAt.$lte = end;
        }
      }
      if (Object.keys(q.createdAt).length === 0) delete q.createdAt;
    }

    const [items, total] = await Promise.all([
      search
        ? PetitionAuditLog.aggregate([
          { $match: q },
          ...buildSearchRankingStages(search, {
            primary: ['petitionNo'], secondary: ['actor', 'note'],
          }, { createdAt: -1 }),
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ])
        : PetitionAuditLog.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PetitionAuditLog.countDocuments(q),
    ]);
    res.json({ items, total, page, limit });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/notifications?since=<ISO>&audiences=qc,lab&employeeId=E1&all=0&limit=30
// In-app bell feed: audit log + petition → notifications this viewer should see.
// Unauthenticated like the rest of this API — the client states who it is, same as
// the `actor` field other routes accept.
const NOTIFY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

router.get('/notifications', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const audiences = String(req.query.audiences || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const viewer = {
      audiences,
      employeeId: String(req.query.employeeId || '').trim(),
      seeAll: String(req.query.all || '') === '1',
    };

    // Hard 24h ceiling no matter how stale the client's cursor is.
    const floor = new Date(Date.now() - NOTIFY_LOOKBACK_MS);
    const since = new Date(String(req.query.since || ''));
    const window = !Number.isNaN(since.getTime()) && since > floor ? since : floor;

    const logs = await PetitionAuditLog.find({ createdAt: { $gte: window } })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const petitionIds = [...new Set(logs.filter((l) => l.petitionId).map((l) => String(l.petitionId)))];
    const petitions = petitionIds.length
      ? await Petition.find({ _id: { $in: petitionIds } })
          .select(
            'petitionNo dept status items.batchNo items.sampleName items.commonName ' +
            'submittedBy assignedTo qcCompletedAt labCompletedAt labApprovedAt',
          )
          .lean()
      : [];
    const byId = new Map(petitions.map((p) => [String(p._id), p]));

    const items = [];
    // resultEntered fires once per form field, so a burst for one petition must
    // collapse to its single newest row BEFORE the limit cap below — otherwise the
    // burst alone can fill the cap and crowd out older, more important events
    // (e.g. ⛔ ถูกส่งกลับ) that never get re-fetched once the cursor moves past them.
    const seenResultEntered = new Set();
    for (const log of logs) {
      if (items.length >= limit) break;
      const petition = byId.get(String(log.petitionId));
      if (!petition) continue; // ถูกลบ/soft delete แล้ว
      if (isCollapsibleDuplicate(log, seenResultEntered)) continue;
      const desc = bellDescribe(petition, log);
      if (!desc) continue;
      if (!isRelevant(desc, petition, viewer)) continue;
      items.push(toNotification(petition, log, desc, viewer));
    }

    // Client uses serverTime as its next cursor — avoids client/server clock skew.
    res.json({ items, serverTime: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/returned-flags?petitionIds=id1,id2,...
// Returns map of petitionId → boolean (true if petition is a revision of another
// petition, i.e. its predecessor was sent back from QC for re-submission).
router.get('/returned-flags', async (req, res) => {
  try {
    const raw = String(req.query.petitionIds || '').trim();
    if (!raw) return res.json({});
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.json({});

    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const withRevision = await Petition.find({
      _id: { $in: objectIds },
      revisionOf: { $ne: null },
    }).select('_id').lean();
    const set = new Set(withRevision.map((d) => String(d._id)));

    const map = {};
    for (const id of ids) map[id] = set.has(id);
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/rejected-by-batch?batchNo=X&employeeId=Y
// Returns rejected petitions whose items contain the given batchNo AND whose
// submittedBy.employeeId matches the requester. Used to suggest "this looks
// like a revision of an earlier rejected petition" on the new-petition form.
// Without employeeId we return nothing — preventing cross-user batch lookup.
router.get('/rejected-by-batch', async (req, res) => {
  try {
    const batchNo = String(req.query.batchNo || '').trim();
    const employeeId = String(req.query.employeeId || '').trim();
    if (!batchNo || !employeeId) return res.json([]);

    const docs = await Petition.find({
      status: 'rejected',
      'submittedBy.employeeId': employeeId,
      'items.batchNo': batchNo,
    })
      .select('_id petitionNo submittedBy items reviewHistory rejectedAt dept')
      .sort({ rejectedAt: -1 })
      .limit(10)
      .lean();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/batch-exists?batchNo=X
router.get('/batch-exists', async (req, res) => {
  try {
    const batchNo = String(req.query.batchNo || '').trim();
    if (!batchNo) return res.json({ exists: false });
    const exists = await Petition.exists({ 'items.batchNo': batchNo, status: { $ne: 'deleted' } });
    res.json({ exists: Boolean(exists) });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/scan/:code
router.get('/scan/:code', async (req, res) => {
  try {
    const code = decodeURIComponent(req.params.code || '').trim();
    if (!code) return badRequest(res, 'ไม่พบรหัสจาก QR Code');
    if (code.startsWith('LIS-EXTRA-')) {
      const doc = await Petition.findOne({ 'additionalSampleRequests.qrCode': code }).lean();
      const round = doc?.additionalSampleRequests?.find(entry => entry.qrCode === code);
      if (!round) return res.status(404).json({ error: { message: 'ไม่พบรอบตัวอย่างเพิ่มจาก QR นี้' } });
      return res.json({ ...doc, scannedAdditionalSampleId: String(round._id), scannedAdditionalSampleCode: round.qrCode });
    }

    const query = [
      { petitionNo: code },
      { 'items.sampleId': code },
    ];
    if (mongoose.Types.ObjectId.isValid(code)) {
      query.unshift({ _id: code });
    }

    const fallbackPetitionNo = code.match(/^(P-\d{4}-\d{4})-\d+$/i)?.[1];
    if (fallbackPetitionNo) query.push({ petitionNo: fallbackPetitionNo });

    let doc = await Petition.findOne({ $or: query }).lean();
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้องจาก QR Code นี้' } });
    doc = await latestDeliverableRevision(doc);
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/:id/audit-logs → chronological status/event trail for a petition
router.get('/:id/audit-logs', async (req, res) => {
  try {
    const id = req.params.id;
    const petition = mongoose.Types.ObjectId.isValid(id)
      ? await Petition.findById(id).select('_id petitionNo').lean()
      : await Petition.findOne({ petitionNo: id }).select('_id petitionNo').lean();
    if (!petition) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    const logs = await PetitionAuditLog.find({ petitionId: petition._id })
      .sort({ createdAt: 1 })
      .lean();
    res.json({ items: logs });
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/status-log/:id → derived human-readable status + timeline
router.get('/status-log/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const petition = mongoose.Types.ObjectId.isValid(id)
      ? await Petition.findById(id).lean()
      : await Petition.findOne({ petitionNo: id }).lean();
    if (!petition) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });

    const [auditLogs, qcResults, parameters] = await Promise.all([
      PetitionAuditLog.find({ petitionId: petition._id }).sort({ createdAt: 1 }).lean(),
      // QCTestResult.petitionId is stored as a String of _id (not ObjectId) — keep the cast
      QCTestResult.find({ petitionId: String(petition._id) }).lean(),
      Parameter.find().lean(),
    ]);

    // labDone: Lab track finished — explicit completion flag, or (legacy) every lab
    // sampleId has a completed PhysicalResult.
    const isResearchRequest = isResearchAndDevelopmentDepartment(petition.submittedBy?.department);
    const labSampleIds = (petition.items || [])
      .filter((it) => isResearchRequest || shouldSendItemToLab(it))
      .map((it) => it.sampleId || `${petition.petitionNo}-${it.seq}`)
      .filter(Boolean);
    let labDone = !hasLabTrack(petition);
    if (labSampleIds.length > 0) {
      if (petition.labCompletedAt) {
        labDone = true;
      } else {
        const physResults = await PhysicalResult.find({ sampleId: { $in: labSampleIds } }).lean();
        labDone = labSampleIds.every(
          (sid) => physResults.find((p) => p.sampleId === sid)?.status === 'completed',
        );
      }
    }

    res.json(buildStatusLog(petition, auditLogs, qcResults, parameters, labDone));
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// POST /api/petitions/status-petition-log -> แจ้งขอตรวจสอบซ้ำ
router.post('/status-petition-log', serializePetitionWrite(async (req, res) => {
  try {
    const petitionId = req.body?.petitionId || req.body?.id;
    if (!petitionId) return badRequest(res, 'กรุณาระบุคำร้อง');
    const q = mongoose.Types.ObjectId.isValid(petitionId) ? { _id: petitionId } : { petitionNo: petitionId };
    const petition = await Petition.findOne(q);
    if (!petition) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    const actor = String(req.body?.actor || 'system').trim();
    const payload = {
      event: 'recheck',
      fromStatus: petition.status,
      toStatus: petition.status,
      actor,
      note: 'แจ้งขอตรวจสอบซ้ำ',
      metadata: {
        recipients: ['qc-head', 'requester'],
        recipientEmployeeIds: petition.submittedBy?.employeeId ? [String(petition.submittedBy.employeeId)] : [],
      },
    };
    logAudit(petition, payload);
    res.status(201).json({ petitionId: petition._id, ...payload });
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// POST /api/petitions/:id/complete  → one track records "บันทึกผล" (Lab or QC).
// Petition flips to `success` ONLY when every required track is complete
// (QC always; Lab when the petition has a lab-batch item). Until then it stays
// inProgress, waiting for the other side.
router.post('/:id/complete', serializePetitionWrite(async (req, res) => {
  try {
    const side = String(req.body?.side || '').trim();
    if (!['lab', 'qc'].includes(side)) return badRequest(res, 'side ต้องเป็น "lab" หรือ "qc"');

    const doc = await Petition.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    const actor = await additionalActor(req, res, doc, side);
    if (!actor) return;
    if (doc.status === 'approved' || doc.status === 'rejected') {
      return res.status(409).json({ error: { message: 'คำร้องนี้ปิดแล้ว ไม่สามารถบันทึกผลได้' } });
    }

    const now = new Date();
    const redoExplanation = String(req.body?.redoExplanation || '').trim();
    const additionalError = await additionalCompletionError(doc, [side]);
    if (additionalError) return res.status(409).json({ error: { message: additionalError } });
    if (side === 'qc') {
      if (!requiresQcTrack(doc)) return badRequest(res, 'คำขอ R&D ไม่ต้องส่ง QC');
      if (doc.qcReturnNote && !redoExplanation) {
        return badRequest(res, 'กรุณาอธิบายว่าทำใหม่อย่างไร (ถูกส่งกลับให้แก้)');
      }
      doc.qcCompletedAt = now;
      doc.qcCompletedBy = actor;
      if (doc.qcReturnNote) { doc.qcRedoExplanation = redoExplanation; doc.qcReturnNote = undefined; }
    } else {
      if (doc.labReturnNote && !redoExplanation) {
        return badRequest(res, 'กรุณาอธิบายว่าทำใหม่อย่างไร (ถูกส่งกลับให้แก้)');
      }
      doc.labCompletedAt = now;
      doc.labCompletedBy = actor;
      if (doc.labReturnNote) { doc.labRedoExplanation = redoExplanation; doc.labReturnNote = undefined; }
    }

    const prevStatus = doc.status;
    const sideLabel = side === 'qc' ? 'QC' : 'Lab';
    const finalWaitNote = requiresQcTrack(doc) ? 'รอหัวหน้า QC ยืนยัน' : 'รอ Final Result';
    if (isPetitionComplete(doc)) {
      if (doc.status !== 'success') doc.status = 'success';
      if (!doc.completedAt) doc.completedAt = now;
      await doc.save();
      logAudit(doc, {
        event: 'statusChanged',
        fromStatus: prevStatus,
        toStatus: 'success',
        actor,
        note: `${sideLabel} บันทึกผลเสร็จ — ครบทุกส่วน ${finalWaitNote}`,
        metadata: { side },
      });
    } else {
      await doc.save();
      logAudit(doc, {
        event: 'updated',
        toStatus: doc.status,
        actor,
        note: `${sideLabel} บันทึกผลเสร็จ — รออีกฝั่งตรวจให้ครบ`,
        metadata: { side },
      });
    }
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// POST /api/petitions/:id/lab-approve  → หัวหน้า Lab ออกผล Lab. success เกิดเมื่อครบทุก track.
router.post('/:id/lab-approve', serializePetitionWrite(async (req, res) => {
  try {
    const doc = await Petition.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    const actor = await additionalActor(req, res, doc, 'lab', true);
    if (!actor) return;
    if (['success', 'approved', 'rejected'].includes(doc.status)) {
      return res.status(409).json({ error: { message: 'คำร้องนี้ผ่านขั้นออกผล Lab แล้ว' } });
    }
    if (!doc.labCompletedAt) return badRequest(res, 'ผู้ทดสอบ Lab ยังไม่ได้บันทึกผล');
    if (doc.labApprovedAt) return badRequest(res, 'ออกผล Lab ไปแล้ว');
    const additionalError = await additionalCompletionError(doc, ['lab']);
    if (additionalError) return res.status(409).json({ error: { message: additionalError } });

    const now = new Date();
    doc.labApprovedAt = now;
    doc.labApprovedBy = actor;
    doc.reviewHistory.push({ action: 'lab-approve', reviewedBy: actor, reviewedAt: now });

    const prevStatus = doc.status;
    const finalWaitNote = requiresQcTrack(doc) ? 'รอหัวหน้า QC ออก Final Result' : 'รอ Final Result';
    if (isPetitionComplete(doc)) {
      if (doc.status !== 'success') doc.status = 'success';
      if (!doc.completedAt) doc.completedAt = now;
      await doc.save();
      logAudit(doc, {
        event: 'statusChanged', fromStatus: prevStatus, toStatus: 'success', actor,
        note: `หัวหน้า Lab ออกผล — ครบทุกส่วน ${finalWaitNote}`, metadata: { side: 'lab' },
      });
    } else {
      await doc.save();
      logAudit(doc, {
        event: 'updated', toStatus: doc.status, actor,
        note: 'หัวหน้า Lab ออกผล — รอ QC ตรวจให้ครบ', metadata: { side: 'lab' },
      });
    }
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// POST /api/petitions/:id/lab-reject  → หัวหน้า Lab ส่งผล Lab กลับให้ผู้ทดสอบแก้ (ไม่ใช่ reject ทั้งใบ).
router.post('/:id/lab-reject', serializePetitionWrite(async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note) return badRequest(res, 'กรุณาระบุเหตุผลที่ส่งกลับ');
    const doc = await Petition.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    const actor = await additionalActor(req, res, doc, 'lab', true);
    if (!actor) return;
    if (['approved', 'rejected'].includes(doc.status)) {
      return res.status(409).json({ error: { message: 'คำร้องนี้ปิดแล้ว' } });
    }
    if (!doc.labCompletedAt) return badRequest(res, 'ยังไม่มีผล Lab ให้ส่งกลับ');

    doc.labCompletedAt = null;
    doc.labCompletedBy = undefined;
    doc.labApprovedAt = null;
    doc.labApprovedBy = undefined;
    doc.labReturnNote = note;
    doc.reviewHistory.push({ action: 'lab-reject', reviewedBy: actor, reviewedAt: new Date(), note });
    await doc.save();
    logAudit(doc, {
      event: 'updated', toStatus: doc.status, actor,
      note: `หัวหน้า Lab ส่งกลับให้แก้: ${note}`, metadata: { side: 'lab', returnTo: 'lab' },
    });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// POST /api/petitions/:id/lab-agreement-review
// บันทึก "สำหรับหัวหน้าห้องปฏิบัติการ" ครั้งเดียว → เขียนลงทุก LabRequest ของคำร้อง (fan-out)
router.post('/:id/lab-agreement-review', async (req, res) => {
  try {
    const actor = req.body?.actor || 'system';
    const review = { ...(req.body?.review || {}) };
    delete review.reviewedAt;
    delete review.reviewedBy;
    review.reviewedBy = actor;
    review.reviewedAt = new Date();

    const petition = await Petition.findById(req.params.id).lean();
    if (!petition) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });

    const result = await LabRequest.updateMany(
      { petitionId: petition._id },
      { $set: { labAgreementReview: review } },
    );
    const updated = result.modifiedCount ?? result.nModified ?? 0;
    res.json({ updated, review });
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// GET /api/petitions/:id
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let doc = mongoose.Types.ObjectId.isValid(id)
      ? await Petition.findById(id)
      : await Petition.findOne({ petitionNo: id });
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    // Lazy phase advance: if phase2DueAt has elapsed, transition to Phase 2 on read
    doc = await maybeAdvancePhase(doc);
    res.json(doc.toObject());
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// PATCH /api/petitions/:id/advance-phase — manual phase advance (admin override)
router.patch('/:id/advance-phase', serializePetitionWrite(async (req, res) => {
  try {
    const id = req.params.id;
    const q = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { petitionNo: id };
    const doc = await Petition.findOne(q);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    if (doc.additionalSampleRequests?.length) {
      const round = doc.additionalSampleRequests.find(entry => String(entry._id) === String(req.body?.additionalSampleId || ''));
      if (!round || round.status !== 'received' || round.side !== req.body?.side) return res.status(409).json({ error: { message: 'กรุณาระบุรอบตัวอย่างที่รับแล้วและฝ่ายที่ต้องการเปิด Phase 2' } });
      const actor = await additionalActor(req, res, doc, round.side, true);
      if (!actor) return;
      if (round.currentPhase === 2) return badRequest(res, 'ตัวอย่างรอบนี้อยู่ใน Phase 2 แล้ว');
      if (['approved', 'rejected'].includes(doc.status)) return res.status(409).json({ error: { message: 'คำขอนี้ปิดแล้ว' } });
      round.phase2DueAt = new Date();
      const advanced = await maybeAdvancePhase(doc, actor);
      return res.json(advanced.toObject());
    }
    if (doc.currentPhase === 2) {
      return badRequest(res, 'คำร้องนี้อยู่ใน Phase 2 แล้ว');
    }
    // Force unlock: set due to now and let maybeAdvancePhase run
    doc.phase2DueAt = new Date();
    const actor = req.body?.actor || 'system';
    const advanced = await maybeAdvancePhase(doc, actor);
    res.json(advanced.toObject());
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// POST /api/petitions
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    if (Object.keys(body).some(key => key.startsWith('additionalSampleRequests') || key.startsWith('$'))) return badRequest(res, 'รอบตัวอย่างเพิ่มต้องสร้างหลังรับและบันทึกผลตรวจเท่านั้น');
    const submissionError = validatePetitionSubmission(body);
    if (submissionError) return badRequest(res, submissionError);
    let revisionOf = null;
    if (body.revisionOf) {
      if (!mongoose.Types.ObjectId.isValid(body.revisionOf)) {
        return badRequest(res, 'revisionOf ไม่ใช่รหัสคำร้องที่ถูกต้อง');
      }
      const predecessor = await Petition.findById(body.revisionOf).lean();
      if (!predecessor) {
        return badRequest(res, 'ไม่พบคำร้องต้นทาง');
      }
      if (predecessor.status !== 'rejected') {
        return badRequest(res, 'คำร้องต้นทางไม่ได้ถูกส่งกลับให้แก้ไข');
      }
      const submitterId = body.submittedBy?.employeeId?.trim();
      const predecessorId = predecessor.submittedBy?.employeeId?.trim();
      if (!submitterId || !predecessorId) {
        return res.status(403).json({ error: { message: 'การยื่นคำร้องแก้ไขต้องระบุรหัสพนักงาน' } });
      }
      if (submitterId !== predecessorId) {
        return res.status(403).json({ error: { message: 'เฉพาะผู้ยื่นคำร้องเดิมเท่านั้นที่สามารถยื่นแก้ไขได้' } });
      }
      revisionOf = predecessor._id;
    }
    const petitionNo = await nextPetitionNo();
    // เลขที่ใบนำส่ง: ใช้ค่าที่กรอก ถ้าเว้นว่าง default = เลขคำขอ
    const items = normalizePetitionItems(body.items, {
      department: body.submittedBy?.department,
      petitionNo,
    });
    const submittedBy = await resolveEmployeeActor(body.submittedBy);
    const doc = await Petition.create({
      ...body,
      submittedBy,
      items,
      petitionNo,
      status: 'deliveringQC',
      revisionOf,
      productionWorkflow: buildProductionWorkflow(body.productionWorkflow, petitionNo),
    });
    logAudit(doc, {
      event: 'created',
      toStatus: doc.status,
      actor: body.actor || body.submittedBy?.name || 'system',
      note: revisionOf ? `สร้างคำร้องใหม่ (แก้ไขจาก ${body.revisionOf})` : 'สร้างคำร้องใหม่',
      metadata: revisionOf ? { revisionOf: String(revisionOf) } : undefined,
    });
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// PATCH /api/petitions/:id/deliver  → mark sample as sent (scan ส่ง)
router.patch('/:id/deliver', serializePetitionWrite(async (req, res) => {
  try {
    const id = req.params.id;
    const q = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { petitionNo: id };
    const before = await Petition.findOne(q).lean();
    if (!before) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    if (req.body?.additionalSampleId || req.body?.additionalSampleCode) return await changeAdditionalSampleState(req, res, before, 'deliver');
    if (pendingAdditionalSamples(before).length) return res.status(409).json({ error: { message: 'กรุณาสแกน QR ใบนำส่งตัวอย่างเพิ่มของรอบนี้' } });
    if (before.additionalSampleRequests?.length) return res.status(409).json({ error: { message: 'คำขอนี้นำส่งแล้ว กรุณาใช้ QR รอบตัวอย่างเพิ่ม' } });
    const update = { status: 'sampleSent' };
    if (req.body?.deliveredBy?.name) update.deliveredBy = await resolveEmployeeActor(req.body.deliveredBy);
    if (!before.sampleSentAt) update.sampleSentAt = new Date();
    const doc = await Petition.findOneAndUpdate({ ...q, status: before.status, __v: before.__v == null ? { $exists: false } : before.__v }, { $set: update, $inc: { __v: 1 } }, { new: true });
    if (!doc) return res.status(409).json({ error: { message: 'คำขอเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่' } });
    if (before.status !== doc.status) {
      logAudit(doc, {
        event: 'statusChanged',
        fromStatus: before.status,
        toStatus: doc.status,
        actor: req.body?.actor || 'system',
        note: 'สแกนส่งตัวอย่าง',
      });
    }
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// PATCH /api/petitions/:id/receive  → QC/Lab รับตัวอย่าง (scan รับ)
router.patch('/:id/receive', serializePetitionWrite(async (req, res) => {
  try {
    const id = req.params.id;
    const q = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { petitionNo: id };
    const before = await Petition.findOne(q).lean();
    if (!before) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    if (req.body?.additionalSampleId || req.body?.additionalSampleCode) return await changeAdditionalSampleState(req, res, before, 'receive');
    // บล็อกเฉพาะสถานะที่ปิดงานแล้ว — ฝั่งที่สอง (Lab/QC) ยังรับได้แม้ status เป็น pendingReview/inProgress
    if (['success', 'approved', 'rejected'].includes(before.status)) {
      return badRequest(res, `ไม่สามารถรับได้: สถานะปัจจุบันคือ ${before.status}`);
    }
    const actor = req.body?.actor || 'system';
    const side = req.body?.side === 'lab' ? 'lab' : 'qc';
    if (pendingAdditionalSamples(before, side).length) return res.status(409).json({ error: { message: 'กรุณาสแกน QR ใบนำส่งตัวอย่างเพิ่มของรอบนี้' } });
    if (before.additionalSampleRequests?.some(round => round.side === side)) return res.status(409).json({ error: { message: 'รับตัวอย่างเดิมแล้ว กรุณาใช้ QR รอบตัวอย่างเพิ่ม' } });
    if (side === 'qc' && !requiresQcTrack(before)) return badRequest(res, 'คำขอ R&D ไม่ต้องส่ง QC');
    const now = new Date();
    const update = {
      [`${side}ReceivedBy`]: actor,
      [`${side}ReceivedAt`]: now,
    };
    if (before.status === 'sampleSent' || before.status === 'deliveringQC') {
      update.status = 'pendingReview';
    }
    if (!before.sampleSentAt && (before.status === 'sampleSent' || before.status === 'deliveringQC')) {
      update.sampleSentAt = now;
    }
    // legacy receivedBy/At = ฝั่งแรกที่รับ (ไม่ทับถ้ามีแล้ว) เพื่อให้ print/HomeQC ทำงานต่อ
    if (!before.receivedAt) {
      update.receivedBy = actor;
      update.receivedAt = now;
    }
    const doc = await Petition.findOneAndUpdate({ ...q, status: before.status, __v: before.__v == null ? { $exists: false } : before.__v }, { $set: update, $inc: { __v: 1 } }, { new: true });
    if (!doc) return res.status(409).json({ error: { message: 'คำขอเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่' } });
    logAudit(doc, {
      event: 'received',
      fromStatus: before.status,
      toStatus: doc.status,
      actor,
      note: side === 'lab' ? 'Lab รับตัวอย่าง' : 'QC รับตัวอย่าง',
      metadata: { side },
    });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// PATCH /api/petitions/:id/assign
router.patch('/:id/assign', serializePetitionWrite(async (req, res) => {
  try {
    const { employeeId, name, department, position, assignedBy, machines } = req.body || {};
    if (!employeeId || !name) return badRequest(res, 'กรุณาเลือกเจ้าหน้าที่');

    const q = mongoose.Types.ObjectId.isValid(req.params.id)
      ? { _id: req.params.id }
      : { petitionNo: req.params.id };

    const doc = await Petition.findOne(q);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    if (!doc.labReceivedAt && (doc.qcReceivedAt || !doc.receivedAt)) {
      return res.status(409).json({ error: { message: 'Lab ต้องรับตัวอย่างก่อนจึงจะ assign ได้' } });
    }

    const prevStatus = doc.status;
    doc.assignedTo = {
      employeeId: String(employeeId).trim(),
      name: String(name).trim(),
      department: department ? String(department).trim() : undefined,
      position: position ? String(position).trim() : undefined,
      assignedAt: new Date(),
      assignedBy: assignedBy ? String(assignedBy).trim() : undefined,
    };

    if (Array.isArray(machines)) {
      const cleaned = machines
        .filter((m) => m && m.machineId && m.code && m.name)
        .map((m) => ({
          machineId: String(m.machineId).trim(),
          code: String(m.code).trim(),
          name: String(m.name).trim(),
          location: m.location ? String(m.location).trim() : undefined,
          sampleName: m.sampleName ? String(m.sampleName).trim() : undefined,
          commonName: m.commonName ? String(m.commonName).trim() : undefined,
        }));
      for (const machine of cleaned) {
        const standard = await matchStandardTime(machine);
        if (!standard) continue;
        machine.standardTimeId = String(standard._id);
        machine.estimatedMinutes = standard.standardTimeMin;
        machine.estimatedSource = `${standard.instrument} / ${standard.analysisName}`;
      }
      doc.assignedMachines = cleaned;
    }

    if (doc.status === 'pendingReview') doc.status = 'inProgress';

    await doc.save();
    logAudit(doc, {
      event: 'assigned',
      fromStatus: prevStatus,
      toStatus: doc.status,
      actor: assignedBy || 'system',
      note: `มอบหมายให้ ${doc.assignedTo.name}${doc.assignedMachines?.length ? ` (เครื่อง: ${doc.assignedMachines.map((m) => m.code).join(', ')})` : ''}`,
      metadata: { assignee: doc.assignedTo, machines: doc.assignedMachines },
    });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// PATCH /api/petitions/:id  (general update + approve/reject transitions)
router.patch('/:id', serializePetitionWrite(async (req, res) => {
  try {
    const updates = { ...req.body };
    const managedFields = ['additionalSampleRequests', 'assignedTo', 'assignedMachines', 'qcCompletedAt', 'qcCompletedBy', 'labCompletedAt', 'labCompletedBy', 'labApprovedAt', 'labApprovedBy', 'completedAt', 'qcReceivedAt', 'qcReceivedBy', 'labReceivedAt', 'labReceivedBy', 'receivedAt', 'receivedBy', 'sampleSentAt', '__v'];
    if (Object.keys(updates).some(key => key.startsWith('$') || key.includes('.') || managedFields.includes(key))) return badRequest(res, 'ข้อมูลสถานะและรอบตัวอย่างต้องเปลี่ยนผ่านขั้นตอนที่กำหนด');
    let actor = updates.actor;
    delete updates.actor;
    delete updates.petitionNo;
    delete updates._id;
    delete updates.revisionOf;     // revisionOf is set on create only
    delete updates.target;          // routing hint for reject only
    delete updates.approvedAt;     // server-managed
    delete updates.rejectedAt;     // server-managed

    const before = await Petition.findById(req.params.id);
    if (!before) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });

    // Terminal-state guard
    if ((before.status === 'approved' || before.status === 'rejected') && updates.status && updates.status !== before.status) {
      return res.status(409).json({ error: { message: 'คำร้องนี้ปิดแล้ว ไม่สามารถเปลี่ยนสถานะได้' } });
    }

    // `success` is gated: it must be reached via POST /:id/complete (which checks
    // that every required track — QC always, Lab for lab batches — has finished),
    // never forced straight through a generic update.
    if (updates.status === 'success' && before.status !== 'success') {
      return res.status(409).json({ error: { message: 'ต้องบันทึกผลผ่านแต่ละส่วน (Lab/QC) — สถานะ "เสร็จสิ้น" ตั้งตรงไม่ได้' } });
    }

    // Approve transition: success → approved (conclusion = pass | accepted-oos)
    if (updates.status === 'approved') {
      actor = await additionalActor(req, res, before, 'qc', true);
      if (!actor) return;
      const additionalError = await additionalCompletionError(before, ['qc', 'lab']);
      if (additionalError) return res.status(409).json({ error: { message: additionalError } });
      if (before.status !== 'success') {
        return res.status(409).json({ error: { message: 'ออก Final Result ได้เฉพาะคำร้องสถานะ "ทดสอบเสร็จสิ้น"' } });
      }
      const conclusion = ['pass', 'accepted-oos'].includes(req.body.conclusion)
        ? req.body.conclusion
        : 'pass';
      if (conclusion === 'accepted-oos') {
        const reason = String(req.body.conclusionNote || '').trim();
        if (!reason) return badRequest(res, 'กรุณาระบุเหตุผลที่ยอมรับผลไม่ปกติ');
        before.conclusionNote = reason;
      }
      before.status = 'approved';
      before.conclusion = conclusion;
      before.approvedAt = new Date();
      before.reviewHistory.push({
        action: 'approve',
        reviewedBy: actor || 'system',
        reviewedAt: new Date(),
      });
      await before.save();
      logAudit(before, {
        event: 'statusChanged',
        fromStatus: 'success',
        toStatus: 'approved',
        actor: actor || 'system',
        note: conclusion === 'accepted-oos' ? 'ยอมรับผลไม่ปกติ' : 'ออก Final Result (ผลถูกต้อง)',
        metadata: { conclusion },
      });
      return res.json(before);
    }

    // Reject transition: success → (requester=ปิดงาน | lab|qc|both=ส่งกลับทดสอบใหม่)
    if (updates.status === 'rejected') {
      actor = await additionalActor(req, res, before, 'qc', true);
      if (!actor) return;
      if (before.status !== 'success') {
        return res.status(409).json({ error: { message: 'ส่งกลับให้แก้ไขได้เฉพาะคำร้องสถานะ "ทดสอบเสร็จสิ้น"' } });
      }
      const note = String(updates.revisionNote || '').trim();
      if (!note) return badRequest(res, 'กรุณาระบุข้อความที่ต้องการให้แก้ไข');
      const target = ['requester', 'lab', 'qc', 'both'].includes(req.body.target) ? req.body.target : 'requester';

      if (target === 'requester') {
        before.status = 'rejected';
        before.rejectedAt = new Date();
        before.conclusion = 'returned-to-requester';
        before.conclusionNote = note;
        before.reviewHistory.push({ action: 'reject', reviewedBy: actor || 'system', reviewedAt: new Date(), note });
        await before.save();
        logAudit(before, {
          event: 'statusChanged', fromStatus: 'success', toStatus: 'rejected',
          actor: actor || 'system', note: `ส่งคืนผู้ส่งแก้ product: ${note}`, metadata: { returnTo: 'requester', conclusion: 'returned-to-requester' },
        });
        return res.json(before);
      }

      // target lab/qc/both — เด้ง track กลับเป็น inProgress (ไม่ปิดงาน ไม่ตั้ง conclusion)
      before.status = 'inProgress';
      before.completedAt = null;
      // Rework starts a fresh review loop; clear terminal decision metadata.
      before.conclusion = null;
      before.conclusionNote = null;
      before.approvedAt = null;
      before.rejectedAt = null;
      if (target === 'lab' || target === 'both') {
        before.labCompletedAt = null;
        before.labCompletedBy = undefined;
        before.labApprovedAt = null;
        before.labApprovedBy = undefined;
        before.labReturnNote = note;
      }
      if (target === 'qc' || target === 'both') {
        before.qcCompletedAt = null;
        before.qcCompletedBy = undefined;
        before.qcReturnNote = note;
      }
      before.reviewHistory.push({ action: 'reject', reviewedBy: actor || 'system', reviewedAt: new Date(), note });
      const targetLabel = target === 'lab' ? 'ฝั่ง Lab' : target === 'qc' ? 'ฝั่ง QC' : 'ทั้ง Lab และ QC';
      await before.save();
      logAudit(before, {
        event: 'statusChanged', fromStatus: 'success', toStatus: 'inProgress',
        actor: actor || 'system',
        note: `หัวหน้า QC ส่งกลับ${targetLabel}ทดสอบใหม่: ${note}`,
        metadata: { returnTo: target },
      });
      return res.json(before);
    }

    // Generic update path (no terminal transition)
    if (before.additionalSampleRequests?.length && (updates.items || updates.submittedBy || (updates.status && updates.status !== before.status))) return res.status(409).json({ error: { message: 'คำขอมีรอบตัวอย่างเพิ่ม ต้องใช้ขั้นตอนรับและตรวจผลตามรอบ' } });
    delete updates.revisionNote;
    // เลขที่ใบนำส่ง: ใช้ค่าที่กรอก ถ้าเว้นว่าง default = เลขคำขอ
    if (Array.isArray(updates.items)) {
      updates.items = normalizePetitionItems(updates.items, {
        department: updates.submittedBy?.department ?? before.submittedBy?.department,
        petitionNo: before.petitionNo,
      });
      const nextBody = { ...(before.toObject ? before.toObject() : before), ...updates };
      const submissionError = validatePetitionSubmission(nextBody);
      if (submissionError) return badRequest(res, submissionError);
    }
    const doc = await Petition.findOneAndUpdate({ _id: before._id, status: before.status, __v: before.__v == null ? { $exists: false } : before.__v }, { $set: updates, $inc: { __v: 1 } }, { new: true });
    if (!doc) return res.status(409).json({ error: { message: 'คำขอเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่' } });
    if (before.status !== doc.status) {
      logAudit(doc, {
        event: 'statusChanged',
        fromStatus: before.status,
        toStatus: doc.status,
        actor: actor || 'system',
        note: 'อัปเดตคำร้อง',
      });
    } else {
      logAudit(doc, {
        event: 'updated',
        toStatus: doc.status,
        actor: actor || 'system',
        note: 'อัปเดตคำร้อง',
      });
    }
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// POST /api/petitions/:id/review  → append a review entry & update status
router.post('/:id/review', serializePetitionWrite(async (req, res) => {
  try {
    const { action, reviewedBy, note, specificGravities, status, items } = req.body || {};
    if (!action || !reviewedBy) return badRequest(res, 'ข้อมูลรีวิวไม่ครบ');
    const doc = await Petition.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    if ((doc.status === 'approved' || doc.status === 'rejected') && status && status !== doc.status) {
      return res.status(409).json({ error: { message: 'คำร้องนี้ปิดแล้ว ไม่สามารถเปลี่ยนสถานะได้' } });
    }
    if (doc.additionalSampleRequests?.length && (items || (status && status !== doc.status))) return res.status(409).json({ error: { message: 'คำขอมีรอบตัวอย่างเพิ่ม ต้องยืนยันผ่านขั้นตอนบันทึกผลและ Final Result' } });
    const prevStatus = doc.status;
    doc.reviewHistory.push({
      action,
      reviewedBy,
      reviewedAt: new Date(),
      note,
      specificGravities: specificGravities || [],
    });
    if (status) doc.status = status;
    if (Array.isArray(items)) {
      // merge per-seq
      for (const incoming of items) {
        const target = doc.items.find((it) => it.seq === incoming.seq);
        if (target) Object.assign(target, incoming);
      }
    }
    await doc.save();
    logAudit(doc, {
      event: prevStatus !== doc.status ? 'statusChanged' : 'reviewed',
      fromStatus: prevStatus,
      toStatus: doc.status,
      actor: reviewedBy,
      note: note || `พิจารณา: ${action}`,
      metadata: { action },
    });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

// DELETE /api/petitions/:id
router.delete('/:id', async (req, res) => {
  try {
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    const doc = await Petition.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    logAudit(doc, {
      event: 'deleted',
      fromStatus: doc.status,
      actor,
      note: 'ลบคำร้อง',
    });
    await doc.softDelete(actor);
    const sampleIds = sampleIdsFromPetition(doc);
    if (sampleIds.length > 0) {
      await Promise.all([
        Sample.softDeleteMany({ id: { $in: sampleIds } }, actor),
        PhysicalResult.softDeleteMany({ sampleId: { $in: sampleIds } }, actor),
        Approval.softDeleteMany({ sampleId: { $in: sampleIds } }, actor),
        RealtimeDensity.softDeleteMany({ sampleId: { $in: sampleIds } }, actor),
      ]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
module.exports.latestDeliverableRevision = latestDeliverableRevision;
