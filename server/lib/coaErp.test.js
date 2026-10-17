const test = require('node:test');
const assert = require('node:assert/strict');
const {
  batchFromRow,
  batchSimilarity,
  densityForBatch,
  densityBatchFamily,
  findBestDensityBatch,
  findBestLegacyLabResult,
  findLatestAiLabItems,
  findBestRequestItem,
  formKindForCommonName,
  legacyProductMatchScore,
  lotSnapshot,
  mergeResultRows,
  normalizeIsoDate,
  physicalFromQc,
  isAfterDryingLabItem,
  resultRowsFromLegacyLab,
  resultRowsFromLegacyLabs,
  resultRowsFromQc,
  sampleFromSources,
} = require('./coaErp');

test('averages two valid density readings from the same batch before autofill', () => {
  const density = densityForBatch([
    { 'Sample name': '26S-ACT50-095 TOP', 'Density [g/cm³]': '1.0514', 'Measurement status': 'valid', 'Date & time': '10/17/2026 9:00 AM' },
    { 'Sample name': '26S-ACT50-095 bottom', 'Density [g/cm³]': '1.0526', 'Measurement status': 'Valid', 'Date & time': '10/17/2026 9:05 AM' },
    { 'Sample name': '26S-ACT50-096', 'Density [g/cm³]': '1.9000', 'Measurement status': 'valid', 'Date & time': '10/17/2026 9:10 AM' },
  ], '26S-ACT50-095');

  assert.equal(density, '1.052');
});

test('ignores failed density readings when deciding whether to average', () => {
  const density = densityForBatch([
    { 'Sample name': 'FG260902-008', 'Density [g/cm³]': '1.158', 'Measurement status': 'valid', 'Date & time': '10/7/2026 9:00 AM' },
    { 'Sample name': 'FG260902-008', 'Density [g/cm³]': '3.071', 'Measurement status': 'Error', 'Date & time': '10/7/2026 9:05 AM' },
  ], 'FG260902-008');

  assert.equal(density, '1.158');
});

test('uses the attached dry-product COA form for every requested common-name suffix', () => {
  for (const suffix of ['WG', 'WP', 'ST', 'GR', 'DS', 'SP', 'GB']) {
    assert.equal(formKindForCommonName(`THIAMETHOXAM 25% ${suffix}`), 'grWpSp');
  }
  for (const suffix of ['SL', 'EC', 'EW', 'SC', 'ME', 'ZC']) {
    assert.equal(formKindForCommonName(`GLYPHOSATE 48% W/V ${suffix}`), 'liquid');
  }
});

test('LOT No. FGYYMMDD-NNN supplies the COA batch and production date', () => {
  assert.deepEqual(lotSnapshot('FG260902-008'), {
    lotNo: 'FG260902-008',
    batchNo: 'FG260902-008',
    productionDate: '2026-09-02',
  });
});

test('finished-product LOT supplies the batch segment and Buddhist production date', () => {
  assert.deepEqual(lotSnapshot('26S-PCB25-480-091069'), {
    lotNo: '26S-PCB25-480-091069',
    batchNo: '480',
    productionDate: '2026-10-09',
  });
});

test('normalizes Buddhist-era dates from the legacy Lab database', () => {
  assert.equal(normalizeIsoDate('26/06/2569'), '2026-06-26');
  assert.equal(normalizeIsoDate('31/02/2569'), '');
});

test('legacy Lab matching handles reversed substances and historical spelling', () => {
  const source = {
    sampleSnapshots: [{ commonName: 'PROPANIL 36% + ANILOFOS 18% W/V EC' }],
    externalCoaRequest: { packingSize: '12*1 L', shipmentDate: '2026-10-09' },
  };
  const match = findBestLegacyLabResult([{
    _id: 'legacy-1', sample_name: 'Anilophos 18+Propanil 36%EC',
    batch_no: '26S-ANF18+PPN36-013', production_date: '07/08/2569', test_date: '08/08/2569',
    tests: [
      { test_name: 'Anilophos', result: '18.39 % W/V', criteria: '16.92-19.08' },
      { test_name: 'Propanil', result: '36.70 % W/V', criteria: '34.20-37.80' },
      { test_name: 'Density', result: '1.091 g/cm³' },
    ],
  }], source);

  assert.ok(legacyProductMatchScore(source.sampleSnapshots[0].commonName, 'Anilophos 18+Propanil 36%EC') >= 0.75);
  assert.equal(match.batchNo, '26S-ANF18+PPN36-013');
  assert.equal(match.productionDate, '2026-08-07');
  assert.equal(match.matchKind, 'productHistory');
});

