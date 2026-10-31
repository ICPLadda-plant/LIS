const test = require('node:test');
const assert = require('node:assert/strict');
const { isLabAwaitingSgConfirmation, isWaterFormulationItem, readSgReading } = require('./sgConfirmation');

const waterItem = { seq: 1, sampleName: 'ไซเปอร์', commonName: 'CYPERMETHRIN 25% W/V EC', batchNo: '26S-CYP-001', sendToLab: true, sendToQc: true };
const petition = (overrides = {}) => ({ status: 'sampleSent', submittedBy: { department: 'LDI' }, items: [waterItem], ...overrides });

test('water formulation detection mirrors the frontend', () => {
  assert.equal(isWaterFormulationItem({ commonName: 'CYPERMETHRIN 25% W/V EC' }), true);
  assert.equal(isWaterFormulationItem({ commonName: 'THIAMETHOXAM 25% WG' }), false);
  assert.equal(isWaterFormulationItem({ commonName: 'ABAMECTIN 1.8% W/V' }), false);
  assert.equal(isWaterFormulationItem({ commonName: 'X', formulation: 'w/v' }), true);
});

test('Lab waits for the ถพ. confirmation of water samples', () => {
  assert.equal(isLabAwaitingSgConfirmation(petition()), true);
  assert.equal(isLabAwaitingSgConfirmation(petition({ items: [{ ...waterItem, sgConfirmedAt: new Date() }] })), false);
  assert.equal(isLabAwaitingSgConfirmation(petition({ items: [{ ...waterItem, sendToLab: false }] })), false);
  assert.equal(isLabAwaitingSgConfirmation(petition({ labReceivedAt: new Date() })), false);
  assert.equal(isLabAwaitingSgConfirmation(petition({ submittedBy: { department: 'R&D' } })), false);
});

test('reads the ถพ. value and temperature from the chosen entry', () => {
  assert.deepEqual(readSgReading({ values: {}, entries: [{ 'ค่าถพ.': 1.052, 'อุณหภูมิ': 30 }] }), { value: '1.052', temperature: '30' });
  assert.deepEqual(readSgReading({ values: { __formEntryIndex: 1 }, entries: [{ 'ค่าถพ.': 1 }, { 'ค่าถพ.::A': '1.100', 'อุณหภูมิ': '' }] }), { value: '1.100', temperature: '' });
  assert.deepEqual(readSgReading(null), { value: '', temperature: '' });
});
