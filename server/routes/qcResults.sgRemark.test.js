const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Petition = require('../models/Petition');
const Parameter = require('../models/Parameter');
const QCTestResult = require('../models/QCTestResult');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const qcResults = require('./qcResults');

const petitionId = '507f1f77bcf86cd799439011';
const sgParameterId = '507f1f77bcf86cd799439012';
const waterItem = { seq: 1, sampleName: 'ไซเปอร์', commonName: 'CYPERMETHRIN 25% W/V EC', batchNo: '26S-CYP-001', sendToLab: true, sendToQc: true };

function call(path, method, body, email = 'qc@icpladda.com') {
  const layer = qcResults.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  return layer.route.stack[0].handle({ body, headers: {}, ip: '10.0.0.5', get: (name) => (name === 'X-LIS-User' ? email : undefined) }, res).then(() => res);
}

function mockSgConfirm(context, { entry, roles = ['qc-staff'] }) {
  const doc = {
    _id: petitionId, petitionNo: 'P-2611-0002', status: 'pendingReview', submittedBy: { department: 'LDI' },
    items: [{ ...waterItem }], saved: 0,
    toObject() { return { ...this, items: this.items.map((item) => ({ ...item })) }; },
    increment() {},
    async save() { this.saved += 1; return this; },
  };
  const audits = [];
  context.mock.method(User, 'findOne', () => ({ lean: async () => ({ name: 'QC รายวัน', email: 'qc@icpladda.com', roles, status: 'active' }) }));
  context.mock.method(Petition, 'findById', async () => doc);
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [{ petitionId, itemSeq: 1, parameterId: sgParameterId, values: {}, entries: [entry] }] }));
  context.mock.method(Parameter, 'find', () => ({ lean: async () => [{ _id: sgParameterId, scope: 'qc', valueFields: [{ label: 'ค่าถพ.' }, { label: 'อุณหภูมิ' }] }] }));
  context.mock.method(PetitionAuditLog, 'create', async (row) => { audits.push(row); return row; });
  return { doc, audits };
}

test('ยืนยันค่า ถพ. ไม่ได้ถ้ายังไม่มีอุณหภูมิ', async (context) => {
  const { doc } = mockSgConfirm(context, { entry: { 'ค่าถพ.': 1.052, 'อุณหภูมิ': '' } });
  const res = await call('/sg-confirm', 'post', { petitionId, itemSeq: 1 });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(doc.saved, 0);
});

test('QC ยืนยันค่า ถพ. แล้วบันทึกต่อ item และปล่อยงานไป Lab พร้อม audit', async (context) => {
  const { doc, audits } = mockSgConfirm(context, { entry: { 'ค่าถพ.': 1.052, 'อุณหภูมิ': 30 } });
  const res = await call('/sg-confirm', 'post', { petitionId, itemSeq: 1 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(doc.saved, 1);
  assert.ok(doc.items[0].sgConfirmedAt instanceof Date);
  assert.equal(doc.items[0].sgConfirmedBy, 'QC รายวัน');
  assert.equal(doc.items[0].sgConfirmedValue, '1.052');
  assert.equal(doc.items[0].sgConfirmedTemperature, '30');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.kind, 'sgConfirmed');
  assert.equal(audits[0].metadata.releasedToLab, true);
});

test('ผู้ใช้ที่ไม่ใช่ QC ยืนยันค่า ถพ. ไม่ได้', async (context) => {
  mockSgConfirm(context, { entry: { 'ค่าถพ.': 1.052, 'อุณหภูมิ': 30 }, roles: ['lab-analyze'] });
  const res = await call('/sg-confirm', 'post', { petitionId, itemSeq: 1 });
  assert.equal(res.statusCode, 403, JSON.stringify(res.body));
});

test('บันทึกหมายเหตุต่อ parameter ต่อตัวอย่างลง QCTestResult.remark พร้อม audit', async (context) => {
  const writes = [];
  const audits = [];
  context.mock.method(Petition, 'findById', () => ({ lean: async () => ({ _id: petitionId, petitionNo: 'P-1', status: 'inProgress', items: [{ seq: 1 }], additionalSampleRequests: [] }) }));
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => ({ _id: sgParameterId, name: 'สี', scope: 'qc', valueFields: [] }) }));
  context.mock.method(QCTestResult, 'findOne', () => ({ lean: async () => ({ remark: '' }) }));
  context.mock.method(QCTestResult, 'findOneAndUpdate', async (filter, update) => { writes.push({ filter, update }); return { ...filter, ...update.$set }; });
  context.mock.method(PetitionAuditLog, 'create', async (row) => { audits.push(row); return row; });

  const res = await call('/remark', 'put', {
    petitionId, petitionNo: 'P-1', itemSeq: 1, parameterId: sgParameterId, parameterName: 'สี',
    remark: '  สีเข้มกว่าปกติ  ', enteredBy: { name: 'QC', email: 'qc@icpladda.com' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(writes[0].filter, { petitionId, itemSeq: 1, parameterId: sgParameterId });
  assert.equal(writes[0].update.$set.remark, 'สีเข้มกว่าปกติ');
  assert.equal(res.body.remark, 'สีเข้มกว่าปกติ');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audits[0].metadata.kind, 'remark');
});
