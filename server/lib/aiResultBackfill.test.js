'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { correctedAiValues } = require('./aiResultBackfill');

test('แก้ %AI คำร้องเก่าด้วยค่า ถพ. รายสาร', () => {
  const result = correctedAiValues(
    { '% Sample Average::OMETHOATE': '50.00', '%AI::OMETHOATE': '50.00' },
    { entries: [{ 'ค่าถพ.::OMETHOATE': '1.075' }] },
  );
  assert.equal(result.values['%AI::OMETHOATE'], '53.75');
  assert.equal(result.changes.length, 1);
});

test('ไม่แก้เมื่อไม่มีค่าเฉลี่ยหรือค่า ถพ.', () => {
  assert.equal(correctedAiValues({ '%AI::OMETHOATE': '50.00' }, {}).changes.length, 0);
});
