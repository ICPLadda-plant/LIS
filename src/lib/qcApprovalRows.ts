import type { ParameterItem } from "@/lib/api";
import type { Petition, PetitionItem, QCTestResult } from "@/types/petition.types";
import { getPetitionCategory, itemGroupKey, matchParametersForItem } from "@/lib/petitionTestItems";
import {
  expandFieldForItem,
  fieldValueList,
  getEntryValues,
  isFieldAbnormal,
  resolveConditionalOutput,
  resolveFieldStandard,
  resolveLabelTolerance,
  resolveStandard,
  type ConditionContext,
} from "@/lib/parameterValidation";
import { describeResolvedStandard, describeStandard, formatLabelToleranceRange } from "@/lib/standardOperators";
import { calculatedAiFieldKind } from "@/lib/aiCalculation";
import { sampleRoundFor } from "@/lib/additionalSamples";
import { isPhaseTriggerParameter, visibleFieldsForPhase } from "@/lib/phaseRetest";

// ต่อท้ายชื่อแถวผลรอบตรวจซ้ำ เพื่อให้หน้าออกผลและรายงานแยกค่าก่อน/หลัง trigger (เช่น อบ 14 วัน) ได้
export const PHASE2_ROW_SUFFIX = "ตรวจซ้ำ Phase 2";

export interface ApprovalFieldRow {
  key: string;
  label: string;
  unit?: string;
  value: string;
  standardText: string;
  abnormal: boolean;
  note: string;
  phase: 1 | 2;
}

export interface ApprovalParamGroup {
  parameterId: string;
  parameterName: string;
  scope: "lab" | "qc";
  hasPhases: boolean;
  rows: ApprovalFieldRow[];
}

export interface ApprovalItemGroup {
  seq: number;
  sampleName: string;
  batchNo?: string;
  sampleId?: string;
  commonName?: string;
  params: ApprovalParamGroup[];
  unmatched: boolean;
}

const resultKey = (itemSeq: number, parameterId: string) => `${itemSeq}__${parameterId}`;
const noteLabelFor = (unitKey: string) => `${unitKey}__note`;

const asStr = (v: unknown) => (v == null ? "" : String(v));

const AI_APPROVAL_ROW_ORDER = [
  "area inj.1",
  "area inj.2",
  "area inj.3",
  "area average",
  "area %rsd",
  "% sample 1",
  "% sample 2",
  "% sample 3",
  "% sample average",
  "% sample %rsd",
] as const;

const aiApprovalRowRank = (label: string) => {
  const normalized = label.split(" · ")[0].trim().toLowerCase();
  const rank = AI_APPROVAL_ROW_ORDER.indexOf(normalized as (typeof AI_APPROVAL_ROW_ORDER)[number]);
  if (rank >= 0) return rank;
  return calculatedAiFieldKind(normalized) === "ai"
    ? AI_APPROVAL_ROW_ORDER.length
    : AI_APPROVAL_ROW_ORDER.length + 1;
};

/**
 * แปลง petition + parameters (scope qc) + ผลที่บันทึก → โครงสร้างแถวสรุปแบบ read-only
 * สำหรับหน้าออกผล. คงตรรกะ match/expand/abnormal/conditional ให้ตรงกับหน้ากรอกผล.
 */
