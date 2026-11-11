import type { ParameterValueField } from "./api";
import { calculatedAiFieldKind, isControlSampleLabel } from "./aiCalculation";
import { expandFieldForItem, type RenderFieldUnit } from "./parameterValidation";
import { extractSubstanceName, matchSubstanceKey, parseSubstances, substanceFieldKey } from "./substances";

type ExpandOptions = Parameters<typeof expandFieldForItem>[2];
export type AiAwareFieldUnit = RenderFieldUnit & { hiddenStandard?: boolean };

export type AiSubstance = { key: string; name: string; raw: string };

// ยาผสม (ชื่อสามัญมี "+") ต้องกรอกชุด %AI แยกต่อสาร; ยาเดี่ยวคืน [] และใช้ชุดเดียวเหมือนเดิม
export function aiSubstancesForItem(commonName: string | undefined): AiSubstance[] {
  const substances = parseSubstances(commonName ?? "");
  if (substances.length < 2) return [];
  return substances.map((raw) => {
    const name = extractSubstanceName(raw) || raw;
    return { key: matchSubstanceKey(name), name, raw };
  });
}

// ช่องในชุด %AI ที่ต้องมีต่อสาร: Area Inj / % Sample / ค่าเฉลี่ย / RSD / Control
export function isAiSetFieldLabel(label: string) {
  const normalized = label.trim();
  const kind = calculatedAiFieldKind(normalized);
  if (kind && kind !== "ai") return true;
  return /^area\s*inj\.?\s*[1-3]$/i.test(normalized) || /^%\s*sample\s*[1-3]$/i.test(normalized) || isControlSampleLabel(normalized);
}

export function isAiParameterFields(fields: ParameterValueField[]) {
  return fields.some((field) => calculatedAiFieldKind(field.label) === "ai");
}

export function stripAiSubstanceSuffix(label: string) {
  return label.replace(/\s+—\s+[^—]+$/, "");
}

/**
 * เหมือน expandFieldForItem แต่ถ้าเป็นพารามิเตอร์ %AI ของยาผสม จะแตกทุกช่องในชุด %AI
 * เป็นรายสาร (key = "<label>::<สาร>") เพื่อให้กรอกและคำนวณได้ครบทั้ง 2 สาร
 */
export function expandAiAwareFieldForItem(
  field: ParameterValueField,
  commonName: string | undefined,
  options: ExpandOptions,
  isAiParameter: boolean,
): AiAwareFieldUnit[] {
  const units = expandFieldForItem(field, commonName, options);
  if (!isAiParameter) return units;
  const substances = aiSubstancesForItem(commonName);
  if (substances.length === 0) return units;
  const isAiResult = calculatedAiFieldKind(field.label) === "ai";
  if (!isAiResult && !isAiSetFieldLabel(field.label)) return units;
  if (isAiResult && units.some((unit) => unit.substanceName !== undefined)) return units;
  return substances.map((substance) => ({
    key: substanceFieldKey(field.label, substance.name),
    field: { ...field, label: field.label + " — " + substance.name },
    substanceName: substance.name,
  }));
}
