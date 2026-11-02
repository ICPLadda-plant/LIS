const crypto = require('crypto');
const express = require('express');
const ProductionIntegrationRequest = require('../models/ProductionIntegrationRequest');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { notifyPetitionEvent } = require('../lib/lineNotify');

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

module.exports = router;
