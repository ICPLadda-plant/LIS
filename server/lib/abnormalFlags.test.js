const { computeAbnormalFlags, ensureRequestedIdsPresent, productTypeFromSpecJS } = require('./abnormalFlags');

const petition = { _id: 'p1', dept: 'fg', items: [{ seq: 1 }] };
const numberParam = {
  _id: 'par1',
  valueFields: [{ label: 'ค่า', type: 'number', standardOperator: 'lte', standardValue: 10 }],
};

describe('computeAbnormalFlags', () => {
  it('maps SAND GRANULE to sand through SG', () => {
    expect(productTypeFromSpecJS('BROMADIOLONE 0.005% W/W SAND GRANULE')).toBe('sand');
  });

  it('flags a petition whose numeric value breaks the standard', () => {
    const docs = [{ petitionId: 'p1', parameterId: 'par1', itemSeq: 1, values: { 'ค่า': 12 } }];
    expect(computeAbnormalFlags({ docs, params: [numberParam], petitions: [petition] }))
      .toEqual({ p1: true });
  });

  it('leaves a petition normal when every value is within the standard', () => {
    const docs = [{ petitionId: 'p1', parameterId: 'par1', itemSeq: 1, values: { 'ค่า': 5 } }];
    expect(computeAbnormalFlags({ docs, params: [numberParam], petitions: [petition] }))
      .toEqual({ p1: false });
  });

  it('flags a retest (Phase 2) value of the same parameter that breaks the standard', () => {
    const docs = [{ petitionId: 'p1', parameterId: 'par1', itemSeq: 1, values: { 'ค่า': 5 }, valuesPhase2: { 'ค่า': 12 } }];
    expect(computeAbnormalFlags({ docs, params: [numberParam], petitions: [petition] }))
      .toEqual({ p1: true });
  });

  it('checks only before/both fields in Phase 1 and after/both fields in Phase 2 for phased parameters', () => {
    const phased = {
      _id: 'par1',
      hasPhases: true,
      valueFields: [
        { label: 'ก่อน', type: 'number', phase: 'before', standardOperator: 'lte', standardValue: 10 },
        { label: 'หลัง', type: 'number', phase: 'after', standardOperator: 'lte', standardValue: 10 },
      ],
    };
    const docs = [{ petitionId: 'p1', parameterId: 'par1', itemSeq: 1, values: { 'ก่อน': 5, 'หลัง': 99 }, valuesPhase2: { 'ก่อน': 99, 'หลัง': 5 } }];
    expect(computeAbnormalFlags({ docs, params: [phased], petitions: [petition] }))
      .toEqual({ p1: false });
  });

  it('uses the exact substance standard before same-first-token standards', () => {
    const densityParam = {
      _id: 'density',
      multiEntry: true,
      valueFields: [{
        label: 'ค่าถพ.',
        type: 'float',
        substanceMode: true,
        substanceStandards: [
          { substance: 'GLYPHOSATE 48% W/V SL (AM)', operator: 'between', value: 1.186, value2: 1.191 },
          { substance: 'GLYPHOSATE 48% W/V SL (IPA)', operator: 'between', value: 1.155, value2: 1.187 },
        ],
      }],
    };
    const docs = [{
      petitionId: 'p1',
      parameterId: 'density',
      itemSeq: 1,
      commonName: 'GLYPHOSATE 48% W/V SL (IPA)',
      entries: [{ 'ค่าถพ.::glyphosate': 1.1568 }],
    }];

    expect(computeAbnormalFlags({ docs, params: [densityParam], petitions: [petition] }))
      .toEqual({ p1: false });
  });

  it('reports false for a petition that has no results yet', () => {
    expect(computeAbnormalFlags({ docs: [], params: [], petitions: [petition] }))
      .toEqual({ p1: false });
  });

  it('ignores results whose parameter has no valueFields', () => {
    const docs = [{ petitionId: 'p1', parameterId: 'ghost', itemSeq: 1, values: { 'ค่า': 999 } }];
    expect(computeAbnormalFlags({ docs, params: [], petitions: [petition] }))
      .toEqual({ p1: false });
  });
});

describe('ensureRequestedIdsPresent', () => {
  it('adds false for a requested id with no QCTestResult docs and no matching petition', () => {
    const map = computeAbnormalFlags({ docs: [], params: [], petitions: [] });
    expect(ensureRequestedIdsPresent(map, ['ghost-id'])).toEqual({ 'ghost-id': false });
  });

  it('keeps true for an id already flagged abnormal (does not clobber real results)', () => {
    const docs = [{ petitionId: 'p1', parameterId: 'par1', itemSeq: 1, values: { 'ค่า': 12 } }];
    const map = computeAbnormalFlags({ docs, params: [numberParam], petitions: [petition] });
    expect(ensureRequestedIdsPresent(map, ['p1'])).toEqual({ p1: true });
  });

  it('returns the map unchanged for an empty id list', () => {
    const map = computeAbnormalFlags({ docs: [], params: [], petitions: [petition] });
    expect(ensureRequestedIdsPresent(map, [])).toEqual(map);
  });
});
