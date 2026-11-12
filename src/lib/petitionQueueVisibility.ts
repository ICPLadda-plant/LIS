import type { Petition } from '@/types/petition.types';
import { isLabRecheckPending, labReceivedAt, qcReceivedAt } from './receiveStatus';
import { hasLabTrack, requiresQcTrack } from './petitionRouting';
import { isLabAwaitingSgConfirmation } from './sgConfirmation';

const OPEN_TESTING_STATUSES: readonly Petition['status'][] = ['sampleSent', 'pendingReview', 'inProgress'];

export function isReceivedBeforeStatusAdvance(petition: Petition): boolean {
  return petition.status === 'deliveringQC' && Boolean(qcReceivedAt(petition) || labReceivedAt(petition));
}

export function isVisibleInQcTestingQueue(petition: Petition): boolean {
  if (!requiresQcTrack(petition)) return false;
  // QC can revise submitted results until final approval.
  if (petition.status === 'success') return Boolean(petition.qcCompletedAt && !petition.approvedAt);
  if (petition.status === 'deliveringQC') return Boolean(qcReceivedAt(petition));
  return OPEN_TESTING_STATUSES.includes(petition.status);
}

export function isVisibleInAssignQueue(petition: Petition): boolean {
  if (!hasLabTrack(petition)) return false;
  // ตัวอย่างกลุ่มน้ำ: Lab ยังไม่เห็นงานจนกว่า QC ยืนยันค่า ถพ.
  if (isLabAwaitingSgConfirmation(petition)) return false;
  // Re-check may be redone by someone else on another day — show it again
  // (even after success) so it can be reassigned.
  if (isLabRecheckPending(petition)) return true;
  // Lab assign ได้ตั้งแต่ยังไม่ส่งตัวอย่าง (กำลังส่งตัวอย่าง) จนถึงระหว่างทดสอบ
  return petition.status === 'deliveringQC' || OPEN_TESTING_STATUSES.includes(petition.status);
}

export function isWaitingForAssignment(petition: Petition): boolean {
  return !!labReceivedAt(petition) && !petition.assignedTo && isVisibleInAssignQueue(petition);
}

const BANGKOK_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** วันที่ตามเวลาไทยในรูป YYYY-MM-DD (เทียบเป็น string ได้) */
export function bangkokDayKey(date: Date): string {
  return BANGKOK_DAY.format(date);
}

function toDayKey(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (dmy) {
    const year = Number(dmy[3]) > 2400 ? Number(dmy[3]) - 543 : Number(dmy[3]);
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : bangkokDayKey(new Date(time));
}

/**
 * วันที่ส่งของคำร้อง: วันที่ส่งรายตัวอย่างที่เร็วที่สุด (Production ตั้งล่วงหน้าได้)
 * ถ้าไม่มี ใช้วันที่ส่งคำร้อง
 */
export function petitionSendDayKey(petition: Petition): string | null {
  const itemDays = (petition.items ?? [])
    .map((item) => toDayKey(item.labelSampledDate))
    .filter((day): day is string => Boolean(day))
    .sort();
  return itemDays[0] ?? toDayKey(petition.submittedBy?.submittedAt) ?? toDayKey(petition.createdAt);
}

/** งานรอมอบหมายแสดงเมื่อวันที่ส่งเลยมาแล้วหรือเป็นวันนี้ — ส่ง/รับตัวอย่างจริงแล้วแสดงเสมอ */
export function isSendDateReached(petition: Petition, now: Date = new Date()): boolean {
  if (petition.sampleSentAt || labReceivedAt(petition) || qcReceivedAt(petition)) return true;
  const day = petitionSendDayKey(petition);
  return !day || day <= bangkokDayKey(now);
}
