const test = require('node:test');
const assert = require('node:assert');
const { assignMissingSampleLabelNumbers, planLabelReceipt } = require('./sampleLabelNumber');

function fakeCounter() {
  const counts = {};
  return async (side, year) => {
    const key = `${side}-${year}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts[key];
  };
}

const now = new Date('2026-11-03T08:00:00+07:00');
const qcOnly = { routeTargets: ['qc'], submittedBy: { department: 'ผลิต 01' }, items: [] };
const qcAndLab = { routeTargets: ['qc', 'lab'], submittedBy: { department: 'ผลิต 01' }, items: [] };

const numbersOnly = (result) => result && { year: result.year, qc: result.qc, lab: result.lab };
const drop = (value) => JSON.parse(JSON.stringify(value));

test('QC และ LAB นับเลขแยกกัน ตามลำดับคำขอ', async () => {
  const nextSequence = fakeCounter();
  const results = [];
  for (const petition of [qcAndLab, qcOnly, qcOnly, qcAndLab]) {
    results.push(drop(numbersOnly(await assignMissingSampleLabelNumbers(petition, { now, nextSequence }))));
  }
  assert.deepStrictEqual(results, [
    { year: 2569, qc: 'P01', lab: 'L01' },
    { year: 2569, qc: 'P02' },
    { year: 2569, qc: 'P03' },
    { year: 2569, qc: 'P04', lab: 'L02' },
  ]);
});

test('R&D ที่ส่ง LAB อย่างเดียวได้เฉพาะเลข L', async () => {
  const result = await assignMissingSampleLabelNumbers(
    { submittedBy: { department: 'R&D' }, items: [] },
    { now, nextSequence: fakeCounter() },
  );
  assert.deepStrictEqual(drop(numbersOnly(result)), { year: 2569, lab: 'L01' });
});

test('คำขอเก่าที่มีเลขระดับคำขอ: กลุ่มแรกรับเลขเดิม และออกเลขเฉพาะฝั่งที่เพิ่มเข้ามาในปีเดิมของคำขอ', async () => {
  const nextSequence = fakeCounter();
  const migrated = await assignMissingSampleLabelNumbers(
    { ...qcOnly, sampleLabelNumbers: { year: 2569, qc: 'P07' } },
    { now, nextSequence },
  );
  assert.deepStrictEqual(migrated, { year: 2569, qc: 'P07', groups: [{ key: '|', qc: 'P07' }] });
  assert.strictEqual(await assignMissingSampleLabelNumbers({ ...qcOnly, sampleLabelNumbers: migrated }, { now, nextSequence }), null);
  const added = await assignMissingSampleLabelNumbers(
    { ...qcAndLab, sampleLabelNumbers: migrated },
    { now: new Date('2027-01-05T08:00:00+07:00'), nextSequence },
  );
  assert.deepStrictEqual(added, { year: 2569, qc: 'P07', lab: 'L01', groups: [{ key: '|', qc: 'P07', lab: 'L01' }] });
});

test('คนละ batch หรือ batch เดียวกันคนละส่วนได้คนละเลข ส่วนป้ายฝั่งเดียวกันใน batch เดียวกันใช้เลขเดียวกัน', async () => {
  const petition = {
    routeTargets: ['qc', 'lab'],
    submittedBy: { department: 'ผลิต 01' },
    items: [
      { seq: 1, batchNo: '001', sendToQc: true, sendToLab: true, sampleQuantity: 3, labelQuantities: ['100 CC', '500 CC', '500 CC'], labelQuantitySides: ['qc', 'qc', 'lab'] },
      { seq: 2, batchNo: '002', sendToQc: true, sendToLab: false, sampleQuantity: 1, labelQuantities: ['100 CC'], labelQuantitySides: ['qc'] },
      { seq: 3, batchNo: '002', part: 'ล่าง', sendToQc: true, sendToLab: false, sampleQuantity: 1, labelQuantitySides: ['qc'] },
      { seq: 4, batchNo: ' 001 ', part: 'ทั่วไป/รวม', sendToQc: true, sendToLab: false, sampleQuantity: 1, labelQuantitySides: ['qc'] },
    ],
  };
  const result = await assignMissingSampleLabelNumbers(petition, { now, nextSequence: fakeCounter() });
  assert.deepStrictEqual(result, {
    year: 2569,
    qc: 'P01',
    lab: 'L01',
    groups: [
      { key: '001|', qc: 'P01', lab: 'L01' },
      { key: '002|', qc: 'P02' },
      { key: '002|ล่าง', qc: 'P03' },
    ],
  });
});

test('แก้รายการแล้วเลขกลุ่มเดิมไม่เปลี่ยน ออกเลขเฉพาะ batch ใหม่ และคงเลขของกลุ่มที่ถูกลบ', async () => {
  const nextSequence = fakeCounter();
  const base = { routeTargets: ['qc'], submittedBy: { department: 'ผลิต 01' } };
  const first = await assignMissingSampleLabelNumbers({ ...base, items: [{ seq: 1, batchNo: 'A' }, { seq: 2, batchNo: 'B' }] }, { now, nextSequence });
  const edited = await assignMissingSampleLabelNumbers({ ...base, sampleLabelNumbers: first, items: [{ seq: 1, batchNo: 'C' }, { seq: 2, batchNo: 'B' }] }, { now, nextSequence });
  assert.deepStrictEqual(edited.groups, [{ key: 'C|', qc: 'P03' }, { key: 'B|', qc: 'P02' }, { key: 'A|', qc: 'P01' }]);
  assert.strictEqual(edited.qc, 'P01');
});

function twoBatchPetition(extra = {}) {
  return {
    routeTargets: ['qc', 'lab'],
    submittedBy: { department: 'ผลิต 01' },
    items: [
      { seq: 1, batchNo: '001', sendToQc: true, sendToLab: true, sampleQuantity: 3, labelQuantitySides: ['qc', 'qc', 'lab'] },
      { seq: 2, batchNo: '002', sendToQc: true, sendToLab: false, sampleQuantity: 1, labelQuantitySides: ['qc'] },
    ],
    sampleLabelNumbers: { year: 2569, qc: 'P01', lab: 'L01', groups: [{ key: '001|', qc: 'P01', lab: 'L01' }, { key: '002|', qc: 'P02' }] },
    ...extra,
  };
}

test('รับทีละป้าย: สแกนป้ายรายการไหนรับเฉพาะเลขนั้น และครบเมื่อรับทุกเลขของฝั่ง', () => {
  const first = planLabelReceipt(twoBatchPetition(), 'qc', { itemSeq: 2 });
  assert.deepStrictEqual(first, { keys: ['002|'], labels: ['P02/69'], receivedCount: 1, total: 2, complete: false });
  const second = planLabelReceipt(twoBatchPetition({ labelReceipts: [{ key: '002|', side: 'qc' }] }), 'qc', { itemSeq: 1 });
  assert.deepStrictEqual(second, { keys: ['001|'], labels: ['P01/69'], receivedCount: 2, total: 2, complete: true });
});

test('รับทีละป้าย: กันรับซ้ำ และไม่ระบุป้ายจะรับทุกป้ายที่ค้าง', () => {
  const received = twoBatchPetition({ labelReceipts: [{ key: '002|', side: 'qc' }] });
  assert.deepStrictEqual(planLabelReceipt(received, 'qc', { itemSeq: 2 }), { error: 'ป้าย P02/69 รับฝั่ง QC แล้ว' });
  assert.deepStrictEqual(planLabelReceipt(received, 'qc', {}).keys, ['001|']);
  assert.deepStrictEqual(planLabelReceipt(twoBatchPetition(), 'qc', { labelKeys: ['001|', '002|'] }).complete, true);
});

test('รับแบบเดิมทั้งคำขอเมื่อฝั่งนั้นมีเลขป้ายเดียว หรือคำขอเก่าที่ไม่มีกลุ่มเลข', () => {
  assert.strictEqual(planLabelReceipt(twoBatchPetition(), 'lab', { itemSeq: 1 }), null);
  assert.strictEqual(planLabelReceipt(twoBatchPetition({ sampleLabelNumbers: { year: 2569, qc: 'P01' } }), 'qc', { itemSeq: 2 }), null);
  assert.strictEqual(planLabelReceipt(twoBatchPetition({ qcReceivedAt: new Date() }), 'qc', { itemSeq: 2 }), null);
});
