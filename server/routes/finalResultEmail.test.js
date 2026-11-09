const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const User = require('../models/User');
const Role = require('../models/Role');
const AccessGroup = require('../models/AccessGroup');
const QCTestResult = require('../models/QCTestResult');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { signToken, roundKey, requestFinalResultApproval } = require('../lib/finalResultEmail');
const router = require('./finalResultEmail');

process.env.FINAL_RESULT_EMAIL_SECRET = 'test-secret';
process.env.PRODUCTION_RESULT_CALLBACK_URL = '';

const head = { _id: new mongoose.Types.ObjectId(), email: 'head@icpladda.com', name: 'หัวหน้า QC', roles: ['qc-head'], status: 'active', approvalStatus: 'approved' };
const preResult = [
  { seq: 1, side: 'qc', status: 'approved', conclusion: 'pass', by: 'QC Approver' },
  { seq: 2, side: 'qc', status: 'approved', conclusion: 'accepted-oos', note: 'ค่าเกินเล็กน้อย', by: 'QC Approver' },
];

function makePetition(overrides = {}) {
  const doc = new Petition({
    petitionNo: 'PT-001',
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

function stub(t, model, method, impl) {
  t.mock.method(model, method, impl);
}

function lean(value) {
  return { lean: async () => value };
}

function handler() {
  const layer = router.stack.find((entry) => entry.route?.path === '/:id/approve');
  return layer.route.stack[0].handle;
}

async function call(petition, body) {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler()({ params: { id: String(petition._id) }, body }, res, () => {});
  return res;
}

function setup(t, petition) {
  stub(t, Petition, 'findById', async () => petition);
  stub(t, User, 'findOne', () => lean(head));
  stub(t, Role, 'find', () => lean([{ id: 'qc-head', permissions: ['/qc-approval'] }]));
  stub(t, AccessGroup, 'find', () => lean([]));
  stub(t, QCTestResult, 'find', () => lean([]));
  stub(t, PetitionAuditLog, 'create', async () => ({}));
}

const tokenFor = (petition) => signToken({ petitionId: String(petition._id), approverEmail: head.email, key: roundKey(petition) }, 'test-secret');

test('กดอนุมัติจากเมล → ออก Final Report โดยคงผลอนุมัติรายรายการของ QC Approver', async (t) => {
  const petition = makePetition();
  setup(t, petition);
  const res = await call(petition, { approverEmail: 'HEAD@icpladda.com', token: tokenFor(petition) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requesterEmail, 'requester@icpladda.com');
  assert.equal(petition.status, 'approved');
  assert.equal(petition.conclusion, 'accepted-oos');
  assert.match(petition.conclusionNote, /ค่าเกินเล็กน้อย/);
  assert.equal(petition.reviewHistory.at(-1).reviewedBy, 'หัวหน้า QC');
  assert.deepEqual(petition.itemApprovals.map((a) => a.by), ['QC Approver', 'QC Approver']);
  assert.equal(petition.saved, 1);
});

test('ลิงก์ในเมลรอบเก่าใช้ไม่ได้หลังผลถูกแก้แล้วครบใหม่', async (t) => {
  const petition = makePetition();
  const oldToken = tokenFor(petition);
  petition.completedAt = new Date('2026-11-10T03:00:00Z');
  setup(t, petition);
  const res = await call(petition, { approverEmail: head.email, token: oldToken });
  assert.equal(res.statusCode, 403);
  assert.equal(petition.status, 'success');
  assert.equal(petition.saved, 0);
});

test('ใบที่ออก Final Result ไปแล้ว ตอบ already-approved โดยไม่แก้ข้อมูล', async (t) => {
  const petition = makePetition({ status: 'approved' });
  setup(t, petition);
  const res = await call(petition, { approverEmail: head.email, token: tokenFor(petition) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'already-approved');
  assert.equal(petition.saved, 0);
});

test('ใบที่ยังไม่มีใครอนุมัติ → หัวหน้า QC กดจากเมลแล้วอนุมัติทุกรายการเป็นผลปกติและออก Final Report', async (t) => {
  const petition = makePetition({ itemApprovals: [] });
  setup(t, petition);
  const res = await call(petition, { approverEmail: head.email, token: tokenFor(petition) });
  assert.equal(res.statusCode, 200);
  assert.equal(petition.status, 'approved');
  assert.equal(petition.conclusion, 'pass');
  assert.deepEqual(petition.itemApprovals.map((a) => [a.seq, a.side, a.status, a.source, a.by]), [
    [1, 'qc', 'approved', 'email', 'หัวหน้า QC'],
    [2, 'qc', 'approved', 'email', 'หัวหน้า QC'],
  ]);
});

test('มีรายการที่ไม่อนุมัติค้างอยู่ ต้องพิจารณาในระบบ', async (t) => {
  const petition = makePetition({ itemApprovals: [{ seq: 1, side: 'qc', status: 'rejected', note: 'x' }] });
  setup(t, petition);
  const res = await call(petition, { approverEmail: head.email, token: tokenFor(petition) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'needs-review');
  assert.equal(petition.status, 'success');
  assert.equal(petition.saved, 0);
});

test('QC Approver (เห็นแค่ผลกายภาพ) ใช้ลิงก์ออก Final Report ไม่ได้', async (t) => {
  const petition = makePetition();
  setup(t, petition);
  t.mock.method(User, 'findOne', () => lean({ ...head, roles: ['qc-head', 'qc-approver'] }));
  t.mock.method(Role, 'find', () => lean([
    { id: 'qc-head', permissions: ['/stock'] },
    { id: 'qc-approver', permissions: ['/qc-approval', 'deny:/qc-approval/lab'] },
  ]));
  const res = await call(petition, { approverEmail: head.email, token: tokenFor(petition) });
  assert.equal(res.statusCode, 403);
  assert.equal(petition.saved, 0);
});

test('ส่งคำขอถึง QC Head ทีละคน และไม่ส่งซ้ำในรอบเดียวกัน', async (t) => {
  const petition = makePetition();
  const other = { ...head, _id: new mongoose.Types.ObjectId(), email: 'head2@icpladda.com', name: 'หัวหน้า 2' };
  const inactive = { ...head, _id: new mongoose.Types.ObjectId(), email: 'old@icpladda.com', status: 'inactive' };
  stub(t, User, 'find', () => lean([head, other, inactive]));
  let claimed = false;
  stub(t, Petition, 'updateOne', async () => {
    if (claimed) return { matchedCount: 0 };
    claimed = true;
    return { matchedCount: 1 };
  });
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };

  const first = await requestFinalResultApproval(petition, { fetchImpl });
  assert.equal(first.sent, 2);
  assert.deepEqual(sent.map((p) => p.approverEmail), ['head@icpladda.com', 'head2@icpladda.com']);
  assert.equal(sent[0].callbackToken, tokenFor(petition));
  assert.equal(sent[0].requesterEmail, 'requester@icpladda.com');
  assert.match(sent[0].details, /ยอมรับผลไม่ปกติ/);
  assert.match(sent[0].callbackUrl, new RegExp('/api/final-result-email/' + petition._id + '/approve$'));

  const second = await requestFinalResultApproval(petition, { fetchImpl });
  assert.equal(second.skipped, 'already-sent');
  assert.equal(sent.length, 2);
});

test('ใบที่ยังทดสอบไม่ครบทุกฝั่ง ไม่ส่งเมล', async (t) => {
  const petition = makePetition({ status: 'inProgress', completedAt: null, itemApprovals: [] });
  t.mock.method(User, 'find', () => lean([head]));
  const result = await requestFinalResultApproval(petition, { fetchImpl: async () => assert.fail('ไม่ควรส่ง') });
  assert.equal(result.skipped, 'not-awaiting');
});
