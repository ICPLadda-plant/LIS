import { describe, it, expect } from 'vitest';
import {
  SG_FIELD_LABEL,
  FORM_ENTRY_INDEX_KEY,
  findSgParameter,
  resolveSpecificGravity,
} from './formSpecificGravity';

const sgParam = {
  _id: 'sg1',
  name: 'ค่า ถพ.',
  scope: 'qc' as const,
  shareWithLab: true,
  valueFields: [
    { label: SG_FIELD_LABEL, type: 'float' as const },
    { label: 'อุณหภูมิ', type: 'float' as const },
  ],
};

describe('findSgParameter', () => {
  it('finds qc + shareWithLab parameter that has the ค่าถพ. field', () => {
    expect(findSgParameter([sgParam] as any)).toEqual({
      parameterId: 'sg1',
      fieldLabel: SG_FIELD_LABEL,
    });
  });

  it('returns null when no parameter has the ค่าถพ. field', () => {
    const other = { _id: 'p2', name: 'กายภาพ', scope: 'qc', shareWithLab: true, valueFields: [{ label: 'สี', type: 'text' }] };
    expect(findSgParameter([other] as any)).toBeNull();
  });

  it('ignores a matching field on a parameter not shared with lab', () => {
    const notShared = { ...sgParam, shareWithLab: false };
    expect(findSgParameter([notShared] as any)).toBeNull();
  });
});

describe('resolveSpecificGravity', () => {
  const matched = { parameterId: 'sg1', fieldLabel: SG_FIELD_LABEL };

  it('returns the scalar value for a non-multiEntry result', () => {
    const results = [{ itemSeq: 1, parameterId: 'sg1', values: { [SG_FIELD_LABEL]: 1.005 } }];
    expect(resolveSpecificGravity(results as any, 1, matched)).toBe('1.005');
  });

  it('uses the lab-chosen entry index for a multiEntry result', () => {
    const results = [{
      itemSeq: 1,
      parameterId: 'sg1',
      values: { [FORM_ENTRY_INDEX_KEY]: 1 },
      entries: [{ [SG_FIELD_LABEL]: 1.001 }, { [SG_FIELD_LABEL]: 1.222 }],
    }];
    expect(resolveSpecificGravity(results as any, 1, matched)).toBe('1.222');
  });

  it('falls back to a substance-scoped SG entry value', () => {
    const results = [{
      itemSeq: 1,
      parameterId: 'sg1',
      values: {},
      entries: [{ [`${SG_FIELD_LABEL}::glyphosate`]: 1.157 }],
    }];
    expect(resolveSpecificGravity(results as any, 1, matched)).toBe('1.157');
  });

  it('defaults to the first entry when no index is chosen', () => {
    const results = [{
      itemSeq: 1,
      parameterId: 'sg1',
      values: {},
      entries: [{ [SG_FIELD_LABEL]: 1.001 }, { [SG_FIELD_LABEL]: 1.222 }],
    }];
    expect(resolveSpecificGravity(results as any, 1, matched)).toBe('1.001');
  });

  it('clamps an out-of-range index to the first entry', () => {
    const results = [{
      itemSeq: 1,
      parameterId: 'sg1',
      values: { [FORM_ENTRY_INDEX_KEY]: 9 },
      entries: [{ [SG_FIELD_LABEL]: 1.001 }],
    }];
    expect(resolveSpecificGravity(results as any, 1, matched)).toBe('1.001');
  });

  it('matches by itemSeq', () => {
    const results = [
      { itemSeq: 1, parameterId: 'sg1', values: { [SG_FIELD_LABEL]: 1.1 } },
      { itemSeq: 2, parameterId: 'sg1', values: { [SG_FIELD_LABEL]: 2.2 } },
    ];
    expect(resolveSpecificGravity(results as any, 2, matched)).toBe('2.200');
  });

  it('returns empty string when no result for the seq', () => {
    expect(resolveSpecificGravity([] as any, 1, matched)).toBe('');
  });

  it('returns empty string when sgParam is null', () => {
    const results = [{ itemSeq: 1, parameterId: 'sg1', values: { [SG_FIELD_LABEL]: 1.005 } }];
    expect(resolveSpecificGravity(results as any, 1, null)).toBe('');
  });

  it('returns empty string when the chosen value is blank', () => {
    const results = [{ itemSeq: 1, parameterId: 'sg1', values: { [SG_FIELD_LABEL]: '' } }];
    expect(resolveSpecificGravity(results as any, 1, matched)).toBe('');
  });
});
