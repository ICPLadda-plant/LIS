import { getRoomBySlug } from "@/lib/dailyCheckRooms";
import { getRoomCatalog } from "@/lib/roomEquipment";
import { formatTime } from "@/lib/dateTime";

export type DailyCheckDisplayReading = {
  label: string;
  value: number | string;
  unit: string;
};

export const fmtTime = (iso: string) => formatTime(iso, "—");

export const fmtDate = (s: string) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

export const firstNameOnly = (name: string) =>
  name.trim().replace(/^(?:นางสาว|นาย|นาง|ดร\.?|Mr\.?|Mrs\.?|Ms\.?)\s*/i, "").split(/\s+/)[0] ?? "";

const THAI_MONTH_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "2026-11-17" → "17 พ.ย. 2569" — วันขึ้นก่อนเดือน กันสับสนกับรูปแบบ mm/dd */
export const fmtThaiDate = (s: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!match) return "—";
  const month = THAI_MONTH_ABBR[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${Number(match[1]) + 543}` : fmtDate(s);
};

/** วันอาทิตย์ไม่ได้ทำงาน — ใช้ระบายสีแถวในรายงาน */
export const isSunday = (s: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  return !!match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay() === 0;
};

export const roomLabel = (slug: string) =>
  slug === "environment" ? "อุณหภูมิ/ความชื้น" : getRoomBySlug(slug)?.label ?? slug;

export const roomFilterLabel = (room: string) =>
  room === "all" ? "ทุกห้อง" : roomLabel(room);

export const statusFilterLabel = (status: string) =>
  status === "normal" ? "ปกติ" : status === "abnormal" ? "ผิดปกติ" : "ทั้งหมด";

export const instrumentFilterLabel = (room: string, instrumentId: string) => {
  if (instrumentId === "all") return "ทั้งหมด";
  const inst = getRoomCatalog(room)?.instruments.find((i) => i.id === instrumentId);
  return inst ? `${inst.name} (${inst.id})` : instrumentId;
};

export const dateFilterLabel = (date: string) => (date ? fmtDate(date) : "ทุกวัน");

export const formatReadings = (readings: readonly DailyCheckDisplayReading[]) =>
  readings.length ? readings.map((x) => `${x.label} ${x.value} ${x.unit}`).join(", ") : "—";
