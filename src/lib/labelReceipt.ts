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

/** รับป้ายของฝั่งนี้ไปแล้วอย่างน้อยหนึ่งป้าย (ยังไม่ครบ) — เปิดงานกรอกผลของป้ายที่รับแล้วได้ */
export function hasPartialLabelReceipt(petition: Petition, side: SampleLabelSide): boolean {
  return sideLabels(petition, side).some((label) => label.received);
}

/** ตัวอย่างรายการนี้ยังรอสแกนรับป้ายของฝั่งนี้ → ยังกรอกผลไม่ได้ */
export function isItemLabelPending(petition: Petition, item: Petition['items'][number], side: SampleLabelSide): boolean {
  const labels = labelReceiptChoices(petition, side);
  if (!labels) return false;
  const label = labels.find((entry) => entry.key === sampleLabelGroupKey(item));
  return !!label && !label.received;
}

/** ข้อความหลังรับรอบนี้: รับครบแล้ว หรือยังรอป้ายที่เหลือ */
export function labelReceiptStatus(labels: SideLabel[], keys: string[]): { complete: boolean; text: string } {
  const after = labels.filter((label) => label.received || keys.includes(label.key)).length;
  return after === labels.length
    ? { complete: true, text: `รับครบ ${labels.length} ป้าย` }
    : { complete: false, text: `รับแล้ว ${after}/${labels.length} ป้าย · รอป้ายที่เหลือ` };
}

/**
 * แยกเลขนำส่งที่พิมพ์เอง เช่น "P04/69", "l3/69", "P4" → ฝั่ง + ลำดับ (ไม่สนเลข 0 นำหน้า)
 * เลขคำร้อง P-YYMM-NNNN ไม่ตรงรูปแบบนี้
 */
export function parseLabelCode(code: string): { side: SampleLabelSide; num: number } | null {
  const match = String(code ?? '').trim().match(/^([PL])\s*0*(\d{1,4})(?:\s*\/\s*(\d{2}))?$/i);
  if (!match) return null;
  return { side: match[1].toUpperCase() === 'P' ? 'qc' : 'lab', num: Number(match[2]) };
}

function labelNum(label: string): number {
  return Number(label.replace(/^[PL]/i, '').split('/')[0]);
}

/** เลขนำส่งของฝั่งนี้สำหรับหัวข้อ เช่น "P04/69, P05/69" — คำขอเก่าที่ไม่มีเลขคืน "" */
export function sideLabelText(petition: Petition, side: SampleLabelSide): string {
  const labels = sideLabels(petition, side);
  if (labels.length) return labels.map((label) => label.label).join(', ');
  const numbers = petition.sampleLabelNumbers;
  const seq = numbers?.[side];
  if (!seq) return '';
  return numbers?.year ? seq + '/' + String(numbers.year % 100).padStart(2, '0') : seq;
}

/** ป้ายของฝั่งนี้ที่ยังไม่รับ — ใช้ทำรายการเลือกตามเลขนำส่ง */
export function pendingSideLabels(petition: Petition, side: SampleLabelSide): SideLabel[] {
  if (petition[side === 'qc' ? 'qcReceivedAt' : 'labReceivedAt']) return [];
  const labels = sideLabels(petition, side).filter((label) => !label.received);
  if (labels.length) return labels;
  const text = sideLabelText(petition, side);
  return text ? [{ key: '', label: text, received: false }] : [];
}

/**
 * เลือกป้ายที่จะรับจากการสแกน: QR บนป้ายมี itemSeq → รับเฉพาะป้ายนั้น
 * พิมพ์/เลือกเลขนำส่ง (เช่น P04/69) → รับเฉพาะป้ายเลขนั้น
 * กรอกเลขคำขอเอง/เลือกจากรายการ → เลือกทุกป้ายที่ยังไม่รับไว้ก่อน (ติ๊กออกได้)
 */
export function pickScannedLabels(
  petition: Petition,
  side: SampleLabelSide,
  itemSeq: number | null,
  code?: string,
): { labels: SideLabel[]; keys: string[] } | { error: string } | null {
  const sideName = side.toUpperCase();
  const typed = code ? parseLabelCode(code) : null;
  if (typed && typed.side !== side) return { error: 'เลข ' + code + ' เป็นป้ายฝั่ง ' + typed.side.toUpperCase() + ' ไม่ใช่ฝั่ง ' + sideName };
  const labels = labelReceiptChoices(petition, side);
  if (!labels) return null;
  if (typed && itemSeq == null) {
    const label = labels.find((entry) => labelNum(entry.label) === typed.num);
    if (!label) return { error: 'ไม่พบป้าย ' + code + ' ฝั่ง ' + sideName };
    if (label.received) return { error: 'ป้าย ' + label.label + ' รับฝั่ง ' + sideName + ' แล้ว' };
    return { labels, keys: [label.key] };
  }
  if (itemSeq == null) return { labels, keys: labels.filter((label) => !label.received).map((label) => label.key) };
  const item = (petition.items ?? []).find((entry) => Number(entry.seq) === itemSeq);
  const label = item ? labels.find((entry) => entry.key === sampleLabelGroupKey(item)) : undefined;
  if (!label) return { error: `ป้ายนี้ไม่ได้ส่งฝั่ง ${sideName}` };
  if (label.received) return { error: `ป้าย ${label.label} รับฝั่ง ${sideName} แล้ว` };
  return { labels, keys: [label.key] };
}