test('legacy Lab matching accepts established product-name aliases', () => {
  assert.ok(legacyProductMatchScore(
    'PACLOBUTRAZOL 25% SC',
    'Paclobutrazole 25% SC',
  ) >= 0.75);
  assert.ok(legacyProductMatchScore(
    '2,4-D-BUTYL 3.76% + ANILOFOS 1.5% GR',
    'Anilophos 1.5+2,4-D BE3.76 %GR',
  ) >= 0.75);
});

test('legacy Lab matching uses package type to choose the compatible formulation', () => {
  const source = {
    sampleSnapshots: [{ commonName: 'อะซีทามิพิด (acetamiprid)' }],
    externalCoaRequest: { packingSize: '12*500 g', shipmentDate: '2026-10-15' },
  };
  const match = findBestLegacyLabResult([
    {
      sample_name: 'Acetamiprid 2.85% EC', batch_no: 'LIQUID-NEW',
      production_date: '01/07/2569', test_date: '02/07/2569',
      tests: [{ test_name: 'Acetamiprid', result: '2.89 % W/V', criteria: '2.57-3.14' }],
    },
    {
      sample_name: 'Acetamiprid 20 %SP', batch_no: 'DRY-OLDER',
      production_date: '20/03/2569', test_date: '09/07/2569',
      tests: [{ test_name: 'Acetamiprid', result: '20.53 %W/W', criteria: '18.80-21.20' }],
    },
  ], source);

  assert.equal(match.batchNo, 'DRY-OLDER');
});

test('legacy Lab matching rejects a different chemical with a similar name', () => {
  const source = {
    sampleSnapshots: [{ commonName: 'PHOSPHONIC ACID 40% W/V SL' }],
    externalCoaRequest: { packingSize: '16*1 L', shipmentDate: '2026-10-07' },
  };
  const match = findBestLegacyLabResult([{
    sample_name: 'Phosphoric acid 40% SL', batch_no: '2605202',
    production_date: '22/07/2569', test_date: '14/08/2569',
    tests: [{ test_name: 'Phosphoric acid', result: '42.40 % W/V', criteria: '38.00-42.00' }],
  }], source);

  assert.equal(match, null);
});

test('legacy Lab matching rejects a mislabeled row whose tests belong to another product', () => {
  const source = {
    sampleSnapshots: [{ commonName: '2,4-D-BUTYL 3.76% + ANILOFOS 1.5% GR' }],
    externalCoaRequest: { packingSize: '1*15 kg', shipmentDate: '2026-10-07' },
  };
  const match = findBestLegacyLabResult([{
    sample_name: 'Anilophos 1.5+2,4-D BE3.76 %GR', batch_no: '26S-OMT50-456',
    production_date: '17/08/2569', test_date: '17/08/2569',
    tests: [{ test_name: 'Omethoate', result: '51.94 % W/V', criteria: '47.50-52.50' }],
  }], source);

  assert.equal(match, null);
});

test('legacy Lab results fill every required COA result field and clean repeat suffixes', () => {
  const source = {
    sampleSnapshots: [{ commonName: 'EMAMECTIN BENZOATE 2.0% W/V ME' }],
    externalCoaRequest: { packingSize: '24*500 cc', shipmentDate: '2026-10-15' },
  };
  const row = {
    sample_name: 'Emamectin bensoate 2 % ME', batch_no: '20260430 P1',
    production_date: '18/06/2569', test_date: '31/08/2569', sample_condition: 'ของเหลวใสสีเหลือง',
    tests: [
      { test_name: 'Emamectin bensoate', result: '2.09 % W/V', criteria: '1.70-2.30', method: 'CIPAC 1C' },
      { test_name: 'Density', result: '0.946 g/cm³' },
    ],
  };
  const match = findBestLegacyLabResult([row], source);
  const result = resultRowsFromLegacyLab(row, source.sampleSnapshots[0].commonName);

  assert.equal(match.batchNo, '20260430');
  assert.equal(result.rows[0].testItem, 'Appearance');
  assert.equal(result.rows[1].testItem, '%AI content');
  assert.match(result.rows[2].testItem, /Density at 30/);
  assert.equal(result.rows[3].testItem, 'Date of analysis');
  assert.equal(result.rows[1].result, '2.09 % W/V');
  assert.equal(result.rows[2].result, '0.946');
  assert.equal(result.rows[3].result, '2026-08-31');
});

