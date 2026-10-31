const express = require('express');
const router = express.Router();
const Approval = require('../models/Approval');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const QCTestResult = require('../models/QCTestResult');
const { notifyPetitionEvent } = require('../lib/lineNotify');
const { serializePetitionWrite } = require('../lib/petitionWriteQueue');
const { additionalSampleCompletionError } = require('../lib/additionalSamples');
const { resolveApprovalTabs } = require('../lib/qcApprovalAccess');
const { notifyProductionBatches } = require('../lib/productionCallback');
const {
  itemRequiresSide,
  upsertItemApproval,
  allItemsApproved,
  approvedBatchNos,
  overallConclusion,
  batchResultSummary,
} = require('../lib/itemApprovals');
const { currentUser } = require('./additionalSamples');

const CLOSED = ['approved', 'rejected'];

// ออก Final Result ทั้งใบเมื่อทุกรายการอนุมัติครบทุกฝั่ง (ใช้ร่วมกับการแก้ผลโดยหัวหน้า Lab)
// คืน payload audit เมื่อปิดใบ หรือ null ถ้ายังไม่ครบ/ติดรอบตัวอย่างเพิ่ม
async function finalizeIfComplete(petition, actor) {
  if (CLOSED.includes(petition.status) || !allItemsApproved(petition)) return null;
  if (petition.additionalSampleRequests?.length) {
    const results = await QCTestResult.find({ petitionId: String(petition._id) }).lean();
    for (const side of ['qc', 'lab']) {
      if (additionalSampleCompletionError(petition, side, results)) return null;
    }
  }
  const prevStatus = petition.status;
  const { conclusion, note } = overallConclusion(petition);
  const now = new Date();
  petition.status = 'approved';
  petition.conclusion = conclusion;
  if (conclusion === 'accepted-oos') petition.conclusionNote = note;
  petition.approvedAt = now;
  if (!petition.completedAt) petition.completedAt = now;
  petition.reviewHistory.push({ action: 'approve', reviewedBy: actor, reviewedAt: now });
  return {
    event: 'statusChanged',
    fromStatus: prevStatus,
    toStatus: 'approved',
    actor,
    note: conclusion === 'accepted-oos' ? 'อนุมัติครบทุกรายการ (ยอมรับผลไม่ปกติ)' : 'อนุมัติครบทุกรายการ — ออก Final Result',
    metadata: { conclusion, source: 'item-approval' },
  };
}

function writeAudit(petition, payload, notify) {
  PetitionAuditLog.create({ petitionId: petition._id, petitionNo: petition.petitionNo, ...payload })
    .catch((err) => console.error('[audit-log] failed:', err.message));
  if (notify) notifyPetitionEvent(petition, payload);
}

function newlyApprovedBatches(petition, before) {
  const prev = new Set(before);
  return approvedBatchNos(petition)
    .filter((batchNo) => !prev.has(batchNo))
    .map((batchNo) => ({ batchNo, summary: batchResultSummary(petition, batchNo) }));
}

