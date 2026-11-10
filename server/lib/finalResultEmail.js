// ขอออก Final Report ทางอีเมลแบบ "ตอบกลับเพื่ออนุมัติ"
// 1) ใบที่ทุกฝั่งเสร็จแล้ว (status success) → LIS สร้างเมล HTML แล้วให้ n8n
//    (workflow "LIS-send-email-report") ส่งผ่าน Outlook ถึง QC Head ทีละคน — ไม่มี execution ค้างรอ
//    หัวเรื่อง "[LIS] ขออนุมัติออก Final Report <petitionNo>" ตารางตัวอย่างแสดง parameter และค่าที่ตรวจ
// 2) ปุ่มในเมลเป็น mailto: เปิดเมลตอบกลับถึงกล่อง FINAL_RESULT_EMAIL_INBOX (หรือกด Reply ปกติของ Outlook)
//    → QC Head ส่งเมลตอบกลับที่มีคำว่า "อนุมัติ" = ยืนยันอนุมัติ
//    ยืนยันตัวตน: ผู้ส่งต้องอยู่ใน finalResultEmail.recipients ของรอบปัจจุบัน (ได้รับเมลรอบนี้จริง)
// 3) n8n (Outlook Trigger) อ่านเมลตอบกลับ → POST /api/final-result-email/reply → LIS ออก Final Report
//    แจ้งผู้ขอ และคืนข้อความให้ n8n ตอบกลับหา QC Head
// ดู route: server/routes/finalResultEmail.js, HTML: lib/finalResultEmailTemplate.js
const Petition = require('../models/Petition');
const User = require('../models/User');
const QCTestResult = require('../models/QCTestResult');
const Parameter = require('../models/Parameter');
const { normalizeRoles } = require('./roles');
const { approvalRequestEmail, requesterResultEmail } = require('./finalResultEmailTemplate');

const DEFAULT_WEBHOOK_URL = 'https://n8n-plant.icpladda.com/webhook/lis-approval-request';
const DEFAULT_LIS_BASE = 'https://app-plant.icpladda.com/LIS';
// บัญชี Outlook ของ credential "Microsoft Outlook account" ใน n8n (ส่งเมลและรับเมลตอบกลับ)
const DEFAULT_INBOX = 'localservice.plant@icpladda.com';
const APPROVER_ROLE = 'qc-head';
const SUBJECT_PREFIX = '[LIS] ขออนุมัติออก Final Report ';
// เลขคำขอจากหัวเรื่องเมลตอบกลับ (Outlook เติม "RE:" / "ตอบกลับ:" ข้างหน้าได้)
const SUBJECT_PATTERN = /ขออนุมัติออก Final Report\s+(P-[A-Za-z0-9-]+)/i;

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

// รอบ "รอ Final Report" ผูกกับ completedAt — ส่งกลับแก้แล้วครบใหม่ = รอบใหม่ เมลรอบเก่าใช้อนุมัติไม่ได้
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

function parseReplyRef(subject) {
  const m = String(subject || '').match(SUBJECT_PATTERN);
  return m ? { petitionNo: m[1].toUpperCase() } : null;
}

// ผู้ส่งได้รับเมลขออนุมัติของรอบปัจจุบันจริง (รอบใหม่หลังส่งกลับแก้ = ต้องรอเมลรอบใหม่)
function wasSentTo(petition, email) {
  const sent = petition?.finalResultEmail;
  return Boolean(sent && sent.key === roundKey(petition) && (sent.recipients || []).includes(normalizeEmail(email)));
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

function approvalSubject(petition) {
  return SUBJECT_PREFIX + petition.petitionNo;
}

function approveMailto(petition) {
  const subject = 'RE: ' + approvalSubject(petition);
  const body = 'อนุมัติ ออก Final Report ' + petition.petitionNo;
  return 'mailto:' + replyInbox() + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

// ---------- parameter และค่าที่ตรวจ ต่อรายการ ----------
const isFileValue = (v) => typeof v === 'string' && /\/uploads\//.test(v);

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) {
    const files = v.filter(isFileValue).length;
    const rest = v.filter((x) => !isFileValue(x)).map(formatValue).filter(Boolean);
    return [...rest, files ? 'แนบรูป ' + files + ' รูป' : ''].filter(Boolean).join(', ');
  }
  if (typeof v === 'object') return '';
  return isFileValue(v) ? 'แนบรูป 1 รูป' : String(v).trim();
}

