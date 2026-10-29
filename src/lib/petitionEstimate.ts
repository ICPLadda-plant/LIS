import { hasLabTrack } from "@/lib/statusBadge";
import type { Petition } from "@/types/petition.types";

export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 17;
// Lab นับ standard time ต่อได้ถึง 21:00 แล้วยกส่วนที่เหลือไป 08:00 วันทำการถัดไป
export const LAB_WORK_END_HOUR = 21;

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

// ดันเวลาเข้าหน้าต่างทำงาน 08:00-endHour ของวันทำการ (ไม่ขยับถ้าอยู่ในช่วงอยู่แล้ว)
function clampToWorkingWindow(value: Date, endHour: number): Date {
  if (!isWorkingDay(value)) return startOfNextWorkingDay(value);
  const dayStart = atHour(value, WORK_START_HOUR);
  const dayEnd = atHour(value, endHour);
  if (value.getTime() < dayStart.getTime()) return dayStart;
  if (value.getTime() >= dayEnd.getTime()) return startOfNextWorkingDay(value);
  return new Date(value);
}

export function addWorkingMinutes(from: Date, minutes: number, endHour: number = WORK_END_HOUR): Date {
  let cursor = clampToWorkingWindow(from, endHour);
  let remaining = Math.max(0, Math.round(minutes));
  while (remaining > 0) {
    const dayEnd = atHour(cursor, endHour);
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

export type PetitionEstimate = {
  at: string;
  kind: "unreceived" | "estimated" | "waiting";
  /** เวลาที่ได้มาจากเครื่องที่ไม่มี Standard Time (ใช้ค่าเดา 240 นาที) */
  approximate?: boolean;
};

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLabRecheckPending(petition: Petition): boolean {
  const requestedAt = validDate(petition.labRecheckRequestedAt);
  if (!requestedAt) return false;
  if (petition.status === "approved" || petition.status === "rejected") return false;
  const approvedAt = validDate(petition.labApprovedAt);
  return !approvedAt || approvedAt.getTime() < requestedAt.getTime();
}

// จุดเริ่มนับเวลา Lab: Re-check ที่ยังไม่ออกผล -> เวลาที่สั่ง Re-check; ปกติ -> เวลากด "เริ่มงาน"
function labStartAnchor(petition: Petition): Date | null {
  if (isLabRecheckPending(petition)) return validDate(petition.labRecheckRequestedAt);
  return validDate(petition.assignedTo?.acceptedAt);
}

function labBasis(petition: Petition): Array<{ minutes: number; source: "standard" | "default" }> {
  const machines = petition.assignedMachines ?? [];
  if (machines.length > 0) {
    return machines.map((machine) => {
      const minutes = Number(machine.estimatedMinutes);
      return Number.isFinite(minutes) && minutes > 0
        ? { minutes, source: "standard" as const }
        : { minutes: LAB_DEFAULT_MINUTES, source: "default" as const };
    });
  }
  const previous = petition.labExpected?.basis;
  if (previous?.length) return previous.map((item) => ({ minutes: item.minutes, source: item.source }));
  return [{ minutes: LAB_DEFAULT_MINUTES, source: "default" }];
}

export type LabExpected = { at: Date; approximate: boolean };

// mirror ของ resolveLabExpected ใน server/lib/petitionEstimate.js · null = ยังไม่กดเริ่มงาน
export function resolveLabExpected(petition: Petition): LabExpected | null {
  const anchor = labStartAnchor(petition);
  if (!anchor) return null;
  const stored = petition.labExpected;
  const storedStart = validDate(stored?.startedAt);
  const storedAt = validDate(stored?.at);
  if (stored && storedStart && storedAt && storedStart.getTime() === anchor.getTime()) {
    return { at: storedAt, approximate: !!stored.estimated };
  }
  // เครื่องรันคู่ขนานกันได้ -> เอาเครื่องที่นานที่สุด ไม่ใช่ผลรวม
  const basis = labBasis(petition);
  const governing = basis.reduce((max, item) => (item.minutes > max.minutes ? item : max), basis[0]);
  return {
    at: addWorkingMinutes(anchor, governing.minutes, LAB_WORK_END_HOUR),
    approximate: governing.source === "default",
  };
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
  let approximate = false;
  let labWaiting = false;
  if (qcReceivedAt && input.qcTaskCount > 0) {
    candidates.push(addWorkingMinutes(qcReceivedAt, input.qcTaskCount * QC_MINUTES_PER_TASK));
  }
  if (labReceivedAt && hasLabTrack(petition)) {
    // Lab เริ่มนับเมื่อกด "เริ่มงาน" ตาม Standard Time (mirror server/lib/petitionEstimate.js)
    const lab = resolveLabExpected(petition);
    if (lab) {
      candidates.push(lab.at);
      approximate = lab.approximate;
    } else {
      labWaiting = true;
    }
  }

  // Lab ยังไม่เริ่มงาน -> ยังบอกเวลาผลออกไม่ได้ เพราะเวลาผลออกต้องรอ Lab
  if (labWaiting) return { at: (candidates[0] ?? labReceivedAt ?? input.now).toISOString(), kind: "waiting" };

  if (candidates.length === 0) {
    const receivedAt = [qcReceivedAt, labReceivedAt].filter((date): date is Date => !!date)
      .reduce((earliest, date) => (date.getTime() < earliest.getTime() ? date : earliest));
    return { at: endOfNextWorkingDay(receivedAt).toISOString(), kind: "estimated" };
  }

  const latest = new Date(Math.max(...candidates.map((date) => date.getTime())));
  const labIsLatest = approximate && labReceivedAt && resolveLabExpected(petition)?.at.getTime() === latest.getTime();
  return { at: latest.toISOString(), kind: "estimated", approximate: !!labIsLatest };
}
