const test = require('node:test');
const assert = require('node:assert');
const { urgentPendingBySide, urgentNotifications, dailyCheckNotification } = require('./notificationScheduler');

const petition = (over) => ({ petitionNo: 'P-1', priority: 1, status: 'inProgress', routeTargets: ['qc', 'lab'], items: [], ...over });

test('งานด่วน: QC เตือนเฉพาะที่รับตัวอย่างแล้วแต่ยังไม่บันทึกผล, Lab เตือนจนกว่าจะบันทึกผล', () => {
  const pending = urgentPendingBySide([
    petition({ petitionNo: 'A', qcReceivedAt: new Date() }),
    petition({ petitionNo: 'B' }),
    petition({ petitionNo: 'C', qcReceivedAt: new Date(), qcCompletedAt: new Date(), labCompletedAt: new Date() }),
    petition({ petitionNo: 'D', priority: 0, qcReceivedAt: new Date() }),
    petition({ petitionNo: 'E', status: 'approved', qcReceivedAt: new Date() }),
  ]);
  assert.deepStrictEqual(pending.qc.map((p) => p.petitionNo), ['A']);
  assert.deepStrictEqual(pending.lab.map((p) => p.petitionNo), ['A', 'B']);
  const list = urgentNotifications(pending, new Date(2026, 10, 11, 10, 0));
  assert.deepStrictEqual(list.map((n) => [n.key, n.roles[0], n.pushOnly]), [
    ['urgent:qc:2026-11-11T10', 'qc', true],
    ['urgent:lab:2026-11-11T10', 'lab', true],
  ]);
});

test('Daily Check: เตือน role ตระกูล Lab เมื่ออยู่ในรอบและยังไม่ครบ 5 เครื่อง', () => {
  const morning = new Date(2026, 10, 11, 8, 30);
  const records = ['s1', 's2'].map((scaleId) => ({ scaleId, period: 'morning' }));
  const notification = dailyCheckNotification(records, morning);
  assert.strictEqual(notification.key, 'dailyCheck:2026-11-11:morning');
  assert.deepStrictEqual(notification.roles, ['lab']);
  assert.match(notification.message, /2\/5/);
  const done = ['s1', 's2', 's3', 's4', 's5'].map((scaleId) => ({ scaleId, period: 'morning' }));
  assert.strictEqual(dailyCheckNotification(done, morning), null);
  assert.strictEqual(dailyCheckNotification([], new Date(2026, 10, 11, 12, 30)), null);
});
