const test = require('node:test');
const assert = require('node:assert');
const { assignMissingSampleLabelNumbers } = require('./sampleLabelNumber');

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

test('QC และ LAB นับเลขแยกกัน ตามลำดับคำขอ', async () => {
  const nextSequence = fakeCounter();
  const results = [];
  for (const petition of [qcAndLab, qcOnly, qcOnly, qcAndLab]) {
    results.push(await assignMissingSampleLabelNumbers(petition, { now, nextSequence }));
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
  assert.deepStrictEqual(result, { year: 2569, lab: 'L01' });
});

test('เลขเดิมไม่เปลี่ยน และออกเลขเฉพาะฝั่งที่เพิ่มเข้ามาในปีเดิมของคำขอ', async () => {
  const nextSequence = fakeCounter();
  const unchanged = await assignMissingSampleLabelNumbers(
    { ...qcOnly, sampleLabelNumbers: { year: 2569, qc: 'P07' } },
    { now, nextSequence },
  );
  assert.strictEqual(unchanged, null);
  const added = await assignMissingSampleLabelNumbers(
    { ...qcAndLab, sampleLabelNumbers: { year: 2569, qc: 'P07' } },
    { now: new Date('2027-01-05T08:00:00+07:00'), nextSequence },
  );
  assert.deepStrictEqual(added, { year: 2569, qc: 'P07', lab: 'L01' });
});
