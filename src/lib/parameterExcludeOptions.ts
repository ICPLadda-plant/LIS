import type { ParameterItem } from "./api";
import { parameterMatchesFacets, type ParameterMatchFacets } from "./petitionTestItems";
import { getClassification, getCommonName } from "./productClassification";

export type MasterItemRecord = Record<string, unknown>;

export type ParameterExcludeOptionSet = {
  itemNos: { show: boolean; values: string[] };
  itemNames: { show: boolean; values: string[] };
  fullCommonNames: { show: boolean; values: string[] };
  commonNames: { show: boolean; values: string[] };
  productTypes: { show: boolean; values: string[] };
  categories: { show: boolean; values: string[] };
  subCategories: { show: boolean; values: string[] };
  itemGroups: { show: boolean; values: string[] };
};

const ITEM_NAME_KEYS = ["item_name1", "itemName", "item_name", "name"];
const PRODUCT_TYPE_SOURCE_KEYS = [
  "common_name",
  "commonname",
  "commonName",
  "item_name2",
  "item_name3",
  "item_name1",
  "itemName",
];
const CATEGORY_KEYS = [
  "inventory_posting_group",
  "category",
  "itemGroup",
  "item_group",
  "group",
];
const ITEM_NO_KEYS = ["item_no", "itemNo", "item_code", "itemCode", "code"];
const COMMON_NAME_DIRECT_KEYS = ["common_name", "commonname", "commonName"];

function firstString(item: MasterItemRecord, keys: string[]) {
  for (const k of keys) {
    const v = item[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, ["th", "en"]),
  );
}

function extractItemNoPrefix(itemNo: string): string {
  const cleaned = itemNo.trim();
  if (!cleaned) return "";
  const dashIdx = cleaned.indexOf("-");
  return (dashIdx > 0 ? cleaned.slice(0, dashIdx) : cleaned).toUpperCase();
}

export function getParameterOptionItemNo(item: MasterItemRecord): string {
  return firstString(item, ITEM_NO_KEYS);
}

export function getParameterOptionItemName(item: MasterItemRecord): string {
  return firstString(item, ITEM_NAME_KEYS);
}

export function getParameterOptionFullCommonName(item: MasterItemRecord): string {
  return firstString(item, [...COMMON_NAME_DIRECT_KEYS, "item_name2", "description"]);
}

export function getParameterOptionSubCategory(item: MasterItemRecord): string {
  return extractItemNoPrefix(getParameterOptionItemNo(item));
}

export function getParameterOptionWarehouseCategory(item: MasterItemRecord): "RM" | "FG" | "" {
  const code = getParameterOptionItemNo(item).trim();
  const first = code.charAt(0).toUpperCase();
  if (first === "F") return "FG";
  if (first === "R") return "RM";
  return "";
}

export function getParameterOptionProductType(item: MasterItemRecord): string {
  const source = PRODUCT_TYPE_SOURCE_KEYS
    .map((k) => item[k])
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
    .join(" ");
  return getClassification(source)?.group ?? "";
}

export function getParameterOptionCategory(item: MasterItemRecord): string {
  return getParameterOptionWarehouseCategory(item) || firstString(item, CATEGORY_KEYS);
}

export function getParameterOptionCommonName(item: MasterItemRecord): string {
  for (const key of COMMON_NAME_DIRECT_KEYS) {
    const direct = getCommonName(item[key]);
    if (direct) return direct;
  }
  return getCommonName(getParameterOptionItemName(item));
}

// ข้อเท็จจริงของแถว Master Item ดิบ ในรูปที่ matcher กลางใช้
export function facetsForMasterItem(item: MasterItemRecord, itemGroupIds: string[] = []): ParameterMatchFacets {
  return {
    itemNo: getParameterOptionItemNo(item),
    itemName: getParameterOptionItemName(item),
    fullCommonName: getParameterOptionFullCommonName(item),
    commonName: getParameterOptionCommonName(item),
    productType: getParameterOptionProductType(item),
    subCategory: getParameterOptionSubCategory(item),
    category: getParameterOptionCategory(item),
    itemGroupIds,
  };
}

