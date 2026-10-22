const test = require('node:test');
const assert = require('node:assert');
const { pushTargetsForEvent } = require('./webPush');
const { audiencesForUser } = require('./pushAudience');

const labItem = { batchNo: '326', sampleName: 'OMETHOATE' };
const petition = {
  _id: 'p1',
  petitionNo: 'P-2606-0018',
  dept: 'production',
  sentToLab: true,
  items: [labItem],
  submittedBy: { name: 'สมชาย', employeeId: 'E100', department: 'Production' },
};

const sub = (email, extra = {}) => ({ email, endpoint: `https://push.example/${email}`, ...extra });
const viewers = new Map([
  ['qc@x', { audiences: ['qc'], employeeId: 'E1' }],
  ['lab@x', { audiences: ['lab'], employeeId: 'E200' }],
  ['lab2@x', { audiences: ['lab'], employeeId: 'E300' }],
  ['prod@x', { audiences: ['production'], employeeId: 'E400' }],
]);
const emailsOf = (result) => result.targets.map((s) => s.email).sort();

test('pushTargetsForEvent: ตัวอย่างมาถึงส่งให้ฝั่ง QC/Lab ที่เปิดรับและไม่ได้พักไว้', () => {
  const payload = { event: 'statusChanged', fromStatus: 'deliveringQC', toStatus: 'sampleSent' };
  const subs = [sub('qc@x'), sub('lab@x'), sub('lab2@x', { paused: true }), sub('prod@x'), sub('unknown@x')];
  const result = pushTargetsForEvent(petition, payload, subs, viewers);
  assert.deepStrictEqual(emailsOf(result), ['lab@x', 'qc@x']);
  assert.ok(result.desc.title.includes('P-2606-0018'));
});

test('pushTargetsForEvent: งาน Lab ใหม่ส่งเฉพาะคนที่ถูกมอบหมาย', () => {
  const assignee = { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' };
  const payload = { event: 'assigned', metadata: { assignee } };
  const result = pushTargetsForEvent({ ...petition, assignedTo: assignee }, payload, [sub('qc@x'), sub('lab@x'), sub('lab2@x')], viewers);
  assert.deepStrictEqual(emailsOf(result), ['lab@x']);
});

test('pushTargetsForEvent: เหตุการณ์ที่ไม่มีเสียงในกระดิ่งไม่ส่ง push', () => {
  const payload = { event: 'statusChanged', fromStatus: 'inProgress', toStatus: 'success' };
  assert.deepStrictEqual(pushTargetsForEvent(petition, payload, [sub('qc@x'), sub('lab@x')], viewers).targets, []);
});

test('audiencesForUser: ตรงกับฝั่งหน้าเว็บทั้ง role และแผนก', () => {
  assert.deepStrictEqual(audiencesForUser({ roles: ['qc-staff'] }), ['qc']);
  assert.deepStrictEqual(audiencesForUser({ roles: ['admin'], department: 'Lab/วิเคราะห์' }), ['lab']);
  assert.deepStrictEqual(audiencesForUser({ roles: ['viewer'], department: 'ผลิต 1' }), ['production']);
});
