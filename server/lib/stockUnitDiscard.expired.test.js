const test = require('node:test');
const assert = require('node:assert');
const { selectExpiredUnits } = require('./stockUnitDiscard');

test('selectExpiredUnits: เลือกเฉพาะขวด active ที่เลยวันหมดอายุ', () => {
  const now = new Date('2026-11-18T00:00:00Z');
  const units = [
    { _id: 'a', status: 'active', exp: '2026-11-17T00:00:00Z' },
    { _id: 'b', status: 'active', exp: '2026-11-19T00:00:00Z' },
    { _id: 'c', status: 'discarded', exp: '2026-01-01T00:00:00Z' },
    { _id: 'd', status: 'active', exp: null },
  ];
  assert.deepStrictEqual(selectExpiredUnits(units, now).map((u) => u._id), ['a']);
});
