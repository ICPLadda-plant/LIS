import { describe, expect, it } from 'vitest';
import {
  buildProductionReturnUrl,
  hasRequiredLabRequestStep,
  isResearchAndDevelopmentDepartment,
  makeInitialItemsFromQuery,
  integrationPayloadToSearchParams,
  objectToSearchParams,
  requiresMasterItemSelection,
  requiresDeliveryAndBatch,
} from './ProductionPetitionNewPage';

describe('integrationPayloadToSearchParams', () => {
  it('reads the query string Production posted exactly as if it came from the URL', () => {
    const query = new URLSearchParams({
      requestNo: 'SA261106000001',
      'samples[0][sampleName]': 'A',
      'samples[0][batchNo]': 'B-1',
      'samples[0][note]': 'หมายเหตุตัวแรก',
      'samples[1][sampleName]': 'A',
      'samples[1][batchNo]': 'B-2',
      'samples[1][note]': '',
    }).toString();

    const params = integrationPayloadToSearchParams({ query });

    expect(params.toString()).toBe(query);
    // ช่องว่างของตัวสุดท้ายต้องคงไว้ ไม่งั้น LIS เอาค่าของตัวแรกมาเติมแทน
    expect(makeInitialItemsFromQuery(params).map((item) => item.note)).toEqual(['หมายเหตุตัวแรก', '']);
  });

  it('still accepts the object payload of older callers', () => {
    const params = integrationPayloadToSearchParams({ requestNo: 'SA1', samples: [{ sampleName: 'A', batchNo: 'B-1' }] });

    expect(params.get('requestNo')).toBe('SA1');
    expect(params.get('samples[0][batchNo]')).toBe('B-1');
  });
});

describe('buildProductionReturnUrl', () => {
  it('returns production list with original request number and LIS petition number', () => {
    const params = new URLSearchParams('requestNo=SA260715023429&request_no=SA260715023429');

    expect(buildProductionReturnUrl(params, { petitionNo: 'P26070001' })).toBe(
      'https://app-plant.icpladda.com/production-react/?tab=list&requestNo=SA260715023429&request_no=SA260715023429&lisPetitionNo=P26070001&petitionNo=P26070001&lisStatus=sent&lisSent=1',
    );
  });
});

describe('makeInitialItemsFromQuery — itemNo', () => {
  // ระบบผลิตส่ง itemNo มาอยู่แล้ว (เดิมเอาไปต่อท้าย note เฉยๆ) — ต้องลงฟิลด์ itemNo ด้วย
  // ไม่งั้นเงื่อนไข "หมวดหมู่ย่อย (prefix code)" ของ parameter ใช้ไม่ได้กับคำขอเส้นนี้
  it('carries a single itemNo from the query onto the item', () => {
    const [item] = makeInitialItemsFromQuery(new URLSearchParams('sampleName=Foo&itemNo=RO-0123'));
    expect(item.itemNo).toBe('RO-0123');
  });

  it('carries one itemNo per item when several are passed', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams('sampleName=Foo,Bar&batchNo=B1,B2&itemNo=RO-0123,RI-0044'),
    );
    expect(items.map((i) => i.itemNo)).toEqual(['RO-0123', 'RI-0044']);
  });

  it('leaves itemNo empty when the query has none', () => {
    const [item] = makeInitialItemsFromQuery(new URLSearchParams('sampleName=Foo'));
    expect(item.itemNo).toBe('');
  });
});

describe('makeInitialItemsFromQuery — active ingredient format', () => {
  it('pairs active ingredients with their percentages from production payloads', () => {
    const [item] = makeInitialItemsFromQuery(
      new URLSearchParams(
        'sampleName=%E0%B9%84%E0%B8%8B%E0%B9%82%E0%B8%99%E0%B8%A5%E0%B8%B4%E0%B8%99&commonName=CYMOXANIL%20%2B%20MANCOZEB%208%25%20%2B%2064%25%20WP',
      ),
    );

    expect(item.commonName).toBe('CYMOXANIL 8% + MANCOZEB 64% WP');
  });
});

