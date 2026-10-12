import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Petition, QCTestResult } from '@/types/petition.types';
import { useAuth } from '@/hooks/useAuth';
import { api, type ParameterItem } from '@/lib/api';
import { normalizeRoles } from "@/lib/roles";
import { getPetitionCategory, itemGroupKey, matchParametersForItem } from '@/lib/petitionTestItems';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import { isResearchAndDevelopmentPetition, shouldSendItemToLab } from '@/lib/petitionRouting';
import {
  expandFieldForItem,
  fieldValueList,
  getEntryValues,
  isFieldAbnormal,
  resolveFieldStandard,
  resolveStandard,
  resolveLabelTolerance,
} from '@/lib/parameterValidation';
import { describeResolvedStandard, describeStandard, formatLabelToleranceRange, labelToleranceBadge } from '@/lib/standardOperators';
import { SG_FIELD_LABEL } from '@/lib/formSpecificGravity';

interface Props { petition: Petition; hideMissingStandardBadge?: boolean; }

function formatResultValue(value: unknown): string {
  if (value == null || value === '') return '-';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  const display = value === undefined || value === null || value === '' ? '-' : value;
  return (
    <div>
      <p className="text-xs text-grey-500 mb-0.5">{label}</p>
      <div className="text-sm text-black-500">{display}</div>
    </div>
  );
}

