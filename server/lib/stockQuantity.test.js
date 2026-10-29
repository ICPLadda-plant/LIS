const test = require('node:test');
const assert = require('node:assert');
const { normalizeQuantity } = require('./stockQuantity');

test('ตัดเศษทศนิยมจากการลบหลายครั้งให้เป็น 0', () => {
  assert.strictEqual(normalizeQuantity(60 - 10.1 - 20.3 - 29.6), 0);
  assert.strictEqual(normalizeQuantity(1e-12), 0);
  assert.strictEqual(normalizeQuantity(-1e-12), 0);
});

test('คงค่าปกติไว้', () => {
  assert.strictEqual(normalizeQuantity(0.1 + 0.2), 0.3);
  assert.strictEqual(normalizeQuantity(12.5), 12.5);
});
