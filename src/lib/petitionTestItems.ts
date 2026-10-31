import type { ParameterApplyRule, ParameterItem, ParameterValueField } from '@/lib/api';
import type { PetitionItem, Petition } from '@/types/petition.types';
import { isResearchAndDevelopmentPetition, shouldSendItemToLab, shouldSendItemToQc } from '@/lib/petitionRouting';
import { getClassification, getCommonName } from '@/lib/productClassification';

function extractItemNoPrefix(itemNo: string | undefined | null): string {
  const cleaned = String(itemNo ?? '').trim();
  if (!cleaned) return '';
  const dashIdx = cleaned.indexOf('-');
  return (dashIdx > 0 ? cleaned.slice(0, dashIdx) : cleaned).toUpperCase();
}

export function getItemProductType(item: PetitionItem): string {
  return (
    getClassification(item.sampleName)?.group ??
    getClassification(item.commonName)?.group ??
    ''
  );
}

// prefix code ของรหัส Master Item (RO-0123 → RO). อ่าน itemNo ก่อน — sampleId เป็น
// key ของ Approval/PhysicalResult ไม่ใช่รหัสสินค้า และคำขอที่สร้างจาก wizard ไม่เคย
// มีค่านี้เลย; เก็บ fallback ไว้ให้ข้อมูลเก่าที่เผลอกรอกรหัสสินค้าลง sampleId
export function getItemSubCategory(item: PetitionItem): string {
  return extractItemNoPrefix(item.itemNo) || extractItemNoPrefix(item.sampleId);
}

export function getItemWarehouseCategory(item: PetitionItem): 'RM' | 'FG' | '' {
  const code = String(item.itemNo ?? '').trim() || String(item.sampleId ?? '').trim();
  const first = code.charAt(0).toUpperCase();
  if (first === 'F') return 'FG';
  if (first === 'R') return 'RM';
  return '';
}

// "หมวดหมู่ย่อย" ครอบคลุมทุก code ที่ขึ้นต้นด้วย prefix ที่เลือก — เลือก RO ได้ ROLS/ROPH
// ด้วย (ตรงกับข้อความกำกับในหน้า Parameter Settings)
function subCategoryMatches(prefixes: string[] | undefined, subCategory: string): boolean {
  if (!subCategory) return false;
  return (prefixes ?? []).some((prefix) => {
    const needle = prefix.trim().toUpperCase();
    return needle !== '' && subCategory.startsWith(needle);
  });
}

export function getPetitionCategory(petition?: Pick<Petition, 'dept'> | null): 'RM' | 'FG' | '' {
  if (petition?.dept === 'rm') return 'RM';
  if (petition?.dept === 'fg' || petition?.dept === 'production') return 'FG';
  return '';
}

export type PetitionCategory = ReturnType<typeof getPetitionCategory>;

// useItemGroupMembership() คืน Map<itemNo, groupId[]> — คีย์ต้องเป็นรหัส Master Item
// ไม่ใช่ sampleId (ซึ่งเป็น key ของ Approval/PhysicalResult และ wizard ไม่เคยเซ็ตให้)
export function itemGroupKey(item?: Pick<PetitionItem, 'itemNo' | 'sampleId'> | null): string {
  return String(item?.itemNo ?? '').trim() || String(item?.sampleId ?? '').trim();
}

function categoryListed(categories: string[] | undefined, category: string): boolean {
  if (!category) return false;
  return (categories ?? []).some((c) => c.trim().toUpperCase() === category);
}

function hasAnyCriteria(criteria: {
  itemNos?: string[];
  itemNames?: string[];
  fullCommonNames?: string[];
  commonNames?: string[];
  productTypes?: string[];
  categories?: string[];
  subCategories?: string[];
  itemGroups?: string[];
}): boolean {
  return (
    (criteria.itemNos?.length ?? 0) +
      (criteria.itemNames?.length ?? 0) +
      (criteria.fullCommonNames?.length ?? 0) +
      (criteria.commonNames?.length ?? 0) +
      (criteria.productTypes?.length ?? 0) +
      (criteria.categories?.length ?? 0) +
      (criteria.subCategories?.length ?? 0) +
      (criteria.itemGroups?.length ?? 0) >
    0
  );
}

