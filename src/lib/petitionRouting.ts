import type { Petition, PetitionRouteTarget } from "@/types/petition.types";

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
  sendToQc?: unknown;
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

/**
 * รายการที่มี sendToQc เป็น boolean = ฝ่ายผลิตเลือก "ส่งวิเคราะห์" QC / Lab (AI) เองแล้ว
 * ค่า sendToLab ของรายการนั้นเป็นค่าจริง ห้ามกฎ LIS (PUBLIC HEALTH, batch 1/6 ฯลฯ) override
 */
export function hasProductionSendTargets(item: LabRouteItem | null | undefined): boolean {
  return typeof item?.sendToQc === "boolean";
}

export function shouldSendItemToLab(item: LabRouteItem | null | undefined): boolean {
  if (!item) return false;
  if (hasProductionSendTargets(item) && typeof item.sendToLab === "boolean") return item.sendToLab;
  if (isMandatoryLabProduct(item)) return true;
  return typeof item.sendToLab === "boolean" ? item.sendToLab : defaultSendItemToLab(item);
}

/** ตัวอย่างนี้ต้องให้ QC ทดสอบไหม — คำร้องเก่าที่ไม่มี sendToQc ถือว่าส่ง QC */
export function shouldSendItemToQc(item: Pick<LabRouteItem, "sendToQc"> | null | undefined): boolean {
  return Boolean(item) && item.sendToQc !== false;
}

/** รายการฝั่ง QC ของคำร้อง (ตัดตัวอย่างที่ฝ่ายผลิตไม่ได้ติ๊กส่ง QC ออก) */
export function qcSideItems<T extends Pick<LabRouteItem, "sendToQc">>(
  petition: { items?: T[] } | null | undefined,
  items: T[] = petition?.items ?? [],
): T[] {
  return items.filter((item) => shouldSendItemToQc(item));
}

/** ฝ่ายผลิตต้องเลือกส่งวิเคราะห์อย่างน้อย 1 ช่องต่อ batch */
export function sendTargetsRequiredError(items: LabRouteItem[]): string | null {
  const missing = items.find((item) => hasProductionSendTargets(item) && item.sendToQc !== true && item.sendToLab !== true);
  if (!missing) return null;
  const label = missing.seq ? `ลำดับ ${missing.seq}` : missing.sampleName || String(missing.batchNo ?? "").trim() || "นี้";
  return `ตัวอย่าง${label}: กรุณาเลือกส่งวิเคราะห์อย่างน้อย 1 ช่อง (QC หรือ Lab (AI))`;
}

/** ทุกตัวอย่างไม่ส่ง QC → คำร้องไม่มีเส้นทาง QC (คืน null = ใช้เส้นทางตามกฎเดิม) */
export function routeTargetsFromSendTargets(items: LabRouteItem[]): PetitionRouteTarget[] | null {
  if (!items.length || !items.every(hasProductionSendTargets)) return null;
  if (items.some((item) => shouldSendItemToQc(item))) return null;
  return items.some((item) => shouldSendItemToLab(item)) ? ["lab"] : null;
}

export function hasSendToLabOverride(item: LabRouteItem | null | undefined): boolean {
  if (!item || typeof item.sendToLab !== "boolean") return false;
  // ฝ่ายผลิตติ๊กเพิ่ม/เอาออกได้อิสระ ไม่ต้องใส่เหตุผล
  if (hasProductionSendTargets(item)) return false;
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

function sampleAmount(value: unknown): number | null {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

type QcLabSampleItem = {
  sampleName?: string;
  commonName?: string;
  batchNo?: unknown;
  sampleQuantity?: number;
  labelQuantity?: string;
  labelQuantities?: string[];
};

/**
 * เลือกตัวอย่างของฝั่ง QC หรือ LAB สำหรับคำร้องที่ส่งทั้งสองฝั่ง
 * ปริมาณน้อยกว่า = QC, มากกว่า = LAB
 * - คำร้องใหม่: 1 รายการ 2 ตัวอย่าง → คืน 1 ตัวอย่างของฝั่งนั้น
 * - คำร้องเก่า: กรอกแยก 2 รายการ (ชื่อ + batch เดียวกัน) → คืนรายการของฝั่งนั้น
 */
export function pickQcLabSideItems<T extends QcLabSampleItem>(
  petition: Pick<Petition, "submittedBy" | "items" | "routeTargets" | "labReceivedAt" | "labCompletedAt" | "labApprovedAt"> | null | undefined,
  items: T[],
  side: "qc" | "lab",
): T[] {
  if (!petition || !(isQcAndLabPetition(petition) || (requiresQcTrack(petition) && hasLabTrack(petition)))) return items;
  const better = (a: number | null, b: number | null) =>
    a !== null && (b === null || (side === "lab" ? a > b : a < b));
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  items.forEach((item, index) => {
    const batch = String(item.batchNo ?? "").trim().toUpperCase();
    const key = batch ? [String(item.sampleName ?? item.commonName ?? "").trim().toUpperCase(), batch].join("|") : `#${index}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(item);
  });
  return order.map((key) => {
    const group = groups.get(key)!;
    if (group.length > 1) {
      return group.reduce((chosen, item) =>
        better(sampleAmount(item.labelQuantities?.[0] ?? item.labelQuantity), sampleAmount(chosen.labelQuantities?.[0] ?? chosen.labelQuantity)) ? item : chosen);
    }
    const item = group[0];
    const quantities = (item.labelQuantities ?? []).filter((q) => String(q ?? "").trim());
    if (item.sampleQuantity !== 2 || quantities.length !== 2) return item;
    const [a, b] = quantities.map(sampleAmount);
    const pick = better(b, a) ? quantities[1] : quantities[0];
    return { ...item, sampleQuantity: 1, labelQuantity: pick, labelQuantities: [pick] };
  });
}

/**
 * คำร้องส่งทั้ง QC และ LAB: ตัวอย่างเดียวกัน (ชื่อ + batch) ถือเป็นรายการเดียว
 * คำร้องเก่าที่กรอกแยก 2 รายการจะแสดง/กรอกผลเฉพาะรายการแรก
 */
export function mergeQcLabDuplicateItems<T extends { sampleName?: string; commonName?: string; batchNo?: unknown }>(
  petition: Pick<Petition, "submittedBy" | "items" | "routeTargets" | "labReceivedAt" | "labCompletedAt" | "labApprovedAt"> | null | undefined,
  items: T[],
): T[] {
  // คำร้องเก่าอาจไม่มี routeTargets — ดูจากเส้นทางจริงว่าไปทั้ง QC และ LAB
  if (!petition || !(isQcAndLabPetition(petition) || (requiresQcTrack(petition) && hasLabTrack(petition)))) return items;
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
