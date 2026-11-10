import type { ParameterItem, ParameterValueField, TimerUnit, SubstanceStandard, StandardCondition, StandardOperator, OptionOutput, LabelToleranceRule } from "./api";
import type { QCTestResult } from "@/types/petition.types";
import { parseSubstances, extractSubstanceName, matchSubstanceKey, substanceFieldKey, parseLabelPercent, productMatchKey } from "./substances";
import { getClassification } from "./productClassification";
import { getMasterItemRegulatoryTypes } from "./masterItemRegulatoryType";

export function isEnumAbnormal(
  field: ParameterValueField,
  value: unknown,
): boolean {
  if (field.type !== "enum") return false;
  if (value === null || value === undefined) return false;
  const str = String(value);
  if (str === "") return false;
  if (field.optionOutputs) {
    return field.optionOutputs[str]?.kind === "abnormal";
  }
  const expected = field.expectedValues ?? [];
  if (expected.length === 0) return false;
  return !expected.includes(str);
}

// Custom text to display when a `text`-kind option is selected (else null).
export function optionOutputText(
  field: ParameterValueField,
  value: unknown,
): string | null {
  if (field.type !== "enum" || !field.optionOutputs) return null;
  if (value === null || value === undefined) return null;
  const str = String(value);
  if (str === "") return null;
  const entry = field.optionOutputs[str];
  return entry?.kind === "text" ? (entry.text ?? "") : null;
}

// The set of "normal/expected" option labels — from optionOutputs when present, else legacy expectedValues.
export function enumNormalValues(field: ParameterValueField): string[] {
  if (field.optionOutputs) {
    return Object.entries(field.optionOutputs)
      .filter(([, o]) => o?.kind === "normal")
      .map(([k]) => k);
  }
  return field.expectedValues ?? [];
}

// Build a full optionOutputs map from a legacy enum field, preserving its abnormal behavior:
// empty expectedValues meant "no detection" → all neutral (text=label); otherwise expected→normal, rest→abnormal.
export function seedOptionOutputsFromLegacy(
  options: string[] | undefined,
  expectedValues: string[] | undefined,
): Record<string, OptionOutput> {
  const opts = options ?? [];
  const expected = expectedValues ?? [];
  const out: Record<string, OptionOutput> = {};
  if (expected.length === 0) {
    for (const opt of opts) out[opt] = { kind: "text", text: opt };
    return out;
  }
  const set = new Set(expected);
  for (const opt of opts) out[opt] = set.has(opt) ? { kind: "normal" } : { kind: "abnormal" };
  return out;
}

export function isNumericAbnormal(
  field: ParameterValueField,
  value: unknown,
): boolean {
  if (field.type !== "number" && field.type !== "float") return false;
  if (!field.standardOperator) return false;
  if (field.standardValue == null) return false;
  if (value === null || value === undefined || value === "") return false;
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return false;

  const v1 = field.standardValue;
  const v2 = field.standardValue2;

  switch (field.standardOperator) {
    case "lt": return num >= v1;
    case "lte": return num > v1;
    case "eq": return num !== v1;
    case "gte": return num < v1;
    case "gt": return num <= v1;
    case "between":
      if (v2 == null) return false;
      return num < v1 || num > v2;
    case "tolerance":
      if (v2 == null || v2 <= 0) return false;
      return Math.abs(num - v1) > Math.abs(v1) * (v2 / 100);
    default:
      return false;
  }
}

export function isFieldAbnormal(
  field: ParameterValueField,
  value: unknown,
): boolean {
  return isEnumAbnormal(field, value) || isNumericAbnormal(field, value);
}

// Normalize a result into a list of per-entry value-objects.
// Non-multiEntry parameters yield a single entry from `values`; multiEntry yields `entries`.
export function getEntryValues(
  result: { values?: Record<string, unknown>; entries?: Record<string, unknown>[] },
  param: { multiEntry?: boolean },
): Record<string, unknown>[] {
  if (param.multiEntry) {
    const e = result.entries;
    return Array.isArray(e) && e.length ? e : [{}];
  }
  return [result.values ?? {}];
}

