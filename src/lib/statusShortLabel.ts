import type { PetitionStatus } from '@/types/petition.types';
import { nextPetitionStatuses } from '@/lib/petitionStatusFlow';

/**
 * ป้ายสถานะแบบสั้นสำหรับรายการ/ตาราง (ให้ Badge อยู่บรรทัดเดียว)
 * หน้ารายละเอียดยังใช้ชื่อเต็มเหมือนเดิม — map นี้ใช้แสดงผลเท่านั้น ไม่แตะค่าใน DB
 */
const SHORT_LABELS: Record<string, string> = {
  // PETITION_STATUS_CONFIG
  'กำลังส่งตัวอย่าง': 'กำลังส่ง',
  'ส่งตัวอย่างแล้ว': 'ส่งแล้ว',
  'รับตัวอย่างแล้ว': 'รับแล้ว',
  'กำลังดำเนินการ': 'ดำเนินการ',
  'ทดสอบเสร็จสิ้น': 'ทดสอบเสร็จ',
  'QC กำลังตรวจ': 'QC ตรวจ',
  // petitionStatusBadge
  'QC ตรวจครบ · รอส่วนอื่น': 'รอส่วนอื่น',
  'ผล Lab ออกแล้ว · รอ QC': 'รอ QC',
  'ผล Lab ออกแล้ว · รอ Final Result': 'รอ Final',
  // labTrackStatusBadge / qcTrackStatusBadge
  'ผลวิเคราะห์ออกแล้ว': 'ออกผลแล้ว',
  'Lab ออกผลแล้วรอ QC ยืนยันผล': 'รอ QC ยืนยัน',
  'เจ้าหน้าที่บันทึกผลแล้วรออนุมัติ': 'รออนุมัติ',
  'รอยืนยันค่า ถพ.': 'รอยืนยัน ถพ.',
  'Lab รับงานแล้ว รอ assign': 'รอ assign',
  'Lab มอบหมายงานแล้ว รอเจ้าหน้าที่รับ': 'รอรับงาน',
  'เจ้าหน้าที่กำลังดำเนินการวิเคราะห์': 'วิเคราะห์',
  'รอ Final Result': 'รอ Final',
};

const LABEL_RECEIPT = /^รับแล้ว (\d+)\/(\d+) ป้าย$/;

/** ชื่อเต็ม → ป้ายสั้น; ถ้าไม่มีใน map คืนชื่อเต็ม */
export function statusShortLabel(full: string): string {
  const mapped = SHORT_LABELS[full];
  if (mapped) return mapped;
  const receipt = LABEL_RECEIPT.exec(full);
  if (receipt) return `รับ ${receipt[1]}/${receipt[2]}`;
  return full;
}

/** ลำดับสถานะตาม workflow เดิม (เดิน NEXT จาก deliveringQC) — approved/rejected เป็นขั้นสุดท้ายร่วมกัน */
function buildStatusOrder(): PetitionStatus[][] {
  const order: PetitionStatus[][] = [];
  const seen = new Set<PetitionStatus>();
  let current: PetitionStatus[] = ['deliveringQC'];
  while (current.length > 0) {
    order.push(current);
    current.forEach((s) => seen.add(s));
    current = Array.from(new Set(current.flatMap((s) => nextPetitionStatuses(s)))).filter((s) => !seen.has(s));
  }
  return order;
}

const STATUS_ORDER = buildStatusOrder();

/** ขั้นปัจจุบันของสถานะ (นับจาก 1) และจำนวนขั้นทั้งหมด; null ถ้าไม่อยู่ใน workflow */
export function statusStep(status: string | undefined | null): { step: number; total: number } | null {
  if (!status) return null;
  const index = STATUS_ORDER.findIndex((group) => group.includes(status as PetitionStatus));
  if (index < 0) return null;
  return { step: index + 1, total: STATUS_ORDER.length };
}
