import type { LabRequest } from "@/types/labRequest.types";
import type { Petition, PetitionItem } from "@/types/petition.types";
import type { ApprovalItemGroup } from "@/lib/qcApprovalRows";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { pesticideTestMethod } from "@/lib/pesticideTestMethods";

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

function labReportCriteriaText(standardText: string): string {
  const raw = standardText.trim();
  if (!raw) return "";

  const numericParts = raw
    .split(/\s*(?:·|\|)\s*/u)
    .map((part) =>
      part
        .replace(/[^\d.,+–—<>≤≥=±%\s-]/gu, " ")
        .replace(/\s*([-–—])\s*/g, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => /\d/.test(part));

  if (!numericParts.length) return raw;
  if (/เกณฑ์กรม|หัวหน้า/u.test(raw)) {
    return numericParts[numericParts.length - 1];
  }
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

function rowsForItem(group: ApprovalItemGroup | undefined, commonName?: string): LabReportRow[] {
  if (!group) return [];
  const out: LabReportRow[] = [];
  group.params
    .filter((p) => p.scope === "lab")
    .forEach((p) => {
      p.rows.forEach((r) => {
        const unit = r.unit ? ` (${r.unit})` : "";
        out.push({
          testItem: `${r.label}${unit}`,
          result: r.value || DASH,
          criteria: r.standardText ? labReportCriteriaText(r.standardText) : DASH,
          method: methodForRow(r.label, p.parameterName, commonName || group.commonName),
        });
      });
    });
  return out;
}

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
  const analystName = petition.labCompletedBy || DASH;
  const labHeadName = petition.labApprovedBy || DASH;

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
        department: requester?.department || petitionDepartmentLabel(petition) || DASH,
        email: requester?.email || DASH,
        phone: requester?.phone || DASH,
      },
      sample: {
        name: item.commonName || item.sampleName || DASH,
        batchNo: item.batchNo || item.lotNo || DASH,
        productionDate: buddhistDate(item.productionDate) || DASH,
        submissionNo: item.submissionNo || lr?.labRequestNo || petition.petitionNo,
        manufacturer: item.labelManufacturer || item.labelSeller || DASH,
        sampleNo: item.sampleId || lr?.labRequestNo || DASH,
        receivedDate: buddhistDate(petition.labReceivedAt || petition.receivedAt || petition.sampleSentAt) || DASH,
        testedDate: buddhistDate(petition.firstResultAt || petition.labCompletedAt) || DASH,
        reportedDate: reportedDate || DASH,
        condition: physicalDescription(group) || conditionText(item.condition),
      },
      rows: rowsForItem(group, item.commonName),
      analystName,
      labHeadName,
      remark: petition.conclusionNote || "",
    };
  });
}