test('legacy Lab AI excludes the named submitter and averages duplicate batch results', () => {
  const result = resultRowsFromLegacyLabs([
    {
      customer_name: 'Production A', test_date: '16/09/2569',
      tests: [{ test_name: 'Omethoate', result: '51.20 %W/V', criteria: '47.50-52.50', method: 'CIPAC E' }],
    },
    {
      customer_name: 'Production B', test_date: '17/09/2569',
      tests: [{ test_name: 'Omethoate', result: '51.40 %W/V', criteria: '47.50-52.50', method: 'CIPAC E' }],
    },
    {
      customer_name: '\u0e27\u0e18\u0e32\u0e18\u0e23 \u0e2a\u0e2d\u0e19\u0e0b\u0e35', test_date: '18/09/2569',
      tests: [{ test_name: 'Omethoate', result: '0.0045 %W/V', criteria: '47.50-52.50', method: 'CIPAC E' }],
    },
  ], 'OMETHOATE 50% W/V SL');

  assert.equal(result.ai.result, '51.3 %W/V');
  assert.equal(result.ai.valueCount, 2);
  assert.equal(result.analysisDate, '2026-09-17');
  assert.equal(result.rows[0].criteria, '47.50-52.50');
});

test('legacy Lab fallback fills placeholder values without replacing live results', () => {
  const rows = mergeResultRows([
    { testItem: 'Appearance', criteria: 'Clear liquid', result: 'Conform', method: 'Visual', unit: '' },
    { testItem: '%AI content', criteria: '-', result: '-', method: '', unit: '%' },
  ], [
    { testItem: 'Appearance', criteria: 'Yellow liquid', result: 'Conform', method: 'Legacy', unit: '' },
    { testItem: '%AI content', criteria: '1.70-2.30', result: '2.09 % W/V', method: 'CIPAC 1C', unit: '%' },
  ]);

  assert.equal(rows[0].criteria, 'Clear liquid');
  assert.equal(rows[0].method, 'Visual');
  assert.equal(rows[1].criteria, '1.70-2.30');
  assert.equal(rows[1].result, '2.09 % W/V');
  assert.equal(rows[1].method, 'CIPAC 1C');
});

test('stock LOT autofill preserves the full LOT while using its real batch and production date', () => {
  const result = sampleFromSources({
    selectedItemSeqs: [10000],
    sampleSnapshots: [{ sampleName: 'Trade A', commonName: 'PACLOBUTRAZOL 25% SC' }],
    externalCoaRequest: { itemNo: 'F-TWI25-1000X12' },
  }, [{
    item_no: 'F-TWI25-1000X12',
    lot_no: '26S-PCB25-480-091069',
    registering_date: '2026-10-10T00:00:00.000Z',
    stock_qty: 100,
  }], []);

  assert.equal(result.sample.lotNo, '26S-PCB25-480-091069');
  assert.equal(result.sample.batchNo, '480');
  assert.equal(result.sample.productionDate, '2026-10-09');
  assert.equal(result.stockCandidates[0].batchNo, '480');
});

test('dated ERP Lot Description overrides stale Lot and Batch values', () => {
  const result = sampleFromSources({
    selectedItemSeqs: [10000],
    sampleSnapshots: [{
      sampleName: 'Trade A',
      commonName: 'OMETHOATE 50% W/V SL',
      batchNo: '26S-OMT50-256',
      productionDate: '2026-05-09',
    }],
    externalCoaRequest: {
      itemNo: 'F-OMT50-1X20',
      shipmentDate: '2026-09-17T00:00:00.000Z',
    },
  }, [{
    item_no: 'F-OMT50-1X20',
    lot_no: '26S-OMT50-256',
    'Lot Description': '26S-OMT50-526-170969',
    registering_date: '2026-09-18T00:00:00.000Z',
    stock_qty: 100,
  }], []);

  assert.equal(result.erpLotDescription, '26S-OMT50-526-170969');
  assert.equal(result.sample.lotNo, '26S-OMT50-526-170969');
  assert.equal(result.sample.batchNo, '526');
  assert.equal(result.sample.productionDate, '2026-09-17');
});

test('density history selects the matching batch family nearest the shipment date', () => {
  assert.equal(densityBatchFamily('26S-OMT50-256'), '26S-OMT50');
  const result = findBestDensityBatch([
    { 'Sample name': '26S-OMT50-256', 'Date & time': '5/9/2026 1:33 PM' },
    { 'Sample name': '26S-OMT50-524', 'Date & time': '9/17/2026 1:29 PM' },
    { 'Sample name': '26S-OMT50-526', 'Date & time': '9/17/2026 1:31 PM' },
    { 'Sample name': '26S-OMT50-531', 'Date & time': '9/18/2026 1:39 PM' },
  ], {
    externalCoaRequest: { shipmentDate: '2026-09-17T00:00:00.000Z' },
  }, '26S-OMT50-256');

  assert.deepEqual(result, {
    batchNo: '526',
    sourceBatchNo: '26S-OMT50-526',
    productionDate: '2026-09-17',
    productionTime: Date.parse('2026-09-17T00:00:00.000Z'),
  });
});

