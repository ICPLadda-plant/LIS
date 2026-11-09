// ขอออก Final Report ทางอีเมล: ใบที่ทุกฝั่งเสร็จแล้ว (status success) ยังไม่ปิดเป็น Final
// → ส่งคำขอเข้า n8n (workflow "LIS-send-email-report") ซึ่งส่งเมลมีปุ่ม "อนุมัติ" ถึง QC Head ทีละคน
// กดแล้ว n8n เรียก POST /api/final-result-email/:id/approve กลับมาพร้อม token — อนุมัติรายการที่ยังรอ
// (ถ้าผลปกติ) แล้วออก Final Report; รายการที่ QC Approver อนุมัติไว้แล้ว (Pre Result) คงไว้ตามเดิม
// ดู route: server/routes/finalResultEmail.js
const crypto = require('crypto');
const Petition = require('../models/Petition');
const User = require('../models/User');
const { normalizeRoles } = require('./roles');
const { allItemsApproved } = require('./itemApprovals');

const DEFAULT_WEBHOOK_URL = 'https://n8n-plant.icpladda.com/webhook/lis-approval-request';
const DEFAULT_LIS_BASE = 'https://app-plant.icpladda.com/LIS';
const APPROVER_ROLE = 'qc-head';
const MAX_LISTED_ITEMS = 20;

// ตั้งค่าว่าง (FINAL_RESULT_EMAIL_WEBHOOK_URL=) เพื่อปิดการส่งเมล
function webhookUrl() {
  const v = process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL;
  if (v === undefined) return DEFAULT_WEBHOOK_URL;
  return String(v).trim();
}

function lisBase() {
  return String(process.env.LIS_PUBLIC_BASE_URL || DEFAULT_LIS_BASE).trim().replace(/\/+$/, '');
}

function emailSecret() {
  return process.env.FINAL_RESULT_EMAIL_SECRET || process.env.LIS_SESSION_SECRET || process.env.LIS_SSO_SECRET || '';
}

// รอบ "รอ Final Report" ผูกกับ completedAt — ส่งกลับแก้แล้วครบใหม่ = รอบใหม่ ลิงก์ในเมลเก่าใช้ไม่ได้
function roundKey(petition) {
  const t = petition?.completedAt ? new Date(petition.completedAt).getTime() : 0;
  return Number.isFinite(t) && t > 0 ? String(t) : '';
}

