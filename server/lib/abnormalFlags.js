const { isEnumAbnormal, isNumericAbnormal, isFieldAbnormal, isLabelToleranceAbnormal } = require('./abnormal');

// mirror of src/lib/parameterValidation.ts getEntryValues / fieldValueList — keep in sync
function getEntryValuesJS(result, param) {
  if (param && param.multiEntry) {
    const e = result.entries;
    return Array.isArray(e) && e.length ? e : [{}];
  }
  return [result.values || {}];
}

function fieldValueListJS(values, field) {
  if (field.multiple) {
    const v = values[field.label];
    return Array.isArray(v) ? v : [];
  }
  return [values[field.label]];
}

// mirror of src/lib/substances.ts matchSubstanceKey: first whitespace token, lowercased
function matchSubstanceKeyJS(name) {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first ? first.toLowerCase() : "";
}

function fullSubstanceKeyJS(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function parseLabelPercentJS(raw) {
  const m = String(raw == null ? "" : raw).match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

const CLASSIFICATION_CODES = [
  ['SG', 'sand'],
  ['ULV', 'water'], ['EC', 'water'], ['EW', 'water'], ['SC', 'water'], ['SL', 'water'], ['ME', 'water'], ['ZC', 'water'], ['W/V', 'water'],
  ['W/W', 'sand'], ['WP', 'powder'], ['WDG', 'powder'], ['WG', 'powder'], ['GR', 'sand'], ['ST', 'sand'], ['GB', 'sand'], ['SP', 'powder'], ['DS', 'powder'], ['DP', 'powder'],
];

const CLASSIFICATION_ALIASES = [
  ['SAND GRANULE', 'SG'],
];

function productTypeFromSpecJS(raw) {
  const upperValue = String(raw || "").trim().toUpperCase();
  for (const [phrase, code] of CLASSIFICATION_ALIASES) {
    const words = phrase.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const pattern = new RegExp(`(^|[^A-Z0-9])${words}([^A-Z0-9]|$)`);
    if (pattern.test(upperValue)) {
      const found = CLASSIFICATION_CODES.find(([c]) => c === code);
      if (found) return found[1];
    }
  }
  for (const [code, group] of CLASSIFICATION_CODES.sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`(^|[^A-Z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`);
    if (pattern.test(upperValue)) return group;
  }
  return "";
}

function normalizeCategoryJS(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "RM" || normalized === "FG" ? normalized : "";
}

function categoryFromDeptJS(value) {
  const dept = String(value || "").trim().toLowerCase();
  if (dept === "rm") return "RM";
  if (dept === "fg") return "FG";
  return normalizeCategoryJS(value);
}

// mirror of src/lib/parameterValidation.ts isSubstanceAbnormal: build a virtual field, reuse isNumericAbnormal
function isSubstanceAbnormalJS(field, std, value) {
  if (!std || !std.operator || std.value == null) return false;
  return isNumericAbnormal(
    { ...field, standardOperator: std.operator, standardValue: std.value, standardValue2: std.value2 ?? null },
    value,
  );
}

function findSubstanceStandardJS(field, rawSpec, productType, category) {
  const exactKey = fullSubstanceKeyJS(rawSpec);
  const subKey = matchSubstanceKeyJS(rawSpec);
  if (!exactKey && !subKey) return undefined;
  const wantedProductType = String(productType || productTypeFromSpecJS(rawSpec) || "").trim();
  const wantedCategory = normalizeCategoryJS(category);

  const scoreCandidate = (std) => {
    const productTypes = Array.isArray(std.productTypes) ? std.productTypes.filter(Boolean) : [];
    const categories = Array.isArray(std.categories) ? std.categories.map(normalizeCategoryJS).filter(Boolean) : [];
    if (productTypes.length > 0 && (!wantedProductType || !productTypes.includes(wantedProductType))) return null;
    if (categories.length > 0 && (!wantedCategory || !categories.includes(wantedCategory))) return null;
    return (productTypes.length > 0 ? 2 : 0) + (categories.length > 0 ? 2 : 0);
  };

  const pickBest = (standards) => {
    let best = null;
    for (const std of standards) {
      const score = scoreCandidate(std);
      if (score == null) continue;
      if (!best || score > best.score) best = { std, score };
    }
    return best ? best.std : undefined;
  };

  const standards = field.substanceStandards || [];
  const exact = pickBest(standards.filter((std) => fullSubstanceKeyJS(std.substance) === exactKey));
  if (exact) return exact;

  return pickBest(
    standards.filter((std) =>
      matchSubstanceKeyJS(std.substance) === subKey &&
      fullSubstanceKeyJS(std.substance) === matchSubstanceKeyJS(std.substance),
    ),
  );
}

function visibleSubstanceStandardJS(field, rawSpec, includeRestricted, productType, category) {
  const std = findSubstanceStandardJS(field, rawSpec, productType, category);
  if (!std) return undefined;
  if (!includeRestricted && std.headOnly) return undefined;
  return std;
}

function findLabelToleranceStandardJS(field, rawSpec, productType) {
  const subKey = matchSubstanceKeyJS(rawSpec);
  const labelPercent = parseLabelPercentJS(rawSpec);
  const wantedProductType = String(productType || "").trim();
  let best = null;
  for (const std of field.labelToleranceStandards || []) {
    const substance = String(std.substance || '').trim();
    const stdProductTypes = Array.isArray(std.productTypes) ? std.productTypes.filter(Boolean) : [];
    const wantsSubstance = substance.length > 0;
    const wantsPercent = std.labelPercent != null;
    const wantsProductType = stdProductTypes.length > 0;
    if (wantsSubstance && matchSubstanceKeyJS(substance) !== subKey) continue;
    if (wantsPercent && labelPercent !== std.labelPercent) continue;
    if (wantsProductType && (!wantedProductType || !stdProductTypes.includes(wantedProductType))) continue;
    const score = (wantsPercent ? 4 : 0) + (wantsProductType ? 2 : 0) + (wantsSubstance ? 1 : 0);
    if (!best || score > best.score) best = { std, score };
  }
  return best ? best.std : undefined;
}
// รวม rawSpec (มี %) จาก commonName โดย split "+" แล้ว match ด้วย first-token key
function rawSpecForSubKey(commonName, subKey) {
  const parts = String(commonName || "").split("+").map((s) => s.trim()).filter(Boolean);
  return parts.find((p) => matchSubstanceKeyJS(p) === subKey) || "";
}

// mirror of src/lib/parameterValidation.ts evalCondition / resolveStandard — keep in sync
function conditionSourceValueJS(cond, ctx) {
  if (cond.sourceParameterId) {
    return (ctx.otherParams[String(cond.sourceParameterId)] || {})[cond.sourceFieldLabel];
  }
  return ctx.sameParam[cond.sourceFieldLabel];
}

function evalConditionJS(cond, ctx) {
  const raw = conditionSourceValueJS(cond, ctx);
  if (raw === null || raw === undefined || raw === "") return false;
  const target = cond.value;
  if (cond.op === "eq" || cond.op === "ne") {
    const tNum = typeof target === "number" ? target : Number(target);
    const rNum = Number(raw);
    const numericPair = target !== "" && !Number.isNaN(tNum) && !Number.isNaN(rNum);
    const equal = numericPair ? rNum === tNum : String(raw) === String(target);
    return cond.op === "eq" ? equal : !equal;
  }
  const n = Number(raw);
  const t = typeof target === "number" ? target : Number(target);
  if (Number.isNaN(n) || Number.isNaN(t)) return false;
  if (cond.op === "gt") return n > t;
  if (cond.op === "gte") return n >= t;
  if (cond.op === "lt") return n < t;
  if (cond.op === "lte") return n <= t;
  if (cond.op === "between") {
    const t2 = cond.value2 == null ? NaN : Number(cond.value2);
    if (Number.isNaN(t2)) return false;
    return n >= t && n <= t2;
  }
  return false;
}

function resolveFieldStandardJS(field, ctx) {
  if (!field.conditionalMode) return field;
  for (const rule of field.conditionalStandards || []) {
    const matched = (rule.conditions || []).every((c) => evalConditionJS(c, ctx));
    if (matched) {
      return { ...field, conditionalMode: false, standardOperator: rule.operator, standardValue: rule.value, standardValue2: rule.value2 == null ? null : rule.value2 };
    }
  }
  return { ...field, conditionalMode: false, standardOperator: undefined, standardValue: null, standardValue2: null };
}

// mirror of src/lib/parameterValidation.ts resolveConditionalOutput — keep in sync
function resolveConditionalOutputJS(field, ctx) {
  if (!field.conditionalMode || field.conditionalResult !== "output") return null;
  const selfVal = ctx.sameParam[field.label];
  if (selfVal === null || selfVal === undefined || selfVal === "") return null;
  for (const rule of field.conditionalStandards || []) {
    if ((rule.conditions || []).every((c) => evalConditionJS(c, ctx))) {
      return {
        text: (rule.outputText && String(rule.outputText).trim()) || rule.label || "",
        kind: rule.outputKind || "normal",
      };
    }
  }
  return { text: "", kind: "abnormal" };
}

/**
 * docs:      QCTestResult[]  (lean; ต้องมี petitionId, parameterId, itemSeq, commonName, values, entries)
 * params:    Parameter[]     (lean; ต้องมี _id, valueFields, multiEntry)
 * petitions: Petition[]      (lean; ต้องมี _id, dept, items[].seq)
 * คืน map petitionId → boolean (true = มีอย่างน้อยหนึ่ง field ผิดปกติ)
 */
function computeAbnormalFlags({ docs, params, petitions, includeRestricted = false }) {
  const paramById = new Map((params || []).map((p) => [String(p._id), p]));

  const categoryByItem = {};
  for (const petition of petitions || []) {
    const category = categoryFromDeptJS(petition.dept);
    for (const item of petition.items || []) {
      categoryByItem[`${String(petition._id)}__${item.seq}`] = category;
    }
  }

  // แยก context ข้าม parameter ตาม phase — ค่าตรวจซ้ำ (Phase 2) ต้องเทียบกับค่า Phase 2 ด้วยกัน
  const valuesByItem = {};
  const valuesByItemPhase2 = {};
  for (const d of docs || []) {
    const key = `${d.petitionId}__${d.itemSeq}`;
    if (!valuesByItem[key]) valuesByItem[key] = {};
    if (!valuesByItemPhase2[key]) valuesByItemPhase2[key] = {};
    const param = paramById.get(String(d.parameterId));
    valuesByItem[key][String(d.parameterId)] = getEntryValuesJS(d, param || {})[0] || {};
    valuesByItemPhase2[key][String(d.parameterId)] = d.valuesPhase2 || {};
  }

  const map = {};
  for (const petition of petitions || []) map[String(petition._id)] = false;

  for (const d of docs || []) {
    if (map[d.petitionId]) continue;
    const param = paramById.get(String(d.parameterId));
    if (!param?.valueFields?.length) continue;
    const itemKey = `${d.petitionId}__${d.itemSeq}`;
    // Phase 1 = values/entries; Phase 2 = valuesPhase2 ของ parameter เดิม (รอบตรวจซ้ำหลัง trigger เช่น อบ 14 วัน)
    const fieldsFor = (phase) => param.valueFields.filter((field) => {
      if (!param.hasPhases) return true;
      const fieldPhase = field.phase || 'both';
      return fieldPhase === 'both' || fieldPhase === (phase === 1 ? 'before' : 'after');
    });
    const phase2Values = d.valuesPhase2 && Object.keys(d.valuesPhase2).length ? [d.valuesPhase2] : [];
    const passes = [
      { valueSets: getEntryValuesJS(d, param), fields: fieldsFor(1), ctxBucket: valuesByItem[itemKey] || {} },
      { valueSets: phase2Values, fields: fieldsFor(2), ctxBucket: valuesByItemPhase2[itemKey] || {} },
    ];
    let flagged = false;
    for (const { valueSets, fields, ctxBucket } of passes) {
      for (const values of valueSets) {
        for (const field of fields) {
          const isNumeric = field.type === 'number' || field.type === 'float';
          if (field.substanceMode && isNumeric) {
            const prefix = `${field.label}::`;
            for (const [vkey, vval] of Object.entries(values)) {
              if (!vkey.startsWith(prefix)) continue;
              const subKey = vkey.slice(prefix.length);
              const raw = rawSpecForSubKey(d.commonName, subKey) || subKey;
              const productType = productTypeFromSpecJS(raw) || productTypeFromSpecJS(d.commonName);
              const category = categoryByItem[`${d.petitionId}__${d.itemSeq}`] || '';
              const std = visibleSubstanceStandardJS(field, raw, includeRestricted, productType, category);
              if (isSubstanceAbnormalJS(field, std, vval)) { flagged = true; break; }
            }
            if (flagged) break;
            continue;
          }
          if (field.labelToleranceMode && isNumeric) {
            const prefix = `${field.label}::`;
            for (const [vkey, vval] of Object.entries(values)) {
              if (!vkey.startsWith(prefix)) continue;
              const subKey = vkey.slice(prefix.length);
              const raw = rawSpecForSubKey(d.commonName, subKey);
              const productType = productTypeFromSpecJS(raw) || productTypeFromSpecJS(d.commonName);
              const std = findLabelToleranceStandardJS(field, raw, productType);
              if (isLabelToleranceAbnormal(std, raw, vval)) { flagged = true; break; }
            }
            if (flagged) break;
            continue;
          }
          if (field.conditionalMode && field.conditionalResult === 'output' && isNumeric) {
            const out = resolveConditionalOutputJS(field, { sameParam: values, otherParams: ctxBucket });
            if (out && out.kind === 'abnormal') { flagged = true; break; }
            continue;
          }
          const vf = field.conditionalMode && isNumeric
            ? resolveFieldStandardJS(field, { sameParam: values, otherParams: ctxBucket })
            : field;
          for (const v of fieldValueListJS(values, field)) {
            if (isFieldAbnormal(vf, v)) { flagged = true; break; }
          }
          if (flagged) break;
        }
        if (flagged) break;
      }
      if (flagged) break;
    }
    if (flagged) map[d.petitionId] = true;
  }

  return map;
}

/**
 * รับ map ที่ computeAbnormalFlags คำนวณแล้ว + รายการ petitionId ที่ผู้เรียก request มา
 * คืน map ใหม่ที่มีทุก id ที่ request มาเป็น key แน่นอน (ของเดิมไม่ถูกแตะ, ที่ขาดเติม false)
 * รับประกัน contract ของ GET /qc-results/abnormal-flags ว่าทุก id ที่ถามจะมี key ในผลลัพธ์เสมอ
 */
function ensureRequestedIdsPresent(map, ids) {
  const result = { ...map };
  for (const id of ids || []) {
    if (!(id in result)) result[id] = false;
  }
  return result;
}

module.exports = {
  computeAbnormalFlags,
  ensureRequestedIdsPresent,
  getEntryValuesJS,
  fieldValueListJS,
  categoryFromDeptJS,
  productTypeFromSpecJS,
  rawSpecForSubKey,
  visibleSubstanceStandardJS,
  isSubstanceAbnormalJS,
  findLabelToleranceStandardJS,
  resolveFieldStandardJS,
  resolveConditionalOutputJS,
};