function itemMatchesIncludeCriteria(
  form: Partial<ParameterItem>,
  item: MasterItemRecord,
  itemGroupIds: string[],
): boolean {
  if (form.applyAll) return true;

  // ใช้กฎ "ใช้กับ" ชุดกลาง (parameterMatchesFacets) แต่ตัดเงื่อนไข "ยกเว้น" ออก —
  // ที่นี่กำลังสร้างตัวเลือกของช่องยกเว้นเอง ถ้าเอาไปกรองด้วยจะกินหางตัวเอง
  const includeOnly: ParameterItem = {
    ...(form as ParameterItem),
    excludeItemNos: [],
    excludeItemNames: [],
    excludeFullCommonNames: [],
    excludeCommonNames: [],
    excludeProductTypes: [],
    excludeCategories: [],
    excludeSubCategories: [],
    excludeItemGroups: [],
  };

  return parameterMatchesFacets(includeOnly, facetsForMasterItem(item, itemGroupIds));
}

function hasIncludeCriteria(form: Partial<ParameterItem>): boolean {
  const hasApplyRules = (form.applyRules ?? []).some(
    (rule) =>
      (rule.itemNos?.length ?? 0) +
        (rule.itemNames?.length ?? 0) +
        (rule.fullCommonNames?.length ?? 0) +
        (rule.commonNames?.length ?? 0) +
        (rule.productTypes?.length ?? 0) +
        (rule.categories?.length ?? 0) +
        (rule.subCategories?.length ?? 0) +
        (rule.itemGroups?.length ?? 0) >
      0,
  );
  return !!form.applyAll || (
      (form.itemNos?.length ?? 0) +
      (form.itemNames?.length ?? 0) +
      (form.fullCommonNames?.length ?? 0) +
      (form.commonNames?.length ?? 0) +
      (form.productTypes?.length ?? 0) +
      (form.categories?.length ?? 0) +
      (form.subCategories?.length ?? 0) +
      (form.itemGroups?.length ?? 0) >
    0 || hasApplyRules
  );
}

function field(values: string[], show: boolean) {
  return { values, show: show && values.length > 0 };
}

export function buildParameterExcludeOptions(args: {
  form: Partial<ParameterItem>;
  masterItems: MasterItemRecord[];
  groupMembership?: Map<string, string[]>;
}): ParameterExcludeOptionSet {
  const { form, masterItems, groupMembership = new Map() } = args;
  const matchedItems = hasIncludeCriteria(form)
    ? masterItems.filter((item) =>
        itemMatchesIncludeCriteria(
          form,
          item,
          groupMembership.get(getParameterOptionItemNo(item)) ?? [],
        ),
      )
    : [];

  const itemNos = uniqueSorted(matchedItems.map(getParameterOptionItemNo));
  const itemNames = uniqueSorted(matchedItems.map(getParameterOptionItemName));
  const fullCommonNames = uniqueSorted(matchedItems.map(getParameterOptionFullCommonName));
  const commonNames = uniqueSorted(matchedItems.map(getParameterOptionCommonName));
  const productTypes = uniqueSorted(matchedItems.map(getParameterOptionProductType));
  const categories = uniqueSorted(matchedItems.map(getParameterOptionCategory));
  const subCategories = uniqueSorted(matchedItems.map(getParameterOptionSubCategory));
  const itemGroups = uniqueSorted(
    matchedItems.flatMap((item) => groupMembership.get(getParameterOptionItemNo(item)) ?? []),
  );

  return {
    itemNos: field(itemNos, itemNos.length > 0),
    itemNames: field(itemNames, itemNames.length > 0),
    fullCommonNames: field(fullCommonNames, fullCommonNames.length > 0),
    commonNames: field(commonNames, (form.commonNames?.length ?? 0) === 0 && commonNames.length > 1),
    productTypes: field(productTypes, (form.productTypes?.length ?? 0) === 0 && productTypes.length > 1),
    categories: field(categories, (form.categories?.length ?? 0) === 0 && categories.length > 1),
    subCategories: field(subCategories, (form.subCategories?.length ?? 0) === 0 && subCategories.length > 1),
    itemGroups: field(itemGroups, (form.itemGroups?.length ?? 0) === 0 && itemGroups.length > 0),
  };
}
