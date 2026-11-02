import { commonNameKeys, tradeNameKeys } from "./masterItemFields";

export type RegulatoryType = "GMP" | "BIO" | "LS";

const frontNameKeys = ["item_name1", "itemName", "item_name", "Name", "ITEM_NAME"];
const regulatoryTypeKeys = [
  ...frontNameKeys,
  ...commonNameKeys,
  ...tradeNameKeys,
];
const bioTypeKeys = [
  ...commonNameKeys,
  ...tradeNameKeys,
];

function collectText(item: Record<string, unknown>, keys: string[]) {
  return keys
    .map((key) => item[key])
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ");
}

export function getMasterItemRegulatoryTypes(item: Record<string, unknown>): RegulatoryType[] {
  const source = collectText(item, regulatoryTypeKeys);
  const bioSource = collectText(item, bioTypeKeys);
  const labels: RegulatoryType[] = [];
  if (/ปศุสัตว์|livestock/i.test(source)) labels.push("LS");
  if (/ไบโอ|\bbio\b/i.test(bioSource)) labels.push("BIO");
  if (/อ\s*\.?\s*ย\s*\.|fda|gmp/i.test(source)) labels.push("GMP");
  return labels;
}

export function getMasterItemRegulatoryType(item: Record<string, unknown>): string {
  return getMasterItemRegulatoryTypes(item).join(", ");
}

/** สินค้า อย. (GMP) หรือปศุสัตว์ (LS) ต้องใช้ป้ายนำส่งตัวอย่างแบบมีสัญลักษณ์อันตราย F-LAB-01-10 */
export function requiresHazardSampleLabel(item: { sampleName?: string | null; commonName?: string | null }): boolean {
  const types = getMasterItemRegulatoryTypes({ item_name1: item.sampleName, commonName: item.commonName });
  return types.includes("GMP") || types.includes("LS");
}
