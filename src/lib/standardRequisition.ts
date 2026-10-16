// ตรรกะเบิก Standard: จำนวนน้ำหนัก default ตามเครื่อง + รวม/ตรวจ mg รายน้ำหนัก.

import { standardLabelCodeFromStockUnit } from "./standardLabelCode";
import { withThaiKedmaneeFallbacks } from "./keyboardLayout";
import { getSearchScore } from "./searchRanking";

interface StandardRequisitionSearchStandard {
  code?: string | number | null;
  name?: string | null;
}

interface StandardRequisitionSearchUnit {
  itemCode?: string | number | null;
  itemName?: string | null;
  qrId?: string | null;
  labelCode?: string | null;
  labelRunNo?: string | number | null;
  labelRunYear?: string | number | null;
  lotNo?: string | null;
}

const MG_COMPARISON_EPSILON = 1e-9;

function normalizeSearchText(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("th-TH");
}

function normalizeCompactSearchText(value: unknown): string {
  return normalizeSearchText(value).replace(/[^0-9a-zก-๙]/g, "");
}

function truthySearchParts(parts: Array<string | number | null | undefined>): string[] {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean);
}

/** payload `_user` แนบไปกับ deduct-mg ให้ backend ลง ผู้ดำเนินการ (userMeta อ่าน body._user) */
export function requisitionUser(
  user?: { email?: string; name?: string } | null,
): { email?: string; name?: string } | undefined {
  return user ? { email: user.email, name: user.name } : undefined;
}

/** default จำนวนน้ำหนัก: GC = 3, อื่นๆ (HPLC ฯลฯ) = 1 */
export function defaultWeightCount(group?: string): number {
  return group === "gc" ? 3 : 1;
}

/** ผลรวม mg — ข้ามค่าที่ไม่ใช่ตัวเลข */
export function sumWeights(weights: number[]): number {
  return weights.reduce((s, w) => (Number.isFinite(w) ? s + w : s), 0);
}

/** "" = ผ่าน; ไม่งั้นข้อความ error ภาษาไทย */
export function validateWeights(weights: number[], remainingMg: number): string {
  if (weights.length === 0 || weights.some((w) => !Number.isFinite(w) || w <= 0)) {
    return "กรุณากรอก mg ทุกน้ำหนักให้มากกว่า 0";
  }
  if (remainingMg <= 0 || sumWeights(weights) - remainingMg > MG_COMPARISON_EPSILON) {
    return "mg รวมเกินปริมาณคงเหลือของขวด";
  }
  return "";
}

export function standardRequisitionUnitLabelCode(unit: StandardRequisitionSearchUnit): string {
  return standardLabelCodeFromStockUnit(unit);
}

export function standardRequisitionSearchText(
  standard: StandardRequisitionSearchStandard,
  units: StandardRequisitionSearchUnit[],
): string {
  const unitParts = units.flatMap((unit) => truthySearchParts([
    unit.itemCode,
    unit.itemName,
    unit.qrId,
    unit.lotNo,
    standardRequisitionUnitLabelCode(unit),
  ]));

  return truthySearchParts([standard.code, standard.name, ...unitParts]).join(" ");
}

export function standardMatchesRequisitionSearch(
  standard: StandardRequisitionSearchStandard,
  units: StandardRequisitionSearchUnit[],
  query: string,
): boolean {
  const normalizedQueries = withThaiKedmaneeFallbacks(query)
    .map(normalizeSearchText)
    .filter(Boolean);
  if (normalizedQueries.length === 0) return true;
  const normalizedSearchText = normalizeSearchText(standardRequisitionSearchText(standard, units));
  return normalizedQueries.some((normalizedQuery) => normalizedSearchText.includes(normalizedQuery));
}

export function standardRequisitionSearchScore(
  standard: StandardRequisitionSearchStandard,
  units: StandardRequisitionSearchUnit[],
  query: string,
): number {
  const fields = {
    primary: [standard.code, ...units.flatMap((unit) => [unit.itemCode, ...stockUnitIdentifierTerms(unit)])],
    secondary: [standard.name, ...units.map((unit) => unit.itemName), standardRequisitionSearchText(standard, units)],
  };
  return Math.max(0, ...withThaiKedmaneeFallbacks(query).map((candidate) => getSearchScore(candidate, fields)));
}

function stockUnitIdentifierTerms(unit: StandardRequisitionSearchUnit): string[] {
  return truthySearchParts([
    standardRequisitionUnitLabelCode(unit),
    unit.qrId,
    unit.lotNo,
  ]);
}

export function findStandardBottleBySearch<Unit extends StandardRequisitionSearchUnit>(
  units: Unit[],
  query: string,
): Unit | null {
  const normalizedQueries = withThaiKedmaneeFallbacks(query).map(normalizeSearchText).filter(Boolean);
  const compactQueries = withThaiKedmaneeFallbacks(query).map(normalizeCompactSearchText).filter(Boolean);
  if (normalizedQueries.length === 0) return null;

  const candidates = units.map((unit) => ({
    unit,
    terms: stockUnitIdentifierTerms(unit).map((term) => normalizeSearchText(term)),
    compactTerms: stockUnitIdentifierTerms(unit).map((term) => normalizeCompactSearchText(term)),
  }));

  return candidates.find((candidate) => candidate.terms.some((term) => normalizedQueries.includes(term)))?.unit
    ?? candidates.find((candidate) => candidate.compactTerms.some((term) => compactQueries.includes(term)))?.unit
    ?? null;
}
