// โหมด "มอบหมายอิสระ" ของบอร์ด Assign Lab — หัวหน้า Lab เลือกว่าเปิดถึงเมื่อไร
// ระหว่างนั้นเจ้าหน้าที่ Lab กดรับงานที่ยังไม่มีผู้รับเองได้ (server จำกัดไม่เกิน 7 วัน)

export const FREE_ASSIGN_MAX_DAYS = 7;

export type FreeAssignUnit = 'hour' | 'day';

export type FreeAssignPreset =
  | { kind: 'hours'; hours: number }
  | { kind: 'endOfDay'; offsetDays: number };

export interface LabFreeAssignState {
  active: boolean;
  freeUntil: string | null;
  setBy: string;
}

export const FREE_ASSIGN_PRESETS: { label: string; preset: FreeAssignPreset }[] = [
  { label: '1 ชั่วโมง', preset: { kind: 'hours', hours: 1 } },
  { label: '4 ชั่วโมง', preset: { kind: 'hours', hours: 4 } },
  { label: 'ถึงสิ้นวันนี้', preset: { kind: 'endOfDay', offsetDays: 0 } },
  { label: 'ถึงสิ้นวันพรุ่งนี้', preset: { kind: 'endOfDay', offsetDays: 1 } },
];

/** "สิ้นวัน" = 23:59 ตามเวลาเครื่องผู้ใช้ (ผู้ใช้อยู่เวลาไทย) */
export function freeAssignUntilFromPreset(preset: FreeAssignPreset, now: Date = new Date()): Date {
  if (preset.kind === 'hours') return new Date(now.getTime() + preset.hours * 3_600_000);
  const end = new Date(now);
  end.setDate(end.getDate() + preset.offsetDays);
  end.setHours(23, 59, 0, 0);
  return end;
}

/** ช่องกำหนดเอง: เปิดอีก N ชั่วโมง / N วัน — คืน null ถ้าค่าไม่ถูกต้องหรือเกินลิมิต */
export function freeAssignUntilFromDuration(amount: number, unit: FreeAssignUnit, now: Date = new Date()): Date | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const ms = amount * (unit === 'hour' ? 3_600_000 : 86_400_000);
  if (ms > FREE_ASSIGN_MAX_DAYS * 86_400_000) return null;
  return new Date(now.getTime() + ms);
}

export function isFreeAssignActive(state: LabFreeAssignState | null | undefined, now: Date = new Date()): boolean {
  if (!state?.freeUntil) return false;
  return new Date(state.freeUntil).getTime() > now.getTime();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "วันนี้ 17:30", "พรุ่งนี้ 23:59" หรือ "24 ต.ค. 14:00" */
export function formatFreeAssignUntil(iso: string, now: Date = new Date()): string {
  const until = new Date(iso);
  const time = until.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay(until, now)) return `วันนี้ ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(until, tomorrow)) return `พรุ่งนี้ ${time}`;
  const date = until.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  return `${date} ${time}`;
}
