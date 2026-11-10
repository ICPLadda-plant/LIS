import type { Petition } from '@/types/petition.types';
import { expandItemsBySampleQuantity } from '@/lib/petitionPrintItems';
import { sampleLabelCopySide, sampleLabelGroupKey, type SampleLabelSide } from '@/lib/petitionSampler';

export type SideLabel = { key: string; label: string; received: boolean };

/**
 * เลขป้ายของฝั่งนั้นที่ต้องรับทีละป้าย (mirror server/lib/sampleLabelNumber.js sideLabelGroups)
 * คืน [] เมื่อคำขอไม่มีกลุ่มเลขป้าย (คำขอเก่า)
 */
export function sideLabels(petition: Petition, side: SampleLabelSide): SideLabel[] {
  const numbers = petition.sampleLabelNumbers;
  const stored = numbers?.groups ?? [];
  if (!stored.length) return [];
  const active = new Set<string>();
  for (const { item, copyIndex } of expandItemsBySampleQuantity(petition.items ?? [])) {
    if (sampleLabelCopySide(petition, item, copyIndex) === side) active.add(sampleLabelGroupKey(item));
  }
  const year = numbers?.year ? String(numbers.year % 100).padStart(2, '0') : '';
  const receipts = petition.labelReceipts ?? [];
  return stored.flatMap((group) => {
    const seq = group[side];
    if (!seq || !active.has(group.key)) return [];
    return [{
      key: group.key,
      label: year ? `${seq}/${year}` : seq,
      received: receipts.some((receipt) => receipt.side === side && receipt.key === group.key),
    }];
  });
}

/** ป้ายของฝั่งนี้ที่ต้องรับทีละป้าย หรือ null เมื่อรับแบบเดิมทั้งคำขอ (มีเลขเดียว / รับครบแล้ว) */
export function labelReceiptChoices(petition: Petition, side: SampleLabelSide): SideLabel[] | null {
  if (petition[`${side}ReceivedAt`]) return null;
  const labels = sideLabels(petition, side);
  return labels.length > 1 ? labels : null;
}

/** ความคืบหน้าการรับป้ายของฝั่งนั้น เช่น { received: 1, total: 2 } — null เมื่อไม่ได้รับทีละป้าย */
export function labelReceiptProgress(petition: Petition, side: SampleLabelSide): { received: number; total: number } | null {
  const labels = labelReceiptChoices(petition, side);
  if (!labels) return null;
  return { received: labels.filter((label) => label.received).length, total: labels.length };
}

/** ข้อความหลังรับรอบนี้: รับครบแล้ว หรือยังรอป้ายที่เหลือ */
export function labelReceiptStatus(labels: SideLabel[], keys: string[]): { complete: boolean; text: string } {
  const after = labels.filter((label) => label.received || keys.includes(label.key)).length;
  return after === labels.length
    ? { complete: true, text: `รับครบ ${labels.length} ป้าย` }
    : { complete: false, text: `รับแล้ว ${after}/${labels.length} ป้าย · รอป้ายที่เหลือ` };
}

/**
 * เลือกป้ายที่จะรับจากการสแกน: QR บนป้ายมี itemSeq → รับเฉพาะป้ายนั้น
 * กรอกเลขคำขอเอง/เลือกจากรายการ → เลือกทุกป้ายที่ยังไม่รับไว้ก่อน (ติ๊กออกได้)
 */
export function pickScannedLabels(
  petition: Petition,
  side: SampleLabelSide,
  itemSeq: number | null,
): { labels: SideLabel[]; keys: string[] } | { error: string } | null {
  const labels = labelReceiptChoices(petition, side);
  if (!labels) return null;
  const sideName = side.toUpperCase();
  if (itemSeq == null) return { labels, keys: labels.filter((label) => !label.received).map((label) => label.key) };
  const item = (petition.items ?? []).find((entry) => Number(entry.seq) === itemSeq);
  const label = item ? labels.find((entry) => entry.key === sampleLabelGroupKey(item)) : undefined;
  if (!label) return { error: `ป้ายนี้ไม่ได้ส่งฝั่ง ${sideName}` };
  if (label.received) return { error: `ป้าย ${label.label} รับฝั่ง ${sideName} แล้ว` };
  return { labels, keys: [label.key] };
}
