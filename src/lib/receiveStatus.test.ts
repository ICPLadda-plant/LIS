import { describe, it, expect } from 'vitest';
import {
  isLegacyReceived,
  labReceivedAt,
  labReceivedBy,
  qcReceivedAt,
  qcReceivedBy,
  labTrackStatusBadge,
  labAssignBoardStatusBadge,
  isLabRecheckPending,
  qcTrackStatusBadge,
  labTrackStatusSteps,
  qcTrackStatusSteps,
} from './receiveStatus';
import type { Petition } from '@/types/petition.types';
import { statusBadge } from './statusBadge';

const T1 = '2026-06-08T01:00:00.000Z';
const T2 = '2026-06-10T02:00:00.000Z';

describe('receiveStatus', () => {
  it('legacy petition (receivedBy only) counts as received on both sides', () => {
    const p = { receivedAt: T1, receivedBy: 'Dev Administrator' };
    expect(isLegacyReceived(p)).toBe(true);
    expect(qcReceivedAt(p)).toBe(T1);
    expect(qcReceivedBy(p)).toBe('Dev Administrator');
    expect(labReceivedAt(p)).toBe(T1);
    expect(labReceivedBy(p)).toBe('Dev Administrator');
  });

  it('never received → all null/undefined', () => {
    const p = {};
    expect(isLegacyReceived(p)).toBe(false);
    expect(qcReceivedAt(p)).toBeNull();
    expect(qcReceivedBy(p)).toBeUndefined();
    expect(labReceivedAt(p)).toBeNull();
    expect(labReceivedBy(p)).toBeUndefined();
  });

  it('mixed: Lab received first does NOT mark QC received (no legacy fallback)', () => {
    const p = { labReceivedAt: T1, labReceivedBy: 'Lab Tech', receivedAt: T1, receivedBy: 'Lab Tech' };
    expect(isLegacyReceived(p)).toBe(false);
    expect(labReceivedBy(p)).toBe('Lab Tech');
    expect(qcReceivedAt(p)).toBeNull();
    expect(qcReceivedBy(p)).toBeUndefined();
  });

  it('both sides received independently keep their own actor', () => {
    const p = {
      labReceivedAt: T1, labReceivedBy: 'Lab Tech',
      qcReceivedAt: T2, qcReceivedBy: 'QC Tech',
      receivedAt: T1, receivedBy: 'Lab Tech',
    };
    expect(labReceivedBy(p)).toBe('Lab Tech');
    expect(qcReceivedBy(p)).toBe('QC Tech');
    expect(qcReceivedAt(p)).toBe(T2);
  });
});

describe('labTrackStatusBadge', () => {
  it('QC received + testing but Lab not received yet → "รอรับ" (Lab track, not QC status)', () => {
    const p = { status: 'inProgress' as const, qcReceivedAt: T1, qcReceivedBy: 'QC Tech' };
    expect(labTrackStatusBadge(p).label).toBe('รอรับ');
  });

  it('sampleSent without assignee shows waiting receive on the Lab track', () => {
    const p = { status: 'sampleSent' as const };
    expect(labTrackStatusBadge(p).label).toBe('รอรับ');
  });

  it('sampleSent with assignee but not Lab-received shows waiting receive on the Lab track', () => {
    const p = { status: 'sampleSent' as const, assignedTo: { employeeId: 'u1', name: 'Analyst' } };
    expect(labTrackStatusBadge(p).label).toBe('รอรับ');
  });

  it('Lab received + global inProgress → Lab track in progress, not QC status', () => {
    const p = { status: 'inProgress' as const, labReceivedAt: T1, labReceivedBy: 'Lab Tech', assignedTo: { employeeId: 'a1', name: 'Analyst', acceptedAt: T1 } };
    expect(labTrackStatusBadge(p).label).toBe('เจ้าหน้าที่กำลังดำเนินการวิเคราะห์');
  });

  it('Lab received but not assigned shows waiting assign', () => {
    expect(labTrackStatusBadge({ status: 'pendingReview', labReceivedAt: T1 }).label).toBe('Lab รับงานแล้ว รอ assign');
  });

  it('legacy received (receivedAt only) counts as Lab received → Lab track in progress', () => {
    const p = { status: 'inProgress' as const, receivedAt: T1, receivedBy: 'Dev Administrator', assignedTo: { employeeId: 'a1', name: 'Analyst', acceptedAt: T1 } };
    expect(labTrackStatusBadge(p).label).toBe('เจ้าหน้าที่กำลังดำเนินการวิเคราะห์');
  });

  it('Lab completed shows pending result while petition waits for other gates', () => {
    const p = { status: 'inProgress' as const, labReceivedAt: T1, labCompletedAt: T2, assignedTo: { employeeId: 'a1', name: 'Analyst', acceptedAt: T1 } };
    expect(labTrackStatusBadge(p).label).toBe('เจ้าหน้าที่บันทึกผลแล้วรออนุมัติ');
  });
});

