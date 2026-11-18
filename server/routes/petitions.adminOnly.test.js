const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('./petitions');
const Petition = require('../models/Petition');
const User = require('../models/User');
const { nextDocumentNumber } = require('../lib/documentNumber');
const DocumentNumberConfig = require('../models/DocumentNumberConfig');
const { assignMissingSampleLabelNumbers } = require('../lib/sampleLabelNumber');

// คำร้องเฉพาะ Admin: ต้องไม่โผล่ในรายการปกติ (หน้า /queue/qc, /queue/lab ใช้ GET / แบบไม่ส่ง adminOnly)
// และต้องใช้เลขคำร้อง/เลขคิวชุดแยก

function handler(path, method) {
  const layer = router.stack.find((e) => e.route && e.route.path === path && e.route.methods[method]);
  return layer.route.stack[0].handle;
}

async function listQuery({ query, user }) {
  const originals = { find: Petition.find, count: Petition.countDocuments, agg: Petition.aggregate, userFindOne: User.findOne };
  let findQuery;
  Petition.find = (q) => { findQuery = q; return { sort: () => ({ skip: () => ({ limit: async () => [] }) }) }; };
  Petition.countDocuments = async () => 0;
  Petition.aggregate = async () => [];
  User.findOne = () => ({ lean: async () => user });
  const headers = { 'x-lis-user': user?.email || '' };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  try {
    await handler('/', 'get')({ query, params: {}, body: {}, headers: {}, get: (n) => headers[String(n).toLowerCase()] }, res);
  } finally {
    Object.assign(Petition, { find: originals.find, countDocuments: originals.count, aggregate: originals.agg });
    User.findOne = originals.userFindOne;
  }
  assert.equal(res.statusCode, 200);
  return findQuery;
}

const ADMIN = { _id: 'u1', email: 'admin@lab.test', roles: ['admin'], status: 'active' };
const STAFF = { _id: 'u2', email: 'qc@lab.test', roles: ['qc-analyze'], status: 'active' };
const QUEUE_STATUSES = ['sampleSent,pendingReview', 'inProgress', 'success,approved'];

test('หน้าคิว (GET / ตามสถานะ) ซ่อนคำร้องเฉพาะ Admin ทั้งผู้ใช้ทั่วไป, ไม่ล็อกอิน และ admin', async () => {
  for (const user of [STAFF, null, ADMIN]) {
    for (const status of QUEUE_STATUSES) {
      const q = await listQuery({ query: { page: '1', limit: '200', status }, user });
      assert.deepEqual(q.adminOnly, { $ne: true }, 'user=' + user?.email + ' status=' + status);
    }
  }
});

test('adminOnly=true ได้เฉพาะ admin; คนอื่นขอก็ยังได้แค่คำร้องปกติ', async () => {
  assert.equal((await listQuery({ query: { adminOnly: 'true' }, user: ADMIN })).adminOnly, true);
  assert.deepEqual((await listQuery({ query: { adminOnly: 'true' }, user: STAFF })).adminOnly, { $ne: true });
});

test('เลขคำร้องเฉพาะ Admin เป็นชุด PA แยกจาก P', async () => {
  const origConfig = DocumentNumberConfig.findOne;
  DocumentNumberConfig.findOne = () => ({ lean: async () => null });
  const yymm = (() => { const d = new Date(); return String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, '0'); })();
  const issued = ['P-' + yymm + '-0012', 'PA-' + yymm + '-0003'];
  const Model = {
    findOne: (filter) => {
      const hit = issued.filter((n) => filter.petitionNo.test(n)).sort().pop();
      return { sort: () => ({ lean: async () => (hit ? { petitionNo: hit } : null) }) };
    },
  };
  try {
    assert.equal(await nextDocumentNumber('petition', Model, 'petitionNo'), 'P-' + yymm + '-0013');
    assert.equal(await nextDocumentNumber('adminPetition', Model, 'petitionNo'), 'PA-' + yymm + '-0004');
  } finally { DocumentNumberConfig.findOne = origConfig; }
});

test('เลขคิวป้ายของคำร้องเฉพาะ Admin เป็น AP/AL และใช้ตัวนับแยก', async () => {
  const calls = [];
  const nextSequence = async (side) => { calls.push(side); return 1; };
  const now = new Date('2026-11-18T10:00:00+07:00');
  const base = { routeTargets: ['qc', 'lab'], submittedBy: { department: 'ผลิต 01' }, items: [] };
  const admin = await assignMissingSampleLabelNumbers({ ...base, adminOnly: true }, { now, nextSequence });
  const normal = await assignMissingSampleLabelNumbers(base, { now, nextSequence });
  assert.equal(admin.qc, 'AP01');
  assert.equal(admin.lab, 'AL01');
  assert.equal(normal.qc, 'P01');
  assert.deepEqual(calls, ['qcAdmin', 'labAdmin', 'qc', 'lab']);
});

