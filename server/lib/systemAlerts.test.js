const test = require('node:test');
const assert = require('node:assert');
const { systemNotificationFor, normalizeApiPath, isWatchedStatus } = require('./systemAlerts');

test('เฝ้าเฉพาะ 401 / 403 / 5xx', () => {
  assert.deepStrictEqual([200, 400, 401, 403, 404, 500, 501, 503].map(isWatchedStatus), [false, false, true, true, false, true, true, true]);
});

test('path ที่ต่างกันแค่ id รวมเป็นแถวเดียว และตัด /LIS ออก', () => {
  assert.strictEqual(normalizeApiPath('/LIS/api/petitions/65f0c0ffee0000000000abcd/receive?x=1'), '/api/petitions/:id/receive');
  assert.strictEqual(normalizeApiPath('/api/stock/units/123'), '/api/stock/units/:n');
});

test('แจ้ง admin และรวมซ้ำภายใน 10 นาที', () => {
  const at = Date.UTC(2026, 10, 11, 3, 0, 0);
  const a = systemNotificationFor({ status: 503, method: 'GET', path: '/api/x', at });
  const b = systemNotificationFor({ status: 503, method: 'GET', path: '/api/x', at: at + 60 * 1000 });
  const c = systemNotificationFor({ status: 503, method: 'GET', path: '/api/x', at: at + 11 * 60 * 1000 });
  assert.strictEqual(a.key, b.key);
  assert.notStrictEqual(a.key, c.key);
  assert.deepStrictEqual(a.roles, ['admin']);
  assert.strictEqual(a.level, 'error');
  assert.strictEqual(systemNotificationFor({ status: 403, method: 'POST', path: '/api/y', at }).level, 'warning');
});
