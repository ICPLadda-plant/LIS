const test = require('node:test');
const assert = require('node:assert/strict');
const {
  batchFromRow,
  batchSimilarity,
  lotSnapshot,
  physicalFromQc,
  resultRowsFromQc,
  sampleFromSources,
} = require('./coaErp');

test('LOT No. FGYYMMDD-NNN supplies the COA batch and production date', () => {
  assert.deepEqual(lotSnapshot('FG260902-008'), {
    lotNo: 'FG260902-008',
    batchNo: 'FG260902-008',
    productionDate: '2026-09-02',
  });
});

test('batch matching ranks the exact number first and nearby numbers above unrelated batches', () => {
  assert.equal(batchSimilarity('26S-GLY48-005', '26S-GLY48-005'), 1);
  assert.ok(batchSimilarity('26S-GLY48-005', '26S-GLY48-006') > batchSimilarity('26S-GLY48-005', '26S-OMT50-515'));
});

test('reads the batch field between the product name and production date', () => {
  const source = {
    selectedItemSeqs: [10000],
    sampleSnapshots: [{ sampleName: 'Trade A', commonName: 'COMMON A' }],
    externalCoaRequest: { itemNo: 'ITEM-A' },
  };
  const result = sampleFromSources(source, [], [{
    item_no: 'item-a',
    prod_descript: 'Trade A',
    batch_no: 'FG260518-019',
    create_date: '2026-05-18T00:00:00.000Z',
    prod_order_no: 'MF26050019',
  }]);

  assert.equal(batchFromRow({ batch_no: 'FG260518-019', prod_order_no: 'MF26050019' }), 'FG260518-019');
  assert.equal(result.sample.batchNo, 'FG260518-019');
  assert.equal(result.sample.productionDate, '2026-05-18');
  assert.equal(result.mfCandidates[0].batchNo, 'FG260518-019');
});

test('does not use the MF production order as a Batch No.', () => {
  const result = sampleFromSources({
    selectedItemSeqs: [1],
    sampleSnapshots: [{ commonName: 'COMMON A' }],
    externalCoaRequest: { itemNo: 'ITEM-A' },
  }, [], [{
    item_no: 'ITEM-A',
    prod_descript: 'Trade A',
    prod_order_no: 'MF26050019',
    create_date: '2026-05-18T00:00:00.000Z',
  }]);

  assert.equal(result.sample.batchNo, '');
  assert.equal(result.sample.productionDate, '2026-05-18');
});

test('reads positional Batch values after the product name and before production date', () => {
  const source = {
    selectedItemSeqs: [1],
    sampleSnapshots: [{ sampleName: '\u0e0a\u0e49\u0e32\u0e07\u0e21\u0e32\u0e23\u0e4c\u0e01\u0e35\u0e49', commonName: 'BROMADIOLONE 0.005% W/W' }],
    externalCoaRequest: { itemNo: 'FCPH-TO-CK-1X10' },
  };
  const result080 = sampleFromSources(source, [], [[
    'FCPH-TO-CK-1X10', '\u0e0a\u0e49\u0e32\u0e07\u0e21\u0e32\u0e23\u0e4c\u0e01\u0e35\u0e49', '080', '2026-07-22',
  ]]);
  const result081 = sampleFromSources({
    ...source,
    externalCoaRequest: { itemNo: 'FCPH-TO-CK-1000X12' },
  }, [], [[
    'FCPH-TO-CK-1000X12', '\u0e0a\u0e49\u0e32\u0e07\u0e21\u0e32\u0e23\u0e4c\u0e01\u0e35\u0e49', '081', '2026-03-28',
  ]]);

  assert.equal(batchFromRow(['FCPH-TO-CK-1X10', '\u0e0a\u0e49\u0e32\u0e07\u0e21\u0e32\u0e23\u0e4c\u0e01\u0e35\u0e49', '080', '2026-07-22']), '080');
  assert.equal(batchFromRow(['FCPH-TO-CK-1000X12', '\u0e0a\u0e49\u0e32\u0e07\u0e21\u0e32\u0e23\u0e4c\u0e01\u0e35\u0e49', '081', '2026-03-28']), '081');
  assert.equal(batchFromRow({
    saleDate: '2026-06-19', TradeName: '\u0e0a\u0e49\u0e32\u0e07\u0e21\u0e32\u0e23\u0e4c\u0e01\u0e35\u0e49', unnamedBatch: '080', shipmentDate: '2026-07-22',
  }), '080');
  assert.equal(result080.sample.batchNo, '080');
  assert.equal(result080.sample.productionDate, '2026-07-22');
  assert.equal(result081.sample.batchNo, '081');
  assert.equal(result081.sample.productionDate, '2026-03-28');
});

test('physical QC values are translated to English and preserve unknown values for review', () => {
  assert.deepEqual(physicalFromQc({ values: { 'ลักษณะ': 'ของเหลวใส', 'สี': 'สีส้ม' } }), {
    raw: 'ของเหลวใส สีส้ม',
    english: 'Clear liquid, Orange',
    complete: true,
  });
  assert.equal(physicalFromQc({ values: { 'ลักษณะ': 'ของเหลวใส', 'สี': 'สีที่ยังไม่ได้แปล' } }).complete, false);
});

test('QC results become COA rows with common-name criteria and density', () => {
  const rows = resultRowsFromQc([
    { parameterName: 'กายภาพ', values: { 'ลักษณะ': 'ของเหลวใส', 'สี': 'ขาว' }, updatedAt: '2026-09-04T03:19:13.206Z' },
    { parameterName: '%AI', values: { '%AI::glyphosate': '48.35' } },
    { parameterName: 'ค่า ถพ.', entries: [{ 'ค่าถพ.::glyphosate': 1.158 }] },
  ], 'GLYPHOSATE 48% W/V SL');
  assert.deepEqual(rows.rows.map((row) => row.testItem), ['Appearance', '%AI content', 'Density at 30°C (g/cm³)', 'Date of analysis']);
  assert.equal(rows.rows[1].result, '48.35%');
  assert.equal(rows.rows[1].criteria, '48% ± 2.40');
  assert.equal(rows.rows[2].result, '1.158');
});

test('AI results prefer the substance-specific value over a generic total', () => {
  const rows = resultRowsFromQc([
    { parameterName: '%AI', values: { '%AI': '1', '%AI::fipronil': '0.2650' } },
  ], 'FIPRONIL 0.3% GR');
  assert.equal(rows.ai.result, '0.2650%');
});
