const test = require('node:test');
const assert = require('node:assert');
const { sumWeights, validateWeights } = require('./requisitionWeights');

test('sumWeights ignores non-numbers', () => {
  assert.strictEqual(Math.round(sumWeights([9.8, 10.3, 10.1]) * 10) / 10, 30.2);
  assert.strictEqual(sumWeights(['x', 5]), 5);
  assert.strictEqual(sumWeights([]), 0);
});

test('validateWeights: all > 0', () => {
  assert.strictEqual(validateWeights([0, 5], 100), 'จำนวน mg ไม่ถูกต้อง');
  assert.strictEqual(validateWeights([], 100), 'จำนวน mg ไม่ถูกต้อง');
});

test('validateWeights: not exceed remaining', () => {
  assert.strictEqual(validateWeights([60, 60], 100), 'ปริมาณคงเหลือไม่พอ');
});

test('validateWeights: allows displayed total with floating-point residue', () => {
  assert.strictEqual(validateWeights([0.02], 0.01999999999999602), '');
});

test('validateWeights: ok → empty', () => {
  assert.strictEqual(validateWeights([10, 10, 10], 100), '');
});
