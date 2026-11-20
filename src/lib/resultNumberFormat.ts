/**
 * ปัดผลแล็บสำหรับแสดงผล: ค่า >= 0.1 แสดงทศนิยม 2 ตำแหน่ง, ค่า < 0.1 แสดงเลขนัยสำคัญ 2 ตัว
 * เช่น 12.554 → 12.55, 0.4484 → 0.45, 0.02549 → 0.025, 0.005897 → 0.0059
 * ข้อความที่ไม่ใช่ตัวเลขล้วน (เช่น "<0.01", "ผ่าน") คืนค่าเดิม
 */
const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function formatLabResultNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 0.1) return value.toFixed(2);
  const digits = Math.min(20, 1 - Math.floor(Math.log10(abs)));
  const rounded = Number(value.toFixed(digits));
  // ปัดแล้วขึ้นไปถึง 0.1 (เช่น 0.0996) ให้ใช้กฎ 2 ตำแหน่ง
  if (Math.abs(rounded) >= 0.1) return rounded.toFixed(2);
  return rounded.toFixed(digits);
}

export function formatLabResultText(value: string): string {
  const text = value.trim();
  if (!NUMERIC_TEXT.test(text)) return value;
  return formatLabResultNumber(Number(text));
}

export function formatLabResultValue(value: unknown): unknown {
  if (typeof value === "number") return formatLabResultNumber(value);
  if (typeof value === "string") return formatLabResultText(value);
  return value;
}