export function buildApprovalGroups(
  petition: Petition,
  parameters: ParameterItem[],
  results: QCTestResult[],
  groupMembership: Map<string, string[]>,
  options?: {
    includeRestrictedStandards?: boolean;
    showAutoPassRange?: boolean;
    includeResultOnlyFields?: boolean;
  },
): ApprovalItemGroup[] {
  const includeRestrictedStandards = options?.includeRestrictedStandards ?? false;
  const showAutoPassRange = options?.showAutoPassRange ?? true;
  const petitionCategory = getPetitionCategory(petition);
  // Cross-parameter conditional context uses each result's primary (entry-0) values.
  const v1: Record<string, Record<string, unknown>> = {};
  const v2: Record<string, Record<string, unknown>> = {};
  // Full result by key — lets us iterate multiEntry `entries` for the current param.
  const resultByKey: Record<string, QCTestResult> = {};
  results.forEach((r) => {
    const k = resultKey(r.itemSeq, r.parameterId);
    resultByKey[k] = r;
    v1[k] = { ...((r.values ?? {}) as Record<string, unknown>) };
    v2[k] = { ...((r.valuesPhase2 ?? {}) as Record<string, unknown>) };
  });

  const idsFor = (item: PetitionItem) => groupMembership.get(itemGroupKey(item)) ?? [];

  return (petition.items ?? []).map((item) => {
    const matched = matchParametersForItem(item, parameters, idsFor(item), { petitionCategory });
    // รายการที่ไม่มี parameter trigger (เช่น ไม่ใช่ยานำเข้าที่ต้องอบ) ไม่มีรอบตรวจซ้ำ แม้ใบเดียวกันจะเข้า Phase 2 แล้ว
    const itemHasPhasedParam = matched.some((p) => p.hasPhases);

    const params: ApprovalParamGroup[] = matched.map((param) => {
      const k = resultKey(item.seq, param._id!);
      const side = (param.scope ?? "qc") === "lab" ? "lab" : "qc";
      const phaseState = sampleRoundFor(petition, side, item.seq) ?? petition;
      const triggerParameterId = phaseState.phase2TriggeredBy?.parameterId ?? null;
      const phase2Opened = itemHasPhasedParam && ((phaseState.currentPhase ?? 1) === 2 || !!phaseState.phase2DueAt);
      const hasPhase2Values = Object.keys(v2[k] ?? {}).length > 0;
      // รอบตรวจซ้ำใช้ parameter เดิมทุกตัวของรายการ ยกเว้นตัว trigger เอง
      const includePhase2 = phase2Opened || hasPhase2Values ||
        (!!param.hasPhases && !isPhaseTriggerParameter(param, triggerParameterId));
      const buildCtx = (phaseVals: Record<string, Record<string, unknown>>): ConditionContext => ({
        sameParam: phaseVals[k] ?? {},
        otherParams: (() => {
          const out: Record<string, Record<string, unknown>> = {};
          matched.forEach((p) => {
            if (!p._id || p._id === param._id) return;
            out[String(p._id)] = phaseVals[resultKey(item.seq, p._id)] ?? {};
          });
          return out;
        })(),
      });

      const rows: ApprovalFieldRow[] = [];
      const pushFields = (phase: 1 | 2) => {
        const phaseVals = phase === 2 ? v2 : v1;
        const ctx = buildCtx(phaseVals);
        // multiEntry parameters repeat their whole field set per entry; normal
        // parameters collapse to a single entry equal to the phase value-object.
        // Phase-2 has no separate entries store; multiEntry repeats live in phase-1 `entries`.
        const phaseResult = phase === 2
          ? { values: v2[k] ?? {}, entries: undefined }
          : { values: v1[k] ?? {}, entries: resultByKey[k]?.entries };
        const entryList = getEntryValues(phaseResult, param);
        const phaseFields = new Set(visibleFieldsForPhase(param, phase, triggerParameterId));
        entryList.forEach((entryValues, ei) => {
          const handledKeys = new Set<string>();
          const entryLabel = [param.multiEntry ? `รายการที่ ${ei + 1}` : "", phase === 2 ? PHASE2_ROW_SUFFIX : ""]
            .filter(Boolean)
            .join(" · ");
          (param.valueFields ?? []).forEach((field) => {
            if (!phaseFields.has(field)) return;
            // reference fields are auto-resolved from substance standards elsewhere and intentionally omitted from approval rows
            if (field.type === "reference") return;
            handledKeys.add(field.label);
            expandFieldForItem(field, item.commonName, { includeRestrictedStandards, category: petitionCategory }).forEach((unit) => {
              handledKeys.add(unit.key);
              handledKeys.add(noteLabelFor(unit.key));
              const effectiveField = unit.field.conditionalMode
                ? resolveFieldStandard(unit.field, ctx)
                : unit.field;
              const resolved = unit.field.conditionalMode
                ? resolveStandard(unit.field, ctx)
                : null;
              const isOutputMode = unit.field.conditionalMode && unit.field.conditionalResult === "output";
              const outputRes = isOutputMode
                ? resolveConditionalOutput(unit.field, { sameParam: entryValues, otherParams: ctx.otherParams })
                : null;
              const standardText = resolved
                ? describeResolvedStandard(resolved, unit.field.unit ?? "")
                : describeStandard(effectiveField);
              const note = asStr(entryValues[noteLabelFor(unit.key)]);
              // Substance units store a per-substance scalar under unit.key; plain
              // units (incl. `multiple`) read their value list via fieldValueList.
              const valueList = unit.substanceName !== undefined
                ? [entryValues[unit.key]]
                : fieldValueList(entryValues, unit.field);
              valueList.forEach((raw, vi) => {
                const valueLabel = unit.field.multiple ? `ค่าที่ ${vi + 1}` : "";
                const labelParts = [unit.field.label, valueLabel, entryLabel].filter(Boolean);
                const hiddenStandard = (unit as { hiddenStandard?: boolean }).hiddenStandard === true;
                // label-% tolerance unit: 3-zone verdict. Only "fail" (outside เกณฑ์กรม) marks
                // the row abnormal; "review" is still within เกณฑ์กรม so it shows as ปกติ
                // with no extra status note.
                let rowStandardText: string;
                let rowAbnormal: boolean;
                if (unit.labelTolerance) {
                  const rv = resolveLabelTolerance(unit.labelTolerance.std, unit.labelTolerance.rawSpec, raw);
                  const range = formatLabelToleranceRange(rv, unit.field.unit ?? "", {
                    showAutoPass: showAutoPassRange,
                    multiline: true,
                    autoPassLabel: "ผ่านเกณฑ์ 25%",
                  });
                  const statusNote = rv.status === "fail" ? "เกินช่วงที่อนุมัติได้" : "";
                  rowStandardText = [range, statusNote].filter(Boolean).join(" · ");
                  rowAbnormal = rv.status === "fail";
                } else {
                  rowStandardText = hiddenStandard ? "" : (isOutputMode ? (outputRes?.text || (outputRes?.kind === "abnormal" ? "ตกเกณฑ์" : "")) : standardText);
                  rowAbnormal = hiddenStandard ? false : (isOutputMode ? outputRes?.kind === "abnormal" : isFieldAbnormal(effectiveField, raw));
                }
                rows.push({
                  key: `${k}__${unit.key}__p${phase}__e${ei}__v${vi}`,
                  label: labelParts.join(" · "),
                  unit: unit.field.unit,
                  value: asStr(raw),
                  standardText: rowStandardText,
                  abnormal: rowAbnormal,
                  note,
                  phase,
                });
              });
            });
          });
          if (options?.includeResultOnlyFields) {
            Object.entries(entryValues).forEach(([key, raw]) => {
              if (handledKeys.has(key) || key.endsWith("__note")) return;
              rows.push({
                key: `${k}__extra__${key}__p${phase}__e${ei}`,
                label: [key.replace("::", " — "), entryLabel].filter(Boolean).join(" · "),
                value: asStr(raw),
                standardText: "",
                abnormal: false,
                note: "",
                phase,
              });
            });
          }
        });
      };

      pushFields(1);
      if (includePhase2) pushFields(2);
      if ((param.valueFields ?? []).some((field) => calculatedAiFieldKind(field.label) === "ai")) {
        rows.sort((a, b) => a.phase - b.phase || aiApprovalRowRank(a.label) - aiApprovalRowRank(b.label));
      }

      return {
        parameterId: String(param._id),
        parameterName: param.name,
        scope: side,
        hasPhases: !!param.hasPhases,
        rows,
      };
    });

    return {
      seq: item.seq,
      sampleName: item.sampleName || "-",
      batchNo: item.batchNo,
      sampleId: item.sampleId,
      commonName: item.commonName,
      params,
      unmatched: matched.length === 0,
    };
  });
}

export function filterApprovalGroupsByScope(
  groups: ApprovalItemGroup[],
  scope: ApprovalParamGroup["scope"],
  options?: { aiSummaryOnly?: boolean },
): ApprovalItemGroup[] {
  return groups.flatMap((group) => {
    const params = group.params
      .filter((param) => param.scope === scope)
      .map((param) => {
        if (!options?.aiSummaryOnly || !/%\s*ai/i.test(param.parameterName)) return param;
        const aiRows = param.rows.filter((row) => /^%\s*ai\b/i.test(row.label.trim()));
        const filledRows = aiRows.filter((row) => row.value !== "");
        const filledSubstanceRows = filledRows.filter((row) => /^%\s*ai\s+[—-]/i.test(row.label.trim()));
        return {
          ...param,
          rows: filledSubstanceRows.length > 0 ? filledSubstanceRows : (filledRows.length > 0 ? filledRows : aiRows),
        };
      })
      .filter((param) => param.rows.length > 0);
    return params.length > 0 ? [{ ...group, params, unmatched: false }] : [];
  });
}
