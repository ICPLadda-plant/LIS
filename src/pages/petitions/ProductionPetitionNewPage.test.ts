import { describe, expect, it } from 'vitest';
import {
  buildProductionReturnUrl,
  hasRequiredLabRequestStep,
  isResearchAndDevelopmentDepartment,
  makeInitialItemsFromQuery,
  objectToSearchParams,
  requiresMasterItemSelection,
  requiresDeliveryAndBatch,
} from './ProductionPetitionNewPage';

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

  it('sets PUBLIC HEALTH and LIVE STOCK query items to Lab even when batch is non-Lab', () => {
    const items = makeInitialItemsFromQuery(
      new URLSearchParams(
        'sampleName=Foo,Bar&commonName=DELTAMETHRIN%201%25%20W%2FV%20EC%20(PUBLIC%20HEALTH),BIFENTHRIN%2010%25%20W%2FV%20EC%20(LIVE%20STOCK)&batchNo=BATCH002,BATCH002&sendToLab=false,false',
      ),
    );

    expect(items.map((item) => item.sendToLab)).toEqual([true, true]);
  });

  it('sets a single PUBLIC HEALTH query item to Lab even when sendToLab is false', () => {
    const [item] = makeInitialItemsFromQuery(
      new URLSearchParams('sampleName=Foo&commonName=DELTAMETHRIN%201%25%20W%2FV%20EC%20(PUBLIC%20HEALTH)&batchNo=BATCH002&sendToLab=false'),
    );

    expect(item.sendToLab).toBe(true);
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
});

describe('makeInitialItemsFromQuery — QC+LAB same batch', () => {
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
