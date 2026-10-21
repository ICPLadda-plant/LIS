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

  it('defaults missing or invalid density to one', () => {
    expect(calculateAi({ '% Sample 1': '2' }).ai).toBe(2);
    expect(calculateAi({ '% Sample 1': '2' }, 0).ai).toBe(2);
  });

  it('reads density scoped to an active ingredient', () => {
    const density = findAiDensity([{ 'ค่าถพ.::OMETHOATE': '1.075' }]);
    expect(calculateAi({ '% Sample 1': '50' }, density).ai).toBe(53.75);
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
