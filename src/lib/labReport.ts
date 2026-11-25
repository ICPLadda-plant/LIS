import type { LabRequest } from "@/types/labRequest.types";
import type { Petition, PetitionItem } from "@/types/petition.types";
import type { ApprovalItemGroup } from "@/lib/qcApprovalRows";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { pesticideTestMethod } from "@/lib/pesticideTestMethods";
import { itemSubmissionNoText } from "@/lib/petitionSampler";
import { formatLabResultText } from "@/lib/resultNumberFormat";
import { isPaclobutrazolItem } from "@/lib/paclobutrazolFields";

export interface LabReportRow {
  testItem: string;
  result: string;
  criteria: string;
  method: string;
}

export interface LabReportPage {
  reportNo: string;
  reportDate: string;
  customer: { name: string; company: string; department: string; email: string; phone: string };
  sample: {
    name: string;
    batchNo: string;
    productionDate: string;
    submissionNo: string;
    manufacturer: string;
    sampleNo: string;
    sampleId: string;
    receivedDate: string;
    testedDate: string;
    reportedDate: string;
    condition: string;
  };
  rows: LabReportRow[];
  analystName: string;
  labHeadName: string;
  remark: string;
}

const DASH = "-";
const COMPANY_NAME = "บริษัท ไอ ซี พี ลัดดา จำกัด";
const PHYSICAL_PARAMETER_NAME = "กายภาพ";
const PHYSICAL_DESCRIPTION_LABEL = "ลักษณะ";
const PHYSICAL_COLOR_LABEL = "สี";

function cleanText(value?: string | null): string {
  return value?.trim() || "";
}

export function fullThaiTitle(value?: string | null): string {
  return cleanText(value).replace(/^น\.?\s*ส\.?\s*/, "นางสาว");
}

