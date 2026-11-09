const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const User = require('../models/User');
const Role = require('../models/Role');
const AccessGroup = require('../models/AccessGroup');
const QCTestResult = require('../models/QCTestResult');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { replyRef, approvalSubject, approveMailto, requestFinalResultApproval } = require('../lib/finalResultEmail');
const router = require('./finalResultEmail');

process.env.FINAL_RESULT_EMAIL_SECRET = 'test-secret';
process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL = '';
process.env.PRODUCTION_RESULT_CALLBACK_URL = '';

const head = { _id: new mongoose.Types.ObjectId(), email: 'head@icpladda.com', name: 'หัวหน้า QC', roles: ['qc-head'], status: 'active', approvalStatus: 'approved' };
const preResult = [
  { seq: 1, side: 'qc', status: 'approved', conclusion: 'pass', by: 'QC Approver' },
  { seq: 2, side: 'qc', status: 'approved', conclusion: 'accepted-oos', note: 'ค่าเกินเล็กน้อย', by: 'QC Approver' },
];

function makePetition(overrides = {}) {
  const doc = new Petition({
    petitionNo: 'P-2611-0001',
    status: 'success',
    completedAt: new Date('2026-11-09T03:00:00Z'),
    routeTargets: ['qc'],
    submittedBy: { name: 'ผู้ขอ', email: 'Requester@icpladda.com', department: 'ผลิต' },
    items: [{ seq: 1, sampleName: 'A', batchNo: 'B1' }, { seq: 2, sampleName: 'B', batchNo: 'B2' }],
    itemApprovals: preResult,
    ...overrides,
  });
  doc.saved = 0;
  doc.save = async function save() { this.saved += 1; return this; };
  return doc;
}

const lean = (value) => ({ lean: async () => value });

function setup(t, petition, user = head) {
  t.mock.method(Petition, 'findById', async () => petition);
  t.mock.method(Petition, 'findOne', () => lean({ _id: petition._id }));
  t.mock.method(User, 'findOne', () => lean(user));
  t.mock.method(Role, 'find', () => lean([{ id: 'qc-head', permissions: ['/qc-approval'] }]));
  t.mock.method(AccessGroup, 'find', () => lean([]));
  t.mock.method(QCTestResult, 'find', () => lean([]));
  t.mock.method(PetitionAuditLog, 'create', async () => ({}));
}

// เรียก middleware ทั้งสายของ POST /reply
async function sendReply(body) {
  const layer = router.stack.find((entry) => entry.route?.path === '/reply');
  const handlers = layer.route.stack.map((s) => s.handle);
  const req = { body: { ...body }, params: {} };
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
  for (const h of handlers) {
    let nextCalled = false;
    await h(req, res, (err) => { if (err) throw err; nextCalled = true; });
    if (!nextCalled) break;
  }
  return res.body;
}

const replyFrom = (petition, email = head.email, text = 'อนุมัติ\r\n\r\nFrom: Local Service Plant\r\nSubject: ขออนุมัติออก Final Report') => ({
  from: email.toUpperCase(),
  subject: 'RE: ' + approvalSubject(petition, email),
  body: text,
});

test('ตอบกลับว่า "อนุมัติ" → ออก Final Report โดยคงผลที่ QC Approver ตัดสินไว้ และคืนเมลยืนยัน', async (t) => {
  const petition = makePetition();
  setup(t, petition);
  const res = await sendReply(replyFrom(petition));
  assert.equal(res.ok, true);
  assert.equal(res.code, 'approved');
  assert.match(res.replySubject, /ออก Final Report P-2611-0001/);
  assert.match(res.replyHtml, /ส่งอีเมลแจ้งผลผู้ขอแล้ว/);
  assert.equal(petition.status, 'approved');
  assert.equal(petition.conclusion, 'accepted-oos');
  assert.equal(petition.reviewHistory.at(-1).reviewedBy, 'หัวหน้า QC');
  assert.equal(petition.saved, 1);
});

test('ใบที่ยังไม่มีใครอนุมัติ → อนุมัติทุกรายการเป็นผลปกติแล้วออก Final Report', async (t) => {
  const petition = makePetition({ itemApprovals: [] });
  setup(t, petition);
  const res = await sendReply(replyFrom(petition));
  assert.equal(res.ok, true);
  assert.equal(petition.conclusion, 'pass');
  assert.deepEqual(petition.itemApprovals.map((a) => [a.seq, a.side, a.source, a.by]), [
    [1, 'qc', 'email', 'หัวหน้า QC'],
    [2, 'qc', 'email', 'หัวหน้า QC'],
  ]);
});

