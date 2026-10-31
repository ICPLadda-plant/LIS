import { describe, it, expect } from 'vitest';
import {
  SG_VALUE_LABEL,
  SG_TEMP_LABEL,
  sourceSiblingKey,
  densityRowToEntry,
  selectDensitySyncRow,
  hasHandTypedEntries,
  formatTSetComparison,
  formatDensity3,
  isSgMachineUnitKey,
  isSgValueKey,
  isSgTemperatureEditable,
} from './densitySync';

const ROW = {
  'Sample name': '26S-ACT50-095 bottom',
  'Density [g/cm³]': '0.9919',
  'T (block) [°C]': '30.00',
  'T (set) [°C]': '30.00',
  'Instrument name': 'DMA 501',
};

describe('labels', () => {
  it('SG value/temp labels', () => {
    expect(SG_VALUE_LABEL).toBe('ค่าถพ.');
    expect(SG_TEMP_LABEL).toBe('อุณหภูมิ');
    expect(sourceSiblingKey('อุณหภูมิ')).toBe('อุณหภูมิ__source');
  });

  it('matches base and substance SG value keys, but not provenance keys', () => {
    expect(isSgValueKey('ค่าถพ.')).toBe(true);
    expect(isSgValueKey('ค่าถพ.::glyphosate')).toBe(true);
    expect(isSgValueKey('ค่าถพ.::glyphosate__source')).toBe(false);
  });

  it('marks SG value and temp render units as machine-only', () => {
    expect(isSgMachineUnitKey('ค่าถพ.::glyphosate', 'ค่าถพ. — GLYPHOSATE')).toBe(true);
    expect(isSgMachineUnitKey('อุณหภูมิ', 'อุณหภูมิ')).toBe(true);
    expect(isSgMachineUnitKey('สี', 'สี')).toBe(false);
  });
});

describe('densityRowToEntry', () => {
  it('maps density + T(block) and stores T(set) in provenance', () => {
    const e = densityRowToEntry(ROW, '2026-06-13T03:00:00.000Z');
    expect(e['ค่าถพ.']).toBe(0.992);
    expect(e['อุณหภูมิ']).toBe(30);
    const tempSrc = e['อุณหภูมิ__source'] as Record<string, unknown>;
    expect(tempSrc.source).toBe('instrument');
    expect(tempSrc.instrument).toBe('DMA 501');
    expect(tempSrc.sampleName).toBe('26S-ACT50-095 bottom');
    expect(tempSrc.tSet).toBe(30);
    expect(tempSrc.fetchedAt).toBe('2026-06-13T03:00:00.000Z');
    const valSrc = e['ค่าถพ.__source'] as Record<string, unknown>;
    expect(valSrc.source).toBe('instrument');
  });
  it('reads temperature from the compact T(block) column name', () => {
    const { 'T (block) [°C]': _oldTemp, ...row } = ROW;
    const e = densityRowToEntry({ ...row, 'T(block) [°C]': '31.50' }, '2026-06-13T03:00:00.000Z');
    expect(e['อุณหภูมิ']).toBe(31.5);
    expect((e['อุณหภูมิ__source'] as Record<string, unknown>).tBlock).toBe(31.5);
  });
  it('prefers the 3-decimal density column when present', () => {
    const e = densityRowToEntry(
      { ...ROW, 'Density [g/cm³]': '1.1574', 'Density (3 ตำแหน่ง)': '1.157' },
      '2026-06-13T03:00:00.000Z',
    );
    expect(e['ค่าถพ.']).toBe(1.157);
  });
  it('stores density under substance value keys when provided', () => {
    const e = densityRowToEntry(ROW, '2026-06-13T03:00:00.000Z', ['ค่าถพ.::glyphosate']);
    expect(e['ค่าถพ.']).toBeUndefined();
    expect(e['ค่าถพ.::glyphosate']).toBe(0.992);
    expect(e['อุณหภูมิ']).toBe(30);
    const valSrc = e['ค่าถพ.::glyphosate__source'] as Record<string, unknown>;
    expect(valSrc.source).toBe('instrument');
  });
  it('leaves value empty when unparseable', () => {
    const e = densityRowToEntry({ ...ROW, 'Density [g/cm³]': 'n/a' }, '2026-06-13T03:00:00.000Z');
    expect(e['ค่าถพ.']).toBe('');
  });
  it('falls back to DMA 501 when instrument name missing', () => {
    const e = densityRowToEntry({ ...ROW, 'Instrument name': '' }, 'x');
    expect((e['อุณหภูมิ__source'] as Record<string, unknown>).instrument).toBe('DMA 501');
  });
});