// ข้อเท็จจริงของสินค้าหนึ่งชิ้นที่กฎ "ใช้กับ" ต้องใช้ — แยกจากตัวกฎ เพื่อให้ทั้งฝั่ง
// คำขอ (PetitionItem) และหน้า Master Item (แถว master item ดิบ) ใช้กฎชุดเดียวกัน
// ต่างกันแค่วิธีสกัดข้อเท็จจริง
export interface ParameterMatchFacets {
  itemNo?: string;
  itemName?: string;
  fullCommonName?: string;
  commonName?: string;
  productType?: string;
  subCategory?: string;
  itemGroupIds?: string[];
  category?: string;
}

export function facetsForPetitionItem(
  item: PetitionItem,
  itemGroupIds: string[] = [],
  petitionCategory: PetitionCategory = '',
): ParameterMatchFacets {
  return {
    itemNo: item.itemNo,
    itemName: item.sampleName,
    fullCommonName: item.commonName?.trim(),
    commonName: getCommonName(item.commonName) || getCommonName(item.sampleName),
    productType: getItemProductType(item),
    subCategory: getItemSubCategory(item),
    itemGroupIds,
    category: getItemWarehouseCategory(item) || petitionCategory,
  };
}

function productTypeMatches(criteriaTypes: string[] | undefined, productType: string): boolean {
  if (!productType) return false;
  return (criteriaTypes ?? []).some((type) => {
    const normalized = type.trim();
    if (normalized === productType) return true;
    if (normalized === 'liquid') return productType === 'water';
    if (normalized === 'solid') return productType === 'sand' || productType === 'powder';
    return false;
  });
}

function criteriaMatchesFacets(
  criteria: {
    itemNos?: string[];
    itemNames?: string[];
    fullCommonNames?: string[];
    commonNames?: string[];
    productTypes?: string[];
    subCategories?: string[];
    itemGroups?: string[];
  },
  facets: ParameterMatchFacets,
): boolean {
  const itemNo = facets.itemNo?.trim().toUpperCase() ?? '';
  if (itemNo && (criteria.itemNos ?? []).some((n) => n.trim().toUpperCase() === itemNo)) return true;

  const itemName = facets.itemName?.trim() ?? '';
  if (itemName && (criteria.itemNames ?? []).some((n) => n.trim() === itemName)) return true;

  const fullCommonName = facets.fullCommonName?.trim().toUpperCase() ?? '';
  if (fullCommonName && (criteria.fullCommonNames ?? []).some((n) => n.trim().toUpperCase() === fullCommonName)) {
    return true;
  }

  const commonName = (facets.commonName ?? '').trim().toUpperCase();
  if (commonName && (criteria.commonNames ?? []).some((c) => c.trim().toUpperCase() === commonName)) {
    return true;
  }

  const productType = facets.productType ?? '';
  if (productTypeMatches(criteria.productTypes, productType)) return true;

  if (subCategoryMatches(criteria.subCategories, (facets.subCategory ?? '').trim().toUpperCase())) return true;

  const itemGroups = criteria.itemGroups ?? [];
  const itemGroupIds = facets.itemGroupIds ?? [];
  if (itemGroups.length > 0 && itemGroups.some((g) => itemGroupIds.includes(g))) return true;

  return false;
}

function criteriaMatchesEveryFacet(
  criteria: ParameterApplyRule,
  facets: ParameterMatchFacets,
): boolean {
  const category = (facets.category ?? '').trim().toUpperCase();
  const categories = criteria.categories ?? [];
  if (categories.length > 0 && !categoryListed(categories, category)) return false;

  const itemNo = facets.itemNo?.trim().toUpperCase() ?? '';
  const itemNos = criteria.itemNos ?? [];
  if (itemNos.length > 0 && !itemNos.some((n) => n.trim().toUpperCase() === itemNo)) return false;

  const itemName = facets.itemName?.trim() ?? '';
  const itemNames = criteria.itemNames ?? [];
  if (itemNames.length > 0 && !itemNames.some((n) => n.trim() === itemName)) return false;

  const fullCommonName = facets.fullCommonName?.trim().toUpperCase() ?? '';
  const fullCommonNames = criteria.fullCommonNames ?? [];
  if (fullCommonNames.length > 0 && !fullCommonNames.some((n) => n.trim().toUpperCase() === fullCommonName)) {
    return false;
  }

  const commonName = (facets.commonName ?? '').trim().toUpperCase();
  const commonNames = criteria.commonNames ?? [];
  if (commonNames.length > 0 && !commonNames.some((c) => c.trim().toUpperCase() === commonName)) return false;

  const productTypes = criteria.productTypes ?? [];
  if (productTypes.length > 0 && !productTypeMatches(productTypes, facets.productType ?? '')) return false;

  const subCategories = criteria.subCategories ?? [];
  if (subCategories.length > 0 && !subCategoryMatches(subCategories, (facets.subCategory ?? '').trim().toUpperCase())) {
    return false;
  }

  const itemGroups = criteria.itemGroups ?? [];
  const itemGroupIds = facets.itemGroupIds ?? [];
  if (itemGroups.length > 0 && !itemGroups.some((g) => itemGroupIds.includes(g))) return false;

  return true;
}

