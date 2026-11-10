// รับเมลตอบกลับ "อนุมัติออก Final Report" ที่ n8n อ่านได้จากกล่องเมล (ดู lib/finalResultEmail.js)
// POST /reply { from, subject, body } — หาใบจากเลขคำขอในหัวเรื่อง "ขออนุมัติออก Final Report P-..."
// ผู้ส่งต้องได้รับเมลขออนุมัติของรอบปัจจุบัน (finalResultEmail.recipients) และเป็น QC Head
// และข้อความที่พิมพ์ตอบต้องมีคำว่า "อนุมัติ" (ไม่ใช่ "ไม่อนุมัติ")
// - รายการที่ยังรออนุมัติ → อนุมัติเป็นผลปกติ (ถ้ามีผลผิดปกติ/มีรายการไม่อนุมัติ ต้องพิจารณาพร้อมเหตุผลในระบบ)
// - รายการที่ QC Approver อนุมัติไว้แล้ว (Pre Result) คงไว้ตามเดิม
// ตอบ 200 เสมอ พร้อม replySubject/replyHtml ให้ n8n ตอบกลับหา QC Head
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
const {
  isAwaitingFinal, normalizeEmail, wasSentTo, isApprover, parseReplyRef, isApprovalReply, reviewUrl, viewUrl,
  notifyRequesterApproved,
} = require('../lib/finalResultEmail');
const { approverReplyEmail } = require('../lib/finalResultEmailTemplate');
const { finalizeIfComplete, newlyApprovedBatches, writeAudit } = require('./approvals');

const router = express.Router();

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

const problem = (code, message, petition) => ({ problem: { code, message }, petition });

// ตรวจทุกเงื่อนไขก่อนออกผล — ยังไม่แก้ข้อมูล
async function evaluate(petitionId, approverEmail) {
  const petition = petitionId ? await Petition.findById(petitionId).catch(() => null) : null;
  if (!petition) return problem('not-found', 'ไม่พบคำขอนี้ในระบบ');
  if (petition.status === 'approved') return problem('already-approved', 'คำขอนี้ออก Final Report ไปแล้ว', petition);
  if (!isAwaitingFinal(petition)) {
    return problem('not-awaiting', 'คำขอนี้ไม่ได้อยู่ในสถานะรอออก Final Report แล้ว (อาจถูกส่งกลับแก้ไข)', petition);
  }
  if (!wasSentTo(petition, approverEmail)) {
    return problem('not-recipient', 'อีเมลนี้ไม่ได้อยู่ในรายชื่อผู้รับเมลขออนุมัติรอบล่าสุดของคำขอนี้ (หรือผลถูกแก้ไขหลังส่งอีเมล) กรุณาดำเนินการในระบบ LIS', petition);
  }
  const user = await User.findOne({ email: approverEmail }).lean();
  if (!isApprover(user) || !canIssueFinalReport(await resolveApprovalTabs(user))) {
    return problem('not-approver', 'บัญชีนี้ไม่มีสิทธิ์ออก Final Report', petition);
  }
  const pending = [];
  for (const item of petition.items || []) {
    for (const side of SIDES) {
      const status = itemSideStatus(petition, item, side);
      if (status === 'rejected') return problem('needs-review', 'มีรายการที่ไม่อนุมัติ ต้องพิจารณาในระบบ LIS', petition);
      if (status === 'pending') pending.push({ seq: item.seq, side });
    }
  }
  // ผลผิดปกติต้องมีเหตุผลการยอมรับ — ถ้า QC Approver ตัดสินครบแล้ว (Pre Result) ใช้คำตัดสินนั้น
  if (pending.length && await hasAbnormalResult(petition)) {
    return problem('needs-review', 'มีผลผิดปกติ ต้องระบุเหตุผลการยอมรับผลในระบบ LIS', petition);
  }
  return { petition, user, pending };
}

