import type { Petition, PetitionItem, PetitionItemApproval } from "@/types/petition.types";
import type { LabReportPage, LabReportRow } from "@/lib/labReport";
import { buddhistDate } from "@/lib/labReport";
import { itemRequiresSide } from "@/lib/itemApprovals";

/** ฟอร์ม F-CHM-01-01 Rev 04 มีช่องตัวอย่าง 7 ช่องต่อหนึ่งใบ */
export const CHEM_REPORT_SAMPLES_PER_SHEET = 7;

export interface ChemReportSample {
  ai: string;
  sg: string;
  batchNo: string;
  productionDate: string;
  testRound: string;
}

export interface ChemReportSheet {
  customer: {
    recipientName: string;
    department: string;
    sampleName: string;
    sampleCount: string;
    submissionNo: string;
    sentDate: string;
    sentTime: string;
    importDate: string;
    batchNo: string;
    testRound: string;
    importedFrom: string;
  };
  lab: {
    sampleNo: string;
    reportDate: string;
    samples: ChemReportSample[];
    criteria: string;
    analystName: string;
    labHeadName: string;
  };
  qc: {
    passBatches: string;
    failBatches: string;
    remark: string;
    qcHeadName: string;
    usableBatches: string;
    unusableBatches: string;
    managerName: string;
    managerDate: string;
  };
}

const AI_PATTERN = /%\s*a\.?i\b|\bai\b|สารออกฤทธิ์|ปริมาณสาร/iu;
const SG_PATTERN = /ถ\.?\s*พ\.?|ความถ่วงจำเพาะ|specific\s*gravity|\bs\.?g\.?\b/iu;

const clean = (value?: string | null) => {
  const text = value?.trim() ?? "";
  return text === "-" ? "" : text;
};

const unique = (values: Array<string | undefined | null>) => [...new Set(values.map((v) => clean(v)).filter(Boolean))];

/**
 * ใบรายงานผลการวิเคราะห์ (F-CHM-01-01) ออกได้เมื่อหัวหน้า QC ออก Final Result แล้ว
 * ซึ่งเกิดเมื่ออนุมัติครบทุกรายการทั้งฝั่ง QC และฝั่ง Lab และต้องมีรายการที่ส่ง Lab
 */
export function canPrintChemAnalysisReport(petition: Petition): boolean {
  if (petition.status !== "approved") return false;
  return (petition.items ?? []).some((item) => itemRequiresSide(petition, item, "lab"));
}

function findRow(rows: LabReportRow[], pattern: RegExp): LabReportRow | undefined {
  return rows.find((row) => pattern.test(row.testItem));
}

function aiRow(rows: LabReportRow[], item: PetitionItem): LabReportRow | undefined {
  const common = clean(item.commonName).toLowerCase();
  return (
    findRow(rows, AI_PATTERN)
    ?? (common ? rows.find((row) => row.testItem.toLowerCase().includes(common)) : undefined)
    ?? rows.find((row) => !SG_PATTERN.test(row.testItem) && /\d/.test(row.result))
  );
}

// ทดสอบครั้งที่ = 1 + จำนวนครั้งที่ Lab ขอตัวอย่างเพิ่มสำหรับรายการนี้
function testRound(petition: Petition, item: PetitionItem): number {
  const retests = (petition.additionalSampleRequests ?? []).filter((request) => (
    request.side === "lab" && request.items.some((entry) => entry.itemSeq === item.seq)
  )).length;
  return 1 + retests;
}

type ItemOutcome = "pass" | "accepted-oos" | "rejected" | "pending";

function approvalsFor(petition: Petition, seq: number): PetitionItemApproval[] {
  return (petition.itemApprovals ?? []).filter((entry) => Number(entry.seq) === Number(seq));
}

// รวมผลอนุมัติทั้ง 2 ฝั่ง: ฝั่งใดไม่อนุมัติ = ไม่อนุมัติ, ฝั่งใดอนุมัตินอกเกณฑ์ = นอกเกณฑ์แต่นำไปใช้ได้
function itemOutcome(petition: Petition, item: PetitionItem): ItemOutcome {
  const entries = approvalsFor(petition, item.seq);
  if (entries.some((entry) => entry.status === "rejected")) return "rejected";
  if (entries.some((entry) => entry.conclusion === "accepted-oos")) return "accepted-oos";
  if (entries.some((entry) => entry.status === "approved")) return "pass";
  if (petition.status === "approved") return petition.conclusion === "accepted-oos" ? "accepted-oos" : "pass";
  return "pending";
}

