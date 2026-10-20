import type { ParameterApplyRule, ParameterItem } from "./api";
import {
  applyRuleMatchesFacets,
  parameterMatchesFacets,
  type ParameterMatchFacets,
} from "./petitionTestItems";
import {
  facetsForMasterItem,
  getParameterOptionItemName,
  getParameterOptionItemNo,
  type MasterItemRecord,
} from "./parameterExcludeOptions";

export type MasterItemFacets = {
  itemNo: string;
  itemName: string;
  facets: ParameterMatchFacets;
};

export type ApplyPreviewRow = {
  itemNo: string;
  itemName: string;
  ruleIndexes: number[];
};

export type ApplyPreview = {
  // item ที่จะเห็น parameter นี้จริง (ผ่านกฎและไม่โดนยกเว้น)
  rows: ApplyPreviewRow[];
  // จำนวน item ที่ตรงแต่ละกฎ ก่อนหักยกเว้น — index ตรงกับ form.applyRules
  ruleCounts: number[];
  excludedCount: number;
  emptyRules: number[];
  unmatchedRules: number[];
  redundantRules: number[];
};

const EXCLUDE_KEYS = [
  "excludeItemNos",
  "excludeItemNames",
  "excludeFullCommonNames",
  "excludeCommonNames",
  "excludeProductTypes",
  "excludeCategories",
  "excludeSubCategories",
  "excludeItemGroups",
] as const satisfies readonly (keyof ParameterItem)[];

function ruleHasValues(rule: ParameterApplyRule): boolean {
  return Object.values(rule).some((values) => Array.isArray(values) && values.some((v) => String(v).trim() !== ""));
}

export function buildMasterItemFacets(
  masterItems: MasterItemRecord[],
  groupMembership: Map<string, string[]> = new Map(),
): MasterItemFacets[] {
  return masterItems
    .map((item) => {
      const itemNo = getParameterOptionItemNo(item);
      return {
        itemNo,
        itemName: getParameterOptionItemName(item),
        facets: facetsForMasterItem(item, groupMembership.get(itemNo) ?? []),
      };
    })
    .filter((entry) => entry.itemNo !== "");
}

// คำนวณว่าฟอร์ม "ใช้กับ" ตอนนี้ครอบคลุม Master Item ไหนบ้าง ด้วย matcher ชุดเดียวกับตอนสร้างคำขอ
export function buildApplyPreview(form: ParameterItem, items: MasterItemFacets[]): ApplyPreview {
  const rules = form.applyRules ?? [];
  const activeRules = rules.map(ruleHasValues);
  const ruleCounts = rules.map(() => 0);
  const soleCounts = rules.map(() => 0);
  const includeOnly: ParameterItem = { ...form };
  for (const key of EXCLUDE_KEYS) includeOnly[key] = [];

  const rows: ApplyPreviewRow[] = [];
  let excludedCount = 0;
  for (const item of items) {
    const ruleIndexes = form.applyAll
      ? []
      : rules.flatMap((rule, index) => (applyRuleMatchesFacets(rule, item.facets) ? [index] : []));
    for (const index of ruleIndexes) ruleCounts[index] += 1;
    if (ruleIndexes.length === 1) soleCounts[ruleIndexes[0]] += 1;

    if (!parameterMatchesFacets(includeOnly, item.facets)) continue;
    if (!parameterMatchesFacets(form, item.facets)) {
      excludedCount += 1;
      continue;
    }
    rows.push({ itemNo: item.itemNo, itemName: item.itemName, ruleIndexes });
  }

  const activeCount = activeRules.filter(Boolean).length;
  const indexesWhere = (test: (index: number) => boolean) =>
    form.applyAll ? [] : rules.flatMap((_, index) => (test(index) ? [index] : []));

  return {
    rows,
    ruleCounts,
    excludedCount,
    emptyRules: indexesWhere((i) => !activeRules[i]),
    unmatchedRules: indexesWhere((i) => activeRules[i] && ruleCounts[i] === 0),
    redundantRules: indexesWhere(
      (i) => activeRules[i] && activeCount > 1 && ruleCounts[i] > 0 && soleCounts[i] === 0,
    ),
  };
}