describe('labTrackStatusBadge accept step', () => {
  it('assigned but not accepted → waiting for staff to accept', () => {
    const p = { status: 'inProgress' as const, labReceivedAt: T1, assignedTo: { employeeId: 'a1', name: 'Analyst' } };
    expect(labTrackStatusBadge(p).label).toBe('Lab มอบหมายงานแล้ว รอเจ้าหน้าที่รับ');
  });
});

describe('labAssignBoardStatusBadge', () => {
  it('Lab not received yet shows sent sample even if QC already received', () => {
    const p = { status: 'pendingReview' as const, qcReceivedAt: T1 };
    expect(labAssignBoardStatusBadge(p).label).toBe('ส่งตัวอย่างแล้ว');
  });

  it('assigned card shows assigned wording on the Lab assign board', () => {
    const p = { status: 'sampleSent' as const, assignedTo: { employeeId: 'u1', name: 'Analyst' } };
    expect(labAssignBoardStatusBadge(p, true).label).toBe('assign แล้ว');
  });

  it('Lab received card still shows received wording', () => {
    const p = { status: 'inProgress' as const, labReceivedAt: T1 };
    expect(labAssignBoardStatusBadge(p).label).toBe('รับตัวอย่างแล้ว');
  });

  it('re-check card shows Re-check even when already assigned', () => {
    const p = { status: 'success' as const, labReceivedAt: T1, labRecheckRequestedAt: T2 };
    expect(labAssignBoardStatusBadge(p, true).label).toBe('Re-check · เปลี่ยนผู้รับงานได้');
  });
});

describe('isLabRecheckPending', () => {
  it('pending while Lab head has not approved after the re-check', () => {
    expect(isLabRecheckPending({ status: 'success', labRecheckRequestedAt: T2 })).toBe(true);
    expect(isLabRecheckPending({ status: 'inProgress', labRecheckRequestedAt: T2, labApprovedAt: T1 })).toBe(true);
  });

  it('cleared once Lab approval happens after the re-check', () => {
    expect(isLabRecheckPending({ status: 'success', labRecheckRequestedAt: T1, labApprovedAt: T2 })).toBe(false);
  });

  it('never pending without a re-check or on closed petitions', () => {
    expect(isLabRecheckPending({ status: 'inProgress' })).toBe(false);
    expect(isLabRecheckPending({ status: 'approved', labRecheckRequestedAt: T2 })).toBe(false);
    expect(isLabRecheckPending({ status: 'rejected', labRecheckRequestedAt: T2 })).toBe(false);
  });
});

describe('qcTrackStatusBadge', () => {
  it('QC received while global status is still deliveringQC → shows received status', () => {
    const petition = { status: 'deliveringQC' as const, qcReceivedAt: T1 };
    expect(qcTrackStatusBadge(petition).label).toBe('รับตัวอย่างแล้ว');
  });

  it('QC not received yet → "รอรับ" even if global status inProgress', () => {
    const p = { status: 'inProgress' as const, labReceivedAt: T1 };
    expect(qcTrackStatusBadge(p).label).toBe('รอรับ');
  });

  it('QC received + global inProgress → "กำลังดำเนินการ"', () => {
    const p = { status: 'inProgress' as const, qcReceivedAt: T1 };
    expect(qcTrackStatusBadge(p).label).toBe('กำลังดำเนินการ');
  });

  it('QC completed while petition still open → "รอ Final Result"', () => {
    const p = { status: 'inProgress' as const, qcReceivedAt: T1, qcCompletedAt: T2 };
    expect(qcTrackStatusBadge(p).label).toBe('รอ Final Result');
  });

  it('approved → config label, no QC-track wording', () => {
    const p = { status: 'approved' as const, qcReceivedAt: T1, qcCompletedAt: T2 };
    expect(qcTrackStatusBadge(p).label).toBe(statusBadge('approved').label);
  });

  it('legacy received (receivedAt only) counts as QC received', () => {
    const p = { status: 'inProgress' as const, receivedAt: T1, receivedBy: 'Dev Administrator' };
    expect(qcTrackStatusBadge(p).label).toBe('กำลังดำเนินการ');
  });
});

