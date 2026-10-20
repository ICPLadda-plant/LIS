// ===== Petition status =====
export type PetitionStatus =
  | 'deliveringQC'
  | 'sampleSent'
  | 'pendingReview'
  | 'inProgress'
  | 'success'
  | 'approved'
  | 'rejected';

export const PETITION_STATUSES: PetitionStatus[] = [
  'deliveringQC',
  'sampleSent',
  'pendingReview',
  'inProgress',
  'success',
  'approved',
  'rejected',
];

export type StatusBadgeVariant =
  | 'primary' | 'primary-soft'
  | 'yellow' | 'yellow-soft'
  | 'green' | 'green-soft'
  | 'red' | 'red-soft'
  | 'blue' | 'blue-soft'
  | 'purple' | 'purple-soft'
  | 'gray' | 'gray-soft';

export const PETITION_STATUS_CONFIG: Record<
  PetitionStatus,
  { label: string; variant: StatusBadgeVariant }
> = {
  deliveringQC:  { label: 'กำลังส่งตัวอย่าง', variant: 'yellow-soft' },
  sampleSent:    { label: 'ส่งตัวอย่างแล้ว',  variant: 'primary-soft' },
  pendingReview: { label: 'รับตัวอย่างแล้ว',  variant: 'yellow-soft' },
  inProgress:    { label: 'กำลังดำเนินการ',     variant: 'blue-soft' },
  success:       { label: 'ทดสอบเสร็จสิ้น',  variant: 'green-soft' },
  approved:      { label: 'เสร็จสิ้น', variant: 'purple-soft' },
  rejected:      { label: 'Rework',    variant: 'red-soft' },
};

// ===== Department =====
export type PetitionDept = 'production' | 'rm' | 'fg';

export const PETITION_DEPT_LABELS: Record<PetitionDept, string> = {
  production: 'แผนกผลิต',
  rm: 'แผนก RM (วัตถุดิบ)',
  fg: 'แผนก FG (สินค้าสำเร็จรูป)',
};

// batch ที่ลงท้าย '1' หรือ '6' = lab batch (ต้องยื่นใบคำขอรับบริการ)
export function isLabBatch(batchNo: string): boolean {
  const last = batchNo.trim().slice(-1);
  return last === '1' || last === '6';
}

// ===== Items =====
export type ItemCondition = 'normal' | 'defective';

export interface PetitionItem {
  seq: number;
  sampleName: string;
  commonName?: string;
  batchNo: string;
  lotNo?: string;
  productionDate?: string | null;
  submissionNo?: string;
  packageUnit?: string;
  testUnit?: string;
  testItems?: string;
  sendToLab?: boolean;
  MF_Before?: string | null;
  MF_Lasted?: string | null;
  MF_GapDays?: number | null;
  MF_BatchAfterGap?: number | null;
  MF_ConsecutivePassCount?: number | null;
  note?: string;
  sampleQuantity?: number;
  labelManufacturer?: string;
  labelSeller?: string;
  labelQuantity?: string;
  labelQuantities?: string[];
  labelSampledBy?: string;
  labelSampledDate?: string;
  labelRemark?: string;
  sampleId?: string;
  // รหัสสินค้าจาก Master Item (item_no) ของแถวที่เลือก — คนละเรื่องกับ sampleId
  // ซึ่งเป็น key ของ Approval/PhysicalResult (ซ้ำกันข้าม item ไม่ได้). ใช้ขับ
  // "หมวดหมู่ย่อย (prefix code)" + "กลุ่ม Item" ของ parameter — ดู getItemSubCategory.
  itemNo?: string;
  condition?: ItemCondition;
}

// ===== Submitter (ผู้ยื่นคำขอ) =====
export interface PetitionSubmitter {
  employeeId?: string;
  name: string;
  email?: string;
  department?: string;
  submittedAt: string;
}

// ===== Deliverer (ผู้นำส่ง) =====
export interface PetitionDeliverer {
  employeeId?: string;
  name: string;
  email?: string;
}

// ===== Review history =====
export type ReviewAction = 'note' | 'approve' | 'reject' | 'startTesting';

export interface SpecificGravity {
  seq: number;
  sampleName: string;
  value?: string;
}

export interface ReviewEntry {
  action: ReviewAction;
  reviewedBy: string;
  reviewedAt: string;
  note?: string;
  specificGravities?: SpecificGravity[];
}

export interface PetitionAssignee {
  employeeId: string;
  name: string;
  department?: string;
  position?: string;
  assignedAt?: string;
  assignedBy?: string;
}

export interface PetitionAssignedMachine {
  machineId: string;
  code: string;
  name: string;
  location?: string;
  // Substance identity — when a petition has multiple substances, each substance
  // group (items sharing sampleName + commonName) gets its own machine assignment.
  sampleName?: string;
  commonName?: string;
  standardTimeId?: string;
  estimatedMinutes?: number;
  estimatedSource?: string;
}

// ===== Audit log =====
export type PetitionAuditEvent =
  | 'created'
  | 'statusChanged'
  | 'assigned'
  | 'reviewed'
  | 'updated'
  | 'deleted'
  | 'received'
  | 'resultEntered'
  | 'resultUpdated';