// Normalize a field's stored value into a list. `multiple` fields hold an array;
// normal fields are wrapped into a single-element list.
export function fieldValueList(
  values: Record<string, unknown>,
  field: ParameterValueField,
): unknown[] {
  if (field.multiple) {
    const v = values[field.label];
    return Array.isArray(v) ? v : [];
  }
  return [values[field.label]];
}

function normalizeCategory(value: unknown): "RM" | "FG" | "" {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "RM" || normalized === "FG" ? normalized : "";
}

function normalizeRegulatoryType(value: unknown): "GMP" | "BIO" | "LS" | "" {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "GMP" || normalized === "BIO" || normalized === "LS" ? normalized : "";
}

function uniqueRegulatoryTypes(values: unknown[]): ("GMP" | "BIO" | "LS")[] {
  const out: ("GMP" | "BIO" | "LS")[] = [];
  for (const value of values) {
    const normalized = normalizeRegulatoryType(value);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function categoryFromDept(value: unknown): "RM" | "FG" | "" {
  const dept = String(value ?? "").trim().toLowerCase();
  if (dept === "rm") return "RM";
  if (dept === "fg") return "FG";
  return normalizeCategory(value);
}

function fullSubstanceKey(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

type SubstanceSelector = { productType?: string; category?: string; regulatoryType?: string; regulatoryTypes?: string[] };

export function findSubstanceStandard(
  field: ParameterValueField,
  substanceName: string,
  selector: SubstanceSelector = {},
): SubstanceStandard | undefined {
  return matchSubstanceStandard(field, substanceName, selector, true);
}

// หาเกณฑ์ที่ตั้งด้วยชื่อสินค้าเต็ม (ตรงตัว หรือเทียบแบบยืดหยุ่นด้วย productMatchKey)
// ไม่ fallback ไปหาเกณฑ์รายสารจากคำแรก — ใช้ก่อนแตกยาผสมเป็นรายสาร
// เช่น ค่า ถพ. ที่วัดจากตัวสินค้าทั้งตัว
export function findWholeProductStandard(
  field: ParameterValueField,
  commonName: string,
  selector: SubstanceSelector = {},
): SubstanceStandard | undefined {
  return matchSubstanceStandard(field, commonName, selector, false);
}

function matchSubstanceStandard(
  field: ParameterValueField,
  substanceName: string,
  selector: SubstanceSelector,
  allowSubstanceFallback: boolean,
): SubstanceStandard | undefined {
  const exactKey = fullSubstanceKey(substanceName);
  const substanceKey = matchSubstanceKey(substanceName);
  if (!exactKey && !substanceKey) return undefined;
  const wantedProductType = String(
    selector.productType || getClassification(substanceName)?.group || "",
  ).trim();
  const wantedCategory = normalizeCategory(selector.category);
  const wantedRegulatoryTypes = uniqueRegulatoryTypes([
    selector.regulatoryType,
    ...(selector.regulatoryTypes ?? []),
    ...getMasterItemRegulatoryTypes({ common_name: substanceName }),
  ]);

  const scoreCandidate = (std: SubstanceStandard): number | null => {
    const productTypes: string[] = (std.productTypes ?? []).filter(Boolean);
    const regulatoryTypes = uniqueRegulatoryTypes(std.regulatoryTypes ?? []);
    const categories: string[] = (std.categories ?? []).map(normalizeCategory).filter(Boolean);
    if (productTypes.length > 0 && (!wantedProductType || !productTypes.includes(wantedProductType))) return null;
    if (
      regulatoryTypes.length > 0 &&
      (wantedRegulatoryTypes.length === 0 || !regulatoryTypes.some((type) => wantedRegulatoryTypes.includes(type)))
    ) return null;
    if (categories.length > 0 && (!wantedCategory || !categories.includes(wantedCategory))) return null;
    return (
      (regulatoryTypes.length > 0 ? 2 : 0) +
      (productTypes.length > 0 ? 2 : 0) +
      (categories.length > 0 ? 2 : 0)
    );
  };

  const pickBest = (standards: SubstanceStandard[]): SubstanceStandard | undefined => {
    let best: { std: SubstanceStandard; score: number } | undefined;
    for (const std of standards) {
      const score = scoreCandidate(std);
      if (score == null) continue;
      if (!best || score > best.score) best = { std, score };
    }
    return best?.std;
  };

  const standards = field.substanceStandards ?? [];
  const exact = pickBest(standards.filter((std) => fullSubstanceKey(std.substance) === exactKey));
  if (exact) return exact;

  const looseKey = productMatchKey(substanceName);
  if (looseKey) {
    const similar = pickBest(standards.filter((std) => productMatchKey(std.substance) === looseKey));
    if (similar) return similar;
  }

  if (!allowSubstanceFallback || !substanceKey) return undefined;
  return pickBest(
    standards.filter((std) =>
      matchSubstanceKey(std.substance) === substanceKey &&
      fullSubstanceKey(std.substance) === matchSubstanceKey(std.substance),
    ),
  );
}

// เช็คผิดปกติของค่ารายสาร โดยสร้าง virtual field แล้ว reuse isNumericAbnormal เดิม
export function isSubstanceAbnormal(
  field: ParameterValueField,
  std: SubstanceStandard | undefined,
  value: unknown,
): boolean {
  if (!std || !std.operator || std.value == null) return false;
  return isNumericAbnormal(
    {
      ...field,
      standardOperator: std.operator,
      standardValue: std.value,
      standardValue2: std.value2 ?? null,
    },
    value,
  );
}

export type RenderFieldUnit = {
  key: string;                 // ใช้เป็นทั้ง React key และ storage key ใน result.values
  field: ParameterValueField;  // อาจเป็น virtual field (ฉีด standard ของสารแล้ว)
  substanceName?: string;      // มีค่าเมื่อเป็น unit รายสาร
  labelTolerance?: { std: LabelToleranceRule | undefined; rawSpec: string };
};

// แตก field เดียวเป็นหลาย render unit เมื่อ substanceMode เปิด.
// non-substance → คืน unit เดียวที่อ้าง field เดิม (key = field.label).
export function expandFieldForItem(
  field: ParameterValueField,
  commonName: string | undefined,
  options: { includeRestrictedStandards?: boolean; productType?: string; category?: string } = {},
): (RenderFieldUnit & { hiddenStandard?: boolean })[] {
  const includeRestrictedStandards = options.includeRestrictedStandards ?? false;
  const isNumeric = field.type === "number" || field.type === "float";
  if (isNumeric && field.labelToleranceMode) {
    const substances = parseSubstances(commonName ?? "");
    if (substances.length === 0 || (substances.length === 1 && !substances[0])) {
      return [{ key: field.label, field }];
    }
    return substances.map((raw) => {
      const name = extractSubstanceName(raw) || raw;
      const productType = (
        options.productType?.trim() ||
        getClassification(raw)?.group ||
        getClassification(commonName ?? "")?.group ||
        ""
      );
      const std = findLabelToleranceStandard(field, raw, productType);
      const vfield: ParameterValueField = {
        ...field,
        label: `${field.label} — ${name}`,
        labelToleranceMode: false,
      };
      return {
        key: substanceFieldKey(field.label, name),
        field: vfield,
        substanceName: name,
        labelTolerance: { std, rawSpec: raw },
      };
    });
  }
  if (!field.substanceMode || !isNumeric) {
    return [{ key: field.label, field }];
  }
  const substances = parseSubstances(commonName ?? "");
  if (substances.length === 0 || (substances.length === 1 && !substances[0])) {
    return [{ key: field.label, field }];
  }
  const buildUnit = (name: string, label: string, std: SubstanceStandard | undefined) => {
    const hiddenStandard = !!(std && (std as { headOnly?: boolean }).headOnly) && !includeRestrictedStandards;
    const vfield: ParameterValueField = {
      ...field,
      label,
      substanceMode: false,
      standardOperator: hiddenStandard ? undefined : std?.operator,
      standardValue: hiddenStandard ? null : (std?.value ?? null),
      standardValue2: hiddenStandard ? null : (std?.value2 ?? null),
    };
    return {
      key: substanceFieldKey(field.label, name),
      field: vfield,
      substanceName: name,
      hiddenStandard,
    };
  };
  // ยาผสมที่มีเกณฑ์ตั้งด้วยชื่อสินค้าเต็ม → ช่องเดียว (ใช้ key ของสารตัวแรก
  // เพื่อให้ค่าที่บันทึกไว้เดิมยังแสดงอยู่)
  if (substances.length > 1) {
    const productType = options.productType?.trim() || getClassification(commonName ?? "")?.group || "";
    const wholeStd = findWholeProductStandard(field, commonName ?? "", { productType, category: options.category });
    if (wholeStd) {
      const firstName = extractSubstanceName(substances[0]) || substances[0];
      return [buildUnit(firstName, field.label, wholeStd)];
    }
  }
  return substances.map((raw) => {
    const name = extractSubstanceName(raw) || raw;
    const productType = (
      options.productType?.trim() ||
      getClassification(raw)?.group ||
      getClassification(commonName ?? "")?.group ||
      ""
    );
    const std = findSubstanceStandard(field, raw || name, { productType, category: options.category });
    return buildUnit(name, `${field.label} — ${name}`, std);
  });
}

export function countAbnormalInResults(
  results: QCTestResult[],
  parameters: ParameterItem[],
): number {
  if (!results?.length || !parameters?.length) return 0;
  const paramById = new Map<string, ParameterItem>();
  for (const p of parameters) {
    if (p._id) paramById.set(String(p._id), p);
  }
  // group entry values per item for cross-parameter conditional ctx (uses entry 0)
  const valuesByItem = new Map<string, Record<string, Record<string, unknown>>>();
  for (const r of results) {
    const param = paramById.get(String(r.parameterId));
    const itemKey = `${r.petitionId}__${r.itemSeq}`;
    let bucket = valuesByItem.get(itemKey);
    if (!bucket) { bucket = {}; valuesByItem.set(itemKey, bucket); }
    bucket[String(r.parameterId)] = getEntryValues(r, param ?? {})[0] ?? {};
  }
  let count = 0;
  for (const r of results) {
    const param = paramById.get(String(r.parameterId));
    if (!param?.valueFields?.length) continue;
    const itemKey = `${r.petitionId}__${r.itemSeq}`;
    for (const values of getEntryValues(r, param)) {
      for (const field of param.valueFields) {
        const isNumeric = field.type === "number" || field.type === "float";
        if (field.substanceMode && isNumeric) {
          const prefix = `${field.label}::`;
          const substances = parseSubstances(r.commonName ?? "");
          const resultMeta = r as QCTestResult & { category?: string; itemCategory?: string; dept?: string };
          const category = resultMeta.category ?? resultMeta.itemCategory ?? categoryFromDept(resultMeta.dept);
          const wholeStd = substances.length > 1
            ? findWholeProductStandard(field, r.commonName ?? "", {
                productType: getClassification(r.commonName ?? "")?.group ?? "",
                category,
              })
            : undefined;
          for (const [vkey, vval] of Object.entries(values)) {
            if (!vkey.startsWith(prefix)) continue;
            const subKey = vkey.slice(prefix.length);
            const raw = substances.find(
              (s) => matchSubstanceKey(extractSubstanceName(s) || s) === subKey,
            ) ?? subKey;
            const productType = getClassification(raw)?.group ?? getClassification(r.commonName ?? "")?.group ?? "";
            const std = wholeStd ?? findSubstanceStandard(field, raw, { productType, category });
            if (isSubstanceAbnormal(field, std, vval)) count += 1;
          }
          continue;
        }
        if (field.labelToleranceMode && isNumeric) {
          const prefix = `${field.label}::`;
          const substances = parseSubstances(r.commonName ?? "");
          for (const [vkey, vval] of Object.entries(values)) {
            if (!vkey.startsWith(prefix)) continue;
            const subKey = vkey.slice(prefix.length);
            const raw = substances.find(
              (s) => matchSubstanceKey(extractSubstanceName(s) || s) === subKey,
            ) ?? "";
            const productType = getClassification(raw)?.group ?? getClassification(r.commonName ?? "")?.group ?? "";
            const std = findLabelToleranceStandard(field, raw, productType);
            if (isLabelToleranceAbnormal(std, raw, vval)) count += 1;
          }
          continue;
        }
        if (field.conditionalMode && field.conditionalResult === "output" && isNumeric) {
          if (isConditionalOutputAbnormal(field, { sameParam: values, otherParams: valuesByItem.get(itemKey) ?? {} })) count += 1;
          continue;
        }
        const vf = field.conditionalMode && isNumeric
          ? resolveFieldStandard(field, { sameParam: values, otherParams: valuesByItem.get(itemKey) ?? {} })
          : field;
        for (const v of fieldValueList(values, field)) {
          if (isFieldAbnormal(vf, v)) count += 1;
        }
      }
    }
  }
  return count;
}

export function timerDurationMs(field: ParameterValueField): number | null {
  if (field.type !== "timer") return null;
  if (!field.timerDurationSec || field.timerDurationSec <= 0) return null;
  return field.timerDurationSec * 1000;
}

export function timerRemainingMs(
  field: ParameterValueField,
  startedAtIso: string | null | undefined,
): number | null {
  const total = timerDurationMs(field);
  if (total == null) return null;
  if (!startedAtIso) return total;
  const startedAt = new Date(startedAtIso).getTime();
  if (Number.isNaN(startedAt)) return null;
  const elapsed = Date.now() - startedAt;
  return Math.max(0, total - elapsed);
}

export function isTimerDone(
  field: ParameterValueField,
  startedAtIso: string | null | undefined,
): boolean {
  if (!startedAtIso) return false;
  const remaining = timerRemainingMs(field, startedAtIso);
  return remaining != null && remaining <= 0;
}

export type TimerParts = {
  months?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
};

const SEC_PER_MINUTE = 60;
const SEC_PER_HOUR = 3600;
const SEC_PER_DAY = 86400;
const SEC_PER_MONTH = 30 * 86400;

export function partsToSec(parts: TimerParts): number {
  return (parts.months ?? 0) * SEC_PER_MONTH
    + (parts.days ?? 0) * SEC_PER_DAY
    + (parts.hours ?? 0) * SEC_PER_HOUR
    + (parts.minutes ?? 0) * SEC_PER_MINUTE
    + (parts.seconds ?? 0);
}

export function secToParts(sec: number, unit: TimerUnit): TimerParts {
  let remaining = Math.max(0, Math.floor(sec));
  const out: TimerParts = {};
  if (unit === "month") {
    out.months = Math.floor(remaining / SEC_PER_MONTH);
    remaining %= SEC_PER_MONTH;
  }
  if (unit === "month" || unit === "day") {
    out.days = Math.floor(remaining / SEC_PER_DAY);
    remaining %= SEC_PER_DAY;
  }
  if (unit === "month" || unit === "day" || unit === "hour") {
    out.hours = Math.floor(remaining / SEC_PER_HOUR);
    remaining %= SEC_PER_HOUR;
  }
  out.minutes = Math.floor(remaining / SEC_PER_MINUTE);
  out.seconds = remaining % SEC_PER_MINUTE;
  return out;
}

export function formatTimerHuman(sec: number): string {
  if (!sec || sec <= 0) return "0 วินาที";
  const total = Math.floor(sec);
  const months = Math.floor(total / SEC_PER_MONTH);
  let r = total % SEC_PER_MONTH;
  const days = Math.floor(r / SEC_PER_DAY);
  r %= SEC_PER_DAY;
  const hours = Math.floor(r / SEC_PER_HOUR);
  r %= SEC_PER_HOUR;
  const minutes = Math.floor(r / SEC_PER_MINUTE);
  const seconds = r % SEC_PER_MINUTE;
  const parts: string[] = [];
  if (months) parts.push(`${months} เดือน`);
  if (days) parts.push(`${days} วัน`);
  if (hours) parts.push(`${hours} ชม`);
  if (minutes) parts.push(`${minutes} นาที`);
  if (seconds) parts.push(`${seconds} วินาที`);
  return parts.join(" ");
}

export type ConditionContext = {
  sameParam: Record<string, unknown>;
  otherParams: Record<string, Record<string, unknown>>;
};

function conditionSourceValue(cond: StandardCondition, ctx: ConditionContext): unknown {
  if (cond.sourceParameterId) {
    return ctx.otherParams[cond.sourceParameterId]?.[cond.sourceFieldLabel];
  }
  return ctx.sameParam[cond.sourceFieldLabel];
}

export type ResolvedStandard = {
  operator: StandardOperator;
  value: number | null;
  value2: number | null;
  matchedRuleLabel?: string;
} | null;

export function resolveStandard(
  field: ParameterValueField,
  ctx: ConditionContext,
): ResolvedStandard {
  if (!field.conditionalMode) {
    if (!field.standardOperator || field.standardValue == null) return null;
    return {
      operator: field.standardOperator,
      value: field.standardValue,
      value2: field.standardValue2 ?? null,
    };
  }
  for (const rule of field.conditionalStandards ?? []) {
    const matched = (rule.conditions ?? []).every((c) => evalCondition(c, ctx));
    if (matched) {
      return {
        operator: rule.operator,
        value: rule.value,
        value2: rule.value2 ?? null,
        matchedRuleLabel: rule.label,
      };
    }
  }
  return null;
}

// คืน virtual field ที่ฉีดเกณฑ์ที่ resolve ได้ลงไป (conditionalMode ปิด)
// เพื่อให้ isFieldAbnormal / describeStandard เดิมทำงานได้ตรงๆ
export function resolveFieldStandard(
  field: ParameterValueField,
  ctx: ConditionContext,
): ParameterValueField {
  if (!field.conditionalMode) return field;
  const r = resolveStandard(field, ctx);
  return {
    ...field,
    conditionalMode: false,
    standardOperator: r?.operator,
    standardValue: r?.value ?? null,
    standardValue2: r?.value2 ?? null,
  };
}

export type ResolvedOutput = {
  text: string;
  kind: "normal" | "abnormal";
  matchedRuleLabel?: string;
};

// โหมด output ของ conditionalMode: ไล่กฎบนลงล่าง เจอกฎแรกที่เข้า → { ข้อความ, สถานะ }.
// ค่า self ยังว่าง → null (ไม่ flag). กรอกแล้วไม่เข้ากฎไหน → abnormal.
export function resolveConditionalOutput(
  field: ParameterValueField,
  ctx: ConditionContext,
): ResolvedOutput | null {
  if (!field.conditionalMode || field.conditionalResult !== "output") return null;
  const selfVal = ctx.sameParam[field.label];
  if (selfVal === null || selfVal === undefined || selfVal === "") return null;
  for (const rule of field.conditionalStandards ?? []) {
    if ((rule.conditions ?? []).every((c) => evalCondition(c, ctx))) {
      return {
        text: (rule.outputText && rule.outputText.trim()) || rule.label || "",
        kind: rule.outputKind ?? "normal",
        matchedRuleLabel: rule.label || undefined,
      };
    }
  }
  return { text: "", kind: "abnormal" };
}

export function isConditionalOutputAbnormal(
  field: ParameterValueField,
  ctx: ConditionContext,
): boolean {
  return resolveConditionalOutput(field, ctx)?.kind === "abnormal";
}

export function evalCondition(cond: StandardCondition, ctx: ConditionContext): boolean {
  const raw = conditionSourceValue(cond, ctx);
  // เจตนา: source ว่าง/ยังไม่กรอก = condition ไม่ผ่าน (รวม ne ด้วย) — กฎจะ activate
  // เฉพาะเมื่อ field ตัวกำหนดถูกกรอกจริง (ตาม spec)
  if (raw === null || raw === undefined || raw === "") return false;
  const target = cond.value;

  switch (cond.op) {
    case "eq":
    case "ne": {
      const targetNum = typeof target === "number" ? target : Number(target);
      const rawNum = Number(raw);
      const numericPair =
        target !== "" && !Number.isNaN(targetNum) && !Number.isNaN(rawNum);
      const equal = numericPair ? rawNum === targetNum : String(raw) === String(target);
      return cond.op === "eq" ? equal : !equal;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "between": {
      const n = Number(raw);
      const t = typeof target === "number" ? target : Number(target);
      if (Number.isNaN(n) || Number.isNaN(t)) return false;
      if (cond.op === "gt") return n > t;
      if (cond.op === "gte") return n >= t;
      if (cond.op === "lt") return n < t;
      if (cond.op === "lte") return n <= t;
      const t2 = cond.value2 == null ? NaN : Number(cond.value2);
      if (Number.isNaN(t2)) return false;
      return n >= t && n <= t2;
    }
    default:
      return false;
  }
}

export type LabelToleranceStatus = "pass" | "review" | "fail" | "none";
export type LabelToleranceResolved = {
  status: LabelToleranceStatus;              // "none" = ข้ามการตรวจ (center null / ค่าว่าง)
  center: number | null;                     // %ฉลากที่แกะได้ (null = ไม่มี % ในชื่อ → ข้าม)
  autoRange: [number, number] | null;        // ช่วงผ่านเอง
  headRange: [number, number] | null;        // ช่วงหัวหน้าอนุมัติ (null = ไม่ได้ตั้ง headPct/headAbs)
};

function normalizeLabelToleranceModes(std: LabelToleranceRule) {
  if ((std.mode ?? "percent") === "range") {
    return { mode: "range" as const, autoMode: null, headMode: null, legacy: false };
  }
  if (std.autoMode || std.headMode) {
    return {
      mode: "split" as const,
      autoMode: (std.autoMode ?? (std.passLow != null || std.passHigh != null ? "range" : "abs")) as "none" | "percent" | "abs" | "range",
      headMode: (std.headMode ?? (std.failLow != null || std.failHigh != null ? "range" : std.headAbs != null || std.headPct != null ? "abs" : null)) as "none" | "percent" | "abs" | "range" | null,
      legacy: false,
    };
  }
  const legacyMode = std.mode ?? "percent";
  return {
    mode: legacyMode,
    autoMode: (legacyMode === "abs" ? "abs" : "percent") as "percent" | "abs",
    headMode: (legacyMode === "abs" ? (std.headAbs != null ? "abs" : null) : (std.headPct != null ? "percent" : null)) as "percent" | "abs" | null,
    legacy: true,
  };
}

export function findLabelToleranceStandard(
  field: ParameterValueField,
  rawSpec: string,
  productType = "",
): LabelToleranceRule | undefined {
  const substanceKey = matchSubstanceKey(rawSpec);
  const labelPercent = parseLabelPercent(rawSpec);
  const wantedProductType = productType.trim();
  let best: { std: LabelToleranceRule; score: number } | null = null;

  for (const std of field.labelToleranceStandards ?? []) {
    const substance = String(std.substance ?? "").trim();
    const stdProductTypes = (std.productTypes ?? []).filter(Boolean);
    const wantsSubstance = substance.length > 0;
    const wantsPercent = std.labelPercent != null;
    const wantsProductType = stdProductTypes.length > 0;

    if (wantsSubstance && matchSubstanceKey(substance) !== substanceKey) continue;
    if (wantsPercent && labelPercent !== std.labelPercent) continue;
    if (wantsProductType && (!wantedProductType || !stdProductTypes.includes(wantedProductType as "water" | "sand" | "powder"))) continue;

    const score =
      (wantsPercent ? 4 : 0) +
      (wantsProductType ? 2 : 0) +
      (wantsSubstance ? 1 : 0);
    if (!best || score > best.score) best = { std, score };
  }

  return best?.std;
}

// ศูนย์กลาง = %ฉลากจาก rawSpec; tolerance = relative % (mode percent) หรือค่าจริง (mode abs) ของ center; 3 ช่วง.
export function resolveLabelTolerance(
  std: LabelToleranceRule | undefined,
  rawSpec: string,
  value: unknown,
): LabelToleranceResolved {
  const center = parseLabelPercent(rawSpec);
  if (!std) {
    return { status: "none", center, autoRange: null, headRange: null };
  }
  const num = typeof value === "number" ? value : Number(value);
  const round = (n: number) => Number(n.toFixed(6));

  const normalized = normalizeLabelToleranceModes(std);
  if (normalized.mode === "range") {
    const autoRange = std.passLow == null || std.passHigh == null ? null : [round(std.passLow), round(std.passHigh)] as [number, number];
    const headRange = std.failLow == null || std.failHigh == null ? null : [round(std.failLow), round(std.failHigh)] as [number, number];
    if (!autoRange || !headRange) {
      return { status: "none", center, autoRange: null, headRange: null };
    }
    if (value === null || value === undefined || value === "" || Number.isNaN(num)) {
      return { status: "none", center, autoRange, headRange };
    }
    let status: LabelToleranceStatus;
    if (num >= autoRange[0] && num <= autoRange[1]) status = "pass";
    else if (num >= headRange[0] && num <= headRange[1]) status = "review";
    else status = "fail";
    return { status, center, autoRange, headRange };
  }

  const explicitRange = (low: number | null | undefined, high: number | null | undefined): [number, number] | null => {
    if (low == null || high == null || low > high) return null;
    return [round(low), round(high)];
  };

  const headAbs = normalized.headMode === "percent"
    ? (std.headPct == null || center == null ? null : Math.abs(center) * (std.headPct / 100))
    : normalized.headMode === "abs"
      ? (center == null ? null : (std.headAbs ?? null))
      : null;
  const headRange: [number, number] | null = normalized.headMode === "range"
    ? explicitRange(std.failLow, std.failHigh)
    : headAbs != null
      ? [round(center - headAbs), round(center + headAbs)]
      : null;
  const insetRangeFromHead = (pct: number | null | undefined): [number, number] | null => {
    if (pct == null || pct <= 0 || center == null || headRange == null) return null;
    if (center < headRange[0] || center > headRange[1]) return null;
    const next: [number, number] = [
      round(headRange[0] + ((center - headRange[0]) * pct / 100)),
      round(headRange[1] - ((headRange[1] - center) * pct / 100)),
    ];
    return next[0] <= next[1] ? next : null;
  };
  const autoAbs = normalized.autoMode === "percent"
    ? normalized.legacy
      ? (std.autoPct == null || center == null ? null : Math.abs(center) * (std.autoPct / 100))
      : null
    : normalized.autoMode === "abs"
      ? (center == null ? null : (std.autoAbs ?? null))
      : null;
  const autoRange: [number, number] | null = normalized.autoMode === "range"
    ? explicitRange(std.passLow, std.passHigh)
    : normalized.autoMode === "percent" && !normalized.legacy
      ? insetRangeFromHead(std.autoPct)
    : autoAbs != null && autoAbs > 0
      ? [round(center - autoAbs), round(center + autoAbs)]
      : null;
  if (!autoRange && normalized.autoMode !== "none") {
    return { status: "none", center, autoRange: null, headRange: null };
  }
  if (!autoRange && !headRange) {
    return { status: "none", center, autoRange: null, headRange: null };
  }
  if (value === null || value === undefined || value === "" || Number.isNaN(num)) {
    return { status: "none", center, autoRange, headRange };
  }
  let status: LabelToleranceStatus;
  if (autoRange && num >= autoRange[0] && num <= autoRange[1]) status = "pass";
  else if (headRange && num >= headRange[0] && num <= headRange[1]) status = "review";
  else status = "fail";
  return { status, center, autoRange, headRange };
}

export function isLabelToleranceAbnormal(
  std: LabelToleranceRule | undefined,
  rawSpec: string,
  value: unknown,
): boolean {
  const s = resolveLabelTolerance(std, rawSpec, value).status;
  return s === "review" || s === "fail";
}
