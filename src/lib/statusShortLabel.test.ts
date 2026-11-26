import { describe, expect, it } from 'vitest';
import { statusShortLabel, statusStep } from './statusShortLabel';

describe('statusShortLabel', () => {
  it('ย่อป้ายยาวให้สั้น', () => {
    expect(statusShortLabel('เจ้าหน้าที่กำลังดำเนินการวิเคราะห์')).toBe('วิเคราะห์');
    expect(statusShortLabel('Lab มอบหมายงานแล้ว รอเจ้าหน้าที่รับ')).toBe('รอรับงาน');
    expect(statusShortLabel('รับแล้ว 2/5 ป้าย')).toBe('รับ 2/5');
  });

  it('คืนชื่อเต็มเมื่อไม่มีใน map', () => {
    expect(statusShortLabel('รอรับ')).toBe('รอรับ');
    expect(statusShortLabel('สถานะใหม่')).toBe('สถานะใหม่');
  });
});

describe('statusStep', () => {
  it('นับขั้นตามลำดับ workflow', () => {
    expect(statusStep('deliveringQC')).toEqual({ step: 1, total: 6 });
    expect(statusStep('pendingReview')).toEqual({ step: 3, total: 6 });
    expect(statusStep('approved')).toEqual({ step: 6, total: 6 });
    expect(statusStep('rejected')).toEqual({ step: 6, total: 6 });
  });

  it('คืน null เมื่อไม่รู้จักสถานะ', () => {
    expect(statusStep('unknown')).toBeNull();
    expect(statusStep(undefined)).toBeNull();
  });
});