describe('R&D integration request rules', () => {
  it('recognizes the HR department name regardless of spacing/case', () => {
    expect(isResearchAndDevelopmentDepartment('R & D')).toBe(true);
    expect(isResearchAndDevelopmentDepartment('r&d')).toBe(true);
    expect(isResearchAndDevelopmentDepartment('Production')).toBe(false);
  });

  it('does not require a deliverer or batch number for R&D submitters', () => {
    expect(requiresDeliveryAndBatch('R & D')).toBe(false);
    expect(requiresDeliveryAndBatch('Production')).toBe(true);
  });

  it('always routes R&D submitters through the lab request step', () => {
    expect(hasRequiredLabRequestStep('R & D', [{ batchNo: '', testItems: '' }])).toBe(true);
    expect(hasRequiredLabRequestStep('Production', [{ batchNo: 'BN240602', testItems: '' }])).toBe(false);
    expect(hasRequiredLabRequestStep('Production', [{ batchNo: 'BN240601', testItems: '' }])).toBe(true);
  });

  it('uses sendToLab override instead of only the batch suffix', () => {
    expect(hasRequiredLabRequestStep('Production', [{ batchNo: 'BN240601', sendToLab: false }])).toBe(false);
    expect(hasRequiredLabRequestStep('Production', [{ batchNo: 'BN240602', sendToLab: true }])).toBe(true);
  });

  it('always requires a lab request for PUBLIC HEALTH and LIVE STOCK products', () => {
    expect(hasRequiredLabRequestStep('Production', [
      { batchNo: 'BN240602', commonName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)', sendToLab: false },
    ])).toBe(true);
    expect(hasRequiredLabRequestStep('Production', [
      { batchNo: 'BN240602', sampleName: 'BIFENTHRIN 10% W/V EC (LIVE STOCK)', sendToLab: false },
    ])).toBe(true);
  });

  it('allows R&D submitters to type item fields without a master item match', () => {
    expect(requiresMasterItemSelection({ department: 'R & D', integrationMode: false })).toBe(false);
    expect(requiresMasterItemSelection({ department: 'Production', integrationMode: false })).toBe(true);
    expect(requiresMasterItemSelection({ department: 'Production', integrationMode: true })).toBe(false);
  });

  it('maps the integration lab parameter into testItems when R&D has no batch', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams('department=R%20%26%20D&sampleName=R%26D%20Sample&lab=Assay'),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sampleName: 'R&D Sample',
      batchNo: '',
      testItems: 'Assay',
    });
  });

  it('sets sendToLab from legacy batch suffix defaults', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams('sampleName=Foo,Bar&batchNo=BATCH001,BATCH002'),
    );

    expect(items.map((item) => item.sendToLab)).toEqual([true, false]);
  });

  it('dedupes identical repeated production integration items', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams(
        'sampleName=Foo,Foo,Foo&batchNo=BATCH001,BATCH001,BATCH001&commonName=AI&requestDate=2026-09-12&quantity=1 ขวด&mfNo=MF26090136,MF26090136,MF26090136',
      ),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      seq: 1,
      sampleName: 'Foo',
      batchNo: 'BATCH001',
      commonName: 'AI',
      note: 'MF: MF26090136',
    });
  });

  it('keeps repeated batch rows when imported item details differ', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams('sampleName=Foo,Bar&batchNo=BATCH001,BATCH001&commonName=AI'),
    );

    expect(items.map((item) => item.sampleName)).toEqual(['Foo', 'Bar']);
  });

  it('uses explicit sendToLab true or false from integration payload', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams('sampleName=Foo,Bar&batchNo=BATCH001,BATCH002&sendToLab=false,true'),
    );

    expect(items.map((item) => item.sendToLab)).toEqual([false, true]);
  });

  it('defaults PUBLIC HEALTH and LIVE STOCK query items to Lab when production sends no choice', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams(
        'sampleName=Foo,Bar&commonName=DELTAMETHRIN%201%25%20W%2FV%20EC%20(PUBLIC%20HEALTH),BIFENTHRIN%2010%25%20W%2FV%20EC%20(LIVE%20STOCK)&batchNo=BATCH002,BATCH002',
      ),
    );

    expect(items.map((item) => item.sendToLab)).toEqual([true, true]);
    expect(items.map((item) => item.sendToQc)).toEqual([true, true]);
  });

  it('respects production unticking Lab for a single PUBLIC HEALTH item', () => {
    const [item] = makeInitialItemsFromQuery(
      new URLSearchParams('sampleName=Foo&commonName=DELTAMETHRIN%201%25%20W%2FV%20EC%20(PUBLIC%20HEALTH)&batchNo=BATCH002&sendToLab=false'),
    );

    expect(item.sendToLab).toBe(false);
  });

  it('reads per-sample QC / Lab (AI) choices sent by Production System', () => {
    const items = makeInitialItemsFromQuery(objectToSearchParams({
      samplerName: 'นายอติภัทร  จารุณ',
      samples: [
        { sampleName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)', batchNo: 'B-2', sendToQc: '1', sendToLab: '0' },
        { sampleName: 'OMETHOATE', batchNo: 'B-3', sendToQc: '0', sendToLab: '1' },
      ],
    }));

    expect(items.map(({ sendToQc, sendToLab }) => ({ sendToQc, sendToLab }))).toEqual([
      { sendToQc: true, sendToLab: false },
      { sendToQc: false, sendToLab: true },
    ]);
  });

  it('keeps a QC + Lab sample as one item with two portions when Production sends labQty', () => {
    const items = makeInitialItemsFromQuery(objectToSearchParams({
      samples: [
        { sampleName: 'OMETHOATE', batchNo: 'B-1', qty: 100, unit: 'G', sendToQc: '1', sendToLab: '1', labQty: 250 },
        { sampleName: 'OMETHOATE', batchNo: 'B-2', qty: 80, unit: 'G', sendToQc: '1', sendToLab: '0', labQty: 0 },
      ],
    }));

    expect(items.map(({ batchNo, sampleQuantity, labelQuantities, sendToQc, sendToLab }) => ({ batchNo, sampleQuantity, labelQuantities, sendToQc, sendToLab }))).toEqual([
      { batchNo: 'B-1', sampleQuantity: 2, labelQuantities: ['100 G', '250 G'], sendToQc: true, sendToLab: true },
      { batchNo: 'B-2', sampleQuantity: 1, labelQuantities: ['80 G'], sendToQc: true, sendToLab: false },
    ]);
  });

  it('keeps every QC and Lab portion with its side when Production sends qcQtys / labQtys', () => {
    const items = makeInitialItemsFromQuery(objectToSearchParams({
      samples: [
        { sampleName: 'PROPANIL', batchNo: 'B-1', qty: 10, unit: 'CC', sendToQc: '1', sendToLab: '1', labQty: 50, qcQtys: '10,10', labQtys: '50,50,50' },
        { sampleName: 'PROPANIL', batchNo: 'B-2', qty: 20, unit: 'CC', sendToQc: '0', sendToLab: '1', labQty: 0, qcQtys: '', labQtys: '20,30' },
      ],
    }));

    expect(items.map(({ batchNo, sampleQuantity, labelQuantities, labelQuantitySides }) => ({ batchNo, sampleQuantity, labelQuantities, labelQuantitySides }))).toEqual([
      { batchNo: 'B-1', sampleQuantity: 5, labelQuantities: ['10 CC', '10 CC', '50 CC', '50 CC', '50 CC'], labelQuantitySides: ['qc', 'qc', 'lab', 'lab', 'lab'] },
      { batchNo: 'B-2', sampleQuantity: 2, labelQuantities: ['20 CC', '30 CC'], labelQuantitySides: ['lab', 'lab'] },
    ]);
  });

  it('maps posted integration payloads into the existing query parser', () => {
    const params = objectToSearchParams({
      requestNo: 'SA260805025408',
      requestDate: '2026-08-05',
      samples: [
        { sampleName: 'OMETHOATE', commonName: 'OMETHOATE', batchNo: '26S-OMT50', lotNo: '26S-OMT50', qty: 9478.67, unit: 'Kg/L' },
        { sampleName: 'OMETHOATE', commonName: 'OMETHOATE', batchNo: '26S-OMT51', lotNo: '26S-OMT51', qty: 9478.67, unit: 'Kg/L' },
      ],
    });

    const items = makeInitialItemsFromQuery(params);

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      batchNo: '26S-OMT51',
      labelQuantity: '9478.67 Kg/L',
      submittedQuantity: '9478.67',
      submittedUnit: 'Kg/L',
    });
  });

  it('uses the production send date for the label date and keeps the production date separate', () => {
    const items = makeInitialItemsFromQuery(objectToSearchParams({
      requestDate: '2026-11-03',
      samples: [
        { sampleName: 'A', batchNo: 'B-1', productionDate: '2026-11-01', requestDate: '2026-11-03' },
        { sampleName: 'A', batchNo: 'B-2', productionDate: '2026-11-02', requestDate: '' },
      ],
    }));

    expect(items.map(({ productionDate, labelSampledDate }) => ({ productionDate, labelSampledDate }))).toEqual([
      { productionDate: '2026-11-01', labelSampledDate: '2026-11-03' },
      { productionDate: '2026-11-02', labelSampledDate: '2026-11-03' },
    ]);
  });
});