function isAwaitingFinal(petition) {
  return petition?.status === 'success' && Boolean(roundKey(petition));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function signToken({ petitionId, approverEmail, key }, secret = emailSecret()) {
  return crypto
    .createHmac('sha256', secret)
    .update(String(petitionId) + '|' + normalizeEmail(approverEmail) + '|' + String(key))
    .digest('hex');
}

function verifyToken(args, token, secret = emailSecret()) {
  if (!secret || !token || !args.key) return false;
  const expected = Buffer.from(signToken(args, secret));
  const given = Buffer.from(String(token));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function isApprover(user) {
  return Boolean(user) && user.status !== 'inactive' && (user.approvalStatus || 'approved') === 'approved'
    && normalizeRoles(user).includes(APPROVER_ROLE);
}

async function findApprovers() {
  const users = await User.find({ $or: [{ roles: APPROVER_ROLE }, { role: APPROVER_ROLE }] }).lean();
  const seen = new Set();
  return users.filter((user) => {
    const email = normalizeEmail(user.email);
    if (!email || !isApprover(user) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function buildRequestPayload(petition, approver, { base = lisBase(), secret = emailSecret() } = {}) {
  const id = String(petition._id);
  const items = petition.items || [];
  const listed = items.slice(0, MAX_LISTED_ITEMS).map((it) => '- ' + (it.sampleName || '-') + (it.batchNo ? ' (Batch ' + it.batchNo + ')' : ''));
  if (items.length > MAX_LISTED_ITEMS) listed.push('- และอีก ' + (items.length - MAX_LISTED_ITEMS) + ' รายการ');
  return {
    title: 'ออก Final Report ' + petition.petitionNo,
    documentNo: petition.petitionNo,
    details: [
      allItemsApproved(petition)
        ? 'ผล Pre Result อนุมัติครบทุกรายการแล้ว' + (hasAcceptedOos(petition) ? ' (มีรายการยอมรับผลไม่ปกติ)' : '')
        : 'ทดสอบครบทุกฝั่งแล้ว กดอนุมัติเพื่ออนุมัติผลทุกรายการและออก Final Report',
      'แผนก: ' + (petition.submittedBy?.department || '-'),
      'จำนวน ' + items.length + ' รายการ',
      ...listed,
    ].join('\n'),
    link: base + '/qc-approval/' + id,
    approverEmail: normalizeEmail(approver.email),
    approverName: approver.name || approver.email,
    requesterEmail: normalizeEmail(petition.submittedBy?.email),
    requesterName: petition.submittedBy?.name || '',
    callbackUrl: base + '/api/final-result-email/' + id + '/approve',
    callbackToken: signToken({ petitionId: id, approverEmail: approver.email, key: roundKey(petition) }, secret),
  };
}

// ส่งคำขออนุมัติของใบนี้ถึง QC Head ทุกคน (ครั้งเดียวต่อรอบ) — คืนผลไว้ให้สคริปต์/log อ่าน
async function requestFinalResultApproval(petition, { fetchImpl = fetch } = {}) {
  const url = webhookUrl();
  if (!url) return { skipped: 'disabled' };
  if (!emailSecret()) return { skipped: 'no-secret' };
  if (!isAwaitingFinal(petition)) return { skipped: 'not-awaiting' };
  const approvers = await findApprovers();
  if (!approvers.length) return { skipped: 'no-approver' };

  const key = roundKey(petition);
  // จองสิทธิ์ส่งแบบ atomic — กัน trigger ซ้ำ/หลาย instance ที่ใช้ DB เดียวกันส่งเมลซ้ำ
  const claim = await Petition.updateOne(
    { _id: petition._id, status: 'success', completedAt: petition.completedAt, 'finalResultEmail.key': { $ne: key } },
    { $set: { finalResultEmail: { key, sentAt: new Date(), recipients: approvers.map((a) => normalizeEmail(a.email)) } } },
  );
  if (!claim.matchedCount) return { skipped: 'already-sent' };

  const results = [];
  for (const approver of approvers) {
    const email = normalizeEmail(approver.email);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestPayload(petition, approver)),
        signal: AbortSignal.timeout(15000),
      });
      results.push({ email, ok: res.ok, status: res.status });
    } catch (err) {
      results.push({ email, ok: false, error: err.message });
    }
  }
  if (!results.some((r) => r.ok)) {
    // ส่งไม่ออกเลย → ปลดจองไว้ให้รอบหน้าลองใหม่ได้
    await Petition.updateOne({ _id: petition._id, 'finalResultEmail.key': key }, { $unset: { finalResultEmail: 1 } });
  }
  return { sent: results.filter((r) => r.ok).length, results };
}

function hasAcceptedOos(petition) {
  return (petition.itemApprovals || []).some((entry) => entry.status === 'approved' && entry.conclusion === 'accepted-oos');
}

// เรียกหลังบันทึกใบที่เพิ่งอนุมัติครบ (Pre Result) — ไม่ block response และไม่ทำให้ request ล้ม
function notifyFinalResultAwaiting(petition) {
  if (!isAwaitingFinal(petition)) return;
  requestFinalResultApproval(petition)
    .then((r) => {
      if (r.results?.some((x) => !x.ok)) console.error('[final-result-email]', petition.petitionNo, JSON.stringify(r.results));
    })
    .catch((err) => console.error('[final-result-email] failed:', petition.petitionNo, err.message));
}

module.exports = {
  APPROVER_ROLE,
  webhookUrl,
  roundKey,
  isAwaitingFinal,
  normalizeEmail,
  signToken,
  verifyToken,
  isApprover,
  findApprovers,
  buildRequestPayload,
  requestFinalResultApproval,
  notifyFinalResultAwaiting,
};
