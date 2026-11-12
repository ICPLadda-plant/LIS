import type { AppNotification } from "@/context/NotificationContext";
import { formatTime } from "@/lib/dateTime";

export interface NotificationSection {
  key: string;
  label: string;
  items: AppNotification[];
}

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const startOfDay = (ts: number) => {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const dayKey = (ts: number) => {
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

export function dayLabel(ts: number, now = Date.now()) {
  const diffDays = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (diffDays <= 0) return "วันนี้";
  if (diffDays === 1) return "เมื่อวาน";
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]}${sameYear ? "" : ` ${date.getFullYear() + 543}`}`;
}

/** เวลาสั้นแบบ Facebook: วันนี้บอกเป็นเวลาที่ผ่านมา วันอื่นบอกเวลา (วันอยู่ในหัวกลุ่มแล้ว) */
export function shortNotificationTime(ts: number, now = Date.now()) {
  if (startOfDay(ts) !== startOfDay(now)) return formatTime(ts);
  const diff = now - ts;
  if (diff < 60_000) return "เมื่อสักครู่";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาที`;
  return `${Math.floor(diff / 3_600_000)} ชั่วโมง`;
}

/** เรียงใหม่สุดก่อน โดยงานด่วนที่ปักไว้อยู่บนสุดเสมอ */
export function sortNotifications(list: AppNotification[]) {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

/** แบ่งกลุ่ม: งานด่วน แล้วตามด้วยแต่ละวัน (รายการต้องเรียงด้วย sortNotifications มาก่อน) */
export function groupNotificationsByDay(list: AppNotification[], now = Date.now()): NotificationSection[] {
  const sections: NotificationSection[] = [];
  for (const item of list) {
    const key = item.pinned ? "pinned" : dayKey(item.createdAt);
    let section = sections.find(s => s.key === key);
    if (!section) {
      section = { key, label: item.pinned ? "งานด่วน" : dayLabel(item.createdAt, now), items: [] };
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}
