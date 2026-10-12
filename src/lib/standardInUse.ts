// สถานะของ standard ที่ "กำลังใช้งานอยู่" — ตัดสินจาก dueAt ที่ server คำนวณมาให้เท่านั้น
// ฝั่ง server ตั้งใจไม่ส่งสถานะมา เพื่อให้กติกาอยู่ที่เดียว (กันสองสำเนาที่ต้องคอย sync กัน)
import type { StandardInUseItem } from "@/types/stock";
import { formatDateTime } from "@/lib/dateTime";

export const IN_USE_SOON_MS = 24 * 60 * 60 * 1000;
export const IN_USE_NOTIFICATION_PREFIX = "std-inuse:";
export const IN_USE_NOTIFICATION_GROUP = "standard-expiry";

const DAY_MS = 24 * 60 * 60 * 1000;

export type InUseStatus = "expired" | "dueSoon" | "active" | "noFrequency";

type DueRow = Pick<StandardInUseItem, "dueAt">;

const dueMs = (dueAt: string | null | undefined): number => {
  const v = dueAt ? Date.parse(dueAt) : NaN;
  return Number.isNaN(v) ? NaN : v;
};

export function inUseStatus(row: DueRow, now: Date, soonMs: number = IN_USE_SOON_MS): InUseStatus {
  const due = dueMs(row.dueAt);
  if (Number.isNaN(due)) return "noFrequency";
  const diff = due - now.getTime();
  if (diff <= 0) return "expired";
  if (diff <= soonMs) return "dueSoon";
  return "active";
}

const RANK: Record<InUseStatus, number> = { expired: 0, dueSoon: 1, active: 2, noFrequency: 3 };

/** เรียง: หมดอายุ (เกินกำหนดนานสุดก่อน) → ใกล้ครบ → ปกติ → ไม่มีความถี่ (ท้ายสุด) */
export function sortInUse<T extends DueRow & Pick<StandardInUseItem, "withdrawnAt">>(
  rows: T[],
  now: Date,
): T[] {
  const safe = (v: number) => (Number.isNaN(v) ? 0 : v);
  return [...rows].sort((a, b) => {
    const ra = RANK[inUseStatus(a, now)];
    const rb = RANK[inUseStatus(b, now)];
    if (ra !== rb) return ra - rb;
    const da = safe(dueMs(a.dueAt));
    const db = safe(dueMs(b.dueAt));
    if (da !== db) return da - db;
    return safe(Date.parse(b.withdrawnAt || "")) - safe(Date.parse(a.withdrawnAt || ""));
  });
}

const normEmail = (v: string | null | undefined) => String(v || "").trim().toLowerCase();

/**
 * กดรับทราบได้เมื่อหมดอายุแล้ว และคนที่กดคือคนที่เบิกรายการนั้น
 * ยกเว้นแถวที่ไม่มีทั้งอีเมลและชื่อผู้เบิก — ระบุเจ้าของไม่ได้ ปล่อยให้ใครก็ปิดได้
 * (ไม่งั้นแถวค้างถาวร เพราะไม่มีใครผ่านเงื่อนไขเจ้าของเลย)
 */
export function canAcknowledge(
  row: DueRow & Pick<StandardInUseItem, "userEmail" | "userName">,
  user: { email?: string } | null | undefined,
  now: Date,
): boolean {
  if (inUseStatus(row, now) !== "expired") return false;
  const owner = normEmail(row.userEmail);
  if (!owner && !String(row.userName || "").trim()) return true;
  return Boolean(owner) && owner === normEmail(user?.email);
}

/** "อีก 2 วัน" / "ภายในวันนี้" / "เกินกำหนดวันนี้" / "เกิน 3 วัน" / "-" */
export function dueDistanceLabel(dueAt: string | null | undefined, now: Date): string {
  const due = dueMs(dueAt);
  if (Number.isNaN(due)) return "-";
  const diff = due - now.getTime();
  if (diff <= 0) {
    const days = Math.floor(-diff / DAY_MS);
    return days === 0 ? "เกินกำหนดวันนี้" : `เกิน ${days} วัน`;
  }
  const days = Math.floor(diff / DAY_MS);
  return days === 0 ? "ภายในวันนี้" : `อีก ${days} วัน`;
}

export interface InUseNotification {
  id: string;
  title: string;
  message: string;
  level: "warning" | "error";
}

export interface InUseNotificationPlan {
  push: InUseNotification[];
  dismiss: string[];
}

const thaiDateTime = (iso: string | null) => formatDateTime(iso);

/**
 * เทียบรายการที่ยังกำลังใช้งาน กับ id ที่ค้างอยู่ในกระดิ่ง แล้วบอกว่าต้อง push อะไร / ลบอะไร
 * การลบคือหัวใจของ "กดรับทราบแล้วหายทุกคน" — แถวที่ถูกปิดจะหลุดจาก items รอบถัดไปเอง
 */
export function planInUseNotifications(
  items: StandardInUseItem[],
  now: Date,
  existingIds: string[],
): InUseNotificationPlan {
  const push: InUseNotification[] = [];
  const live = new Set<string>();

  for (const item of items) {
    const status = inUseStatus(item, now);
    if (status !== "expired" && status !== "dueSoon") continue;
    const id = `${IN_USE_NOTIFICATION_PREFIX}${item._id}:${status === "expired" ? "expired" : "soon"}`;
    live.add(id);
    push.push({
      id,
      title: `${status === "expired" ? "หมดอายุแล้ว" : "ใกล้ครบกำหนด"}: ${item.itemName || item.itemCode}`,
      message: `เบิกโดย ${item.userName || item.userEmail || "-"} · ครบกำหนด ${thaiDateTime(item.dueAt)}`,
      level: status === "expired" ? "error" : "warning",
    });
  }

  const dismiss = existingIds.filter(
    (id) => id.startsWith(IN_USE_NOTIFICATION_PREFIX) && !live.has(id),
  );
  return { push, dismiss };
}
