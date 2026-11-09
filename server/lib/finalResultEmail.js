// ขอออก Final Report ทางอีเมลแบบ "ตอบกลับเพื่ออนุมัติ"
// 1) ใบที่ทุกฝั่งเสร็จแล้ว (status success) → LIS สร้างเมล HTML แล้วให้ n8n
//    (workflow "LIS-send-email-report") ส่งผ่าน Outlook ถึง QC Head ทีละคน — ไม่มี execution ค้างรอ
// 2) ปุ่มในเมลเป็น mailto: เปิดเมลตอบกลับถึงกล่อง FINAL_RESULT_EMAIL_INBOX โดยมีรหัสอ้างอิง
//    [FR:<petitionNo>:<token>] ในหัวเรื่อง (หัวเรื่องเมลขอก็มีรหัสนี้ จึงกด Reply ปกติของ Outlook ได้เช่นกัน)
//    → QC Head ส่งเมลตอบกลับที่มีคำว่า "อนุมัติ" = ยืนยันอนุมัติ
// 3) n8n (Outlook Trigger) อ่านเมลตอบกลับ → POST /api/final-result-email/reply → LIS ออก Final Report
//    แจ้งผู้ขอ และคืนข้อความให้ n8n ตอบกลับหา QC Head
// ดู route: server/routes/finalResultEmail.js, HTML: lib/finalResultEmailTemplate.js
const crypto = require('crypto');
const Petition = require('../models/Petition');
const User = require('../models/User');
const { normalizeRoles } = require('./roles');
const { approvalRequestEmail, requesterResultEmail } = require('./finalResultEmailTemplate');

const DEFAULT_WEBHOOK_URL = 'https://n8n-plant.icpladda.com/webhook/lis-approval-request';
const DEFAULT_LIS_BASE = 'https://app-plant.icpladda.com/LIS';
// บัญชี Outlook ของ credential "Microsoft Outlook account" ใน n8n (ส่งเมลและรับเมลตอบกลับ)
const DEFAULT_INBOX = 'localservice.plant@icpladda.com';
const APPROVER_ROLE = 'qc-head';
const TOKEN_LENGTH = 16;
const REF_PATTERN = /\[FR:(P-[A-Za-z0-9-]+):([a-f0-9]{16})\]/i;

// ตั้งค่าว่าง (FINAL_RESULT_EMAIL_WEBHOOK_URL=) เพื่อปิดการส่งเมล
function webhookUrl() {
  const v = process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL;
  if (v === undefined) return DEFAULT_WEBHOOK_URL;
  return String(v).trim();
}

function lisBase() {
  return String(process.env.LIS_PUBLIC_BASE_URL || DEFAULT_LIS_BASE).trim().replace(/\/+$/, '');
}

