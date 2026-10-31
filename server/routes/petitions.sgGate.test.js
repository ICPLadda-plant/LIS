const test = require('node:test');
const assert = require('node:assert/strict');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const petitions = require('./petitions');

const waterItem = { seq: 1, sampleName: 'ไซเปอร์', commonName: 'CYPERMETHRIN 25% W/V EC', batchNo: '26S-CYP-001', sendToLab: true, sendToQc: true };

async function receive(context, item, side) {
  const writes = [];
  const before = { _id: 'p1', petitionNo: 'P-2611-0002', dept: 'production', status: 'sampleSent', submittedBy: { department: 'LDI' }, items: [item] };
  context.mock.method(Petition, 'findOne', () => ({ lean: async () => before }));
  context.mock.method(Petition, 'findOneAndUpdate', async (query, update) => { writes.push(update); return { ...before, ...update.$set }; });
  context.mock.method(PetitionAuditLog, 'create', async (row) => row);
  const layer = petitions.stack.find((entry) => entry.route?.path === '/:id/receive' && entry.route.methods.patch);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await layer.route.stack[0].handle({ params: { id: 'P-2611-0002' }, body: { actor: 'Tester', side } }, res);
  return { res, writes };
}

test('Lab รับตัวอย่างกลุ่มน้ำไม่ได้จนกว่า QC ยืนยันค่า ถพ.', async (context) => {
  const { res, writes } = await receive(context, waterItem, 'lab');
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(writes.length, 0);
});

test('Lab รับตัวอย่างกลุ่มน้ำได้หลัง QC ยืนยันค่า ถพ.', async (context) => {
  const { res } = await receive(context, { ...waterItem, sgConfirmedAt: new Date() }, 'lab');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('QC ยังรับตัวอย่างกลุ่มน้ำได้ตามปกติ', async (context) => {
  const { res } = await receive(context, waterItem, 'qc');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});
