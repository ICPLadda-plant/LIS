const crypto = require('crypto');
const express = require('express');
const ProductionIntegrationRequest = require('../models/ProductionIntegrationRequest');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const LabRequest = require('../models/LabRequest');
const { notifyPetitionEvent } = require('../lib/lineNotify');
const { resolveEmployeeActor } = require('../lib/employeeResolver');
const {
  applyItemNotes,
  buildEditedItems,
  canEditWholePetition,
  routeTargetsForItems,
} = require('../lib/productionPetitionEdit');

const router = express.Router();

router.use(express.urlencoded({ extended: true, limit: '10mb' }));

function authorized(req) {
  // apiGuard (mount ก่อนหน้านี้ใน server/index.js) เซ็ต req.apiKey ให้เฉพาะตอน verdict อนุมัติ
  // จริง (allow) เท่านั้น — รับเป็น credential ทางเลือกคู่กับ token เดิม เพื่อไม่ให้ขั้นตอนสุดท้าย
  // ของ rollout (ลบ PRODUCTION_INTEGRATION_TOKEN ออกจาก .env) ทำให้ endpoint นี้ตายสำหรับผู้เรียก
  // ที่ย้ายไปส่ง X-API-Key แล้ว
  if (req.apiKey?.scopes?.includes('integration:write')) return true;
  const secret = process.env.PRODUCTION_INTEGRATION_TOKEN;
  // Missing shared secret must fail closed. API keys remain supported above.
  if (!secret) {
    // Keep local development flow, but never expose an unauthenticated ingest endpoint remotely.
    return process.env.NODE_ENV !== 'production' &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req?.ip);
  }
  const header = req.get('authorization') || '';
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1];
  return req.get('x-integration-token') === secret || bearer === secret;
}

