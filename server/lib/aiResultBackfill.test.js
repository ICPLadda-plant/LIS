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

test('แก้ OMETHOATE ที่เคยใช้ ถพ. = 1 ด้วยค่า ถพ. แบบมีเว้นวรรค', () => {
  const result = correctedAiValues(
    { '% Sample Average': '70.50', '%AI::omethoate': '70.50' },
    { values: { 'ค่า ถพ.': '1.135' } },
  );
  assert.equal(result.values['%AI::omethoate'], '80.02');
});

test('ไม่แตะ %AI ที่คำนวณด้วยค่า ถพ. ไปแล้วหรือถูกแก้มือ', () => {
  const density = { values: { 'ค่าถพ.': '1.135' } };
  assert.equal(correctedAiValues({ '% Sample Average': '70.50', '%AI': '80.02' }, density).changes.length, 0);
  assert.equal(correctedAiValues({ '% Sample Average': '70.50', '%AI': '79.90' }, density).changes.length, 0);
});
