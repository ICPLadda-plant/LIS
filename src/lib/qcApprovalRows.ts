import type { ParameterItem } from "@/lib/api";
import type { Petition, PetitionItem, QCTestResult } from "@/types/petition.types";
import { getPetitionCategory, itemGroupKey, matchParametersForItem } from "@/lib/petitionTestItems";
import {
  expandFieldForItem,
  fieldValueList,
  getEntryValues,
  isFieldAbnormal,
  isLabelToleranceAbnormal,
  resolveConditionalOutput,
  resolveFieldStandard,
  resolveLabelTolerance,
  resolveStandard,
  type ConditionContext,
} from "@/lib/parameterValidation";
import { describeResolvedStandard, describeStandard, formatLabelToleranceRange } from "@/lib/standardOperators";

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

    const params: ApprovalParamGroup[] = matched.map((param) => {
      const k = resultKey(item.seq, param._id!);
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
        entryList.forEach((entryValues, ei) => {
          const handledKeys = new Set<string>();
          const entryLabel = param.multiEntry ? `รายการที่ ${ei + 1}` : "";
          (param.valueFields ?? []).forEach((field) => {
            const fPhase = field.phase ?? "both";
            if (phase === 1 && fPhase === "after") return;
            if (phase === 2 && fPhase === "before") return;
            // reference fields are auto-resolved from substance standards elsewhere and intentionally omitted from approval rows
            if (field.type === "reference") return;
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
                // label-% tolerance unit: 3-zone verdict. review+fail mark the row abnormal
                // (draws head-QC attention) but stay approvable via the server abnormal-flags
                // path; standardText carries the resolved range + a status note.
                let rowStandardText: string;
                let rowAbnormal: boolean;
                if (unit.labelTolerance) {
                  const rv = resolveLabelTolerance(unit.labelTolerance.std, unit.labelTolerance.rawSpec, raw);
                  const range = formatLabelToleranceRange(rv, unit.field.unit ?? "", {
                    showAutoPass: showAutoPassRange,
                    multiline: true,
                    autoPassLabel: "ผ่านเกณฑ์ 25%",
                  });
                  const statusNote = rv.status === "review"
                    ? "รอหัวหน้าอนุมัติ"
                    : rv.status === "fail"
                      ? "เกินช่วงที่อนุมัติได้"
                      : "";
                  rowStandardText = [range, statusNote].filter(Boolean).join(" · ");
                  rowAbnormal = isLabelToleranceAbnormal(unit.labelTolerance.std, unit.labelTolerance.rawSpec, raw);
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
      if (param.hasPhases) pushFields(2);

      return {
        parameterId: String(param._id),
        parameterName: param.name,
        scope: (param.scope ?? "qc") === "lab" ? "lab" : "qc",
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
