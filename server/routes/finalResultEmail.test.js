const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const User = require('../models/User');
const Role = require('../models/Role');
const AccessGroup = require('../models/AccessGroup');
const QCTestResult = require('../models/QCTestResult');
const Parameter = require('../models/Parameter');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { roundKey, approvalSubject, approveMailto, requestFinalResultApproval, summarizeResults } = require('../lib/finalResultEmail');
const router = require('./finalResultEmail');

process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL = '';
process.env.PRODUCTION_RESULT_CALLBACK_URL = '';

const head = { _id: new mongoose.Types.ObjectId(), email: 'head@icpladda.com', name: 'หัวหน้า QC', roles: ['qc-head'], status: 'active', approvalStatus: 'approved' };
const preResult = [
  { seq: 1, side: 'qc', status: 'approved', conclusion: 'pass', by: 'QC Approver' },
  { seq: 2, side: 'qc', status: 'approved', conclusion: 'accepted-oos', note: 'ค่าเกินเล็กน้อย', by: 'QC Approver' },
];

function makePetition(overrides = {}) {
  const completedAt = overrides.completedAt ?? new Date('2026-11-09T03:00:00Z');
  const doc = new Petition({
    petitionNo: 'P-2611-0001',
    status: 'success',
    completedAt,
    routeTargets: ['qc'],
    submittedBy: { name: 'ผู้ขอ', email: 'Requester@icpladda.com', department: 'ผลิต' },
    items: [{ seq: 1, sampleName: 'A', batchNo: 'B1' }, { seq: 2, sampleName: 'B', batchNo: 'B2' }],
    itemApprovals: preResult,
    finalResultEmail: { key: roundKey({ completedAt }), sentAt: new Date(), recipients: [head.email] },
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
  const req = { body: { ...body }, params: {} };
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
  for (const { handle } of layer.route.stack) {
    let nextCalled = false;
    await handle(req, res, (err) => { if (err) throw err; nextCalled = true; });
    if (!nextCalled) break;
  }
  return res.body;
}

const replyFrom = (petition, email = head.email, text = 'อนุมัติ\r\n\r\nFrom: Local Service Plant\r\nSubject: ขออนุมัติออก Final Report') => ({
  from: email.toUpperCase(),
  subject: 'RE: ' + approvalSubject(petition),
  body: text,
});

test('หัวเรื่องเมลเป็น "[LIS] ขออนุมัติออก Final Report <เลขคำขอ>"', () => {
  assert.equal(approvalSubject(makePetition()), '[LIS] ขออนุมัติออก Final Report P-2611-0001');
});

test('ตอบกลับว่า "อนุมัติ" → ออก Final Report โดยคงผลที่ QC Approver ตัดสินไว้ และคืนเมลยืนยัน', async (t) => {
  const petition = makePetition();
  setup(t, petition);
  const res = await sendReply(replyFrom(petition));
  assert.equal(res.ok, true);
  assert.match(res.replySubject, /ออก Final Report P-2611-0001/);
  assert.equal(petition.status, 'approved');
  assert.equal(petition.conclusion, 'accepted-oos');
  assert.equal(petition.reviewHistory.at(-1).reviewedBy, 'หัวหน้า QC');
  assert.equal(petition.saved, 1);
});

test('Outlook ภาษาไทยเติม "ตอบกลับ:" หน้าหัวเรื่อง ก็ยังหาใบเจอ', async (t) => {
  const petition = makePetition({ itemApprovals: [] });
  setup(t, petition);
  const res = await sendReply({ ...replyFrom(petition), subject: 'ตอบกลับ: [LIS] ขออนุมัติออก Final Report P-2611-0001' });
  assert.equal(res.ok, true);
  assert.equal(petition.conclusion, 'pass');
  assert.deepEqual(petition.itemApprovals.map((a) => [a.seq, a.source]), [[1, 'email'], [2, 'email']]);
});

test('ตอบกลับเพื่อถามคำถาม หรือพิมพ์ "ไม่อนุมัติ" → ไม่ออกผล', async (t) => {
  for (const text of ['ขอดูผลก่อนครับ\r\nFrom: Local Service Plant ขออนุมัติ', 'ไม่อนุมัติ ค่าเกิน']) {
    const petition = makePetition();
    setup(t, petition);
    const res = await sendReply(replyFrom(petition, head.email, text));
    assert.equal(res.code, 'not-approval');
    assert.equal(petition.saved, 0);
    t.mock.restoreAll();
  }
});

test('ผู้ส่งไม่ได้รับเมลรอบนี้ (ส่งต่อให้คนอื่นตอบ / เมลรอบเก่าหลังแก้ผล) → ไม่ออกผล', async (t) => {
  const forwarded = makePetition();
  setup(t, forwarded, { ...head, email: 'other@icpladda.com' });
  assert.equal((await sendReply(replyFrom(forwarded, 'other@icpladda.com'))).code, 'not-recipient');
  t.mock.restoreAll();

  const reworked = makePetition();
  reworked.completedAt = new Date('2026-11-10T03:00:00Z');
  setup(t, reworked);
  assert.equal((await sendReply(replyFrom(reworked))).code, 'not-recipient');
  assert.equal(reworked.saved + forwarded.saved, 0);
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

test('ไม่มีเลขคำขอในหัวเรื่อง → ตอบกลับให้ใช้ปุ่มในเมล', async () => {
  const res = await sendReply({ from: head.email, subject: 'RE: สอบถาม', body: 'อนุมัติ' });
  assert.equal(res.code, 'no-ref');
});

test('ปุ่มในเมลเปิดเมลตอบกลับถึงกล่อง n8n พร้อมคำว่าอนุมัติ', () => {
  const href = decodeURIComponent(approveMailto(makePetition()));
  assert.equal(href, 'mailto:localservice.plant@icpladda.com?subject=RE: [LIS] ขออนุมัติออก Final Report P-2611-0001&body=อนุมัติ ออก Final Report P-2611-0001');
});

test('สรุป parameter และค่าที่ตรวจต่อรายการ (ข้ามรูป, %AI หลายสาร, ใช้ผลตรวจซ้ำถ้ามี)', () => {
  const params = [
    { _id: 'p1', name: 'กายภาพ', valueFields: [{ label: 'สี' }, { label: 'ลักษณะ' }, { label: 'รูปกายภาพ' }] },
    { _id: 'p2', name: 'ชั่งน้ำหนักยาหนู', valueFields: [{ label: 'น้ำหนัก', unit: 'g' }] },
    { _id: 'p3', name: '%AI', valueFields: [{ label: '%AI', unit: '%' }] },
  ];
  const docs = [
    { itemSeq: 1, parameterId: 'p1', values: { สี: 'แดง', ลักษณะ: 'ก้อนเล็ก', รูปกายภาพ: ['/LIS/uploads/qc-photos/a.jpg'] } },
    { itemSeq: 1, parameterId: 'p2', values: { น้ำหนัก: '5.86' }, valuesPhase2: { น้ำหนัก: '5.90' } },
    { itemSeq: 2, parameterId: 'p3', values: { 'Area Inj.1': '294.4', '%AI::bromadiolone': '0.00572' } },
  ];
  assert.deepEqual(summarizeResults(docs, params), {
    1: [
      { name: 'กายภาพ', values: ['สี แดง', 'ลักษณะ ก้อนเล็ก', 'รูปกายภาพ แนบรูป 1 รูป'], phase2: false },
      { name: 'ชั่งน้ำหนักยาหนู', values: ['น้ำหนัก 5.90 g'], phase2: true },
    ],
    2: [{ name: '%AI', values: ['%AI (bromadiolone) 0.00572 %'], phase2: false }],
  });
});

test('ส่งเมลถึง QC Head ทีละคน ครั้งเดียวต่อรอบ พร้อมตาราง parameter', async (t) => {
  process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL = 'https://n8n.example/webhook';
  t.after(() => { process.env.FINAL_RESULT_EMAIL_WEBHOOK_URL = ''; });
  const petition = makePetition({ itemApprovals: [], finalResultEmail: undefined });
  const other = { ...head, _id: new mongoose.Types.ObjectId(), email: 'head2@icpladda.com', name: 'หัวหน้า 2' };
  const inactive = { ...head, _id: new mongoose.Types.ObjectId(), email: 'old@icpladda.com', status: 'inactive' };
  t.mock.method(User, 'find', () => lean([head, other, inactive]));
  t.mock.method(QCTestResult, 'find', () => lean([{ itemSeq: 1, parameterId: 'p2', values: { น้ำหนัก: '5.86' } }]));
  t.mock.method(Parameter, 'find', () => lean([{ _id: 'p2', name: 'ชั่งน้ำหนักยาหนู', valueFields: [{ label: 'น้ำหนัก', unit: 'g' }] }]));
  const claims = [];
  t.mock.method(Petition, 'updateOne', async (filter, update) => {
    claims.push(update);
    return { matchedCount: claims.length === 1 ? 1 : 0 };
  });
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };

  const first = await requestFinalResultApproval(petition, { fetchImpl });
  assert.equal(first.sent, 2);
  assert.deepEqual(sent.map((m) => m.to), ['head@icpladda.com', 'head2@icpladda.com']);
  assert.deepEqual(claims[0].$set.finalResultEmail.recipients, ['head@icpladda.com', 'head2@icpladda.com']);
  assert.equal(sent[0].subject, '[LIS] ขออนุมัติออก Final Report P-2611-0001');
  assert.match(sent[0].html, /Parameter ที่ตรวจ/);
  assert.match(sent[0].html, /น้ำหนัก 5\.86 g/);

  const second = await requestFinalResultApproval(petition, { fetchImpl });
  assert.equal(second.skipped, 'already-sent');
  assert.equal(sent.length, 2);
});