describe('makeInitialItemsFromQuery — QC+LAB same batch', () => {
  it('merges a QC-only row and a Lab-only row of the same batch even without routeTargets', () => {
    const sample = { sampleName: 'BROMADIOLONE 0.005% W/W (PUBLIC HEALTH)', unit: 'G', mfNo: 'MF1' };
    const items = makeInitialItemsFromQuery(objectToSearchParams({
      samples: [
        { ...sample, batchNo: 'B-240', qty: 300, sendToQc: '1', sendToLab: '0' },
        { ...sample, batchNo: 'B-240', qty: 500, sendToQc: '0', sendToLab: '1' },
        { ...sample, batchNo: 'B-241', qty: 300, sendToQc: '1', sendToLab: '0' },
        { ...sample, batchNo: 'B-241', qty: 500, sendToQc: '0', sendToLab: '1' },
      ],
    }));

    expect(items.map(({ seq, batchNo, sendToQc, sendToLab, labelQuantities, labelQuantitySides }) => ({ seq, batchNo, sendToQc, sendToLab, labelQuantities, labelQuantitySides }))).toEqual([
      { seq: 1, batchNo: 'B-240', sendToQc: true, sendToLab: true, labelQuantities: ['300 G', '500 G'], labelQuantitySides: ['qc', 'lab'] },
      { seq: 2, batchNo: 'B-241', sendToQc: true, sendToLab: true, labelQuantities: ['300 G', '500 G'], labelQuantitySides: ['qc', 'lab'] },
    ]);
  });

  it('merges two rows of the same batch into one item with two quantities', () => {
    const items = makeInitialItemsFromQuery(new URLSearchParams(
      'routeTargets=qc,lab&sampleName=Foo,Foo&batchNo=B1,B1&qty=50,200&unit=ml',
    ));
    expect(items).toHaveLength(1);
    expect(items[0].labelQuantities).toEqual(['50 ml', '200 ml']);
  });

  it('keeps different batches as separate items', () => {
    const items = makeInitialItemsFromQuery(new URLSearchParams(
      'routeTargets=qc,lab&sampleName=Foo,Foo&batchNo=B1,B2&qty=50,200&unit=ml',
    ));
    expect(items.map((item) => item.batchNo)).toEqual(['B1', 'B2']);
  });
});

