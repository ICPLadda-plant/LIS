const test = require('node:test');
const assert = require('node:assert');
const { computeStockStates, diffStockStates, notificationsForEvents } = require('./stockAlerts');

const now = new Date('2026-11-11T03:00:00.000Z');
const days = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
const bottle = (id, over = {}) => ({ _id: id, itemCode: 'STD1', itemName: 'Atrazine', itemType: 'standard', status: 'active', volume: { remaining: 10 }, exp: days(200), ...over });

test('ระดับสาร: ขวดใช้ได้ 2 = ปกติ, 1 = ใกล้หมด, 0 = หมด (ขวดหมดอายุไม่นับ)', () => {
  const standards = [{ _id: 's1', code: 'STD1', name: 'Atrazine' }];
  const level = (units) => computeStockStates({ standards, units, now }).get('item:standard:s1').state;
  assert.strictEqual(level([bottle('u1'), bottle('u2')]), 'ok');
  assert.strictEqual(level([bottle('u1'), bottle('u2', { exp: days(-1) })]), 'low');
  assert.strictEqual(level([bottle('u1', { volume: { remaining: 0 } })]), 'out');
});

test('อายุขวด: ภายใน 30 วัน = ใกล้หมดอายุ, เลยวัน = หมดอายุ', () => {
  const states = computeStockStates({ units: [bottle('u1', { exp: days(10) }), bottle('u2', { exp: days(-2) }), bottle('u3')], now });
  assert.strictEqual(states.get('unit:u1').state, 'soon');
  assert.strictEqual(states.get('unit:u2').state, 'expired');
  assert.strictEqual(states.get('unit:u3').state, 'ok');
});

test('แจ้งเฉพาะสถานะที่แย่ลงใหม่ ไม่แจ้งซ้ำและไม่แจ้งตอนดีขึ้น', () => {
  const next = computeStockStates({
    standards: [{ _id: 's1', code: 'STD1', name: 'Atrazine' }],
    units: [bottle('u1', { exp: days(10) })],
    solvents: [{ _id: 'v1', name: 'Methanol', qty: 0 }, { _id: 'v2', name: 'ACN', qty: 5 }],
    now,
  });
  const events = diffStockStates(new Map([['item:solvent:v1', 'low'], ['item:solvent:v2', 'low']]), next);
  assert.deepStrictEqual(events.map((e) => e.key + '=' + e.state).sort(), ['item:solvent:v1=out', 'item:standard:s1=low', 'unit:u1=soon']);
  assert.deepStrictEqual(diffStockStates(new Map([...next].map(([k, v]) => [k, v.state])), next), []);
});

test('รวมแจ้งเตือนต่อชนิด และส่งให้ Lab Inventory', () => {
  const list = notificationsForEvents([
    { key: 'a', state: 'low', itemName: 'A', detail: 'เหลือ 1 ขวด' },
    { key: 'b', state: 'low', itemName: 'B', detail: '' },
    { key: 'c', state: 'expired', itemName: 'C', detail: 'ขวด L-1' },
  ], 123);
  assert.strictEqual(list.length, 2);
  const low = list.find((n) => n.key === 'stock:low:123');
  assert.strictEqual(low.title, 'สารใกล้หมด 2 รายการ');
  assert.deepStrictEqual(low.roles, ['lab-inventory']);
  assert.strictEqual(list.find((n) => n.key === 'stock:expired:123').level, 'error');
});