export default function PetitionView({ petition: p, hideMissingStandardBadge = false }: Props) {
  const { user } = useAuth();
  const roles = normalizeRoles(user);
  const canSeeTestItems = roles.length > 0 && roles.some((r) => r !== 'viewer');
  const canSeeRestrictedStandards = roles.some((r) => r === 'admin' || r === 'qc-head');
  const petitionCategory = getPetitionCategory(p);
  const isResearchPetition = isResearchAndDevelopmentPetition(p);
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const groupMembership = useItemGroupMembership();
  const idsFor = (it: Parameters<typeof itemGroupKey>[0]) =>
    groupMembership.get(itemGroupKey(it)) ?? [];
  const [results, setResults] = useState<QCTestResult[]>([]);
  useEffect(() => {
    if (!canSeeTestItems) return;
    api.getParameters().then(setParameters).catch(() => {});
  }, [canSeeTestItems]);
  useEffect(() => {
    if (!canSeeTestItems || !p._id) return;
    api.getQCResults(p._id).then(setResults).catch(() => {});
  }, [canSeeTestItems, p._id]);

  const resultsByKey = useMemo(() => {
    const map = new Map<string, QCTestResult>();
    for (const r of results) map.set(`${r.itemSeq}__${r.parameterId}`, r);
    return map;
  }, [results]);
  const paramById = useMemo(() => {
    const map = new Map<string, ParameterItem>();
    for (const p of parameters) if (p._id) map.set(String(p._id), p);
    return map;
  }, [parameters]);
  const visibleParameters = useMemo(
    () => isResearchPetition ? parameters.filter((param) => param.scope === 'lab') : parameters,
    [isResearchPetition, parameters],
  );

  const resultRowsFor = (
    item: Petition['items'][number],
    param: ParameterItem,
    result: QCTestResult | undefined,
  ) => {
    if (!result) return [];
    const valueRows = getEntryValues(result, param);
    const isSgParam = (param.valueFields ?? []).some((field) => field.label === SG_FIELD_LABEL);
    const otherParams: Record<string, Record<string, unknown>> = {};
    for (const r of results) {
      if (r.itemSeq !== item.seq) continue;
      otherParams[String(r.parameterId)] = getEntryValues(r, paramById.get(String(r.parameterId)) ?? {})[0] ?? {};
    }
    return valueRows.flatMap((values, rowIndex) =>
      (param.valueFields ?? []).flatMap((field) =>
        expandFieldForItem(field, item.commonName, { includeRestrictedStandards: canSeeRestrictedStandards, category: petitionCategory }).flatMap((unit) => {
          const isNumeric = unit.field.type === 'number' || unit.field.type === 'float';
          const ctx = { sameParam: values, otherParams };
          const effectiveField = unit.field.conditionalMode && isNumeric
            ? resolveFieldStandard(unit.field, ctx)
            : unit.field;
          const resolved = unit.field.conditionalMode && isNumeric
            ? resolveStandard(unit.field, ctx)
            : null;
          const standard = resolved
            ? describeResolvedStandard(resolved, unit.field.unit ?? '')
            : unit.field.type === 'enum'
              ? (unit.field.expectedValues ?? []).join(', ')
              : describeStandard(effectiveField);
          const valueList = unit.substanceName !== undefined
            ? [values[unit.key]]
            : fieldValueList(values, unit.field);

          return valueList
            .map((value, valueIndex) => ({ value, valueIndex }))
            .filter(({ value }) => value != null && String(value).trim() !== '')
            .map(({ value, valueIndex }) => {
              // label-% tolerance unit: resolve per saved value → range text + status chip.
              const lt = unit.labelTolerance
                ? resolveLabelTolerance(unit.labelTolerance.std, unit.labelTolerance.rawSpec, value)
                : null;
              const rowStandard = lt ? formatLabelToleranceRange(lt, unit.field.unit ?? '') : standard;
              return {
                key: `${param._id}-${rowIndex}-${unit.key}-${valueIndex}`,
                label: param.multiEntry && valueRows.length > 1
                  ? `รายการ ${rowIndex + 1} - ${unit.field.label}`
                  : unit.field.label,
                value,
                standard: rowStandard,
                hasStandard: rowStandard.trim() !== '',
                hideStandard: isSgParam || (unit as { hiddenStandard?: boolean }).hiddenStandard === true,
                abnormal: lt
                  ? (lt.status === 'review' || lt.status === 'fail')
                  : (unit as { hiddenStandard?: boolean }).hiddenStandard === true ? false : isFieldAbnormal(effectiveField, value),
                labelBadge: lt ? labelToleranceBadge(lt.status, lt.center) : null,
              };
            });
        }),
      ),
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>รายการตัวอย่าง ({p.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {p.items.map((item) => {
            const lab = isResearchPetition || shouldSendItemToLab(item);
            const itemCode = item.itemNo?.trim();
            const matchedParams = canSeeTestItems
              ? matchParametersForItem(item, visibleParameters, idsFor(item), { forceLabTrack: isResearchPetition, petitionCategory })
              : [];
            return (
              <div key={item.seq} className="rounded-[10px] border border-black-50 p-4 space-y-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-sm font-semibold text-black-500">
                    ตัวอย่างที่ {item.seq}: {item.sampleName || '-'}
                  </p>
                  {item.sampleId && (
                    <span className="text-xs text-primary-500">[{item.sampleId}]</span>
                  )}
                  {lab && <Badge variant="blue-soft">ส่ง lab</Badge>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Batch No." value={item.batchNo} />
                  <Field label="วันที่ผลิต" value={item.productionDate} />
                  <Field label="ขนาดบรรจุ" value={item.packageUnit} />
                  <Field label="จำนวนตัวอย่าง" value={String(item.sampleQuantity ?? 1)} />
                  <Field
                    label="ชื่อสามัญ"
                    value={
                      itemCode ? (
                        <div className="space-y-1">
                          <div>{item.commonName || '-'}</div>
                          <Badge variant="gray-soft" className="gap-1 px-2 py-0.5 text-[11px] font-medium">
                            <span>รหัสสินค้า</span>
                            <span className="font-semibold">{itemCode}</span>
                          </Badge>
                        </div>
                      ) : item.commonName
                    }
                  />
                  <Field label="เลขที่ใบนำส่ง" value={item.submissionNo} />
                </div>
                {item.note && <Field label="หมายเหตุ" value={item.note} />}
                {canSeeTestItems && (
                  <Field
                    label="รายการทดลอง / ผลตรวจ"
                    value={
                      matchedParams.length > 0 ? (
                        <div className="space-y-1.5">
                          {matchedParams.map((param) => {
                            const result = param._id
                              ? resultsByKey.get(`${item.seq}__${param._id}`)
                              : undefined;
                            const entries = resultRowsFor(item, param, result);
                            return (
                              <div
                                key={param._id ?? param.name}
                                className="rounded-[8px] border border-grey-200 px-3 py-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`inline-flex h-5 items-center rounded-md px-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                                        (param.scope ?? 'qc') === 'lab'
                                          ? 'bg-sky-100 text-sky-800'
                                          : 'bg-indigo-100 text-indigo-800'
                                      }`}
                                    >
                                      {(param.scope ?? 'qc') === 'lab' ? 'Lab' : 'QC'}
                                    </span>
                                    <span className="text-sm font-medium text-black-500">
                                      {param.name}
                                    </span>
                                  </div>
                                  {entries.length === 0 && (
                                    <Badge variant="gray-soft">ยังไม่บันทึก</Badge>
                                  )}
                                </div>
                                {entries.length > 0 && (
                                  <div className="mt-1.5 grid gap-1.5 text-xs text-grey-700 md:grid-cols-2">
                                    {entries.map((entry) => (
                                      <div key={entry.key} className="rounded-md border border-grey-100 bg-white px-2 py-1.5">
                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                          <span className="text-grey-500">{entry.label}</span>
                                          {entry.labelBadge ? (
                                            <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${entry.labelBadge.cls}`}>
                                              {entry.labelBadge.text}
                                            </span>
                                          ) : !entry.hasStandard && hideMissingStandardBadge ? null : (
                                            <Badge variant={entry.hideStandard || !entry.hasStandard ? 'gray-soft' : entry.abnormal ? 'red-soft' : 'green-soft'}>
                                              {entry.hideStandard ? 'ไม่แสดงเกณฑ์' : !entry.hasStandard ? 'ไม่มีเกณฑ์' : entry.abnormal ? 'ไม่ผ่านเกณฑ์' : 'ผ่านเกณฑ์'}
                                            </Badge>
                                          )}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                          <span>
                                            ผล:{' '}
                                            <span className="text-black-500 font-medium">
                                              {formatResultValue(entry.value)}
                                            </span>
                                          </span>
                                          {!entry.hideStandard && (
                                            <span>
                                              เกณฑ์:{' '}
                                              <span className="text-black-500 font-medium">
                                                {entry.standard || '-'}
                                              </span>
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : undefined
                    }
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {p.cause && (
        <Card>
          <CardHeader>
            <CardTitle>สาเหตุการตรวจ / ข้อมูลเพิ่มเติม</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-black-500 whitespace-pre-wrap">{p.cause}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
