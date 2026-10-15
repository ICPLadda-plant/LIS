import type { CoaDocument, CoaResultSnapshot, CoaSampleSnapshot } from "@/types/coa.types";
import { aiToleranceCriteriaForCommonName, isAiContentTestItem } from "@/lib/aiToleranceCriteria";
import { isGrWpSpCommonName } from "@/lib/coaFormulation";
import { formatDate as formatDisplayDate } from "@/lib/dateTime";

export type CoaReportTemplateKind = "standard" | "grWpSp" | "liquid" | "bromadiolone0005";

export type CoaReportSample = CoaSampleSnapshot & {
  rows: CoaResultSnapshot[];
  selectedResultsOnly?: boolean;
  product: string;
  manufacturingDate: string;
  expiredDate: string;
  batchLabel: string;
  aiContentResult: string;
  aiContentCriteria: string;
  densityResult: string;
  waxBlockSizeResult: string;
  dateOfAnalysis: string;
};

export type CoaReportPage = {
  template: CoaReportTemplateKind;
  coaNo: string;
  revision: number;
  issueDate: string;
  petitionNo: string;
  customer: NonNullable<CoaDocument["customerSnapshot"]>;
  samples: CoaReportSample[];
  remark: string;
  approvedBy: string;
  approvedAt: string;
};

function formatDate(iso?: string): string {
  return formatDisplayDate(iso);
}

function formatGregorianDate(value?: string): string {
  if (!value) return "-";
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB");
}

function formatEnglishDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function addYears(value: string | undefined, years: number): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  date.setFullYear(date.getFullYear() + years);
  return formatGregorianDate(date.toISOString());
}

function isLiquidCommonName(commonName?: string): boolean {
  return /\b(SL|EC|EW|SC|ME|ZC)$/i.test(commonName?.trim() ?? "");
}

function normalizeCommonName(commonName?: string): string {
  return commonName?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
}

function isBromadiolone0005CommonName(commonName?: string): boolean {
  return /^BROMADIOLONE\s+0\.005%(?:\s|$)/.test(normalizeCommonName(commonName));
}

function productLabel(sample: CoaSampleSnapshot): string {
  const tradeName = sample.sampleName?.trim();
  const commonName = sample.commonName?.trim();
  if (tradeName && commonName) return `${tradeName} (${commonName})`;
  return tradeName || commonName || "-";
}

function batchLabel(sample: CoaSampleSnapshot): string {
  return [sample.lotNo?.trim(), sample.batchNo?.trim()].filter(Boolean).join(" / ") || "-";
}

function aiContentResult(rows: CoaResultSnapshot[]): string {
  return rows.find((row) => isAiContentTestItem(row.testItem))?.result || "-";
}

function aiContentCriteria(rows: CoaResultSnapshot[], sample: CoaSampleSnapshot): string {
  return rows.find((row) => isAiContentTestItem(row.testItem) && row.criteria && row.criteria !== "-")?.criteria
    || aiToleranceCriteriaForCommonName(sample.commonName)
    || "-";
}

function waxBlockSizeResult(rows: CoaResultSnapshot[]): string {
  return rows.find((row) => /wax\s*block\s*size/i.test(row.testItem ?? ""))?.result || "-";
}

function densityResult(rows: CoaResultSnapshot[]): string {
  return rows.find((row) => /density/i.test(row.testItem ?? ""))?.result || "-";
}

function dateOfAnalysis(rows: CoaResultSnapshot[]): string {
  const row = rows.find((item) => /date\s*of\s*analysis/i.test(item.testItem ?? ""));
  if (!row?.result) return "-";
  const formatted = formatGregorianDate(row.result);
  return formatted === "-" ? row.result : formatted;
}

function templateKindFor(samples: CoaReportSample[]): CoaReportTemplateKind {
  if (samples.some((sample) => isBromadiolone0005CommonName(sample.commonName))) return "bromadiolone0005";
  if (samples.some((sample) => isGrWpSpCommonName(sample.commonName))) return "grWpSp";
  if (samples.some((sample) => isLiquidCommonName(sample.commonName))) return "liquid";
  return "standard";
}

export function buildCoaReportPages(doc: CoaDocument): CoaReportPage[] {
  const rowsBySeq = new Map<number, CoaResultSnapshot[]>();
  for (const row of doc.resultSnapshots || []) {
    const bucket = rowsBySeq.get(row.itemSeq) || [];
    bucket.push(row);
    rowsBySeq.set(row.itemSeq, bucket);
  }
  const samples = (doc.sampleSnapshots || []).map((sample) => {
    const rows = rowsBySeq.get(sample.itemSeq) || [];
    const resolvedAiContentCriteria = aiContentCriteria(rows, sample);
    const rowsWithAiCriteria = rows.map((row) => (
      isAiContentTestItem(row.testItem) && (!row.criteria || row.criteria === "-") && resolvedAiContentCriteria !== "-"
        ? { ...row, criteria: resolvedAiContentCriteria }
        : row
    ));
    return {
      ...sample,
      rows: rowsWithAiCriteria,
      selectedResultsOnly: doc.sourceType === "erpManual" || Boolean(doc.formSelections?.some((selection) => selection.itemSeq === sample.itemSeq && Array.isArray(selection.resultKeys))),
      product: productLabel(sample),
      manufacturingDate: formatGregorianDate(sample.productionDate),
      expiredDate: addYears(sample.productionDate, 2),
      batchLabel: batchLabel(sample),
      aiContentResult: aiContentResult(rows),
      aiContentCriteria: resolvedAiContentCriteria,
      densityResult: densityResult(rows),
      waxBlockSizeResult: waxBlockSizeResult(rows),
      dateOfAnalysis: dateOfAnalysis(rows),
    };
  });
  const sampleGroups = samples.some((sample) => templateKindFor([sample]) !== "standard")
    ? samples.map((sample) => [sample])
    : [samples];
  return sampleGroups.map((group) => {
    const template = templateKindFor(group);
    return {
      template,
      coaNo: doc.coaNo || "-",
      revision: doc.revision || 0,
      issueDate: template === "liquid" ? formatEnglishDate(doc.approval?.approvedAt) : formatDate(doc.approval?.approvedAt),
      petitionNo: doc.petitionNoSnapshot || "-",
      customer: doc.customerSnapshot || {},
      samples: group,
      remark: doc.remark || "",
      approvedBy: doc.approval?.approvedBy?.name || "-",
      approvedAt: formatDate(doc.approval?.approvedAt),
    };
  });
}