// POST /api/approvals/petitions/:id/items
// { side: 'qc'|'lab', decision: 'approve'|'reject', items: [{ seq, abnormal? }], note? }
// อนุมัติ/ไม่อนุมัติรายรายการจากหน้า /qc-approval — ตรวจสิทธิ์ระดับ tab (deny:/qc-approval/<side>)
router.post('/petitions/:id/items', serializePetitionWrite(async (req, res) => {
  try {
    const side = req.body?.side === 'lab' ? 'lab' : req.body?.side === 'qc' ? 'qc' : null;
    const decision = ['approve', 'reject'].includes(req.body?.decision) ? req.body.decision : null;
    if (!side || !decision) return res.status(400).json({ error: { message: 'ข้อมูลไม่ถูกต้อง' } });
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const note = String(req.body?.note || '').trim();
    if (note.length > 2000) return res.status(400).json({ error: { message: 'เหตุผลยาวเกินไป' } });

    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: { message: 'กรุณาเข้าสู่ระบบ' } });
    const tabs = await resolveApprovalTabs(user);
    if (!tabs.includes(side)) {
      return res.status(403).json({ error: { message: side === 'lab' ? 'ไม่มีสิทธิ์อนุมัติผล Lab' : 'ไม่มีสิทธิ์อนุมัติผล QC' } });
    }

    const petition = await Petition.findById(req.params.id);
    if (!petition) return res.status(404).json({ error: { message: 'ไม่พบคำร้อง' } });
    if (CLOSED.includes(petition.status)) return res.status(409).json({ error: { message: 'คำร้องนี้ปิดแล้ว' } });
    const trackDone = side === 'qc' ? petition.qcCompletedAt : petition.labCompletedAt;
    if (!trackDone) {
      return res.status(409).json({ error: { message: side === 'lab' ? 'Lab ยังไม่ยืนยันผล' : 'QC ยังไม่ยืนยันผล' } });
    }

    const seen = new Set();
    const targets = [];
    for (const raw of rawItems) {
      const seq = Number(raw?.seq);
      if (!Number.isInteger(seq) || seen.has(seq)) continue;
      const item = (petition.items || []).find((it) => it.seq === seq);
      if (!item || !itemRequiresSide(petition, item, side)) {
        return res.status(400).json({ error: { message: `รายการที่ ${seq} ไม่อยู่ในผลฝั่งนี้` } });
      }
      seen.add(seq);
      targets.push({ seq, abnormal: raw?.abnormal === true });
    }
    if (!targets.length) return res.status(400).json({ error: { message: 'กรุณาเลือกรายการ' } });
    if (decision === 'reject' && !note) return res.status(400).json({ error: { message: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' } });
    if (decision === 'approve' && targets.some((t) => t.abnormal) && !note) {
      return res.status(400).json({ error: { message: 'กรุณาระบุเหตุผลที่ยอมรับผลไม่ปกติ' } });
    }

    const actor = user.name || user.email;
    const now = new Date();
    const batchesBefore = approvedBatchNos(petition);
    const prevStatus = petition.status;
    const seqLabel = targets.map((t) => t.seq).join(', ');
    const sideLabel = side === 'lab' ? 'Lab' : 'QC';

    for (const target of targets) {
      upsertItemApproval(petition, decision === 'approve'
        ? {
          seq: target.seq, side, status: 'approved',
          conclusion: target.abnormal ? 'accepted-oos' : 'pass',
          note: note || undefined, by: actor, at: now, source: 'qc-approval',
        }
        : { seq: target.seq, side, status: 'rejected', note, by: actor, at: now, source: 'qc-approval' });
    }

    let finalPayload = null;
    if (decision === 'reject') {
      // ส่งผลฝั่งนั้นกลับไปทดสอบใหม่ (รายการที่อนุมัติไปแล้วคงสถานะเดิม)
      if (side === 'qc') {
        petition.qcCompletedAt = null;
        petition.qcCompletedBy = undefined;
        petition.qcReturnNote = note;
      } else {
        petition.labCompletedAt = null;
        petition.labCompletedBy = undefined;
        petition.labApprovedAt = null;
        petition.labApprovedBy = undefined;
        petition.labReturnNote = note;
      }
      if (petition.status === 'success') petition.status = 'inProgress';
      petition.completedAt = null;
      petition.reviewHistory.push({ action: 'reject', reviewedBy: actor, reviewedAt: now, note: `รายการที่ ${seqLabel} (${sideLabel}): ${note}` });
    } else {
      finalPayload = await finalizeIfComplete(petition, actor);
    }

    await petition.save();

    writeAudit(petition, {
      event: decision === 'reject' && prevStatus !== petition.status ? 'statusChanged' : 'reviewed',
      fromStatus: prevStatus,
      toStatus: decision === 'reject' ? petition.status : prevStatus,
      actor,
      note: decision === 'approve'
        ? `อนุมัติผล ${sideLabel} รายการที่ ${seqLabel}${note ? `: ${note}` : ''}`
        : `ไม่อนุมัติผล ${sideLabel} รายการที่ ${seqLabel} — ส่งกลับ${sideLabel}ทดสอบใหม่: ${note}`,
      metadata: { type: 'itemApproval', side, decision, seqs: targets.map((t) => t.seq), returnTo: decision === 'reject' ? side : undefined },
    }, decision === 'reject');
    if (finalPayload) writeAudit(petition, finalPayload, true);

    const batches = decision === 'approve' ? newlyApprovedBatches(petition, batchesBefore) : [];
    if (batches.length) notifyProductionBatches(petition, batches);

    res.json(petition.toObject());
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
}));

router.get('/', async (req, res) => {
  try {
    const approvals = await Approval.find();
    const map = {};
    approvals.forEach(a => {
      map[a.sampleId] = {
        labApproved: a.labApproved,
        labApprovedAt: a.labApprovedAt,
        qcStatus: a.qcStatus,
        qcNote: a.qcNote,
      };
    });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:sampleId/lab', async (req, res) => {
  try {
    const approval = await Approval.findOneAndUpdate(
      { sampleId: req.params.sampleId },
      { labApproved: true, labApprovedAt: new Date() },
      { new: true, upsert: true }
    );
    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:sampleId/qc', async (req, res) => {
  try {
    const { status, note, actor } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const approval = await Approval.findOneAndUpdate(
      { sampleId: req.params.sampleId },
      { qcStatus: status, qcNote: note },
      { new: true, upsert: true }
    );

    // Petition → success when all samples have qcStatus === 'approved'
    // ใบที่ปิดแล้ว (approved/rejected) ต้องไม่ถูกเปิดกลับเป็น success จากการอนุมัติรายตัวอย่าง
    const CLOSED_PETITION_STATUSES = ['success', 'approved', 'rejected'];
    if (status === 'approved') {
      const petition = await Petition.findOne({ 'items.sampleId': req.params.sampleId });
      if (petition && !CLOSED_PETITION_STATUSES.includes(petition.status)) {
        const sampleIds = (petition.items || [])
          .map((it) => it.sampleId || `${petition.petitionNo}-${it.seq}`)
          .filter(Boolean);
        const approvals = await Approval.find({ sampleId: { $in: sampleIds } }).lean();
        const allApproved =
          sampleIds.length > 0 &&
          sampleIds.every((sid) => approvals.find((a) => a.sampleId === sid)?.qcStatus === 'approved');
        if (allApproved) {
          const prevStatus = petition.status;
          petition.status = 'success';
          if (!petition.completedAt) petition.completedAt = new Date();
          await petition.save();
          const auditPayload = {
            event: 'statusChanged',
            fromStatus: prevStatus,
            toStatus: petition.status,
            actor: actor || 'system',
            note: 'QC อนุมัติครบทุกตัวอย่าง',
          };
          PetitionAuditLog.create({
            petitionId: petition._id,
            petitionNo: petition.petitionNo,
            ...auditPayload,
          }).catch((err) => console.error('[audit-log] failed:', err.message));
          notifyPetitionEvent(petition, auditPayload);
        }
      }
    }

    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.finalizeIfComplete = finalizeIfComplete;
module.exports.newlyApprovedBatches = newlyApprovedBatches;
module.exports.writeAudit = writeAudit;
