import { describe, expect, it } from 'vitest';
import { calculateAi, calculatedAiFieldKind, findAiDensity, formatCalculatedAi } from './aiCalculation';

describe('calculateAi', () => {
  it('calculates separate averages, sample RSD and AI using density', () => {
    const result = calculateAi({ 'Area Inj.1': '10', 'Area Inj.2': '20', 'Area Inj.3': '30', '% Sample 1': '0.00145', '% Sample 2': '0.00155', '% Sample 3': '0.00150' }, 1.2);
    expect(result.areaAverage).toBe(20);
    expect(result.sampleAverage).toBeCloseTo(0.0015);
    expect(result.sampleRsd).toBeCloseTo(3.333333);
    expect(result.ai).toBeCloseTo(0.0018);
  });

  it('leaves %AI empty until a specific gravity is available', () => {
    expect(calculateAi({ '% Sample 1': '2' }).ai).toBeNull();
    expect(calculateAi({ '% Sample 1': '2' }, 0).ai).toBeNull();
    expect(calculateAi({ '% Sample 1': '2' }).sampleAverage).toBe(2);
    expect(findAiDensity([{ 'ค่าถพ.': '' }])).toBeNull();
  });

  it('reads density scoped to an active ingredient', () => {
    const density = findAiDensity([{ 'ค่าถพ.::OMETHOATE': '1.075' }]);
    expect(calculateAi({ '% Sample 1': '50' }, density).ai).toBe(53.75);
  });

  it('calculates OMETHOATE %AI as Sample Average × specific gravity', () => {
    const values = { '% Sample 1': '70.4', '% Sample 2': '70.5', '% Sample 3': '70.6' };
    const density = findAiDensity([{ 'ค่า ถพ.': '1.135' }], 'omethoate');
    expect(formatCalculatedAi(calculateAi(values, density, 'omethoate').ai)).toBe('80.02');
  });

  it('prefers the specific gravity of the same substance and accepts spelling variants', () => {
    const instrumentEntry = { 'ค่าถพ.::omethoate': 1.041, 'ค่าถพ.::omethoate__source': { source: 'instrument' } };
    expect(findAiDensity([instrumentEntry], 'omethoate')).toBe(1.041);
    const records = [{ 'ค่า ถ.พ.::ABAMECTIN': '0.950', 'ค่าถพ.::OMETHOATE': '1.135', 'Density': '1.000' }];
    expect(findAiDensity(records, 'omethoate')).toBe(1.135);
    expect(findAiDensity(records, 'abamectin')).toBe(0.95);
    expect(findAiDensity(records, 'imidacloprid')).toBe(1);
    expect(findAiDensity([{ 'ค่าถพ.::ABAMECTIN': '0.950' }], 'omethoate')).toBeNull();
  });

  it('uses each substance own sample values in multi-ingredient products', () => {
    const values = { '% Sample 1::omethoate': '70', '% Sample 1::abamectin': '2', '%AI::omethoate': '' };
    expect(calculateAi(values, 1.1, 'omethoate').sampleAverage).toBe(70);
    expect(calculateAi({ '% Sample 1': '70', '%AI::omethoate': '' }, 1, 'omethoate').sampleAverage).toBe(70);
  });

  it('shows two decimals normally and three significant decimal digits below one', () => {
    expect(formatCalculatedAi(12.3456)).toBe('12.35');
    expect(formatCalculatedAi(0.00145)).toBe('0.00145');
  });

  it('recognizes common result label word orders', () => {
    expect(calculatedAiFieldKind('Average Area')).toBe('areaAverage');
    expect(calculatedAiFieldKind('Sample Average')).toBe('sampleAverage');
    expect(calculatedAiFieldKind('% RSD Sample')).toBe('sampleRsd');
    expect(calculatedAiFieldKind('%AI — IMIDACLOPRID')).toBe('ai');
  });
});