router.post('/petitions', async (req, res) => {
  try {
    if (!authorized(req)) return res.status(401).json({ error: { message: 'Unauthorized' } });
    const payload = req.body || {};
    const token = crypto.randomBytes(18).toString('base64url');
    await ProductionIntegrationRequest.create({ token, payload });
    const prefix = req.originalUrl.startsWith('/LIS/') ? '/LIS' : '';
    res.status(201).json({
      token,
      redirectUrl: `${prefix}/petitions/ProductionIntegrationPetitionNewPage?integrationToken=${encodeURIComponent(token)}`,
    });
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

router.get('/petitions/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) {
      return res.status(400).json({ error: { message: 'Invalid token' } });
    }
    const doc = await ProductionIntegrationRequest.findOne({ token }).lean();
    if (!doc) return res.status(404).json({ error: { message: 'Integration request not found' } });
    res.json(doc.payload);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// Production กด "ส่งตัวอย่างเพิ่ม" พร้อมปริมาณต่อรายการ → รอบตัวอย่างเพิ่มเป็น sent
// body: { requestNo, sentBy?, items: [{ itemSeq, amount, unit? }] }
router.post('/petitions/:petitionNo/additional-samples/:roundId/send', async (req, res) => {
  try {
    if (!authorized(req)) return res.status(401).json({ error: { message: 'Unauthorized' } });
    const petition = await Petition.findOne({ petitionNo: String(req.params.petitionNo) }).lean();
    if (!petition) return res.status(404).json({ error: { message: 'ไม่พบคำขอ' } });
    const requestNo = String(req.body?.requestNo || '').trim();
    if (!requestNo || petition.productionWorkflow?.requestNo !== requestNo) {
      return res.status(403).json({ error: { message: 'requestNo ไม่ตรงกับคำขอ' } });
    }
    if (['approved', 'rejected'].includes(petition.status)) return res.status(409).json({ error: { message: 'คำขอนี้ปิดแล้ว' } });
    const round = (petition.additionalSampleRequests || []).find((r) => String(r._id) === String(req.params.roundId));
    if (!round) return res.status(404).json({ error: { message: 'ไม่พบรอบตัวอย่างเพิ่ม' } });
    if (round.status !== 'requested') return res.status(409).json({ error: { message: 'ส่งตัวอย่างรอบนี้แล้ว' } });
    const input = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = [];
    for (const it of round.items) {
      const row = input.find((x) => Number(x?.itemSeq) === it.itemSeq);
      const amount = Number(row?.amount);
      if (!row || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: { message: `กรุณากรอกปริมาณรายการที่ ${it.itemSeq}` } });
      }
      items.push({ ...(it.toObject?.() ?? it), sentAmount: amount, sentUnit: String(row.unit || '').trim() || undefined });
    }
    const sentBy = { name: String(req.body?.sentBy?.name || 'Production System').trim(), email: String(req.body?.sentBy?.email || '').trim() };
    const now = new Date();
    const updated = await Petition.findOneAndUpdate(
      { _id: petition._id, status: { $nin: ['approved', 'rejected'] }, additionalSampleRequests: { $elemMatch: { _id: round._id, status: 'requested' } } },
      { $set: {
        'additionalSampleRequests.$.status': 'sent',
        'additionalSampleRequests.$.sentAt': now,
        'additionalSampleRequests.$.sentBy': sentBy,
        'additionalSampleRequests.$.items': items,
      }, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );
    if (!updated) return res.status(409).json({ error: { message: 'รอบนี้ถูกดำเนินการแล้ว กรุณาโหลดใหม่' } });
    const payload = {
      event: 'updated', toStatus: updated.status, actor: sentBy.name,
      note: 'นำส่งตัวอย่างเพิ่ม (Production): ' + items.map((it) => `#${it.itemSeq} ${it.sentAmount}${it.sentUnit ? ' ' + it.sentUnit : ''}`).join(', '),
      metadata: { type: 'additionalSampleSent', side: round.side, additionalSampleId: String(round._id), reason: round.reason, items },
    };
    await PetitionAuditLog.create({ petitionId: updated._id, petitionNo: updated.petitionNo, ...payload });
    notifyPetitionEvent(updated, payload);
    res.json({ ok: true, petitionNo: updated.petitionNo, roundId: String(round._id), status: 'sent' });
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// Production แก้ไขคำขอ: ยังไม่รับตัวอย่าง = แทนที่รายการทั้งใบ (mode=full), รับแล้ว = แก้หมายเหตุอย่างเดียว (mode=note)
// body: { requestNo, mode, note, priority?, sampledBy?, updatedBy?, items?: [{ sampleName, commonName, itemNo, mfNo, packsize,
//         batchNo, lotNo, productionDate, qty, labQty, unit, sendToQc, sendToLab }] }
router.put('/petitions/:petitionNo', async (req, res) => {
  try {
    if (!authorized(req)) return res.status(401).json({ error: { message: 'Unauthorized' } });
    const requestNo = String(req.body?.requestNo || '').trim();
    // Production ที่ไม่ได้เลขคำร้องกลับมาจะเก็บ requestNo แทน petitionNo → หาจาก productionWorkflow.requestNo ต่อ
    const petition = await Petition.findOne({ petitionNo: String(req.params.petitionNo) })
      || (requestNo ? await Petition.findOne({ 'productionWorkflow.requestNo': requestNo, deletedAt: null }).sort({ createdAt: -1 }) : null);
    if (!petition) return res.status(404).json({ error: { message: 'ไม่พบคำขอ' } });
    if (!requestNo || petition.productionWorkflow?.requestNo !== requestNo) {
      return res.status(403).json({ error: { message: 'requestNo ไม่ตรงกับคำขอ' } });
    }
    const mode = req.body?.mode === 'full' ? 'full' : 'note';
    const note = String(req.body?.note ?? '').trim();
    // production ส่งชื่อจากบัญชีของตัวเอง (มักเป็นภาษาอังกฤษ) → จับคู่อีเมลกับ HR ให้ได้ชื่อไทย
    const updatedBy = req.body?.updatedBy ? await resolveEmployeeActor(req.body.updatedBy) : null;
    const actor = String(updatedBy?.name || 'Production System').trim();
    const before = { status: petition.status, __v: petition.__v };
    let update;
    let auditNote;
    if (mode === 'full') {
      if (!canEditWholePetition(petition)) {
        return res.status(409).json({ error: { message: 'รับตัวอย่างแล้ว แก้ไขได้เฉพาะหมายเหตุ' } });
      }
      const rows = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!rows.length) return res.status(400).json({ error: { message: 'ต้องมีตัวอย่างอย่างน้อย 1 รายการ' } });
      const items = buildEditedItems(petition.toObject().items, rows, {
        note,
        priority: req.body?.priority,
        department: petition.submittedBy?.department,
        petitionNo: petition.petitionNo,
      });
      if (items.some((item) => !item.sampleName || !item.batchNo)) {
        return res.status(400).json({ error: { message: 'กรุณาระบุชื่อตัวอย่างและ Batch ให้ครบ' } });
      }
      if (items.some((item) => item.sendToQc === false && item.sendToLab !== true)) {
        return res.status(400).json({ error: { message: 'ต้องเลือกส่งวิเคราะห์อย่างน้อย 1 ช่อง (QC หรือ Lab)' } });
      }
      update = { items, routeTargets: routeTargetsForItems(items) };
      const sampledName = String(req.body?.sampledBy?.name || '').trim();
      if (sampledName) {
        const employeeId = String(req.body?.sampledBy?.employeeId || '').trim();
        update.sampledBy = employeeId ? { employeeId, name: sampledName } : { name: sampledName };
      }
      auditNote = 'Production แก้ไขคำขอก่อนรับตัวอย่าง: ' + items.map((it) => `#${it.seq} ${it.batchNo} ${it.labelQuantity || ''}`.trim()).join(', ');
    } else {
      const itemNotes = Array.isArray(req.body?.itemNotes) ? req.body.itemNotes : [];
      update = { items: applyItemNotes(petition.toObject().items, itemNotes, note) };
      auditNote = 'Production แก้ไขหมายเหตุ: ' + (itemNotes.length
        ? itemNotes.map((n) => `#${n.seq} ${n.batchNo || '-'}: ${String(n.note || '').trim() || '-'}`).join(', ')
        : (note || '-'));
    }
    const saved = await Petition.findOneAndUpdate(
      { _id: petition._id, status: before.status, __v: before.__v == null ? { $exists: false } : before.__v },
      { $set: update, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );
    if (!saved) return res.status(409).json({ error: { message: 'คำขอเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่' } });
    if (mode === 'full') {
      // ใบคำขอรับบริการ Lab ผูกกับรายการ Lab ตัวแรก — ย้ายตามรายการที่แก้
      const firstLab = saved.items.find((item) => item.sendToLab === true);
      if (firstLab) {
        await LabRequest.updateMany(
          { petitionId: saved._id, deletedAt: null },
          { $set: { batchNo: firstLab.batchNo, sampleSeq: firstLab.seq } },
        );
      }
    }
    const payload = { event: 'updated', toStatus: saved.status, actor, note: auditNote, metadata: { type: 'productionEdit', mode } };
    await PetitionAuditLog.create({ petitionId: saved._id, petitionNo: saved.petitionNo, ...payload });
    res.json({ ok: true, petitionNo: saved.petitionNo, mode });
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

module.exports = router;