function normalizedApplyRules(param: ParameterItem): ParameterApplyRule[] {
  return (param.applyRules ?? []).filter((rule) => hasAnyCriteria(rule));
}

// กฎ "ใช้กับ" ข้อเดียวตรงกับ item นี้ไหม — ไม่รวมประตูหมวดหมู่ระดับ parameter และไม่รวมยกเว้น
// ใช้กับตัวแสดงผลลัพธ์ในหน้า Parameter Settings เพื่อนับว่าแต่ละกฎครอบคลุม item ไหนบ้าง
export function applyRuleMatchesFacets(rule: ParameterApplyRule, facets: ParameterMatchFacets): boolean {
  return hasAnyCriteria(rule) && criteriaMatchesEveryFacet(rule, facets);
}

// Returns true when the parameter's "ใช้กับ" criteria fit this petition item.
//
// หมวดหมู่ (คลัง RM/FG) เป็น "ประตู" แบบ AND ไม่ใช่มิติ OR ตัวที่หก.
// คลังได้จาก prefix รหัสสินค้า: F = FG, R = RM; fallback petition.dept มีไว้ให้ข้อมูลเก่า.
//   ตั้ง RM + RO  → รหัสสินค้าขึ้นต้น R และ prefix code ขึ้นต้น RO
//   ตั้ง RM เปล่า → ทุก item ในคลัง RM
// เมื่อผ่านประตูแล้ว applyAll → ผ่านเลย; ที่เหลือเป็น AND ข้ามมิติที่ derive จาก item
// ได้ (itemNo / itemName / commonName / productType / subCategory / itemGroups), OR เฉพาะค่าภายในมิติเดียวกัน
export function parameterMatchesFacets(param: ParameterItem, facets: ParameterMatchFacets): boolean {
  const category = (facets.category ?? '').trim().toUpperCase();

  if (categoryListed(param.excludeCategories, category)) return false;

  const excludeCriteria = {
    itemNos: param.excludeItemNos,
    itemNames: param.excludeItemNames,
    fullCommonNames: param.excludeFullCommonNames,
    commonNames: param.excludeCommonNames,
    productTypes: param.excludeProductTypes,
    subCategories: param.excludeSubCategories,
    itemGroups: param.excludeItemGroups,
  };
  if (hasAnyCriteria(excludeCriteria) && criteriaMatchesFacets(excludeCriteria, facets)) {
    return false;
  }

  const hasCategoryGate = (param.categories ?? []).some((c) => c.trim() !== '');
  if (hasCategoryGate && !categoryListed(param.categories, category)) return false;

  if (param.applyAll) return true;

  const applyRules = normalizedApplyRules(param);
  if (applyRules.length > 0) {
    return applyRules.some((rule) => criteriaMatchesEveryFacet(rule, facets));
  }

  const includeCriteria = {
    itemNos: param.itemNos,
    itemNames: param.itemNames,
    fullCommonNames: param.fullCommonNames,
    commonNames: param.commonNames,
    productTypes: param.productTypes,
    subCategories: param.subCategories,
    itemGroups: param.itemGroups,
  };
  // เลือกแค่หมวดหมู่ ไม่ระบุอะไรต่อ = ทั้งหมวด
  if (!hasAnyCriteria(includeCriteria)) return hasCategoryGate;

  return criteriaMatchesEveryFacet(includeCriteria, facets);
}

export function parameterAppliesToItem(
  param: ParameterItem,
  item: PetitionItem,
  itemGroupIds: string[] = [],
  petitionCategory: PetitionCategory = '',
): boolean {
  return parameterMatchesFacets(param, facetsForPetitionItem(item, itemGroupIds, petitionCategory));
}