export function buddhistDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yy}`;
}

// จับคู่ labRequest ต่อ item — ตำแหน่ง sampleSeq ก่อน, batchNo รอง
// หมายเหตุ: ตั้งใจไม่มี `?? labRequests[0]` fallback แบบ ResultReportPrintTemplate.labRequestFor —
// รายงานนี้เป็นรายตัวอย่าง ถ้า item ไม่ match ไม่ควรไปยืมข้อมูลลูกค้าของตัวอย่างอื่นมาใส่
function labRequestForItem(item: PetitionItem, labRequests: LabRequest[]): LabRequest | undefined {
  return (
    labRequests.find((lr) => lr.sampleSeq === item.seq) ??
    labRequests.find((lr) => lr.batchNo === item.batchNo)
  );
}

const HEAD_CRITERIA_LABEL = "เกณฑ์กรม";
// ช่วงผ่านอัตโนมัติ (เกณฑ์ 25%) ใช้ภายในตอนอนุมัติผลเท่านั้น ห้ามพิมพ์ลงใบรายงาน
const AUTO_PASS_CRITERIA_PATTERN = /ผ่าน(?:เกณฑ์)?\s*(?:25\s*%|[\d±])|ฉลาก\s*±/u;

function numericCriteriaParts(text: string): string[] {
  return text
    .split(/\s*(?:·|\|)\s*/u)
    .map((part) =>
      part
        .replace(/[^\d.,+–—<>≤≥=±%\s-]/gu, " ")
        .replace(/\s*([-–—])\s*/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\d+(?:[.,]\d+)?/g, (value) => Number(value.replace(",", ".")).toFixed(2)),
    )
    .filter((part) => /\d/.test(part));
}

function labReportCriteriaText(standardText: string): string {
  const raw = standardText.trim();
  if (!raw) return "";

  // เกณฑ์กรมแสดงได้ตามปกติ แต่ตัดช่วงผ่านอัตโนมัติ (เกณฑ์ 25%) ที่อยู่ก่อนหน้าออก
  const headIndex = raw.lastIndexOf(HEAD_CRITERIA_LABEL);
  if (headIndex >= 0) {
    const headParts = numericCriteriaParts(raw.slice(headIndex + HEAD_CRITERIA_LABEL.length));
    return headParts[0] || DASH;
  }
  if (AUTO_PASS_CRITERIA_PATTERN.test(raw)) return DASH;

  const numericParts = numericCriteriaParts(raw);
  if (!numericParts.length) return raw;
  return numericParts.join(" · ");
}

const AI_CONTENT_PATTERN = /%\s*a\.?i\b|\bai\b|สารออกฤทธิ์|ปริมาณสาร/iu;

// วิธีทดสอบตาม FM-QP-07-01-002: จับจากชื่อสารใน label ก่อน ถ้าเป็นแถวปริมาณสารออกฤทธิ์ค่อยใช้ชื่อสามัญของตัวอย่าง
function methodForRow(label: string, parameterName: string, commonName?: string): string {
  const fromLabel = pesticideTestMethod(label.split(" · ")[0]);
  if (fromLabel) return fromLabel;
  if (AI_CONTENT_PATTERN.test(label) || AI_CONTENT_PATTERN.test(parameterName)) {
    return pesticideTestMethod(commonName) || DASH;
  }
  return DASH;
}

function rowsForItem(group: ApprovalItemGroup | undefined, sampleName?: string): LabReportRow[] {
  if (!group) return [];
  const out: LabReportRow[] = [];
  // PACLOBUTRAZOL ใช้แค่ Sample 1/2 (Internal standard) — ไม่แสดงแถว Sample 3
  const isPbz = isPaclobutrazolItem(sampleName || group.commonName);
  group.params
    .filter((p) => p.scope === "lab" || /ถ\.?\s*พ|density/i.test(p.parameterName))
    .forEach((p) => {
      p.rows.forEach((r) => {
        if (isPbz && /sample\s*3\b/i.test(r.label)) return;
        const unit = r.unit ? ` (${r.unit})` : "";
        out.push({
          testItem: `${r.label}${unit}`,
          result: r.value ? formatLabResultText(r.value) : DASH,
          criteria: r.standardText ? labReportCriteriaText(r.standardText) : DASH,
          method: methodForRow(r.label, p.parameterName, sampleName || group.commonName),
        });
      });
    });
  return mergeDensityAndUnit(out).map((row) => ({ ...row, testItem: sampleName || group.commonName || DASH }));
}

// มี Density จึงรายงาน % W/V; ถ้าไม่มีให้รายงานค่าฐานน้ำหนัก % W/W
function mergeDensityAndUnit(rows: LabReportRow[]): LabReportRow[] {
  const isDensity = (r: LabReportRow) => /ถพ|density/i.test(r.testItem);
  const ai = rows.find((r) => (AI_CONTENT_PATTERN.test(r.testItem) || r.method !== DASH) && !isDensity(r));
  const den = rows.find(isDensity);
  const unit = den?.result && den.result !== DASH ? "% W/V" : "% W/W";
  const out = rows.filter((r) => !(ai && den && r === den));
  if (ai) {
    if (ai.result !== DASH) ai.result += ` ${unit}`;
    if (den && den.result !== DASH) ai.result += `\nDensity : ${Number.isFinite(Number(den.result)) ? Number(den.result).toFixed(3) : den.result}`;
  }
  return out;
}

// shortcut: ข้อมูลติดต่อฮาร์ดโค้ด, ย้ายไปอ่านจากข้อมูลผู้ใช้เมื่อมี API
const CONTACT_FALLBACK: Record<string, { email: string; phone: string }> = {
  "นางอัจฉรา บุญไทย": { email: "achara.b@icpladda.com", phone: "034 305281 ต่อ 124" },
};

const conditionText = (c?: string) =>
  c === "normal" ? "ปกติ" : c === "defective" ? "บกพร่อง" : DASH;

function physicalFieldValue(rows: ApprovalItemGroup["params"][number]["rows"], label: string): string {
  const row = rows.find((fieldRow) => fieldRow.label.split(" · ")[0]?.trim() === label);
  const value = cleanText(row?.value);
  return value && value !== DASH ? value : "";
}

function physicalDescription(group: ApprovalItemGroup | undefined): string {
  for (const parameter of group?.params ?? []) {
    if (parameter.parameterName.trim() !== PHYSICAL_PARAMETER_NAME) continue;
    const description = physicalFieldValue(parameter.rows, PHYSICAL_DESCRIPTION_LABEL);
    const color = physicalFieldValue(parameter.rows, PHYSICAL_COLOR_LABEL);
    const text = [description, color].filter(Boolean).join(" ");
    if (text) return text;
  }
  return "";
}

export function buildLabReportPages(
  petition: Petition,
  labRequests: LabRequest[],
  groups: ApprovalItemGroup[],
): LabReportPage[] {
  const groupBySeq = new Map<number, ApprovalItemGroup>();
  groups.forEach((g) => groupBySeq.set(g.seq, g));

  const reportedDate = buddhistDate(petition.labApprovedAt);
  // ผู้วิเคราะห์: คนที่กดเสร็จ ถ้ายังไม่เสร็จใช้คนที่ได้รับ assign
  const analystName = fullThaiTitle(petition.assignedTo?.name || petition.labCompletedBy) || DASH;
  const labHeadName = fullThaiTitle(petition.labApprovedBy) || DASH;

  return (petition.items ?? []).map((item) => {
    const lr = labRequestForItem(item, labRequests);
    const requester = lr?.requester;
    const group = groupBySeq.get(item.seq);
    const requesterName = cleanText(requester?.fullName) || cleanText(petition.submittedBy?.name) || DASH;
    return {
      reportNo: lr?.labRequestNo || petition.petitionNo,
      reportDate: reportedDate || DASH,
      customer: {
        name: requesterName,
        company: cleanText(lr?.reportCustomerName) || COMPANY_NAME,
        department: requester?.department || petitionDepartmentLabel(petition) || "",
        email: requester?.email || CONTACT_FALLBACK[requesterName]?.email || "",
        phone: requester?.phone || CONTACT_FALLBACK[requesterName]?.phone || "",
      },
      sample: {
        name: item.commonName || item.sampleName || "",
        batchNo: item.batchNo || item.lotNo || "",
        productionDate: buddhistDate(item.productionDate) || "",
        submissionNo: itemSubmissionNoText(petition, item, "lab") || lr?.labRequestNo || petition.petitionNo,
        manufacturer: item.labelManufacturer || item.labelSeller || "",
        sampleNo: /^\d+$/.test(item.sampleId || "")
          ? `${item.sampleId}/${String((petition.sampleLabelNumbers?.year ?? new Date().getFullYear() + 543) % 100).padStart(2, "0")}`
          : item.sampleId || lr?.labRequestNo || "",
        sampleId: item.sampleId || "",
        receivedDate: buddhistDate(petition.labReceivedAt || petition.receivedAt || petition.sampleSentAt) || "",
        testedDate: buddhistDate(petition.firstResultAt || petition.labCompletedAt || petition.updatedAt) || "",
        reportedDate: reportedDate || "",
        condition: physicalDescription(group) || conditionText(item.condition),
      },
      rows: rowsForItem(group, item.commonName || item.sampleName),
      analystName,
      labHeadName,
      remark: petition.conclusionNote || "",
    };
  });
}

/**
 * หน้าที่ควรพิมพ์ในใบรายงานผลการทดสอบ: ตัดตัวอย่างที่ไม่มีรายการทดสอบฝั่ง Lab ออก
 * (เช่น ตัวอย่างที่ส่ง QC อย่างเดียวในคำร้องเดียวกัน) — ผลจาก buildLabReportPages
 * ยังต้องเรียงตาม petition.items สำหรับเอกสารอื่น จึงกรองตอนพิมพ์แทน
 */
export function labReportPagesWithResults(pages: LabReportPage[]): LabReportPage[] {
  return pages.filter((page) => page.rows.length > 0);
}

