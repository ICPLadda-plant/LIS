import { hasLabTrack } from "@/lib/statusBadge";
import type { Petition } from "@/types/petition.types";

export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 17;

// วันอาทิตย์ (getDay() === 0) เป็นวันหยุดวันเดียว — เสาร์ทำงานปกติ
function isWorkingDay(value: Date): boolean {
  return value.getDay() !== 0;
}

function atHour(value: Date, hour: number): Date {
  const result = new Date(value);
  result.setHours(hour, 0, 0, 0);
  return result;
}

function startOfNextWorkingDay(value: Date): Date {
  const result = atHour(value, WORK_START_HOUR);
  do {
    result.setDate(result.getDate() + 1);
  } while (!isWorkingDay(result));
  return result;
}

// ดันเวลาเข้าหน้าต่างทำงาน 08:00-17:00 ของวันทำการ (ไม่ขยับถ้าอยู่ในช่วงอยู่แล้ว)
function clampToWorkingWindow(value: Date): Date {
  if (!isWorkingDay(value)) return startOfNextWorkingDay(value);
  const dayStart = atHour(value, WORK_START_HOUR);
  const dayEnd = atHour(value, WORK_END_HOUR);
  if (value.getTime() < dayStart.getTime()) return dayStart;
  if (value.getTime() >= dayEnd.getTime()) return startOfNextWorkingDay(value);
  return new Date(value);
}

export function addWorkingMinutes(from: Date, minutes: number): Date {
  let cursor = clampToWorkingWindow(from);
  let remaining = Math.max(0, Math.round(minutes));
  while (remaining > 0) {
    const dayEnd = atHour(cursor, WORK_END_HOUR);
    const availableMinutes = Math.round((dayEnd.getTime() - cursor.getTime()) / 60000);
    if (remaining <= availableMinutes) {
      cursor = new Date(cursor.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= availableMinutes;
      cursor = startOfNextWorkingDay(cursor);
    }
  }
  return cursor;
}

export function endOfNextWorkingDay(from: Date): Date {
  return atHour(startOfNextWorkingDay(from), WORK_END_HOUR);
}

export const LAB_DEFAULT_MINUTES = 240;
export const QC_MINUTES_PER_TASK = 60;

export type PetitionEstimate = { at: string; kind: "unreceived" | "estimated" };

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// เครื่องรันคู่ขนานกันได้ -> เอาเครื่องที่นานที่สุด ไม่ใช่ผลรวม
function labMinutes(petition: Petition): number {
  const machines = petition.assignedMachines ?? [];
  if (machines.length === 0) return LAB_DEFAULT_MINUTES;
  return Math.max(...machines.map((machine) => {
    const minutes = Number(machine.estimatedMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : LAB_DEFAULT_MINUTES;
  }));
}

export function estimatePetitionEnd(input: { petition: Petition; qcTaskCount: number; now: Date }): PetitionEstimate {
  const { petition } = input;
  // receivedAt (legacy field) is written for whichever side scans first (server/routes/petitions.js,
  // PATCH /:id/receive) — if Lab already has its own labReceivedAt, receivedAt is Lab's timestamp,
  // not QC's. Only fall back to it when neither side timestamp exists (same rule as
  // qcReceivedAtOf() in server/lib/qcParamBaseline.js).
  const qcReceivedAt = validDate(petition.qcReceivedAt)
    ?? (petition.labReceivedAt ? null : validDate(petition.receivedAt));
  const labReceivedAt = validDate(petition.labReceivedAt);

  if (!qcReceivedAt && !labReceivedAt) {
    const anchor = validDate(petition.sampleSentAt)
      ?? validDate(petition.submittedBy?.submittedAt)
      ?? validDate(petition.createdAt)
      ?? input.now;
    return { at: endOfNextWorkingDay(anchor).toISOString(), kind: "unreceived" };
  }

  // คิดเฉพาะฝั่งที่รับงานแล้วจริง — ฝั่งที่ยังไม่รับ ไม่ต้องเดา
  const candidates: Date[] = [];
  if (qcReceivedAt && input.qcTaskCount > 0) {
    candidates.push(addWorkingMinutes(qcReceivedAt, input.qcTaskCount * QC_MINUTES_PER_TASK));
  }
  if (labReceivedAt && hasLabTrack(petition)) {
    // นับจากตอนเจ้าหน้าที่รับงาน (mirror server/lib/petitionEstimate.js)
    const acceptedAt = validDate(petition.assignedTo?.acceptedAt);
    candidates.push(addWorkingMinutes(acceptedAt ?? labReceivedAt, labMinutes(petition)));
  }

  if (candidates.length === 0) {
    const receivedAt = [qcReceivedAt, labReceivedAt].filter((date): date is Date => !!date)
      .reduce((earliest, date) => (date.getTime() < earliest.getTime() ? date : earliest));
    return { at: endOfNextWorkingDay(receivedAt).toISOString(), kind: "estimated" };
  }

  const latest = new Date(Math.max(...candidates.map((date) => date.getTime())));
  return { at: latest.toISOString(), kind: "estimated" };
}