test('ERP Lot No. takes precedence and its six date digits supply the production date', () => {
  const result = sampleFromSources({
    selectedItemSeqs: [10000],
    sampleSnapshots: [{ sampleName: 'Trade A', commonName: 'EMAMECTIN BENZOATE 2.0% W/V ME' }],
    externalCoaRequest: { itemNo: 'FC-LINOI-1X16' },
  }, [{
    item_no: 'FC-LINOI-1X16',
    lot_no: 'FG260404-002',
    'Lot Description': 'FG261015-008',
    stock_qty: 64,
  }], []);

  assert.equal(result.sample.lotNo, 'FG260404-002');
  assert.equal(result.sample.productionDate, '2026-04-04');
});

test('matching ERP Lot Description supplies production date before an existing request date', () => {
  const result = sampleFromSources({
    selectedItemSeqs: [10000],
    sampleSnapshots: [{
      sampleName: 'Trade A',
      commonName: 'PACLOBUTRAZOL 25% SC',
      batchNo: '480',
      productionDate: '2026-06-16',
    }],
    externalCoaRequest: { itemNo: 'F-TWI25-1000X12' },
  }, [{
    item_no: 'F-TWI25-1000X12',
    'Lot Description': '26S-PCB25-480-091069',
    registering_date: '2026-10-10T00:00:00.000Z',
    stock_qty: 100,
  }], []);

  assert.equal(result.sample.lotNo, '26S-PCB25-480-091069');
  assert.equal(result.sample.batchNo, '480');
  assert.equal(result.sample.productionDate, '2026-10-09');
});

test('newest ERP FG Lot Description supplies the production date even when the request date is older', () => {
  const result = sampleFromSources({
    selectedItemSeqs: [10000],
    sampleSnapshots: [{
      sampleName: 'Trade A',
      commonName: 'PACLOBUTRAZOL 25% SC',
      batchNo: 'B-CUSTOMER-001',
      productionDate: '2026-06-16',
    }],
    externalCoaRequest: { itemNo: 'F-TWI25-1000X12' },
  }, [{
    item_no: 'F-TWI25-1000X12', lot_no: 'FG260615-022', stock_qty: 100,
  }, {
    item_no: 'F-TWI25-1000X12', lot_no: 'FG260902-008', stock_qty: 50,
  }], []);

  assert.equal(result.sample.batchNo, 'B-CUSTOMER-001');
  assert.equal(result.sample.productionDate, '2026-09-02');
});

test('customer COA request batch, lot and production date take precedence over ERP references', () => {
  const result = sampleFromSources({
    selectedItemSeqs: [10000],
    sampleSnapshots: [{
      sampleName: 'Trade A',
      commonName: 'PACLOBUTRAZOL 25% SC',
      batchNo: 'B-CUSTOMER-001',
      lotNo: 'L-CUSTOMER-001',
      productionDate: '2026-04-18T00:00:00.000Z',
    }],
    externalCoaRequest: { itemNo: 'F-TWI25-1000X12' },
  }, [{
    item_no: 'F-TWI25-1000X12',
    lot_no: '26S-PCB25-480-091069',
    registering_date: '2026-10-10T00:00:00.000Z',
    stock_qty: 100,
  }], [{
    item_no: 'F-TWI25-1000X12',
    batch_no: 'FG260518-019',
    create_date: '2026-05-18T00:00:00.000Z',
  }]);

  assert.equal(result.sample.batchNo, 'B-CUSTOMER-001');
  assert.equal(result.sample.lotNo, 'L-CUSTOMER-001');
  assert.equal(result.sample.productionDate, '2026-04-18');
});

