import type { Petition, PetitionStatus } from '@/types/petition.types';
import { statusBadge, toneBadge, type StatusBadge, type PetitionStatusStep } from './statusBadge';

/**
 * Per-side receive status (Lab / QC), with legacy backward-compat.
 *
 * ใบที่รับก่อนมีฟีเจอร์แยก Lab/QC มีแต่ field รวม `receivedBy`/`receivedAt`
 * (ไม่มี `labReceivedAt`/`qcReceivedAt`). ถือว่าเป็น "legacy received" แล้วให้
 * `receivedBy`/`receivedAt` นับเป็นของฝั่งที่ถาม (ทั้ง Lab และ QC) — ใบเก่าจึง
 * โชว์ว่ารับแล้ว + ชื่อผู้รับได้
 *
 * ใบใหม่ที่มี side field อย่างน้อยหนึ่งฝั่งแล้ว จะ "ไม่" fallback — กันไม่ให้
 * ใบ mixed (เช่น Lab รับก่อน) แสดงผู้รับฝั่ง Lab เป็นผู้รับฝั่ง QC ผิดๆ
 */
export function isLegacyReceived(p: Pick<Petition, 'labReceivedAt' | 'qcReceivedAt' | 'receivedAt'>): boolean {
  return !p.labReceivedAt && !p.qcReceivedAt && !!p.receivedAt;
}

type ReceiveFields = Pick<
  Petition,
  | 'labReceivedAt'
  | 'labReceivedBy'
  | 'labCompletedAt'
  | 'labApprovedAt'
  | 'labRecheckRequestedAt'
  | 'qcReceivedAt'
  | 'qcReceivedBy'
  | 'qcCompletedAt'
  | 'receivedAt'
  | 'receivedBy'
  | 'assignedTo'
>;

export function labReceivedAt(p: ReceiveFields): string | null | undefined {
  return p.labReceivedAt ?? (isLegacyReceived(p) ? p.receivedAt : null);
}

export function labReceivedBy(p: ReceiveFields): string | undefined {
  return p.labReceivedBy ?? (isLegacyReceived(p) ? p.receivedBy : undefined);
}

export function qcReceivedAt(p: ReceiveFields): string | null | undefined {
  return p.qcReceivedAt ?? (isLegacyReceived(p) ? p.receivedAt : null);
}

export function qcReceivedBy(p: ReceiveFields): string | undefined {
  return p.qcReceivedBy ?? (isLegacyReceived(p) ? p.receivedBy : undefined);
}

/**
 * สถานะที่โชว์ในลิสต์ "การทดสอบ Lab" — อิง track ของ Lab เอง ไม่ใช่ status รวม.
 *
 * petition.status เป็นตัวเดียวใช้ร่วมทั้ง Lab/QC พอ QC รับ+assign จะกลายเป็น
 * `inProgress` ("QC กำลังตรวจ") ทั้งที่ Lab ยังไม่ได้รับตัวอย่าง ถ้าโชว์ตรงๆ
 * ฝั่ง Lab จะเห็น "QC กำลังตรวจ" ผิด — ต้องรับตัวอย่างก่อน assign
 */
/** เจ้าหน้าที่รับงานที่หัวหน้า assign แล้ว (งานเก่าที่เริ่มบันทึกผลไปแล้วถือว่ารับแล้ว) */
export function isLabWorkAccepted(p: Pick<Petition, 'assignedTo' | 'firstResultAt' | 'labCompletedAt'>): boolean {
  return !!(p.assignedTo?.acceptedAt || p.firstResultAt || p.labCompletedAt);
}

// mirror ของ buildLabTrack ใน server/lib/petitionStatusLog.js
export function labTrackStatusBadge(p: ReceiveFields & { status: PetitionStatus }): StatusBadge {
  if (p.status === 'approved') return toneBadge('success', 'ผลวิเคราะห์ออกแล้ว');
  if (p.status === 'rejected') return statusBadge(p.status);
  if (p.labApprovedAt) return toneBadge('warning', 'Lab ออกผลแล้วรอ QC ยืนยันผล');
  if (p.labCompletedAt) return toneBadge('warning', 'เจ้าหน้าที่บันทึกผลแล้วรออนุมัติ');
  if (!labReceivedAt(p)) return toneBadge('warning', 'รอรับ');
  if (!p.assignedTo) return toneBadge('info', 'Lab รับงานแล้ว รอ assign');
  if (!isLabWorkAccepted(p)) return toneBadge('warning', 'Lab มอบหมายงานแล้ว รอเจ้าหน้าที่รับ');
  return toneBadge('info', 'เจ้าหน้าที่กำลังดำเนินการวิเคราะห์');
}

