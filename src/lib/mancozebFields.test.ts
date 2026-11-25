import { describe, expect, it } from 'vitest';
import { calculateMancozeb, isMancozebItem } from './mancozebFields';

describe('calculateMancozeb', () => {
  it('คำนวณตามตัวอย่างใบรายงาน', () => {
    const r = calculateMancozeb({
      'MCZ Conc 0.1 N I2': '0.1', 'MCZ mL of Blank': '0',
      'MCZ Sample 1 wt/g': '0.20350', 'MCZ Sample 1 mL 0.1 N I2': '12.2',
      'MCZ Sample 2 wt/g': '0.20310', 'MCZ Sample 2 mL 0.1 N I2': '12.2',
    }, null);
    expect(r.average?.toFixed(4)).toBe('81.3134');
    expect(r.report?.toFixed(2)).toBe('81.31');
    expect(isMancozebItem('Mancozeb 80% WP')).toBe(true);
  });
});
