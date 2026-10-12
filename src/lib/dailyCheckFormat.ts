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