function latest(entries: PetitionItemApproval[]): PetitionItemApproval | undefined {
  return [...entries]
    .filter((entry) => clean(entry.by))
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))[0];
}

function timeOf(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")} น.`;
}

/**
 * ประกอบข้อมูลฟอร์ม F-CHM-01-01 จากหน้ารายงานผล Lab (เรียงตาม petition.items)
 * ใช้เฉพาะรายการที่ส่ง Lab และแบ่งใบละ 7 ตัวอย่างตามช่องในฟอร์ม
 */
export function buildChemAnalysisSheets(petition: Petition, labPages: LabReportPage[]): ChemReportSheet[] {
  const entries = (petition.items ?? [])
    .map((item, index) => ({ item, page: labPages[index] }))
    .filter((entry): entry is { item: PetitionItem; page: LabReportPage } => (
      Boolean(entry.page?.sample) && itemRequiresSide(petition, entry.item, "lab")
    ));
  if (!entries.length) return [];

  const sheets: ChemReportSheet[] = [];
  for (let start = 0; start < entries.length; start += CHEM_REPORT_SAMPLES_PER_SHEET) {
    const chunk = entries.slice(start, start + CHEM_REPORT_SAMPLES_PER_SHEET);
    const first = chunk[0].page;
    const samples = chunk.map(({ item, page }) => {
      const rows = page.rows ?? [];
      const ai = aiRow(rows, item);
      const sg = findRow(rows, SG_PATTERN);
      return {
        ai: clean(ai?.result),
        sg: clean(item.sgConfirmedValue) || clean(sg?.result),
        batchNo: clean(page.sample.batchNo),
        productionDate: clean(page.sample.productionDate),
        testRound: String(testRound(petition, item)),
        criteria: clean(ai?.criteria),
        outcome: itemOutcome(petition, item),
      };
    });
    const batchesWith = (...outcomes: ItemOutcome[]) => unique(
      samples.filter((sample) => outcomes.includes(sample.outcome)).map((sample) => sample.batchNo),
    ).join(", ");
    const chunkApprovals = chunk.flatMap(({ item }) => approvalsFor(petition, item.seq));
    const qcHead = latest(chunkApprovals.filter((entry) => entry.side === "qc")) ?? latest(chunkApprovals);
    const hasOos = samples.some((sample) => sample.outcome === "accepted-oos" || sample.outcome === "rejected");
    const oosApproval = latest(chunkApprovals.filter((entry) => entry.conclusion === "accepted-oos" || entry.status === "rejected"));
    const remarks = unique([petition.conclusionNote, ...chunkApprovals.map((entry) => entry.note)]);

    sheets.push({
      customer: {
        recipientName: clean(first.customer.name),
        department: clean(first.customer.department),
        sampleName: unique(chunk.map(({ page }) => page.sample.name)).join(", "),
        sampleCount: String(chunk.length),
        submissionNo: unique(chunk.map(({ page }) => page.sample.submissionNo)).join(", "),
        sentDate: buddhistDate(petition.sampleSentAt),
        sentTime: timeOf(petition.sampleSentAt),
        importDate: petition.dept === "rm" ? buddhistDate(petition.receivedAt) : "",
        batchNo: unique(samples.map((sample) => sample.batchNo)).join(", "),
        testRound: unique(samples.map((sample) => sample.testRound)).join(", "),
        importedFrom: unique(chunk.map(({ page }) => page.sample.manufacturer)).join(", "),
      },
      lab: {
        sampleNo: unique(chunk.map(({ page }) => page.sample.sampleNo)).join(", "),
        reportDate: clean(first.reportDate),
        samples: samples.map(({ ai, sg, batchNo, productionDate, testRound: round }) => ({ ai, sg, batchNo, productionDate, testRound: round })),
        criteria: unique(samples.map((sample) => sample.criteria)).join(" · "),
        analystName: clean(first.analystName),
        labHeadName: clean(first.labHeadName),
      },
      qc: {
        passBatches: batchesWith("pass"),
        failBatches: batchesWith("accepted-oos", "rejected"),
        remark: remarks.join(" / "),
        qcHeadName: clean(qcHead?.by),
        usableBatches: batchesWith("accepted-oos"),
        unusableBatches: batchesWith("rejected"),
        managerName: hasOos ? clean(oosApproval?.by) : "",
        managerDate: hasOos ? buddhistDate(oosApproval?.at) : "",
      },
    });
  }
  return sheets;
}