async function approve({ petition, user, pending }) {
  const actor = user.name || user.email;
  const now = new Date();
  const prevStatus = petition.status;
  const batchesBefore = approvedBatchNos(petition);
  for (const { seq, side } of pending) {
    upsertItemApproval(petition, { seq, side, status: 'approved', conclusion: 'pass', by: actor, at: now, source: 'email' });
  }
  const finalPayload = await finalizeIfComplete(petition, actor);
  if (!finalPayload) return problem('needs-review', 'ยังออก Final Report ไม่ได้ เพราะตัวอย่างเพิ่มยังบันทึกผลไม่ครบ', petition);
  await petition.save();

  if (pending.length) {
    writeAudit(petition, {
      event: 'reviewed',
      fromStatus: prevStatus,
      toStatus: prevStatus,
      actor,
      note: 'อนุมัติผลรายการที่รออยู่ผ่านการตอบกลับอีเมล',
      metadata: { type: 'itemApproval', source: 'email', decision: 'approve', seqs: [...new Set(pending.map((p) => p.seq))] },
    }, false);
  }
  writeAudit(petition, { ...finalPayload, note: finalPayload.note + ' (อนุมัติผ่านการตอบกลับอีเมล)', metadata: { ...finalPayload.metadata, source: 'email' } }, true);
  const batches = newlyApprovedBatches(petition, batchesBefore);
  if (batches.length) notifyProductionBatches(petition, batches);
  notifyRequesterApproved(petition, actor).catch(() => {});
  return { petition, actor };
}

// แปลงรหัสอ้างอิงเป็น petitionId ก่อนเข้าคิวเขียน (serializePetitionWrite ใช้ req.body.petitionId)
async function parseRef(req, res, next) {
  try {
    const ref = parseReplyRef(req.body?.subject);
    req.replyRef = ref;
    if (ref) {
      const doc = await Petition.findOne({ petitionNo: ref.petitionNo }, { _id: 1 }).lean();
      if (doc) req.body.petitionId = String(doc._id);
    }
    next();
  } catch (err) {
    next(err);
  }
}

// POST /api/final-result-email/reply  { from, subject, body }
router.post('/reply', parseRef, serializePetitionWrite(async (req, res) => {
  const reply = (ok, code, message, petition, extra = {}) => {
    const title = (ok ? 'ออก Final Report ' : 'ยังออก Final Report ไม่ได้ ') + (petition?.petitionNo || '');
    const mail = approverReplyEmail({
      ok,
      title: '[LIS] ' + title.trim(),
      message,
      petition,
      linkUrl: petition ? (ok ? viewUrl(petition) : reviewUrl(petition)) : null,
      linkLabel: ok ? 'ดูผลในระบบ LIS' : 'ดำเนินการต่อในระบบ LIS',
    });
    res.json({ ok, code, message, petitionNo: petition?.petitionNo || null, replySubject: mail.subject, replyHtml: mail.html, ...extra });
  };
  try {
    const from = normalizeEmail(req.body?.from);
    if (!req.replyRef) return reply(false, 'no-ref', 'ไม่พบเลขที่คำขอในหัวเรื่อง กรุณากดตอบกลับอีเมลขออนุมัติโดยไม่แก้หัวเรื่อง');
    if (!from) return reply(false, 'bad-request', 'ไม่พบอีเมลผู้ส่ง');
    if (!isApprovalReply(req.body?.body)) {
      const petition = req.body.petitionId ? await Petition.findById(req.body.petitionId) : null;
      return reply(false, 'not-approval', 'ยังไม่ได้ออก Final Report เพราะเมลตอบกลับไม่มีคำว่า "อนุมัติ" ถ้าต้องการอนุมัติ ให้ตอบกลับอีกครั้งโดยพิมพ์ว่า "อนุมัติ"', petition);
    }
    let result = await evaluate(req.body.petitionId, from);
    if (!result.problem) result = await approve(result);
    if (result.problem) return reply(false, result.problem.code, result.problem.message, result.petition);
    const { petition, actor } = result;
    const notified = petition.submittedBy?.email ? ' และส่งอีเมลแจ้งผลผู้ขอแล้ว' : ' (คำขอนี้ไม่มีอีเมลผู้ขอ จึงไม่ได้แจ้งทางอีเมล)';
    return reply(true, 'approved', 'ออก Final Report ' + petition.petitionNo + ' เรียบร้อย' + notified, petition, { approvedBy: actor });
  } catch (err) {
    return reply(false, 'error', 'เกิดข้อผิดพลาดในระบบ LIS: ' + err.message);
  }
}));

module.exports = router;