// กล่องเมลที่รับเมลตอบกลับ = บัญชี Outlook ที่ n8n ใช้ส่ง/อ่านเมล
function replyInbox() {
  return normalizeEmail(process.env.FINAL_RESULT_EMAIL_INBOX || DEFAULT_INBOX);
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
    .digest('hex')
    .slice(0, TOKEN_LENGTH);
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

function replyRef(petition, approverEmail, secret = emailSecret()) {
  const id = String(petition._id);
  return '[FR:' + petition.petitionNo + ':' + signToken({ petitionId: id, approverEmail, key: roundKey(petition) }, secret) + ']';
}

// อ่านรหัสอ้างอิงจากหัวเรื่องเมลตอบกลับ (Outlook เติม "RE:" / "ตอบกลับ:" ข้างหน้าได้)
function parseReplyRef(...texts) {
  for (const text of texts) {
    const m = String(text || '').match(REF_PATTERN);
    if (m) return { petitionNo: m[1].toUpperCase(), token: m[2].toLowerCase() };
  }
  return null;
}

// ข้อความที่ผู้อนุมัติพิมพ์เอง (ตัดส่วนที่ Outlook ยกเมลเดิมมาต่อท้าย)
function ownReplyText(body) {
  const text = String(body || '');
  const cut = text.search(/(^|\n|\s)(From:|จาก:|_{6,}|-{3,}\s*Original)/i);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

// เมลตอบกลับต้องมีคำว่า "อนุมัติ" (ไม่ใช่ "ไม่อนุมัติ") — กันกด Reply เพื่อถามคำถามแล้วกลายเป็นอนุมัติ
function isApprovalReply(body) {
  const own = ownReplyText(body);
  return /อนุมัติ|approve/i.test(own) && !/ไม่อนุมัติ|ไม่ให้อนุมัติ|ยังไม่|not\s+approve|reject/i.test(own);
}

function approvalSubject(petition, approverEmail) {
  return '[LIS] ขออนุมัติออก Final Report ' + replyRef(petition, approverEmail);
}

function approveMailto(petition, approverEmail) {
  const subject = 'RE: ' + approvalSubject(petition, approverEmail);
  const body = 'อนุมัติ ออก Final Report ' + petition.petitionNo;
  return 'mailto:' + replyInbox() + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

const reviewUrl = (petition, base = lisBase()) => base + '/qc-approval/' + String(petition._id);
const viewUrl = (petition, base = lisBase()) => base + '/petition/' + String(petition._id);

// n8n รับ { to, subject, html } แล้วส่งผ่าน Outlook — คืน true ถ้า n8n รับงาน
async function sendMail(mail, { fetchImpl = fetch } = {}) {
  const url = webhookUrl();
  if (!url) return { ok: false, error: 'disabled' };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildApprovalMail(petition, approver, { previewTo } = {}) {
  const { html } = approvalRequestEmail({
    petition,
    approverName: approver.name || approver.email,
    approveUrl: approveMailto(petition, approver.email),
    reviewUrl: reviewUrl(petition),
    preview: Boolean(previewTo),
  });
  return { to: normalizeEmail(previewTo || approver.email), subject: (previewTo ? '[ตัวอย่าง] ' : '') + approvalSubject(petition, approver.email), html };
}

// ส่งคำขออนุมัติของใบนี้ถึง QC Head ทุกคน ครั้งเดียวต่อรอบ (force = ส่งซ้ำแม้เคยส่งรอบนี้แล้ว)
async function requestFinalResultApproval(petition, { fetchImpl = fetch, force = false } = {}) {
  if (!webhookUrl()) return { skipped: 'disabled' };
  if (!emailSecret()) return { skipped: 'no-secret' };
  if (!replyInbox().includes('@')) return { skipped: 'no-inbox' };
  if (!isAwaitingFinal(petition)) return { skipped: 'not-awaiting' };
  const approvers = await findApprovers();
  if (!approvers.length) return { skipped: 'no-approver' };

  const key = roundKey(petition);
  // จองสิทธิ์ส่งแบบ atomic — กัน trigger ซ้ำ/หลาย instance ที่ใช้ DB เดียวกันส่งเมลซ้ำ
  const filter = { _id: petition._id, status: 'success', completedAt: petition.completedAt };
  if (!force) filter['finalResultEmail.key'] = { $ne: key };
  const claim = await Petition.updateOne(filter, {
    $set: { finalResultEmail: { key, sentAt: new Date(), recipients: approvers.map((a) => normalizeEmail(a.email)) } },
  });
  if (!claim.matchedCount) return { skipped: 'already-sent' };

  const results = [];
  for (const approver of approvers) {
    const r = await sendMail(buildApprovalMail(petition, approver), { fetchImpl });
    results.push({ email: normalizeEmail(approver.email), ...r });
  }
  if (!results.some((r) => r.ok)) {
    // ส่งไม่ออกเลย → ปลดจองไว้ให้รอบหน้าลองใหม่ได้
    await Petition.updateOne({ _id: petition._id, 'finalResultEmail.key': key }, { $unset: { finalResultEmail: 1 } });
  }
  return { sent: results.filter((r) => r.ok).length, results };
}

// เรียกหลังบันทึกใบที่เพิ่งครบทุกฝั่ง — ไม่ block response และไม่ทำให้ request ล้ม
function notifyFinalResultAwaiting(petition) {
  if (!isAwaitingFinal(petition)) return;
  requestFinalResultApproval(petition)
    .then((r) => {
      if (r.results?.some((x) => !x.ok)) console.error('[final-result-email]', petition.petitionNo, JSON.stringify(r.results));
    })
    .catch((err) => console.error('[final-result-email] failed:', petition.petitionNo, err.message));
}

// แจ้งผู้ขอหลังออก Final Report (ไม่มีอีเมลผู้ขอ = ข้าม)
function notifyRequesterApproved(petition, approverName, { fetchImpl = fetch } = {}) {
  const to = normalizeEmail(petition.submittedBy?.email);
  if (!to) return Promise.resolve({ skipped: 'no-requester-email' });
  const { subject, html } = requesterResultEmail({ petition, approverName, viewUrl: viewUrl(petition) });
  return sendMail({ to, subject, html }, { fetchImpl })
    .then((r) => {
      if (!r.ok) console.error('[final-result-email] requester mail failed:', petition.petitionNo, r.error || r.status);
      return r;
    });
}

module.exports = {
  APPROVER_ROLE,
  webhookUrl,
  lisBase,
  replyInbox,
  roundKey,
  isAwaitingFinal,
  normalizeEmail,
  signToken,
  verifyToken,
  isApprover,
  findApprovers,
  replyRef,
  parseReplyRef,
  ownReplyText,
  isApprovalReply,
  approvalSubject,
  approveMailto,
  reviewUrl,
  viewUrl,
  sendMail,
  buildApprovalMail,
  requestFinalResultApproval,
  notifyFinalResultAwaiting,
  notifyRequesterApproved,
};
