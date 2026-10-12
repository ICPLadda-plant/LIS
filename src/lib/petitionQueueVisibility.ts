import type { Petition } from '@/types/petition.types';
import { labReceivedAt, qcReceivedAt } from './receiveStatus';
import { hasLabTrack, requiresQcTrack } from './petitionRouting';

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
  // Keep received-but-unassigned work on the board so Lab can be assigned after
  // accepting the sample, and keep assigned work visible during testing.
  if (petition.assignedTo) return OPEN_TESTING_STATUSES.includes(petition.status);
  return OPEN_TESTING_STATUSES.includes(petition.status) || isReceivedBeforeStatusAdvance(petition);
}

export function isWaitingForAssignment(petition: Petition): boolean {
  return !!labReceivedAt(petition) && !petition.assignedTo && isVisibleInAssignQueue(petition);
}
