const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Petition = require('../models/Petition');
const Parameter = require('../models/Parameter');
const QCTestResult = require('../models/QCTestResult');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const qcResults = require('./qcResults');

const petitionId = '507f1f77bcf86cd799439011';
const parameterId = '507f1f77bcf86cd799439012';

// PUT /qc-results บนใบหลัก (ไม่มีรอบตัวอย่างเพิ่ม) — mock ทุก model ไม่แตะ DB จริง
async function put(context, petition, phase) {
  const writes = [];
  context.mock.method(User, 'findOne', () => ({ lean: async () => null }));
  context.mock.method(Petition, 'findById', () => ({ lean: async () => ({
    _id: petitionId, petitionNo: 'P-1', status: 'inProgress', items: [{ seq: 1 }],
    additionalSampleRequests: [], ...petition,
  }) }));
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => ({
    _id: parameterId, scope: 'qc', hasPhases: true, valueFields: [{ label: 'สี', type: 'text', phase: 'both' }],
  }) }));
  context.mock.method(QCTestResult, 'findOne', async () => null);
  context.mock.method(QCTestResult, 'findOneAndUpdate', async (filter, update) => {
    writes.push(update);
    return update.$set;
  });
  context.mock.method(PetitionAuditLog, 'create', async (entry) => entry);

  const layer = qcResults.stack.find((entry) => entry.route?.path === '/' && entry.route.methods.put);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await layer.route.stack[0].handle({
    body: { petitionId, petitionNo: 'P-1', itemSeq: 1, parameterId, parameterName: 'กายภาพ', fieldLabel: 'สี', value: 'แดง', phase },
    headers: {}, ip: '10.0.0.5', get: () => undefined,
  }, res);
  return { res, writes };
}

test('บันทึก Phase 2 ของใบหลักที่ยังอยู่ Phase 1 ไม่ได้ (409) และไม่เขียนผล', async (context) => {
  const { res, writes } = await put(context, { currentPhase: 1, phase2DueAt: null }, 2);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(writes.length, 0);
});

test('บันทึก Phase 2 ไม่ได้ถ้า timer ยังไม่ครบเวลา', async (context) => {
  const future = new Date(Date.now() + 3600_000);
  const { res, writes } = await put(context, { currentPhase: 1, phase2DueAt: future }, 2);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(writes.length, 0);
});

test('บันทึก Phase 2 ได้เมื่อใบเข้า Phase 2 แล้ว', async (context) => {
  const { res, writes } = await put(context, { currentPhase: 2 }, 2);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(writes[0].$set.valuesPhase2, { 'สี': 'แดง' });
});

test('บันทึก Phase 2 ได้เมื่อ timer ครบเวลาแล้วแต่ยังไม่มีใครเปิดใบให้ lazy advance', async (context) => {
  const past = new Date(Date.now() - 3600_000);
  const { res } = await put(context, { currentPhase: 1, phase2DueAt: past }, 2);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('บันทึก Phase 1 ไม่ได้รับผลกระทบ', async (context) => {
  const { res, writes } = await put(context, { currentPhase: 1 }, 1);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(writes[0].$set.values, { 'สี': 'แดง' });
});
