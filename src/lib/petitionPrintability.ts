import type { PetitionStatus } from '@/types/petition.types';

type PrintabilityInput = {
  status: PetitionStatus;
  qcReceivedBy?: string;
  labReceivedBy?: string;
  labCompletedAt?: string | null;
  labApprovedAt?: string | null;
};

const received = (name?: string) => !!name?.trim();

/**
 * ฉลากตัวอย่างติดที่ขวดก่อนส่งของให้ QC — พอ QC หรือ Lab รับตัวอย่างเข้าระบบแล้ว
 * ตัวอย่างอยู่ในมือห้องแล็บ ไม่มีเหตุให้พิมพ์ฉลากใหม่
 */
export function canPrintSampleLabel(petition: PrintabilityInput): boolean {
  return !received(petition.qcReceivedBy) && !received(petition.labReceivedBy);
}

/** Pre Report ใช้ได้จนกว่าหัวหน้า QC จะออก Final Result — หลังจากนั้นใช้ Final Report แทน */
export function canPrintPreReport(petition: PrintabilityInput): boolean {
  return petition.status !== 'approved';
}

/**
 * ผลวิเคราะห์ Lab พิมพ์ได้ทันทีเมื่อ Lab อนุมัติผลแล้ว ไม่ต้องรอหัวหน้า QC ออก Final Result
 * ถ้า Lab แค่ออกผล (ยังไม่อนุมัติ) ต้องรอ Final Result ก่อน
 */
export function canPrintLabResult(petition: PrintabilityInput): boolean {
  if (petition.labApprovedAt) return true;
  return petition.status === 'approved' && !!petition.labCompletedAt;
}
