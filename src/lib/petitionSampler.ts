import type { Petition, PetitionDeliverer } from "@/types/petition.types";
import { hasLabTrack, requiresQcTrack, shouldSendItemToLab, shouldSendItemToQc } from "@/lib/petitionRouting";
import { normalizeSamplePart } from "@/lib/samplePart";

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

/** กุญแจกลุ่มเลขป้าย batch + ส่วน (mirror server/lib/sampleLabelNumber.js sampleLabelGroupKey) */
type SampleLabelGroupItem = Partial<Pick<Petition["items"][number], "batchNo" | "part">>;

export function sampleLabelGroupKey(item: SampleLabelGroupItem | null | undefined): string {
  const batch = String(item?.batchNo ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return `${batch}|${normalizeSamplePart(item?.part)}`;
}

/**
 * เลขที่ป้ายของฝั่งนั้น เช่น { seq: "P04", year: "69" }
 * ส่ง item มาด้วยเพื่อใช้เลขของกลุ่ม batch + ส่วนของรายการนั้น; คำขอเก่าที่ไม่มีกลุ่มใช้เลขระดับคำขอ
 * คำขอเก่าที่ยังไม่มีเลข P/L คืน null
 */
export function sampleLabelSideNumber(
  petition: Pick<Petition, "sampleLabelNumbers">,
  side: SampleLabelSide,
  item?: SampleLabelGroupItem,
): { seq: string; year: string } | null {
  const numbers = petition.sampleLabelNumbers;
  const group = item ? numbers?.groups?.find((entry) => entry.key === sampleLabelGroupKey(item)) : undefined;
  const seq = group?.[side] || numbers?.[side];
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

/**
 * ช่อง "เลขที่ใบนำส่งตัวอย่าง" ในใบคำขอรับบริการ: ใช้เลขป้ายนำส่ง เช่น P01/69 (ฝั่ง QC ก่อน แล้วฝั่ง LAB)
 * เลข P/L นับต่อเนื่องทั้งปี พ.ศ. ห้ามแปลงจากเลขคำร้อง P-YYMM-NNNN เพราะลำดับนั้นเริ่มใหม่ทุกเดือน
 * ถ้าผู้ใช้กรอกเลขที่ใบนำส่งเองซึ่งไม่ใช่เลขคำร้อง หรือคำขอยังไม่มีเลข P/L ให้แสดงค่าที่บันทึกไว้
 */
export function serviceRequestSubmissionNo(
  petition: Pick<Petition, "petitionNo" | "sampleLabelNumbers">,
  item: Pick<Petition["items"][number], "submissionNo"> & Partial<Pick<Petition["items"][number], "batchNo" | "part">>,
): string {
  const entered = String(item.submissionNo ?? "").trim();
  if (entered && entered !== petition.petitionNo) return entered;
  const group = petition.sampleLabelNumbers?.groups?.find((entry) => entry.key === sampleLabelGroupKey(item));
  const side: SampleLabelSide = group && !group.qc && group.lab ? "lab" : "qc";
  const number = sampleLabelSideNumber(petition, side, item) ?? sampleLabelSideNumber(petition, "lab", item);
  if (number) return `${number.seq}/${number.year}`;
  return entered;
}

/**
 * เลขป้ายนำส่งของรายการนี้ทุกฝั่ง เช่น ["P04/69", "L03/69"] ตามกลุ่ม batch + ส่วน
 * ถ้ามีกลุ่มของรายการ ใช้เฉพาะฝั่งที่กลุ่มนั้นมีเลข (ไม่ดึงเลขระดับคำขอของอีกฝั่งมาปน)
 */
export function itemSampleLabelNumbers(
  petition: Pick<Petition, "sampleLabelNumbers">,
  item: SampleLabelGroupItem,
  sides: SampleLabelSide[] = ["qc", "lab"],
): string[] {
  const numbers = petition.sampleLabelNumbers;
  if (!numbers?.year) return [];
  const year = String(numbers.year % 100).padStart(2, "0");
  const group = numbers.groups?.find((entry) => entry.key === sampleLabelGroupKey(item));
  const source = group ?? numbers;
  return sides.map((side) => source[side]).filter(Boolean).map((seq) => `${seq}/${year}`);
}

/**
 * เลขที่ใบนำส่งสำหรับแสดงบนหน้าจอ/รายงาน: เลขที่ผู้ใช้กรอกเอง (ที่ไม่ใช่เลขคำร้อง) ก่อน
 * แล้วเลขป้าย P/L ของรายการ; preferSide ใช้เลขฝั่งนั้นก่อนถ้ามี เช่นรายงาน LAB ใช้ L
 */
export function itemSubmissionNoText(
  petition: Pick<Petition, "petitionNo" | "sampleLabelNumbers">,
  item: Pick<Petition["items"][number], "submissionNo"> & SampleLabelGroupItem,
  preferSide?: SampleLabelSide,
): string {
  const entered = String(item.submissionNo ?? "").trim();
  if (entered && entered !== petition.petitionNo) return entered;
  if (preferSide) {
    const [preferred] = itemSampleLabelNumbers(petition, item, [preferSide]);
    if (preferred) return preferred;
  }
  const all = itemSampleLabelNumbers(petition, item);
  return all.length ? all.join(", ") : entered;
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
