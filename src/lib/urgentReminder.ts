import type { Petition } from "@/types/petition.types";
import { hasLabTrack, requiresQcTrack } from "@/lib/petitionRouting";
import { isUrgentPetition } from "@/lib/urgentPetition";

export type UrgentReminderSide = "qc" | "lab";

const HOUR_MS = 60 * 60 * 1000;
const QC_ROLES = ["qc-staff", "qc-head"];
const LAB_ROLES = ["lab-analyze", "lab-head"];

export interface UrgentReminderItem {
  id: string;
  petitionId: string;
  petitionNo: string;
  side: UrgentReminderSide;
  link: string;
}

/** ฝั่งที่ผู้ใช้ต้องได้รับเตือนตาม role — admin ไม่ได้รับเตือนถ้าไม่มี role QC/Lab ร่วมด้วย */
export function urgentReminderSidesForRoles(roles: string[]): UrgentReminderSide[] {
  const sides: UrgentReminderSide[] = [];
  if (roles.some((role) => QC_ROLES.includes(role))) sides.push("qc");
  if (roles.some((role) => LAB_ROLES.includes(role))) sides.push("lab");
  return sides;
}

/** งานด่วนที่ยังไม่บันทึกผลในแต่ละฝั่ง — ฝั่งไหนบันทึกผลแล้วจะหยุดเตือนเฉพาะฝั่งนั้น */
export function pendingUrgentReminders(petitions: Petition[], sides: UrgentReminderSide[]): UrgentReminderItem[] {
  const out: UrgentReminderItem[] = [];
  for (const petition of petitions) {
    if (!isUrgentPetition(petition)) continue;
    if (petition.status === "rejected" || petition.status === "approved") continue;
    if ((petition as { deletedAt?: unknown }).deletedAt) continue;
    if (sides.includes("qc") && requiresQcTrack(petition) && !petition.qcCompletedAt) {
      out.push({
        id: `urgent:${petition._id}:qc`,
        petitionId: petition._id,
        petitionNo: petition.petitionNo,
        side: "qc",
        link: `/qc-testing/${petition._id}`,
      });
    }
    if (sides.includes("lab") && hasLabTrack(petition) && !petition.labCompletedAt) {
      out.push({
        id: `urgent:${petition._id}:lab`,
        petitionId: petition._id,
        petitionNo: petition.petitionNo,
        side: "lab",
        link: `/lab-testing/${petition._id}`,
      });
    }
  }
  return out;
}

/** เลขชั่วโมงตามนาฬิกาเครื่อง ใช้เป็น key กันเสียงดังซ้ำในชั่วโมงเดียวกัน */
export function reminderHourKey(now: number): string {
  const date = new Date(now);
  date.setMinutes(0, 0, 0);
  return String(date.getTime());
}

/** เวลาต้นชั่วโมงถัดไป (ms) */
export function nextHourAt(now: number): number {
  return Number(reminderHourKey(now)) + HOUR_MS;
}

export function urgentReminderStorageKey(userKey: string | undefined): string {
  return `lis:urgent-reminder-hour:${userKey || "anon"}`;
}

/**
 * ตัดสินว่ารอบนี้ต้องเล่นเสียงไหม และอัปเดต key ชั่วโมงล่าสุดใน storage
 * - ครั้งแรกที่ยังไม่มี key: จำชั่วโมงไว้เฉย ๆ ไม่เล่นเสียง
 * - ชั่วโมงเดิม: ไม่เล่นซ้ำ (กันหลายแท็บ/รีเฟรช)
 * - ข้ามชั่วโมงแล้วและยังมีงานด่วนค้าง: เล่นเสียง
 */
export function claimUrgentReminderHour(storage: Pick<Storage, "getItem" | "setItem">, key: string, hourKey: string, hasPending: boolean): boolean {
  let stored: string | null = null;
  try {
    stored = storage.getItem(key);
    if (stored !== hourKey) storage.setItem(key, hourKey);
  } catch {
    return false;
  }
  return hasPending && stored !== null && stored !== hourKey;
}
