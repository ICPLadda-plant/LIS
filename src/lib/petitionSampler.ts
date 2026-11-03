import type { Petition, PetitionDeliverer } from "@/types/petition.types";
import { hasLabTrack, requiresQcTrack, shouldSendItemToLab, shouldSendItemToQc } from "@/lib/petitionRouting";

export type SampleLabelSide = "qc" | "lab";

function labelAmount(value: unknown): number | null {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * ป้ายแผ่นนี้ (ตัวอย่างชิ้นที่ copyIndex ของรายการ) ส่งฝั่งไหน
 * ใช้ฝั่งที่ฝ่ายผลิตระบุมาก่อน ถ้าไม่มีให้ดูจากปลายทางของคำขอและรายการ
 * รายการที่ส่งทั้งสองฝั่งแบบ 2 ตัวอย่าง: ปริมาณน้อยกว่า = QC, มากกว่า = LAB (ตรงกับ pickQcLabSideItems)
 */
export function sampleLabelCopySide(
  petition: Petition,
  item: Petition["items"][number],
  copyIndex: number,
): SampleLabelSide {
  const declared = item.labelQuantitySides?.[copyIndex];
  if (declared === "qc" || declared === "lab") return declared;
  const hasQc = requiresQcTrack(petition);
  const hasLab = hasLabTrack(petition);
  if (!hasLab) return "qc";
  if (!hasQc) return "lab";
  if (!shouldSendItemToQc(item)) return "lab";
  if (!shouldSendItemToLab(item)) return "qc";
  const quantities = (item.labelQuantities ?? []).filter((quantity) => String(quantity ?? "").trim());
  if (quantities.length === 2) {
    const [first, second] = quantities.map(labelAmount);
    const qcIndex = first !== null && second !== null && second < first ? 1 : 0;
    return copyIndex === qcIndex ? "qc" : "lab";
  }
  return copyIndex === 0 ? "qc" : "lab";
}

/** เลขที่ป้ายของฝั่งนั้น เช่น { seq: "P04", year: "69" } — คำขอเก่าที่ยังไม่มีเลข P/L คืน null */
export function sampleLabelSideNumber(
  petition: Pick<Petition, "sampleLabelNumbers">,
  side: SampleLabelSide,
): { seq: string; year: string } | null {
  const numbers = petition.sampleLabelNumbers;
  const seq = numbers?.[side];
  if (!seq || !numbers?.year) return null;
  return { seq, year: String(numbers.year % 100).padStart(2, "0") };
}

/**
 * เลขที่มุมขวาบนของป้ายนำส่งตัวอย่าง จากเลขคำร้อง P-YYMM-NNNN
 * P-2611-0002 → { seq: "2", year: "69" } (ตัด 0 นำหน้า, ปี = 2 หลักท้ายของ พ.ศ. จาก YY ค.ศ.)
 * รูปแบบอื่นคืน null ให้ป้ายคงช่องว่างแบบเดิม
 */
export function sampleLabelDocumentNumber(petitionNo: string | null | undefined): { seq: string; year: string } | null {
  const match = String(petitionNo ?? "").trim().match(/^P-(\d{2})(\d{2})-(\d+)$/i);
  if (!match) return null;
  const seq = String(Number(match[3]));
  const year = String((Number(match[1]) + 43) % 100).padStart(2, "0");
  return { seq, year };
}

export function formatSampleLabelDocumentNumber(petitionNo: string | null | undefined): string {
  const number = sampleLabelDocumentNumber(petitionNo);
  return number ? `${number.seq}/${number.year}` : "";
}

/** ตัดวงเล็บท้ายชื่อ เช่น "นายสมชาย ใจดี (ชาย)" → "นายสมชาย ใจดี" */
function withoutTrailingParenthesis(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/u, "").trim();
}

/** "สุ่มโดย" บนป้าย: QC รายวันที่ฝ่ายผลิตเลือกก่อน แล้ว fallback ของเดิม (ไม่แสดงชื่อเล่นในวงเล็บ) */
export function labelSampledByName(
  petition: Pick<Petition, "sampledBy" | "submittedBy">,
  item?: Pick<Petition["items"][number], "labelSampledBy">,
): string {
  const name = petition.sampledBy?.name?.trim() || petition.submittedBy?.name || item?.labelSampledBy || "";
  return withoutTrailingParenthesis(name);
}

/**
 * "ผู้ผลิต" บนป้าย: ผู้ยื่นจากสายผลิต 1–5 / LDI ใช้ชื่อแผนกตัวเอง ("ผลิต 4", "LDI"),
 * แผนกอื่นใช้ผู้ผลิตของรายการตามเดิม
 */
export function labelManufacturerName(
  petition: Pick<Petition, "submittedBy">,
  item?: Pick<Petition["items"][number], "labelManufacturer">,
): string {
  const dept = String(petition.submittedBy?.department ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const line = dept.match(/(?:ผลิต|prod(?:uction)?)\s*0?([1-5])(?!\d)/);
  if (line) return `ผลิต ${line[1]}`;
  if (/\bldi\b/.test(dept)) return "LDI";
  return item?.labelManufacturer ?? "";
}

/** ผู้นำส่งที่ /scanner: คำร้องที่มี "สุ่มโดย" จากผลิตใช้ชื่อนั้นอัตโนมัติ, คำร้องเก่าคืน null (ให้เลือกเอง) */
export function presetDelivererFor(petition: Pick<Petition, "sampledBy"> | null | undefined): PetitionDeliverer | null {
  const name = petition?.sampledBy?.name?.trim();
  if (!name) return null;
  return petition.sampledBy.employeeId ? { employeeId: petition.sampledBy.employeeId, name } : { name };
}
