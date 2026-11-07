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
