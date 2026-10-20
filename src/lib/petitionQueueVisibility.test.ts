import { describe, expect, it } from 'vitest';
import type { Petition } from '@/types/petition.types';
import {
  isReceivedBeforeStatusAdvance,
  isVisibleInAssignQueue,
  isVisibleInQcTestingQueue,
  isWaitingForAssignment,
} from './petitionQueueVisibility';

const receivedStalePetition = {
  status: 'deliveringQC',
  submittedBy: { department: 'IT' },
  qcReceivedAt: '2026-09-03T06:05:34.767Z',
  items: [{ seq: 1, sampleName: 'Sample A', batchNo: 'B-6' }],
} as Petition;

describe('petitionQueueVisibility', () => {
  it('treats deliveringQC with a receive timestamp as already received', () => {
    expect(isReceivedBeforeStatusAdvance(receivedStalePetition)).toBe(true);
  });

  it('does not show untouched deliveringQC petitions in QC testing queue', () => {
    expect(isVisibleInQcTestingQueue({
      ...receivedStalePetition,
      qcReceivedAt: undefined,
    } as Petition)).toBe(false);
  });

  it('keeps stale received deliveringQC petitions visible in QC testing and Assign queues', () => {
    expect(isVisibleInQcTestingQueue(receivedStalePetition)).toBe(true);
    expect(isVisibleInAssignQueue(receivedStalePetition)).toBe(true);
    expect(isWaitingForAssignment(receivedStalePetition)).toBe(false);
  });

  it('hides QC-only sample-sent petitions from Assign queue', () => {
    expect(isVisibleInAssignQueue({
      status: 'sampleSent',
      submittedBy: { department: 'Production' },
      items: [{ seq: 1, sampleName: 'QC-only sample', batchNo: 'B-2' }],
    } as Petition)).toBe(false);
  });

  it('keeps Lab-track sample-sent petitions visible in Assign queue', () => {
    expect(isVisibleInAssignQueue({
      status: 'sampleSent',
      submittedBy: { department: 'Production' },
      items: [{ seq: 1, sampleName: 'Lab sample', batchNo: 'B-1' }],
    } as Petition)).toBe(true);
  });

  it('keeps assigned Lab work visible after Lab receives sample', () => {
    const labReceivedPetition = {
      ...receivedStalePetition,
      status: 'inProgress',
      assignedTo: { employeeId: 'E123', name: 'นายชนินัญชา ภู่สุวรรณ' },
      labReceivedAt: '2026-09-03T07:05:34.767Z',
      labReceivedBy: 'นายชนินัญชา ภู่สุวรรณ',
      qcReceivedAt: undefined,
    } as Petition;

    expect(isVisibleInAssignQueue(labReceivedPetition)).toBe(true);
  });

  it('brings re-checked Lab work back to the Assign board after success so it can be reassigned', () => {
    const recheckPetition = {
      ...receivedStalePetition,
      status: 'success',
      assignedTo: { employeeId: 'E123', name: 'คนเดิม' },
      labReceivedAt: '2026-09-03T07:05:34.767Z',
      labCompletedAt: '2026-09-03T09:00:00.000Z',
      labRecheckRequestedAt: '2026-09-04T01:00:00.000Z',
    } as Petition;

    expect(isVisibleInAssignQueue(recheckPetition)).toBe(true);
    expect(isVisibleInAssignQueue({ ...recheckPetition, labRecheckRequestedAt: undefined })).toBe(false);  });

  it('keeps Lab-received petitions waiting for assignment until an assignee is selected', () => {
    const labReceivedWithoutAssignee = {
      ...receivedStalePetition,
      status: 'pendingReview',
      assignedTo: undefined,
      labReceivedAt: '2026-09-03T07:05:34.767Z',
      labReceivedBy: 'นายชนินัญชา ภู่สุวรรณ',
      qcReceivedAt: undefined,
    } as Petition;

    expect(isVisibleInAssignQueue(labReceivedWithoutAssignee)).toBe(true);
    expect(isWaitingForAssignment(labReceivedWithoutAssignee)).toBe(true);
    expect(isWaitingForAssignment({ ...labReceivedWithoutAssignee, status: 'inProgress' })).toBe(true);
  });
});