export function matchParametersForItem(
  item: PetitionItem,
  params: ParameterItem[],
  itemGroupIds: string[] = [],
  options: { forceLabTrack?: boolean; petitionCategory?: PetitionCategory } = {},
): ParameterItem[] {
  const petitionCategory = options.petitionCategory ?? '';
  // Lab-scope parameters only apply to items actually sent to lab
  // (lab batch = batchNo ending in 1/6). This gate is independent of the
  // param's "ใช้กับ" classification — applyAll must not leak a lab param
  // onto non-lab items. QC params are unaffected.
  const itemIsLab = options.forceLabTrack || shouldSendItemToLab(item);
  // ตัวอย่างที่ฝ่ายผลิตไม่ได้ติ๊กส่ง QC (sendToQc=false) ไม่ต้องมี parameter ฝั่ง QC
  const itemIsQc = shouldSendItemToQc(item);
  const active = params.filter(
    (p) =>
      p.status !== 'inactive' &&
      ((p.scope ?? 'qc') === 'lab' ? itemIsLab : itemIsQc),
  );

  if (!item.testItems) {
    return active.filter((p) => parameterAppliesToItem(p, item, itemGroupIds, petitionCategory));
  }

  const names = item.testItems
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return active.filter(
    (p) =>
      names.includes((p.name ?? '').toLowerCase()) &&
      parameterAppliesToItem(p, item, itemGroupIds, petitionCategory),
  );
}

export function hasAssignableLabParameter(
  petition: Petition,
  params: ParameterItem[],
  membership?: Map<string, string[]>,
): boolean {
  const research = isResearchAndDevelopmentPetition(petition);
  const labItems = (petition.items ?? []).filter((item) => research || shouldSendItemToLab(item));
  return labItems.length > 0 && labItems.every((item) =>
    matchParametersForItem(item, params, membership?.get(itemGroupKey(item)) ?? [], {
      forceLabTrack: research,
      petitionCategory: getPetitionCategory(petition),
    }).some((parameter) => parameter.scope === 'lab'),
  );
}

export function parameterNamesForPetition(
  petition: Petition,
  params: ParameterItem[],
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of petition.items ?? []) {
    for (const p of matchParametersForItem(item, params)) {
      const name = p.name?.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

// Filter enum options based on item's classification.
// option ที่ไม่มี entry ใน optionFilters = แสดงเสมอ (backward-compatible).
// option ที่มี entry แต่ทุกมิติว่าง = แสดงเสมอ.
// option ที่ตั้ง filter ≥ 1 มิติ — OR ข้ามมิติ (เหมือน parameterAppliesToItem).
// Categories (RM/FG) ระดับ option ยังไม่ enforce ที่ runtime — ต่างจากระดับ parameter
// (parameterMatchesFacets) ที่บังคับแล้ว. จะเปิดใช้ต้องส่ง petition category เข้ามาที่นี่ด้วย.
export function visibleEnumOptions(
  field: ParameterValueField,
  item: PetitionItem,
  itemGroupIds: string[] = [],
): string[] {
  const options = field.options ?? [];
  const filters = field.optionFilters;
  if (!filters) return options;

  const itemNo = item.itemNo?.trim().toUpperCase() ?? '';
  const sampleName = item.sampleName?.trim() ?? '';
  const fullCommonName = item.commonName?.trim().toUpperCase() ?? '';
  const itemCommonName = (
    getCommonName(item.commonName) || getCommonName(item.sampleName)
  ).toUpperCase();
  const itemProductType = getItemProductType(item);
  const itemSubCat = getItemSubCategory(item);

  return options.filter((opt) => {
    const f = filters[opt];
    if (!f) return true;
    const itemNos = f.itemNos ?? [];
    const itemNames = f.itemNames ?? [];
    const fullCommonNames = f.fullCommonNames ?? [];
    const commonNames = f.commonNames ?? [];
    const productTypes = f.productTypes ?? [];
    const subCategories = f.subCategories ?? [];
    const itemGroups = f.itemGroups ?? [];
    if (
      itemNos.length === 0 &&
      itemNames.length === 0 &&
      fullCommonNames.length === 0 &&
      commonNames.length === 0 &&
      productTypes.length === 0 &&
      subCategories.length === 0 &&
      itemGroups.length === 0
    ) {
      return true;
    }
    if (itemNo && itemNos.some((n) => n.trim().toUpperCase() === itemNo)) return true;
    if (sampleName && itemNames.some((n) => n.trim() === sampleName)) return true;
    if (fullCommonName && fullCommonNames.some((n) => n.trim().toUpperCase() === fullCommonName)) return true;
    if (
      itemCommonName &&
      commonNames.some((c) => c.toUpperCase() === itemCommonName)
    ) {
      return true;
    }
    if (productTypeMatches(productTypes, itemProductType)) return true;
    if (subCategoryMatches(subCategories, itemSubCat)) return true;
    if (itemGroups.length > 0 && itemGroups.some((gid) => itemGroupIds.includes(gid))) return true;
    return false;
  });
}
