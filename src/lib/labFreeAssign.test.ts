import { describe, expect, it } from 'vitest';
import {
  formatFreeAssignUntil,
  freeAssignUntilFromDuration,
  freeAssignUntilFromPreset,
  isFreeAssignActive,
} from './labFreeAssign';

const NOW = new Date(2026, 9, 22, 10, 15, 0);

describe('labFreeAssign', () => {
  it('ปุ่มลัด "ถึงสิ้นวัน" จบที่ 23:59 ของวันนั้น', () => {
    const today = freeAssignUntilFromPreset({ kind: 'endOfDay', offsetDays: 0 }, NOW);
    expect([today.getDate(), today.getHours(), today.getMinutes()]).toEqual([22, 23, 59]);
    const tomorrow = freeAssignUntilFromPreset({ kind: 'endOfDay', offsetDays: 1 }, NOW);
    expect([tomorrow.getDate(), tomorrow.getHours()]).toEqual([23, 23]);
  });

  it('กำหนดเองเป็นชั่วโมง/วันได้ แต่ไม่เกิน 7 วันและต้องมากกว่า 0', () => {
    expect(freeAssignUntilFromDuration(3, 'hour', NOW)?.getTime()).toBe(NOW.getTime() + 3 * 3_600_000);
    expect(freeAssignUntilFromDuration(2, 'day', NOW)?.getTime()).toBe(NOW.getTime() + 2 * 86_400_000);
    expect(freeAssignUntilFromDuration(8, 'day', NOW)).toBeNull();
    expect(freeAssignUntilFromDuration(0, 'hour', NOW)).toBeNull();
  });

  it('หมดเวลาแล้วถือว่าปิด แม้ server ยังไม่ได้ poll รอบใหม่', () => {
    const state = { active: true, freeUntil: new Date(NOW.getTime() - 1000).toISOString(), setBy: 'Head' };
    expect(isFreeAssignActive(state, NOW)).toBe(false);
    expect(isFreeAssignActive({ ...state, freeUntil: new Date(NOW.getTime() + 1000).toISOString() }, NOW)).toBe(true);
  });

  it('แสดงเวลาสิ้นสุดเป็นวันนี้/พรุ่งนี้', () => {
    expect(formatFreeAssignUntil(new Date(2026, 9, 22, 17, 30).toISOString(), NOW)).toMatch(/^วันนี้ 17:30/);
    expect(formatFreeAssignUntil(new Date(2026, 9, 23, 23, 59).toISOString(), NOW)).toMatch(/^พรุ่งนี้ 23:59/);
  });
});