/**
 * Re-check ฝั่ง Lab ที่ยังไม่ถูกปิดด้วยการออกผลของหัวหน้า Lab — วันที่ทำซ้ำอาจไม่ใช่
 * คนเดิม จึงต้องให้งานกลับมาบนบอร์ด Assign เพื่อเปลี่ยนผู้รับงานได้
 */
export function isLabRecheckPending(
  p: Pick<Petition, 'labRecheckRequestedAt' | 'labApprovedAt'> & { status: PetitionStatus },
): boolean {
  if (!p.labRecheckRequestedAt) return false;
  if (p.status === 'approved' || p.status === 'rejected') return false;
  if (!p.labApprovedAt) return true;
  return new Date(p.labApprovedAt).getTime() < new Date(p.labRecheckRequestedAt).getTime();
}

export function labAssignBoardStatusBadge(
  p: ReceiveFields & { status: PetitionStatus },
  assigned?: boolean,
): StatusBadge {
  if (isLabRecheckPending(p)) return toneBadge('warning', 'Re-check · เปลี่ยนผู้รับงานได้');
  if (assigned) return toneBadge('info', 'assign แล้ว');
  if (!labReceivedAt(p)) return statusBadge('sampleSent');
  return statusBadge('pendingReview');
}

/**
 * สถานะที่โชว์ในลิสต์ "การทดสอบ QC" — อิง track ของ QC เอง (คู่ขนานกับ labTrackStatusBadge).
 *
 * ต่างจาก petitionStatusBadge (สถานะรวมทั้งใบ เช่น "QC ตรวจครบ · รอส่วนอื่น") — หน้า QC
 * ควรเห็นเฉพาะความคืบหน้าของ track QC เอง ก่อน QC รับให้โชว์ "รอรับ" เสมอ
 */
export function qcTrackStatusBadge(p: ReceiveFields & { status: PetitionStatus }): StatusBadge {
  if (!qcReceivedAt(p)) return toneBadge('warning', 'รอรับ');
  if (['success', 'approved', 'rejected'].includes(p.status)) return statusBadge(p.status);
  if (p.status === 'deliveringQC') return statusBadge('pendingReview');
  if (p.qcCompletedAt) return toneBadge('warning', 'รอ Final Result');
  // ค่า config ของ inProgress = "QC กำลังตรวจ" อยู่แล้ว จึงปล่อยผ่านลง statusBadge ได้เลย
  return statusBadge(p.status);
}

const isClosedStatus = (status: PetitionStatus): boolean =>
  ['success', 'approved', 'rejected'].includes(status);

/** เติม `current` = step แรกที่ยังไม่ done (mirror ของ petitionStatusSteps) */
function withCurrentStep(steps: PetitionStatusStep[]): PetitionStatusStep[] {
  const firstOpen = steps.find((step) => !step.done);
  return steps.map((step) => ({ ...step, current: step === firstOpen }));
}

/**
 * Timeline เฉพาะ track Lab สำหรับหน้า /lab-testing:
 *   รับตัวอย่าง → Assign → Lab → ออกผล Lab
 * step กลางนับ done เมื่อ field ตัวเองมีหรือใบปิดแล้ว; step ออกผลผูกกับ labApprovedAt ล้วน
 */
export function labTrackStatusSteps(petition: Petition): PetitionStatusStep[] {
  const closed = isClosedStatus(petition.status);
  return withCurrentStep([
    { key: 'received', label: 'รับตัวอย่าง', done: !!labReceivedAt(petition) || closed },
    { key: 'assigned', label: 'Assign', done: !!petition.assignedTo || closed },
    { key: 'lab', label: 'Lab', done: !!petition.labCompletedAt || closed },
    { key: 'lab-approval', label: 'ออกผล Lab', done: !!petition.labApprovedAt },
  ]);
}

/**
 * Timeline เฉพาะ track QC สำหรับหน้า /qc-testing:
 *   รับตัวอย่าง → Assign → QC → ออก Final Result
 * step ปลายทางผูกกับ status === 'approved' (ตรงกับ petitionStatusSteps)
 */
export function qcTrackStatusSteps(petition: Petition): PetitionStatusStep[] {
  const closed = isClosedStatus(petition.status);
  const received = !!qcReceivedAt(petition);
  const steps: PetitionStatusStep[] = petition.status === 'deliveringQC' && !received
    ? [{ key: 'delivering', label: 'กำลังส่งตัวอย่าง', done: false }]
    : [];
  steps.push(
    { key: 'received', label: 'รับตัวอย่าง', done: received || closed },
    { key: 'assigned', label: 'Assign', done: !!petition.assignedTo || closed },
    { key: 'qc', label: 'QC', done: !!petition.qcCompletedAt || closed },
    { key: 'qc-approval', label: 'ออก Final Result', done: petition.status === 'approved' },
  );
  return withCurrentStep(steps);
}
