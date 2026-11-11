const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCoaSnapshots } = require('./coaLifecycle');
const { buildCoaFormOptions, buildCoaParameterOptions, applyCoaFormSelections } = require('./coaForm');

const source = {
  petition: { petitionNo: 'P-1', items: [{ seq: 1, commonName: 'Glyphosate 48% SL' }] },
  selectedItemSeqs: [1],
  parameters: [
    { _id: 'ai', name: '%AI', scope: 'lab', valueFields: [{ label: '%AI', type: 'float', unit: '%' }] },
    { _id: 'physical', name: 'กายภาพ', scope: 'qc', valueFields: [{ label: 'ลักษณะ', type: 'enum' }, { label: 'สี', type: 'text' }, { label: 'รูปกายภาพ', type: 'photo' }] },
    { _id: 'density', name: 'ค่า ถพ.', scope: 'qc', valueFields: [{ label: 'ค่าถพ.', type: 'float', unit: 'g/cm3' }, { label: 'อุณหภูมิ', type: 'float', unit: 'C' }] },
  ],
  qcResults: [
    { itemSeq: 1, parameterId: 'ai', parameterName: '%AI', entries: [{ '%AI': 48.1 }, { '%AI': 48.2 }], valuesPhase2: { '%AI': 48.3 } },
    { itemSeq: 1, parameterId: 'physical', values: { 'ลักษณะ': 'ของเหลวใส', 'สี': 'สีส้ม', 'รูปกายภาพ': ['private-photo'], __note: 'private' } },
    { itemSeq: 1, parameterId: 'density', values: { 'ค่าถพ.': 1.182, 'อุณหภูมิ': 30 } },
    { itemSeq: 2, parameterId: 'ai', values: { '%AI': 99 } },
  ],
};
const options = buildCoaFormOptions(source);
const snapshots = buildCoaSnapshots(source);
const selection = {
  itemSeq: 1,
  aiKey: options.find((option) => option.result === '48.3%').key,
  appearanceKey: options.find((option) => option.kind === 'appearance').key,
  appearanceSource: 'ของเหลวใส สีส้ม',
  appearanceSpecification: 'Clear orange liquid',
  appearanceResult: 'Conform',
  densityKey: options.find((option) => option.kind === 'density').key,
};

test('offers all saved configured fields without exposing photos, files or internal values', () => {
  const fields = buildCoaParameterOptions(source);
  assert.equal(fields.length, 7);
  assert.ok(fields.every((field) => field.kind === 'result' && field.itemSeq === 1));
  assert.ok(fields.some((field) => field.testItem.includes('อุณหภูมิ') && field.result === '30' && field.unit === 'C'));
  assert.ok(fields.some((field) => field.testItem === 'กายภาพ - สี' && field.result === 'สีส้ม'));
  assert.equal(JSON.stringify(fields).includes('private'), false);
  assert.equal(fields.find((field) => field.result === '48.3').criteria, '48% ± 2.40');
});

test('freezes only chosen database fields without requiring AI or inventing a physical verdict', () => {
  const fields = buildCoaParameterOptions(source);
  const color = fields.find((field) => field.testItem === 'กายภาพ - สี');
  const selected = [{ itemSeq: 1, resultKeys: [color.key], result: 'Conform' }];
  const result = applyCoaFormSelections(snapshots, fields, selected);
  assert.deepEqual(result.resultSnapshots, [{ itemSeq: 1, testItem: 'กายภาพ - สี', result: 'สีส้ม', criteria: '', unit: '' }]);
  assert.deepEqual(result.formSelections, [{ itemSeq: 1, resultKeys: [color.key] }]);
  assert.equal(result.trendSnapshots[0].aiResultPercent, undefined);
  for (const resultKeys of [null, [], [color.key, color.key], ['not-a-source'], [1]]) {
    assert.throws(() => applyCoaFormSelections(snapshots, fields, [{ itemSeq: 1, resultKeys }]));
  }
  assert.throws(() => applyCoaFormSelections(snapshots, [{ ...color, itemSeq: 2 }], selected));
});

test('supports repeated fields, zero values and phase-specific fields with stable keys', () => {
  const changed = structuredClone(source);
  changed.parameters = [{ _id: 'repeat', name: 'Other test', valueFields: [
    { label: 'Value', type: 'number', unit: 'mg', multiple: true, phase: 'both', standardOperator: 'between', standardValue: 0, standardValue2: 10 },
    { label: 'Before', type: 'text', phase: 'before' }, { label: 'After', type: 'text', phase: 'after' },
    { label: 'File', type: 'file' }, { label: '__note', type: 'text' },
  ] }];
  changed.qcResults = [{ itemSeq: 1, parameterId: 'repeat', entries: [{ Value: [0, 2], Before: 'before', After: 'hidden', File: 'private', __note: 'private' }], valuesPhase2: { Value: [3], Before: 'hidden', After: 'after' } }];
  const fields = buildCoaParameterOptions(changed);
  assert.deepEqual(fields.map((field) => field.result), ['0', '2', 'before', '3', 'after']);
  assert.equal(fields[0].criteria, '0 - 10');
  const phase2Key = fields.find((field) => field.result === '3').key;
  changed.qcResults[0].entries.push({ Value: [4] });
  assert.equal(buildCoaParameterOptions(changed).find((field) => field.result === '3').key, phase2Key);
});

