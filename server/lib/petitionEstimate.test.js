const test = require('node:test');
const assert = require('node:assert');
const { buildStatusLog } = require('./petitionStatusLog');
const { computeLabExpected, refreshLabExpected } = require('./petitionEstimate');

// เวลาไทย (+07:00) · 13 ก.ค. 2026 = จันทร์
const bkk = (day, hour, minute = 0) => new Date(Date.UTC(2026, 6, day, hour - 7, minute));
const labPetition = (overrides = {}) => ({
  status: 'inProgress',
  items: [{ seq: 1, sampleName: 'A', batchNo: 'B-001' }],
  labReceivedAt: bkk(13, 9),
  assignedTo: { employeeId: 'E1', name: 'Lab A', position: 'Lab' },
  assignedMachines: [{ code: 'GC-01', name: 'GC', estimatedMinutes: 180, standardTimeId: 's1', estimatedSource: 'GC7890A / X' }],
  ...overrides,
});
const labTrack = (petition, now) => buildStatusLog(petition, [], [], [], false, now).current.tracks.lab;

test('Lab ยังไม่กดเริ่มงาน → expectedText = รอเริ่มงาน', () => {
  const lab = labTrack(labPetition(), bkk(13, 10));
  assert.strictEqual(lab.expectedAt, null);
  assert.strictEqual(lab.expectedText, 'รอเริ่มงาน');
});

test('กดเริ่มงาน 16:00 + Standard Time 3 ชม. → 19:00 วันเดียวกัน', () => {
  const p = labPetition({ assignedTo: { employeeId: 'E1', name: 'Lab A', acceptedAt: bkk(13, 16) } });
  const lab = labTrack(p, bkk(13, 17));
  assert.strictEqual(lab.expectedAt, bkk(13, 19).toISOString());
  assert.strictEqual(lab.expectedText, '13/07/2569 19:00');
  assert.strictEqual(lab.expectedOverdue, false);
});

test('เกิน 21:00 ยกไป 08:00 วันถัดไป และแสดงเกินกำหนดเมื่อเลยเวลา', () => {
  const p = labPetition({ assignedTo: { employeeId: 'E1', name: 'Lab A', acceptedAt: bkk(13, 20) } });
  const lab = labTrack(p, bkk(14, 12));
  assert.strictEqual(lab.expectedAt, bkk(14, 10).toISOString());
  assert.match(lab.expectedText, /\(เกินกำหนด\)$/);
});

test('ไม่มี Standard Time → ใช้ 240 นาที เก็บ basis และแสดง (ประมาณ)', () => {
  const doc = labPetition({ assignedTo: { employeeId: 'E1', name: 'Lab A', acceptedAt: bkk(13, 9) }, assignedMachines: [{ code: 'HPLC-9', name: 'HPLC' }] });
  refreshLabExpected(doc);
  assert.strictEqual(doc.labExpected.minutes, 240);
  assert.strictEqual(doc.labExpected.estimated, true);
  assert.deepStrictEqual(doc.labExpected.basis.map((b) => [b.code, b.source]), [['HPLC-9', 'default']]);
  const lab = labTrack(doc, bkk(13, 10));
  assert.strictEqual(lab.expectedText, '13/07/2569 13:00 (ประมาณ)');
});

test('ค่าที่บันทึกไว้ไม่เปลี่ยนตาม Standard Time ใหม่ · Re-check เริ่มนับใหม่ด้วยเครื่องเดิม', () => {
  const doc = labPetition({ assignedTo: { employeeId: 'E1', name: 'Lab A', acceptedAt: bkk(13, 9) } });
  refreshLabExpected(doc);
  doc.assignedMachines[0].estimatedMinutes = 600;
  assert.strictEqual(labTrack(doc, bkk(13, 10)).expectedAt, bkk(13, 12).toISOString());

  doc.assignedTo = undefined;
  doc.assignedMachines = [];
  doc.labRecheckRequestedAt = bkk(14, 9);
  const next = computeLabExpected(doc);
  assert.strictEqual(next.at.toISOString(), bkk(14, 12).toISOString());
});

test('Lab อนุมัติแล้ว → ใช้เวลาจริง', () => {
  const p = labPetition({ assignedTo: { employeeId: 'E1', name: 'Lab A', acceptedAt: bkk(13, 9) }, labApprovedAt: bkk(13, 11) });
  assert.strictEqual(labTrack(p, bkk(13, 15)).expectedAt, bkk(13, 11).toISOString());
});