// ค่าของ field ตาม valueFields (รองรับ key แบบ "<label>::<สาร>" ของงาน %AI หลายสาร)
function fieldValues(values, field) {
  const out = [];
  const label = field.label;
  const unit = field.unit ? ' ' + field.unit : '';
  const direct = formatValue(values[label]);
  if (direct) out.push(label + ' ' + direct + (/\d$/.test(direct) ? unit : ''));
  for (const [k, v] of Object.entries(values)) {
    if (!k.startsWith(label + '::')) continue;
    const val = formatValue(v);
    if (val) out.push(label + ' (' + k.slice(label.length + 2) + ') ' + val + (/\d$/.test(val) ? unit : ''));
  }
  return out;
}

function hasValues(v) {
  return Boolean(v) && typeof v === 'object' && Object.values(v).some((x) => x !== '' && x !== null && x !== undefined);
}

// { [itemSeq]: [{ name, values: ['สี แดง', ...] }] } — ใช้ผลรอบตรวจซ้ำ (Phase 2) ถ้ามี
function summarizeResults(docs = [], params = []) {
  const byId = new Map(params.map((p) => [String(p._id), p]));
  const out = {};
  for (const d of docs) {
    const param = byId.get(String(d.parameterId)) || {};
    const name = param.name || d.parameterName || '-';
    const sets = hasValues(d.valuesPhase2) ? [d.valuesPhase2]
      : param.multiEntry && Array.isArray(d.entries) && d.entries.length ? d.entries : [d.values || {}];
    const fields = Array.isArray(param.valueFields) && param.valueFields.length
      ? param.valueFields
      : Object.keys(sets[0] || {}).map((label) => ({ label }));
    const values = sets.flatMap((set, i) => fields.flatMap((field) => fieldValues(set || {}, field))
      .map((v) => (sets.length > 1 ? '#' + (i + 1) + ' ' : '') + v));
    (out[d.itemSeq] ||= []).push({ name, values, phase2: hasValues(d.valuesPhase2) });
  }
  return out;
}

async function loadResultSummary(petition) {
  const docs = await QCTestResult.find(
    { petitionId: String(petition._id) },
    { itemSeq: 1, parameterId: 1, parameterName: 1, values: 1, valuesPhase2: 1, entries: 1 },
  ).lean();
  if (!docs.length) return {};
  const params = await Parameter.find(
    { _id: { $in: [...new Set(docs.map((d) => String(d.parameterId)))] } },
    { name: 1, valueFields: 1, multiEntry: 1 },
  ).lean();
  return summarizeResults(docs, params);
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

function buildApprovalMail(petition, approver, { previewTo, results = {} } = {}) {
  const { html } = approvalRequestEmail({
    petition,
    approverName: approver.name || approver.email,
    approveUrl: approveMailto(petition),
    reviewUrl: reviewUrl(petition),
    results,
  });
  return { to: normalizeEmail(previewTo || approver.email), subject: approvalSubject(petition), html };
}

// ส่งคำขออนุมัติของใบนี้ถึง QC Head ทุกคน ครั้งเดียวต่อรอบ (force = ส่งซ้ำแม้เคยส่งรอบนี้แล้ว)
async function requestFinalResultApproval(petition, { fetchImpl = fetch, force = false } = {}) {
  if (!webhookUrl()) return { skipped: 'disabled' };
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

  const summary = await loadResultSummary(petition);
  const results = [];
  for (const approver of approvers) {
    const r = await sendMail(buildApprovalMail(petition, approver, { results: summary }), { fetchImpl });
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
async function notifyRequesterApproved(petition, approverName, { fetchImpl = fetch } = {}) {
  const to = normalizeEmail(petition.submittedBy?.email);
  if (!to) return { skipped: 'no-requester-email' };
  const results = await loadResultSummary(petition).catch(() => ({}));
  const { subject, html } = requesterResultEmail({ petition, approverName, viewUrl: viewUrl(petition), results });
  const r = await sendMail({ to, subject, html }, { fetchImpl });
  if (!r.ok) console.error('[final-result-email] requester mail failed:', petition.petitionNo, r.error || r.status);
  return r;
}

module.exports = {
  APPROVER_ROLE,
  webhookUrl,
  lisBase,
  replyInbox,
  roundKey,
  isAwaitingFinal,
  normalizeEmail,
  isApprover,
  findApprovers,
  parseReplyRef,
  wasSentTo,
  summarizeResults,
  loadResultSummary,
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