test('LIS petition Lot No. supplies its own production date instead of a newer ERP lot', () => {
  const source = {
    selectedItemSeqs: [10000],
    sampleSnapshots: [{ sampleName: 'Trade A', commonName: 'COMMON A' }],
    externalCoaRequest: {
      itemNo: 'ITEM-A',
      saleOrderDate: '2026-05-01',
      shipmentDate: '2026-09-20',
    },
  };
  const petitionMatch = findBestRequestItem([
    {
      updatedAt: '2026-10-16',
      items: [{ itemNo: 'ITEM-A', sampleName: 'Trade A', commonName: 'COMMON A', batchNo: 'B-NEW', productionDate: '2026-10-15' }],
    },
    {
      updatedAt: '2026-09-13',
      items: [{ itemNo: 'ITEM-A', sampleName: 'Trade A', commonName: 'COMMON A', batchNo: 'B-CUSTOMER', lotNo: 'FG260912-001', productionDate: '2026-06-16' }],
    },
  ], source);
  const result = sampleFromSources(source, [{
    item_no: 'ITEM-A', lot_no: 'FG261015-004', stock_qty: 100,
  }], [], petitionMatch.item);

  assert.equal(petitionMatch.item.batchNo, 'B-CUSTOMER');
  assert.equal(result.sample.batchNo, 'B-CUSTOMER');
  assert.equal(result.sample.lotNo, 'FG260912-001');
  assert.equal(result.sample.productionDate, '2026-09-12');
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

test('does not use an MF row without a real batch for Batch No. or production date', () => {
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
  assert.equal(result.sample.productionDate, '');
  assert.equal(result.mfCandidates.length, 0);
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

test('AI Lab selection prefers exact batch then falls back to the latest same drug and excludes after-drying items', () => {
  const commonName = 'GLYPHOSATE 48% W/V SL';
  const regularItems = [
    { seq: 1, sampleName: 'Product A', commonName, batchNo: '2026031601' },
    { seq: 2, sampleName: 'Product A', commonName, batchNo: '2025120701' },
  ];
  const result = findLatestAiLabItems([
    {
      _id: 'excluded-submitter', labApprovedAt: '2026-10-13T00:00:00.000Z',
      submittedBy: { name: '\u0e27\u0e18\u0e32\u0e18\u0e23 \u0e2a\u0e2d\u0e19\u0e0b\u0e35' }, items: regularItems,
    },
    {
      _id: 'rnd-newest', labApprovedAt: '2026-10-12T00:00:00.000Z',
      submittedBy: { department: 'R&D' }, items: regularItems,
    },
    {
      _id: 'after-drying', labApprovedAt: '2026-10-11T00:00:00.000Z',
      submittedBy: { department: 'QC' },
      items: [{ seq: 1, sampleName: 'ยาหลังอบ', commonName, batchNo: '2026031601' }],
    },
    {
      _id: 'warehouse-latest', approvedAt: '2026-10-10T00:00:00.000Z',
      submittedBy: { department: 'Warehouse Product' }, items: regularItems,
    },
    {
      _id: 'qc-older', labApprovedAt: '2026-10-09T00:00:00.000Z',
      submittedBy: { department: 'QC' }, items: regularItems.slice(0, 1),
    },
  ], { commonName, batchNo: '2026031601' });

  assert.equal(result.best.petition._id, 'rnd-newest');
  assert.deepEqual(result.best.items.map((item) => item.seq), [1]);
  assert.equal(isAfterDryingLabItem({ note: 'ทดสอบยาหลังอบ' }), true);

  const fallback = findLatestAiLabItems([
    {
      _id: 'latest-in-progress', status: 'inProgress', updatedAt: '2026-10-15T00:00:00.000Z',
      items: [{ seq: 7, sampleName: 'Product B', commonName, batchNo: 'B-OTHER' }],
    },
  ], { commonName, batchNo: 'B-NOT-FOUND', sampleName: 'Product A' });
  assert.equal(fallback.best.petition._id, 'latest-in-progress');
  assert.equal(fallback.best.matchKind, 'commonName');
});

test('AI results average duplicate entries and ignore after-drying phase values', () => {
  const rows = resultRowsFromQc([{
    parameterName: '%AI',
    entries: [
      { '%AI::glyphosate': '24.28' },
      { '%AI::glyphosate': '24.33' },
    ],
    valuesPhase2: { '%AI::glyphosate': '99.99' },
  }], 'GLYPHOSATE 48% W/V SL');

  assert.equal(rows.ai.result, '24.305%');
  assert.equal(rows.ai.valueCount, 2);
});

test('AI results average matching values from multiple Lab result documents', () => {
  const rows = resultRowsFromQc([
    { parameterName: '%AI', values: { '%AI::glyphosate': '24.28' } },
    { parameterName: '%AI', values: { '%AI::glyphosate': '24.33' } },
  ], 'GLYPHOSATE 48% W/V SL');

  assert.equal(rows.ai.result, '24.305%');
  assert.equal(rows.ai.valueCount, 2);
});