describe('labTrackStatusSteps', () => {
  it('4 steps in Lab-only order: รับตัวอย่าง → Assign → Lab → ออกผล Lab', () => {
    const steps = labTrackStatusSteps({ status: 'sampleSent' } as Petition);
    expect(steps.map((s) => s.label)).toEqual(['รับตัวอย่าง', 'Assign', 'Lab', 'ออกผล Lab']);
  });

  it('nothing done → receive is the current step', () => {
    const steps = labTrackStatusSteps({ status: 'sampleSent' } as Petition);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps.find((s) => s.current)?.key).toBe('received');
  });

  it('received but not assigned → assign is the current step', () => {
    const steps = labTrackStatusSteps({
      status: 'pendingReview',
      labReceivedAt: T1,
    } as unknown as Petition);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['received']);
    expect(steps.find((s) => s.current)?.key).toBe('assigned');
  });

  it('received + assigned + labCompleted, not approved → lab-approval is current', () => {
    const p = {
      status: 'inProgress',
      labReceivedAt: T1,
      assignedTo: { employeeId: 'u1', name: 'Analyst' },
      labCompletedAt: T2,
    } as unknown as Petition;
    const steps = labTrackStatusSteps(p);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['received', 'assigned', 'lab']);
    expect(steps.find((s) => s.current)?.key).toBe('lab-approval');
  });

  it('labApprovedAt set → every step done', () => {
    const p = {
      status: 'inProgress',
      labReceivedAt: T1,
      assignedTo: { employeeId: 'u1', name: 'Analyst' },
      labCompletedAt: T2,
      labApprovedAt: T2,
    } as unknown as Petition;
    expect(labTrackStatusSteps(p).every((s) => s.done)).toBe(true);
  });

  it('rejected: intermediate steps done via closed, but ออกผล Lab stays not-done', () => {
    const steps = labTrackStatusSteps({ status: 'rejected' } as Petition);
    expect(steps.find((s) => s.key === 'received')?.done).toBe(true);
    expect(steps.find((s) => s.key === 'lab-approval')?.done).toBe(false);
  });
});

describe('qcTrackStatusSteps', () => {
  it('4 steps in QC-only order: รับตัวอย่าง → Assign → QC → ออก Final Result', () => {
    const steps = qcTrackStatusSteps({ status: 'sampleSent' } as Petition);
    expect(steps.map((s) => s.label)).toEqual(['รับตัวอย่าง', 'Assign', 'QC', 'ออก Final Result']);
  });

  it('delivering sample is current while QC receive stays pending', () => {
    const steps = qcTrackStatusSteps({ status: 'deliveringQC' } as Petition);
    expect(steps.find((s) => s.key === 'delivering')?.label).toBe('กำลังส่งตัวอย่าง');
    expect(steps.find((s) => s.key === 'delivering')?.current).toBe(true);
    expect(steps.find((s) => s.key === 'received')?.done).toBe(false);
    expect(steps.find((s) => s.key === 'received')?.current).toBeFalsy();
  });

  it('qc completed but not approved → ออก Final Result is current', () => {
    const p = {
      status: 'inProgress',
      qcReceivedAt: T1,
      assignedTo: { employeeId: 'u1', name: 'Analyst' },
      qcCompletedAt: T2,
    } as unknown as Petition;
    expect(qcTrackStatusSteps(p).find((s) => s.current)?.key).toBe('qc-approval');
  });

  it('approved → every step done including ออก Final Result', () => {
    const p = {
      status: 'approved',
      qcReceivedAt: T1,
      assignedTo: { employeeId: 'u1', name: 'Analyst' },
      qcCompletedAt: T2,
    } as unknown as Petition;
    expect(qcTrackStatusSteps(p).every((s) => s.done)).toBe(true);
  });
});
