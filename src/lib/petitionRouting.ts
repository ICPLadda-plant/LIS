import type { Petition } from "@/types/petition.types";

export function isResearchAndDevelopmentDepartment(department: unknown): boolean {
  return String(department ?? "").replace(/\s+/g, "").toLowerCase() === "r&d";
}

export function isQualityControlDepartment(department: unknown): boolean {
  const normalized = String(department ?? "").replace(/\s+/g, "").toLowerCase();
  return normalized === "ควบคุมคุณภาพ" || normalized === "qualitycontrol" || normalized === "qc";
}

export function isResearchAndDevelopmentPetition(petition: Pick<Petition, "submittedBy">): boolean {
  return isResearchAndDevelopmentDepartment(petition.submittedBy?.department);
}

export function isLabBatchNo(batchNo: unknown): boolean {
  return /[16]$/.test(String(batchNo ?? "").trim());
}

export type LabRouteItem = {
  seq?: number;
  sampleName?: string;
  commonName?: string;
  batchNo?: unknown;
  sendToLab?: unknown;
  note?: unknown;
  MF_Before?: unknown;
  MF_Lasted?: unknown;
  MF_GapDays?: unknown;
  MF_BatchAfterGap?: unknown;
  MF_ConsecutivePassCount?: unknown;
};

const RODENTICIDE_PATTERNS = [
  /BROMADIOLONE/i,
  /BRODIFACOUM/i,
  /DIFENACOUM/i,
  /DIFETHIALONE/i,
  /COUMATETRALYL/i,
  /CHLOROPHACINONE/i,
  /FLOCOUMAFEN/i,
  /ZINC\s+PHOSPHIDE/i,
  /RODENTICIDE/i,
  /RAT\s+BAIT/i,
  /ยาหนู/,
  /กำจัดหนู/,
];

export function isMandatoryLabProduct(item: Pick<LabRouteItem, "sampleName" | "commonName"> | null | undefined): boolean {
  const normalized = [item?.sampleName, item?.commonName]
    .map((value) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase())
    .join(" ");
  return normalized.includes("PUBLIC HEALTH") || normalized.includes("LIVE STOCK") || RODENTICIDE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizedDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function mfGapDays(item: Pick<LabRouteItem, "MF_Before" | "MF_Lasted" | "MF_GapDays">): number | null {
  const explicit = numberOrNull(item.MF_GapDays);
  if (explicit !== null) return explicit;
  const before = normalizedDate(item.MF_Before);
  const lasted = normalizedDate(item.MF_Lasted);
  if (!before || !lasted) return null;
  const diff = (Date.parse(`${lasted}T00:00:00Z`) - Date.parse(`${before}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(diff) ? diff : null;
}

export function isMfFiveBatchLabHold(item: Pick<LabRouteItem, "MF_Before" | "MF_Lasted" | "MF_GapDays" | "MF_BatchAfterGap" | "MF_ConsecutivePassCount">): boolean {
  const gap = mfGapDays(item);
  if (gap === null || gap < 30) return false;

  const passCount = numberOrNull(item.MF_ConsecutivePassCount);
  if (passCount !== null && passCount >= 5) return false;

  const batchAfterGap = numberOrNull(item.MF_BatchAfterGap);
  return batchAfterGap === null || batchAfterGap <= 5;
}

export function defaultSendItemToLab(item: Pick<LabRouteItem, "batchNo" | "sampleName" | "commonName" | "MF_Before" | "MF_Lasted" | "MF_GapDays" | "MF_BatchAfterGap" | "MF_ConsecutivePassCount">): boolean {
  return isMandatoryLabProduct(item) || isMfFiveBatchLabHold(item) || isLabBatchNo(item.batchNo);
}

export function shouldSendItemToLab(item: LabRouteItem | null | undefined): boolean {
  if (!item) return false;
  if (isMandatoryLabProduct(item)) return true;
  return typeof item.sendToLab === "boolean" ? item.sendToLab : defaultSendItemToLab(item);
}

export function hasSendToLabOverride(item: LabRouteItem | null | undefined): boolean {
  if (!item || typeof item.sendToLab !== "boolean") return false;
  if (isMandatoryLabProduct(item)) return false;
  return item.sendToLab !== defaultSendItemToLab(item);
}

export function labSendOverrideNoteError(items: LabRouteItem[]): string | null {
  const missing = items.find((item) => hasSendToLabOverride(item) && !String(item.note ?? "").trim());
  if (!missing) return null;
  const label = missing.seq ? `ลำดับ ${missing.seq}` : missing.sampleName || String(missing.batchNo ?? "").trim() || "นี้";
  return `ตัวอย่าง${label}: โปรดระบุเหตุผล`;
}

export function duplicateBatchError(
  items: Pick<LabRouteItem, "batchNo" | "sendToLab">[],
  options: { allowDuplicates?: boolean } = {},
): string | null {
  // Production samples can share a batch, including samples sent to Lab.
  if (options.allowDuplicates) return null;
  const seen = new Set<string>();
  for (const item of items) {
    const key = String(item.batchNo ?? "").trim();
    if (!key) continue;
    if (seen.has(key)) return `พบ batch ซ้ำ: ${key}`;
    seen.add(key);
  }
  return null;
}

export function hasLabTrack(
  petition: Pick<Petition, "submittedBy" | "items" | "routeTargets" | "labReceivedAt" | "labCompletedAt" | "labApprovedAt">,
): boolean {
  if (petition.routeTargets?.length) return petition.routeTargets.includes("lab");
  return Boolean(
    isResearchAndDevelopmentPetition(petition as Petition) ||
      petition.labReceivedAt ||
      petition.labCompletedAt ||
      petition.labApprovedAt ||
      petition.items?.some((item) => shouldSendItemToLab(item)),
  );
}

export function requiresQcTrack(petition: Pick<Petition, "submittedBy" | "routeTargets">): boolean {
  if (petition.routeTargets?.length) return petition.routeTargets.includes("qc");
  return !isResearchAndDevelopmentPetition(petition as Petition);
}

export function isQcAndLabPetition(petition: Pick<Petition, "routeTargets"> | null | undefined): boolean {
  return Boolean(petition?.routeTargets?.includes("qc") && petition.routeTargets.includes("lab"));
}

/**
 * คำร้องส่งทั้ง QC และ LAB: ตัวอย่างเดียวกัน (ชื่อ + batch) ถือเป็นรายการเดียว
 * คำร้องเก่าที่กรอกแยก 2 รายการจะแสดง/กรอกผลเฉพาะรายการแรก
 */
export function mergeQcLabDuplicateItems<T extends { sampleName?: string; commonName?: string; batchNo?: unknown }>(
  petition: Pick<Petition, "routeTargets"> | null | undefined,
  items: T[],
): T[] {
  if (!isQcAndLabPetition(petition)) return items;
  const seen = new Set<string>();
  return items.filter((item) => {
    const batch = String(item.batchNo ?? "").trim().toUpperCase();
    if (!batch) return true;
    const key = [String(item.sampleName ?? item.commonName ?? "").trim().toUpperCase(), batch].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