test('persists generic selection keys while keeping legacy form validation', () => {
  const CoaDocument = require('../models/CoaDocument');
  const base = { petitionId: '507f1f77bcf86cd799439031', status: 'draft' };
  const document = new CoaDocument({ ...base, formSelections: [{ itemSeq: 1, resultKeys: ['field-key'] }] });
  assert.equal(document.validateSync(), undefined);
  assert.deepEqual(document.toObject().formSelections, [{ itemSeq: 1, resultKeys: ['field-key'] }]);
  assert.equal(new CoaDocument({ ...base, formSelections: [selection] }).validateSync(), undefined);
  for (const formSelection of [{ itemSeq: 1 }, { itemSeq: 1, resultKeys: [] }, { itemSeq: 1, resultKeys: null }]) {
    assert.ok(new CoaDocument({ ...base, formSelections: [formSelection] }).validateSync());
  }
});

test('offers only selected, configured AI, physical and density values with safe English suggestions', () => {
  assert.equal(options.length, 5);
  assert.ok(options.every((option) => option.itemSeq === 1));
  assert.equal(options.find((option) => option.kind === 'appearance').suggestedEnglish, 'Clear liquid, Orange');
  const powder = structuredClone(source);
  powder.qcResults[1].values = { 'ลักษณะ': 'ผงละเอียด', 'สี': 'สีขาวนวล' };
  assert.equal(buildCoaFormOptions(powder).find((option) => option.kind === 'appearance').suggestedEnglish, 'Off white powder');
  assert.equal(JSON.stringify(options).includes('private'), false);
  assert.equal(JSON.stringify(options).includes('อุณหภูมิ'), false);
  const changed = structuredClone(source);
  changed.qcResults[1].values['สี'] = 'สีที่ยังไม่ได้แปล';
  assert.equal(buildCoaFormOptions(changed).find((option) => option.kind === 'appearance').suggestedEnglish, '');
});

test('keeps phase-two source keys stable when more phase-one entries are added', () => {
  const changed = structuredClone(source);
  changed.qcResults[0].entries.push({ '%AI': 48.4 });
  assert.equal(buildCoaFormOptions(changed).find((option) => option.result === '48.3%').key, selection.aiKey);
});

test('does not present AI from QC or measurements with incompatible units as report values', () => {
  const changed = structuredClone(source);
  changed.parameters[0].scope = 'qc';
  changed.parameters[2].valueFields[0].unit = 'kg/m3';
  assert.deepEqual(buildCoaFormOptions(changed).map((option) => option.kind), ['appearance']);
});

test('recognizes a density parameter with a generic numeric field without selecting temperature', () => {
  const changed = structuredClone(source);
  changed.parameters[2].name = 'Density';
  changed.parameters[2].valueFields[0].label = 'Value';
  changed.qcResults[2].values = { Value: 1.182, 'อุณหภูมิ': 30 };
  assert.deepEqual(buildCoaFormOptions(changed).filter((option) => option.kind === 'density').map((option) => option.result), ['1.182']);
});

test('freezes selected database values, English appearance and matching trend without density tolerance', () => {
  const result = applyCoaFormSelections(snapshots, options, [{ ...selection, aiResult: '999' }]);
  assert.deepEqual(result.resultSnapshots, [
    { itemSeq: 1, testItem: 'Appearance', criteria: 'Clear orange liquid', result: 'Conform' },
    { itemSeq: 1, testItem: '%AI content', result: '48.3%', criteria: '48% ± 2.40', unit: '%' },
    { itemSeq: 1, testItem: 'Density at 30°C (g/cm³)', result: '1.182', criteria: '', unit: 'g/cm³' },
  ]);
  assert.equal(result.trendSnapshots[0].aiResultPercent, 48.3);
  assert.deepEqual(result.formSelections, [selection]);
  assert.equal(snapshots.resultSnapshots[0].result, '48.1');
});

test('requires complete selections, valid sources, English text and explicit physical confirmation', () => {
  for (const invalid of [undefined, [], [selection, selection], [{ ...selection, itemSeq: 2 }]]) {
    assert.throws(() => applyCoaFormSelections(snapshots, options, invalid));
  }
  for (const change of [
    { aiKey: 'not-a-source' }, { appearanceKey: 'not-a-source' }, { densityKey: 'not-a-source' },
    { appearanceSource: 'เปลี่ยนข้อมูลเอง' }, { appearanceResult: '' }, { appearanceResult: 'ผ่าน' },
    { appearanceSpecification: '' }, { appearanceSpecification: 'ของเหลวใส' }, { appearanceSpecification: 'a'.repeat(301) },
  ]) {
    assert.throws(() => applyCoaFormSelections(snapshots, options, [{ ...selection, ...change }]));
  }
});

test('preserves Not conform and allows omitting a density result', () => {
  const result = applyCoaFormSelections(snapshots, options, [{ ...selection, densityKey: '', appearanceResult: 'Not conform' }]);
  assert.equal(result.resultSnapshots[0].result, 'Not conform');
  assert.equal(result.resultSnapshots.length, 2);
});
