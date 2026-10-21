import type { ParameterItem, ParameterValueField } from "./api";
import type { PetitionPhase } from "@/types/petition.types";
import { calculatedAiFieldKind } from "./aiCalculation";
import { SG_TEMP_LABEL } from "./densitySync";

export function isPhaseTriggerParameter(
  parameter: Pick<ParameterItem, "_id" | "valueFields">,
  triggerParameterId?: string | null,
): boolean {
  if (triggerParameterId) {
    return String(parameter._id ?? "") === String(triggerParameterId);
  }
  return (parameter.valueFields ?? []).some((field) => field.triggersPhase2);
}

export function visibleFieldsForPhase(
  parameter: ParameterItem,
  phase: PetitionPhase,
  triggerParameterId?: string | null,
): ParameterValueField[] {
  const fields = parameter.valueFields ?? [];

  if (phase === 2 && isPhaseTriggerParameter(parameter, triggerParameterId)) {
    return [];
  }

  if (!parameter.hasPhases) {
    return fields;
  }

  return fields.filter((field) => {
    const fieldPhase = field.phase ?? "both";
    if (fieldPhase === "both") return true;
    return phase === 1 ? fieldPhase === "before" : fieldPhase === "after";
  });
}

// ช่องที่ระบบเติมเอง/ไม่ใช่ค่าตรวจ — ไม่บังคับให้กรอกก่อนเริ่มอบ
const NON_RESULT_FIELD_TYPES = new Set<ParameterValueField["type"]>(["reference", "photo", "file", "timer"]);

const isEmptyValue = (value: unknown): boolean => {
  if (Array.isArray(value)) return !value.some((entry) => !isEmptyValue(entry));
  return value == null || String(value).trim() === "";
};

/**
 * รายการช่อง Phase 1 ที่ยังว่าง ของ parameter ที่ไม่ใช่ตัว trigger (เช่น อบ 14 วัน)
 * ผู้ทดสอบต้องกรอกค่าทั้งหมดก่อนเริ่มอบ เพื่อให้มีค่าก่อนอบไว้เทียบกับค่าตรวจซ้ำ
 * ข้ามช่องที่คำนวณเอง (%AI/ค่าเฉลี่ย/RSD), อุณหภูมิจากเครื่องวัด ถ.พ., reference, รูป, ไฟล์ และ timer
 */
export function missingValuesBeforePhaseTrigger(
  parameters: ParameterItem[],
  valueSetsFor: (parameter: ParameterItem) => Record<string, unknown>[],
  unitsFor: (field: ParameterValueField) => { key: string; field: ParameterValueField }[],
): string[] {
  const missing: string[] = [];
  parameters.forEach((parameter) => {
    if (isPhaseTriggerParameter(parameter, null)) return;
    const fields = visibleFieldsForPhase(parameter, 1, null);
    const isAiParameter = fields.some((field) => calculatedAiFieldKind(field.label) === "ai");
    const valueSets = valueSetsFor(parameter);
    fields.forEach((field) => {
      if (NON_RESULT_FIELD_TYPES.has(field.type)) return;
      if (isAiParameter && calculatedAiFieldKind(field.label)) return;
      if (field.label.trim() === SG_TEMP_LABEL) return;
      unitsFor(field).forEach((unit) => {
        if (valueSets.some((values) => isEmptyValue(values[unit.key]))) {
          missing.push(`${parameter.name} › ${unit.field.label}`);
        }
      });
    });
  });
  return missing;
}

export function phaseTriggerBlockedReason(missing: string[]): string | undefined {
  if (missing.length === 0) return undefined;
  const shown = missing.slice(0, 3).join(", ");
  const rest = missing.length > 3 ? ` และอีก ${missing.length - 3} ช่อง` : "";
  return `กรอกค่าก่อนอบให้ครบก่อนเริ่มจับเวลา: ${shown}${rest}`;
}
