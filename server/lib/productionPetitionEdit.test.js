const {
  buildEditedItems,
  canEditWholePetition,
  replaceProductionNote,
  routeTargetsForItems,
} = require('./productionPetitionEdit');

describe('productionPetitionEdit', () => {
  test('allows whole edit only before QC/Lab receive the sample', () => {
    expect(canEditWholePetition({ status: 'deliveringQC' })).toBe(true);
    expect(canEditWholePetition({ status: 'sampleSent' })).toBe(true);
    expect(canEditWholePetition({ status: 'sampleSent', qcReceivedAt: new Date() })).toBe(false);
    expect(canEditWholePetition({ status: 'inProgress' })).toBe(false);
  });

  test('rebuilds items like the production create flow, including QC + Lab split', () => {
    const items = buildEditedItems(
      [{ seq: 1, sampleName: 'OLD', batchNo: 'B0', sampleId: 'P1-1', labelManufacturer: 'ICP' }],
      [
        { sampleName: 'PROPANIL', commonName: 'PROPANIL 36%', itemNo: 'RS-1', mfNo: 'MF1', batchNo: 'B1', lotNo: 'B1', qty: '100', unit: 'CC', sendToQc: '1', sendToLab: '1', labQty: '500', productionDate: '2026-11-02', requestDate: '2026-11-03' },
        { sampleName: 'PROPANIL', batchNo: 'B2', qty: '50', unit: 'CC', sendToQc: '0', sendToLab: '1' },
      ],
      { note: 'แก้ batch', priority: 'normal', petitionNo: 'P1' },
    );
    expect(items[0]).toMatchObject({
      seq: 1, batchNo: 'B1', sampleQuantity: 2, labelQuantities: ['100 CC', '500 CC'], labelQuantity: '100 CC, 500 CC',
      sendToQc: true, sendToLab: true, sampleId: 'P1-1', labelManufacturer: 'ICP', submissionNo: 'P1',
      note: 'แก้ batch | Item: RS-1 | MF: MF1 | Priority: normal', productionDate: '2026-11-02', labelSampledDate: '2026-11-03',
    });
    expect(items[1]).toMatchObject({ seq: 2, sampleQuantity: 1, labelQuantities: ['50 CC'], sendToQc: false, sendToLab: true });
    expect(routeTargetsForItems(items)).toEqual([]);
    expect(routeTargetsForItems([items[1]])).toEqual(['lab']);
  });

  test('keeps several QC and Lab portions with their sides', () => {
    const [item] = buildEditedItems([], [
      { sampleName: 'PROPANIL', batchNo: 'B1', qty: '10', unit: 'CC', sendToQc: '1', sendToLab: '1', labQty: '50', qcQtys: ['10', '10'], labQtys: ['50', '50', '50'] },
    ], { petitionNo: 'P1' });
    expect(item).toMatchObject({
      sampleQuantity: 5,
      labelQuantities: ['10 CC', '10 CC', '50 CC', '50 CC', '50 CC'],
      labelQuantitySides: ['qc', 'qc', 'lab', 'lab', 'lab'],
    });
  });

  test('replaces only the production note and keeps Item/MF/Priority', () => {
    expect(replaceProductionNote('MF: X | Item: A | MF: X | Priority: urgent', 'ใหม่'))
      .toBe('ใหม่ | Item: A | MF: X | Priority: urgent');
    expect(replaceProductionNote('เก่า | Item: A', '')).toBe('Item: A');
  });
});

