import { describe, expect, it } from 'vitest';
import { isProductionDepartment, productionLineLabel } from './productionDepartment';

describe('productionLineLabel', () => {
  it('treats zero-padded and plain line numbers as the same line', () => {
    expect(productionLineLabel('ผลิต 01')).toBe('ผลิต 1');
    expect(productionLineLabel('ผลิต 1')).toBe('ผลิต 1');
    expect(productionLineLabel(' ผลิต 12 ')).toBe('ผลิต 12');
  });

  it('ignores departments outside production', () => {
    expect(productionLineLabel('ควบคุมคุณภาพ')).toBeNull();
    expect(isProductionDepartment('IT')).toBe(false);
    expect(isProductionDepartment('product team')).toBe(false);
  });
});