test('ตอบกลับเพื่อถามคำถาม หรือพิมพ์ "ไม่อนุมัติ" → ไม่ออกผล', async (t) => {
  for (const text of ['ขอดูผลก่อนครับ\r\nFrom: Local Service Plant ขออนุมัติ', 'ไม่อนุมัติ ค่าเกิน']) {
    const petition = makePetition();
    setup(t, petition);
    const res = await sendReply(replyFrom(petition, head.email, text));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'not-approval');
    assert.equal(petition.saved, 0);
    t.mock.restoreAll();
  }
});

test('ผู้ส่งไม่ใช่คนที่ได้รับเมล (ส่งต่อให้คนอื่นตอบ) → รหัสไม่ผ่าน', async (t) => {
  const petition = makePetition();
  setup(t, petition);
  const res = await sendReply({ ...replyFrom(petition), from: 'other@icpladda.com' });
  assert.equal(res.code, 'invalid-token');
  assert.equal(petition.saved, 0);
});

test('เมลรอบเก่าใช้ไม่ได้หลังผลถูกแก้แล้วครบใหม่', async (t) => {
  const petition = makePetition();
  const old = replyFrom(petition);
  petition.completedAt = new Date('2026-11-10T03:00:00Z');
  setup(t, petition);
  const res = await sendReply(old);
  assert.equal(res.code, 'invalid-token');
  assert.equal(petition.saved, 0);
});

test('ออก Final Report ไปแล้ว / มีรายการไม่อนุมัติ / ไม่มีสิทธิ์ → ไม่แก้ข้อมูล', async (t) => {
  const cases = [
    [makePetition({ status: 'approved' }), head, 'already-approved'],
    [makePetition({ itemApprovals: [{ seq: 1, side: 'qc', status: 'rejected', note: 'x' }] }), head, 'needs-review'],
    [makePetition(), { ...head, roles: ['qc-staff'] }, 'not-approver'],
  ];
  for (const [petition, user, code] of cases) {
    setup(t, petition, user);
    const res = await sendReply(replyFrom(petition));
    assert.equal(res.code, code);
    assert.equal(petition.saved, 0);
    t.mock.restoreAll();
  }
});

test('ไม่มีรหัสในหัวเรื่อง → ตอบกลับให้ใช้ปุ่มในเมล', async () => {
  const res = await sendReply({ from: head.email, subject: 'RE: สอบถาม', body: 'อนุมัติ' });
  assert.equal(res.code, 'no-ref');
});

test('ปุ่มในเมลเปิดเมลตอบกลับถึงกล่อง n8n พร้อมรหัสและคำว่าอนุมัติ', () => {
  const petition = makePetition();
  const href = decodeURIComponent(approveMailto(petition, head.email));
  assert.match(href, /^mailto:localservice\.plant@icpladda\.com\?subject=RE: \[LIS\] ขออนุมัติออก Final Report \[FR:P-2611-0001:[a-f0-9]{16}\]&body=อนุมัติ/);
  assert.ok(href.includes(replyRef(petition, head.email)));
});

test('ส่งเมลถึง QC Head ทีละคน ครั้งเดียวต่อรอบ', async (t) => {
  process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL = 'https://n8n.example/webhook';
  t.after(() => { process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL = ''; });
  const petition = makePetition({ itemApprovals: [] });
  const other = { ...head, _id: new mongoose.Types.ObjectId(), email: 'head2@icpladda.com', name: 'หัวหน้า 2' };
  const inactive = { ...head, _id: new mongoose.Types.ObjectId(), email: 'old@icpladda.com', status: 'inactive' };
  t.mock.method(User, 'find', () => lean([head, other, inactive]));
  let claimed = false;
  t.mock.method(Petition, 'updateOne', async () => {
    if (claimed) return { matchedCount: 0 };
    claimed = true;
    return { matchedCount: 1 };
  });
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };

  const first = await requestFinalResultApproval(petition, { fetchImpl });
  assert.equal(first.sent, 2);
  assert.deepEqual(sent.map((m) => m.to), ['head@icpladda.com', 'head2@icpladda.com']);
  assert.equal(sent[0].subject, approvalSubject(petition, head.email));
  assert.notEqual(sent[0].subject, sent[1].subject); // รหัสผูกกับผู้รับแต่ละคน
  assert.match(sent[0].html, /ตอบกลับเพื่ออนุมัติ Final Report/);

  const second = await requestFinalResultApproval(petition, { fetchImpl });
  assert.equal(second.skipped, 'already-sent');
  assert.equal(sent.length, 2);
});
