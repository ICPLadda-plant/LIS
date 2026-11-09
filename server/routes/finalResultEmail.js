// n8n เรียกกลับเมื่อ QC Head กด "อนุมัติ" ในเมลขอออก Final Report (ดู lib/finalResultEmail.js)
// ยืนยันตัวตนด้วย token (HMAC ต่อใบ × อีเมลผู้อนุมัติ × รอบ) แทน session
// - รายการที่ยังรออนุมัติ → อนุมัติเป็นผลปกติ (ถ้ามีผลผิดปกติ/มีรายการไม่อนุมัติ ต้องพิจารณาพร้อมเหตุผลในระบบ)
// - รายการที่ QC Approver อนุมัติไว้แล้ว (Pre Result) คงไว้ตามเดิม
// แล้วออก Final Report ด้วย finalizeIfComplete เดียวกับหน้า /qc-approval
const express = require('express');
const Petition = require('../models/Petition');
const User = require('../models/User');
const Parameter = require('../models/Parameter');
const QCTestResult = require('../models/QCTestResult');
const { serializePetitionWrite } = require('../lib/petitionWriteQueue');
const { computeAbnormalFlags } = require('../lib/abnormalFlags');
const { resolveApprovalTabs, canIssueFinalReport } = require('../lib/qcApprovalAccess');
const { notifyProductionBatches } = require('../lib/productionCallback');
const { SIDES, itemSideStatus, upsertItemApproval, approvedBatchNos } = require('../lib/itemApprovals');
const { roundKey, isAwaitingFinal, normalizeEmail, verifyToken, isApprover } = require('../lib/finalResultEmail');
const { finalizeIfComplete, newlyApprovedBatches, writeAudit } = require('./approvals');

const router = express.Router();

const fail = (res, status, code, message) => res.status(status).json({ ok: false, code, error: { message } });

async function hasAbnormalResult(petition) {
  const id = String(petition._id);
  const docs = await QCTestResult.find(
    { petitionId: id },
    { petitionId: 1, parameterId: 1, itemSeq: 1, commonName: 1, values: 1, valuesPhase2: 1, entries: 1 },
  ).lean();
  if (!docs.length) return false;
  const paramIds = [...new Set(docs.map((d) => String(d.parameterId)))];
  const params = await Parameter.find({ _id: { $in: paramIds } }, { valueFields: 1, multiEntry: 1 }).lean();
  const flags = computeAbnormalFlags({ docs, params, petitions: [petition.toObject()], includeRestricted: true });
  return Boolean(flags[id]);
}

// POST /api/final-result-email/:id/approve  { approverEmail, token }
router.post('/:id/approve', serializePetitionWrite(async (req, res) => {
  try {
    const approverEmail = normalizeEmail(req.body?.approverEmail);
    const token = String(req.body?.token || '');
    if (!approverEmail || !token) return fail(res, 400, 'bad-request', 'ข้อมูลไม่ครบ');

    const petition = await Petition.findById(req.params.id).catch(() => null);
    if (!petition) return fail(res, 404, 'not-found', 'ไม่พบคำขอ');
    if (petition.status === 'approved') return fail(res, 409, 'already-approved', 'ใบนี้ออก Final Report ไปแล้ว');
    if (!isAwaitingFinal(petition)) {
      return fail(res, 409, 'not-awaiting', 'ใบนี้ไม่ได้อยู่ในสถานะรอออก Final Report แล้ว (อาจถูกส่งกลับแก้ไข)');
    }
    if (!verifyToken({ petitionId: String(petition._id), approverEmail, key: roundKey(petition) }, token)) {
      return fail(res, 403, 'invalid-token', 'ลิงก์อนุมัตินี้หมดอายุแล้ว เพราะผลถูกแก้ไขหลังส่งเมล');
    }

    const user = await User.findOne({ email: approverEmail }).lean();
    if (!isApprover(user) || !canIssueFinalReport(await resolveApprovalTabs(user))) {
      return fail(res, 403, 'not-approver', 'บัญชีนี้ไม่มีสิทธิ์ออก Final Report แล้ว');
    }

    const pending = [];
    for (const item of petition.items || []) {
      for (const side of SIDES) {
        const status = itemSideStatus(petition, item, side);
        if (status === 'rejected') return fail(res, 409, 'needs-review', 'มีรายการที่ไม่อนุมัติ ต้องพิจารณาในระบบ LIS');
        if (status === 'pending') pending.push({ seq: item.seq, side });
      }
    }
    // ผลผิดปกติต้องมีเหตุผลการยอมรับ — ถ้า QC Approver ตัดสินครบแล้ว (Pre Result) ใช้คำตัดสินนั้น
    if (pending.length && await hasAbnormalResult(petition)) {
      return fail(res, 409, 'needs-review', 'มีผลผิดปกติ ต้องระบุเหตุผลการยอมรับผลในระบบ LIS');
    }

    const actor = user.name || user.email;
    const now = new Date();
    const prevStatus = petition.status;
    const batchesBefore = approvedBatchNos(petition);
    for (const { seq, side } of pending) {
      upsertItemApproval(petition, { seq, side, status: 'approved', conclusion: 'pass', by: actor, at: now, source: 'email' });
    }
    const finalPayload = await finalizeIfComplete(petition, actor);
    if (!finalPayload) return fail(res, 409, 'needs-review', 'ยังออก Final Report ไม่ได้ — ตัวอย่างเพิ่มยังบันทึกผลไม่ครบ');
    await petition.save();

    if (pending.length) {
      writeAudit(petition, {
        event: 'reviewed',
        fromStatus: prevStatus,
        toStatus: prevStatus,
        actor,
        note: 'อนุมัติผลรายการที่รออยู่ผ่านอีเมล',
        metadata: { type: 'itemApproval', source: 'email', decision: 'approve', seqs: [...new Set(pending.map((p) => p.seq))] },
      }, false);
    }
    writeAudit(petition, { ...finalPayload, note: finalPayload.note + ' (อนุมัติผ่านอีเมล)', metadata: { ...finalPayload.metadata, source: 'email' } }, true);
    const batches = newlyApprovedBatches(petition, batchesBefore);
    if (batches.length) notifyProductionBatches(petition, batches);

    res.json({
      ok: true,
      petitionNo: petition.petitionNo,
      approvedBy: actor,
      requesterEmail: normalizeEmail(petition.submittedBy?.email),
      requesterName: petition.submittedBy?.name || '',
    });
  } catch (err) {
    fail(res, 500, 'error', err.message);
  }
}));

module.exports = router;
