const test = require('node:test');
const assert = require('node:assert');
const { pushTargetsForPetitionLog, pushTargetsForAppNotification } = require('./webPush');

const petition = {
  _id: 'p1',
  petitionNo: 'P-2611-0001',
  routeTargets: ['qc', 'lab'],
  items: [{ seq: 1, batchNo: '326', sampleName: 'OMETHOATE' }],
  submittedBy: { name: 'สมชาย', employeeId: 'E100' },
  assignedTo: { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' },
};
const sub = (email, extra = {}) => ({ email, endpoint: 'https://push.example/' + email, ...extra });
const viewers = new Map([
  ['qc@x', { roles: ['qc-staff'], employeeId: 'E1', email: 'qc@x' }],
  ['head@x', { roles: ['qc-head', 'qc-staff'], employeeId: 'E2', email: 'head@x' }],
  ['lab@x', { roles: ['lab-analyze'], employeeId: 'E200', email: 'lab@x' }],
  ['inv@x', { roles: ['lab-inventory', 'lab-analyze'], employeeId: 'E300', email: 'inv@x' }],
  ['req@x', { roles: ['viewer'], employeeId: 'E100', email: 'req@x' }],
  ['admin@x', { roles: ['admin'], employeeId: 'E9', email: 'admin@x', seeAll: true }],
]);
const emails = (targets) => targets.map((t) => t.sub.email).sort();

test('PWA ส่งทุกเหตุการณ์ตามกฎกระดิ่ง ไม่จำกัดเฉพาะเหตุการณ์ที่มีเสียง', () => {
  const entry = { _id: 'l1', event: 'statusChanged', toStatus: 'success', actor: 'x' };
  const subs = [sub('qc@x'), sub('head@x'), sub('lab@x'), sub('req@x')];
  assert.deepStrictEqual(emails(pushTargetsForPetitionLog(petition, entry, subs, viewers)), ['head@x']);
});

test('PWA ข้ามเครื่องที่พักไว้ และ admin ที่เปิดดูทั้งระบบได้ทุกเหตุการณ์', () => {
  const entry = { _id: 'l2', event: 'statusChanged', toStatus: 'approved', actor: 'x' };
  const subs = [sub('head@x', { paused: true }), sub('req@x'), sub('admin@x')];
  assert.deepStrictEqual(emails(pushTargetsForPetitionLog(petition, entry, subs, viewers)), ['admin@x', 'req@x']);
});

test('PWA แจ้งเตือนสต็อกส่งเฉพาะ Lab Inventory (และ admin ที่ดูทั้งระบบ)', () => {
  const doc = { key: 'stock:low:1', kind: 'stock', title: 'สารใกล้หมด 1 รายการ', recipientRoles: ['lab-inventory'], createdAt: new Date() };
  const subs = [sub('qc@x'), sub('lab@x'), sub('inv@x'), sub('admin@x')];
  assert.deepStrictEqual(emails(pushTargetsForAppNotification(doc, subs, viewers)), ['admin@x', 'inv@x']);
});