describe('selectDensitySyncRow', () => {
  it('uses the only valid result row when the matched batch has one value', () => {
    const docs = [
      { _id: 'a', 'Measurement status': 'valid', 'Density [g/cm³]': '0.991', 'T(block) [°C]': '31.5' },
    ];

    expect(selectDensitySyncRow(docs)).toBe(docs[0]);
  });

  it('chooses the most repeated 3-decimal density, then T(block) closest to 30', () => {
    const docs = [
      { _id: 'a', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '29.80' },
      { _id: 'b', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.10' },
      { _id: 'c', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.158', 'T(block) [°C]': '30.00' },
    ];

    expect(selectDensitySyncRow(docs)).toBe(docs[1]);
  });

  it('chooses repeated 3-decimal densities only when rows are consecutive', () => {
    const docs = [
      { _id: 'a', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.00' },
      { _id: 'b', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.158', 'T(block) [°C]': '30.50' },
      { _id: 'c', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '29.90' },
      { _id: 'd', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '30.20' },
      { _id: 'e', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '30.05' },
    ];

    expect(selectDensitySyncRow(docs)).toBe(docs[4]);
  });

  it('uses the displayed 3-decimal density value for consecutive equality', () => {
    const docs = [
      { _id: 'a', 'Measurement status': 'valid', 'Density [g/cm³]': '1.1568', 'T(block) [°C]': '30.20' },
      { _id: 'b', 'Measurement status': 'valid', 'Density [g/cm³]': '1.1567', 'T(block) [°C]': '29.95' },
      { _id: 'c', 'Measurement status': 'valid', 'Density [g/cm³]': '1.1582', 'T(block) [°C]': '30.00' },
    ];

    expect(selectDensitySyncRow(docs)).toBe(docs[1]);
  });

  it('returns nothing until at least two valid rows repeat consecutively', () => {
    const docs = [
      { _id: 'a', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.00' },
      { _id: 'b', 'Measurement status': 'invalid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.00' },
      { _id: 'c', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.158', 'T(block) [°C]': '29.95' },
    ];

    expect(selectDensitySyncRow(docs)).toBeUndefined();
  });
});

describe('formatDensity3', () => {
  it('uses the reported 3-decimal value when present', () => {
    expect(formatDensity3({ ...ROW, 'Density (3 ตำแหน่ง)': '1.028' })).toBe('1.028');
  });

  it('rounds raw density to 3 decimals when the reported value is missing', () => {
    expect(formatDensity3({ ...ROW, 'Density [g/cm³]': '1.0279' })).toBe('1.028');
  });

  it('returns empty text for an unparseable density', () => {
    expect(formatDensity3({ ...ROW, 'Density [g/cm³]': 'n/a' })).toBe('');
  });
});

describe('hasHandTypedEntries', () => {
  it('false for empty / instrument-sourced entries', () => {
    expect(hasHandTypedEntries(undefined)).toBe(false);
    expect(hasHandTypedEntries([])).toBe(false);
    expect(hasHandTypedEntries([densityRowToEntry(ROW, 'x')])).toBe(false);
  });
  it('true when a value lacks instrument provenance', () => {
    expect(hasHandTypedEntries([{ 'ค่าถพ.': 0.99 }])).toBe(true);
    expect(hasHandTypedEntries([{ 'ค่าถพ.::glyphosate': 0.99 }])).toBe(true);
    expect(hasHandTypedEntries([{ 'อุณหภูมิ': 30 }])).toBe(true);
  });
  it('false for substance values with instrument provenance', () => {
    expect(hasHandTypedEntries([
      {
        'ค่าถพ.::glyphosate': 0.99,
        'ค่าถพ.::glyphosate__source': { source: 'instrument' },
      },
    ])).toBe(false);
  });
});

describe('formatTSetComparison', () => {
  it('does not build a visible T set comparison message', () => {
    expect(formatTSetComparison(30, 30)).toBeNull();
    expect(formatTSetComparison(30, 25)).toBeNull();
    expect(formatTSetComparison(30, null)).toBeNull();
    expect(formatTSetComparison('', 30)).toBeNull();
    expect(formatTSetComparison(undefined, 30)).toBeNull();
  });
});

describe('isSgTemperatureEditable', () => {
  const fromMachine = densityRowToEntry(ROW, '2026-10-31T00:00:00.000Z');

  it('locks the temperature while the ถพ. value comes from the instrument', () => {
    expect(isSgTemperatureEditable(fromMachine, false)).toBe(false);
    expect(isSgTemperatureEditable({}, false)).toBe(false);
  });

  it('opens the temperature as soon as QC picks "กรอกค่าเอง"', () => {
    expect(isSgTemperatureEditable(fromMachine, true)).toBe(true);
    expect(isSgTemperatureEditable({}, true)).toBe(true);
  });

  it('keeps the temperature open after reload when the saved ถพ. value was typed by hand', () => {
    expect(isSgTemperatureEditable({ [SG_VALUE_LABEL]: '1.050', [SG_TEMP_LABEL]: '' }, false)).toBe(true);
    expect(isSgTemperatureEditable({ ...fromMachine, [SG_VALUE_LABEL]: '1.050', [sourceSiblingKey(SG_VALUE_LABEL)]: null }, false)).toBe(true);
  });
});