describe('makeInitialItemsFromQuery — nested samples with commas in the name', () => {
  // ชื่อสาร "2,4-D-BUTYL" มีจุลภาคในชื่อ เคยถูกตัดเป็น 2 ตัวอย่าง ("2" กับ "4-D-BUTYL ...")
  it('keeps one sample per samples[i] entry', () => {
    const params = new URLSearchParams();
    params.set('sampleName', '2,4-D-BUTYL 3.76% + BUTACHLOR 4% GR');
    params.set('samples[0][sampleName]', '2,4-D-BUTYL 3.76% + BUTACHLOR 4% GR');
    params.set('samples[0][commonName]', '2,4-D-BUTYL 3.76% + BUTACHLOR 4% GR');
    params.set('samples[0][batchNo]', '102');
    params.set('samples[0][mfNo]', 'MF26110047');
    params.set('samples[0][qty]', '210');
    params.set('samples[0][unit]', 'G');

    const items = makeInitialItemsFromQuery(params);
    expect(items).toHaveLength(1);
    expect(items[0].sampleName).toBe('2,4-D-BUTYL 3.76% + BUTACHLOR 4% GR');
  });

  it('keeps blank fields aligned to their own sample', () => {
    const params = new URLSearchParams();
    params.set('samples[0][sampleName]', '2,4-D AMINE');
    params.set('samples[0][lotNo]', '');
    params.set('samples[1][sampleName]', 'GLYPHOSATE');
    params.set('samples[1][lotNo]', 'L2');

    const items = makeInitialItemsFromQuery(params);
    expect(items.map((item) => [item.sampleName, item.lotNo])).toEqual([
      ['2,4-D AMINE', ''],
      ['GLYPHOSATE', 'L2'],
    ]);
  });
});

