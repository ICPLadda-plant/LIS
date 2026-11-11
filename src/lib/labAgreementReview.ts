import type { LabAgreementReview, LabRequest } from '@/types/labRequest.types';

export const PERSONNEL_ABLE_REASON_LABELS = {
  trained: 'ได้รับการฝึกอบรมแล้ว',
  assigned: 'ได้รับการมอบหมายให้ทดลอง',
} as const;

export const PERSONNEL_UNABLE_REASON_LABELS = {
  neverDone: 'ยังไม่เคยทำการทดลอง',
  notTrained: 'ยังไม่ได้รับการฝึกอบรม',
  notAssigned: 'ยังไม่ได้รับการมอบหมายให้ทำงานทดลอง',
} as const;

export const WORKLOAD_LABELS = {
  normal: 'ยังมีความสามารถรับงานได้ตามปกติ',
  slower: 'สามารถรับงานได้แต่อาจช้ากว่าปกติ ซึ่งลูกค้ายินยอม',
  cannot: 'ไม่สามารถรับงานได้ เพราะมีงานสะสมมาก',
} as const;

export const EQUIP_READY_REASON_LABELS = {
  hasInstrument: 'มีเครื่องมือ',
  calibrated: 'สอบเทียบแล้ว',
} as const;

export const EQUIP_NOT_READY_REASON_LABELS = {
  noInstrument: 'ไม่มีเครื่องมือ',
  notCalibrated: 'ยังไม่มีการสอบเทียบ',
  outOfRange: 'เครื่องมือไม่ครอบคลุมช่วงทดสอบที่ต้องการ',
  broken: 'เครื่องมือเสีย',
} as const;

export function isReviewFilled(r?: LabAgreementReview | null): boolean {
  return !!r && !!r.reviewedBy && !!r.reviewedAt;
}

/** Lab รับตัวอย่างได้เมื่อทุกใบ L ของคำร้องทบทวนแล้วและสรุปว่าพร้อมรับงาน (ไม่มีใบ L = ไม่ต้องทบทวน) */
export function isReadyToReceive(requests: Pick<LabRequest, 'labAgreementReview'>[]): boolean {
  return requests.every((r) => isReviewFilled(r.labAgreementReview) && r.labAgreementReview?.acceptable !== false);
}
