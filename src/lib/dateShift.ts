import { formatDate } from "@/lib/dateTime";

export const SHIFT_SWITCH_HOUR = 12;

export function greetForHour(h: number): string {
  if (h < 12) return "อรุณสวัสดิ์";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

export function currentShift(d: Date): "กะเช้า" | "กะบ่าย" {
  return d.getHours() < SHIFT_SWITCH_HOUR ? "กะเช้า" : "กะบ่าย";
}

export function formatThaiDate(d: Date): string {
  return formatDate(d);
}