export interface PetitionAuditLogEntry {
  _id: string;
  petitionId: string;
  petitionNo: string;
  event: PetitionAuditEvent;
  fromStatus?: PetitionStatus;
  toStatus?: PetitionStatus;
  actor?: string;
  note?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export const PETITION_AUDIT_EVENT_LABELS: Record<PetitionAuditEvent, string> = {
  created: 'สร้างคำร้อง',
  statusChanged: 'เปลี่ยนสถานะ',
  assigned: 'มอบหมาย',
  reviewed: 'พิจารณา',
  updated: 'แก้ไขข้อมูล',
  deleted: 'ลบคำร้อง',
  received: 'รับตัวอย่าง',
  resultEntered: 'ใส่ค่า QC',
  resultUpdated: 'แก้ค่า QC',
};

// ===== Phase 2 tracking (for parameters with hasPhases=true) =====
export interface PhaseTriggerInfo {
  parameterId: string;
  parameterName?: string;
  fieldLabel: string;
  itemSeq: number;
  triggeredAt: string;
}

export type PetitionPhase = 1 | 2;

export interface ProductionWorkflow {
  requestNo?: string;
  requesterEmail?: string;
  lisPetitionNo?: string;
  petitionNo?: string;
  lisStatus?: string;
  lisSent?: boolean;
  sentAt?: string | null;
}

// ===== Petition (discriminated by dept) =====
export interface AdditionalSampleRequest {
  _id: string;
  qrCode: string;
  side: 'qc' | 'lab';
  reason: string;
  items: { itemSeq: number; quantity: number; weights?: number[] }[];
  requestedAt: string;
  requestedBy: { name: string; email?: string; employeeId?: string };
  status: 'requested' | 'sent' | 'received';
  sentAt?: string;
  receivedAt?: string;
  receivedBy?: { name: string };
  previousResults?: unknown[];
  currentPhase?: PetitionPhase;
  phase2DueAt?: string | null;
  phase2UnlockedAt?: string | null;
  phase2TriggeredBy?: PhaseTriggerInfo | null;
}

interface PetitionBase {
  _id: string;
  petitionNo: string;
  dept: PetitionDept;
  status: PetitionStatus;
  submittedBy: PetitionSubmitter;
  deliveredBy?: PetitionDeliverer;
  items: PetitionItem[];
  additionalSampleRequests?: AdditionalSampleRequest[];
  scannedAdditionalSampleId?: string;
  scannedAdditionalSampleCode?: string;
  priority?: 0 | 1;
  cause?: string;
  reviewHistory?: ReviewEntry[];
  assignedTo?: PetitionAssignee | null;
  assignedMachines?: PetitionAssignedMachine[];
  prodOrderNos?: string[];
  productionWorkflow?: ProductionWorkflow;
  sampleSentAt?: string | null;
  receivedAt?: string | null;
  receivedBy?: string;
  labReceivedAt?: string | null;
  labReceivedBy?: string;
  qcReceivedAt?: string | null;
  qcReceivedBy?: string;
  labCompletedAt?: string | null;
  labCompletedBy?: string;
  qcCompletedAt?: string | null;
  qcCompletedBy?: string;
  labApprovedAt?: string | null;
  labApprovedBy?: string;
  // กด Re-check ฝั่ง Lab — งานกลับไปโชว์บนบอร์ด Assign ให้เปลี่ยนผู้รับงานได้จนกว่าหัวหน้า Lab ออกผล
  labRecheckRequestedAt?: string | null;
  labRecheckRequestedBy?: string;
  labReturnNote?: string;
  qcReturnNote?: string;
  labRedoExplanation?: string;
  qcRedoExplanation?: string;
  firstResultAt?: string | null;
  completedAt?: string | null;
  conclusion?: "pass" | "accepted-oos" | "returned-to-requester" | null;
  conclusionNote?: string;
  // 2-phase testing
  currentPhase?: PetitionPhase;
  phase2UnlockedAt?: string | null;
  phase2DueAt?: string | null;
  phase2TriggeredBy?: PhaseTriggerInfo | null;
  revisionOf?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionPetition extends PetitionBase {
  dept: 'production';
}

export interface RmPetition extends PetitionBase {
  dept: 'rm';
}

export interface FgPetition extends PetitionBase {
  dept: 'fg';
}

export type Petition = ProductionPetition | RmPetition | FgPetition;

// ===== QC Test Results =====
export interface QCTestResult {
  _id?: string;
  sampleRoundId?: string;
  petitionId: string;
  petitionNo?: string;
  itemSeq: number;
  sampleId?: string;
  sampleName?: string;
  commonName?: string;
  parameterId: string;
  parameterName?: string;
  values: Record<string, unknown>;
  // Phase 2 retest values after a trigger/timer unlocks the second pass.
  valuesPhase2?: Record<string, unknown>;
  // For multiEntry parameters — array of per-entry value-objects.
  entries?: Record<string, unknown>[];
  enteredBy?: { name: string; email: string };
  enteredAt?: string;
  updatedBy?: { name: string; email: string };
  updatedAt?: string;
}

export interface SaveQCResultPayload {
  sampleRoundId?: string;
  petitionId: string;
  petitionNo?: string;
  itemSeq: number;
  sampleId?: string;
  sampleName?: string;
  commonName?: string;
  parameterId: string;
  parameterName?: string;
  fieldLabel: string;
  value: unknown;
  // For multiEntry parameters — which entry row this field write targets.
  entryIndex?: number;
  enteredBy: { name: string; email: string };
  // 1 = Phase 1 (default, ค่าก่อน), 2 = Phase 2 retest values
  phase?: PetitionPhase;
  overrideReason?: string;
}
