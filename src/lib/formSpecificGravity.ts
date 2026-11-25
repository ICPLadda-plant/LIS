import type { ParameterItem } from '@/lib/api';
import type { PetitionItem, QCTestResult } from '@/types/petition.types';

// Field label that QC enters the specific-gravity reading into, inside the
// shared QC parameter "ค่า ถพ.". Matching by field label (not parameter _id)
// keeps this resilient to parameter re-creation; a future explicit flag on the
// Parameter could replace this (see spec).
export const SG_FIELD_LABEL = 'ค่าถพ.';

// Sibling key in QCTestResult.values holding the entry index the lab chose to
// show on the service-request form (for multiEntry ถพ. parameters).
export const FORM_ENTRY_INDEX_KEY = '__formEntryIndex';

export interface SgParameter {
  parameterId: string;
  fieldLabel: string;
}

function isFilled(value: unknown): boolean {
  return value != null && value !== '';
}

// แสดงค่า ถพ. เป็นทศนิยม 3 ตำแหน่งเสมอ (1.59 -> 1.590); ค่าที่ไม่ใช่ตัวเลขคืนตามเดิม
export function formatSpecificGravity(value: unknown): string {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  const num = Number(text.replace(/,/g, ''));
  return text !== '' && Number.isFinite(num) ? num.toFixed(3) : text;
}

export function readSpecificGravityEntryValue(
  row: Record<string, unknown> | undefined,
  fieldLabel: string = SG_FIELD_LABEL,
): unknown {
  if (!row) return undefined;
  const direct = row[fieldLabel];
  if (isFilled(direct)) return direct;
  const prefix = `${fieldLabel}::`;
  const key = Object.keys(row).find((entryKey) => entryKey.startsWith(prefix) && isFilled(row[entryKey]));
  return key ? row[key] : direct;
}

// Locate the QC parameter that holds the ถพ. reading shared with the lab.
export function findSgParameter(parameters: ParameterItem[] | null | undefined): SgParameter | null {
  for (const p of parameters ?? []) {
    const source = p.specificGravitySource;
    const configuredField = p.valueFields?.find((f) => f.label === SG_FIELD_LABEL);
    const fieldSource = configuredField?.requestValueSource;
    if (fieldSource?.mode === 'manual' || (!fieldSource && source?.mode === 'manual')) continue;
    // New config lives on the value field. Keep legacy parameter-level config readable.
    if (fieldSource?.mode === 'collection' || fieldSource?.mode === 'manual') {
      if (p.scope !== 'qc' || !p.shareWithLab || !p._id) continue;
      return { parameterId: p._id, fieldLabel: SG_FIELD_LABEL };
    }
    const sourceParameter = source?.mode === 'reference'
      ? (parameters ?? []).find((candidate) => candidate._id === source.refParameterId)
      : p;
    if (!sourceParameter || sourceParameter.scope !== 'qc' || !sourceParameter.shareWithLab || !Array.isArray(sourceParameter.valueFields)) continue;
    const field = sourceParameter.valueFields.find((f) => f.label === (source?.refFieldLabel || SG_FIELD_LABEL));
    if (field && sourceParameter._id) return { parameterId: sourceParameter._id, fieldLabel: field.label };
  }
  return null;
}

// Resolve the ถพ. value to print for a given sample (itemSeq), honouring the
// lab's chosen entry when the result is multiEntry.
export function resolveSpecificGravity(
  qcResults: QCTestResult[] | null | undefined,
  seq: number,
  sgParam: SgParameter | null,
): string {
  if (!sgParam) return '';
  const result = (qcResults ?? []).find(
    (r) => r.itemSeq === seq && r.parameterId === sgParam.parameterId,
  );
  if (!result) return '';

  const entries = Array.isArray(result.entries) ? result.entries : [];
  let row: Record<string, unknown>;
  if (entries.length) {
    let idx = Number(result.values?.[FORM_ENTRY_INDEX_KEY] ?? 0);
    if (!Number.isFinite(idx) || idx < 0 || idx >= entries.length) idx = 0;
    row = entries[idx] ?? {};
  } else {
    row = result.values ?? {};
  }

  const value = readSpecificGravityEntryValue(row, sgParam.fieldLabel);
  return formatSpecificGravity(value);
}

export function resolveSpecificGravityForItem(
  qcResults: QCTestResult[] | null | undefined,
  items: PetitionItem[] | null | undefined,
  seq: number,
  sgParam: SgParameter | null,
): string {
  const direct = resolveSpecificGravity(qcResults, seq, sgParam);
  if (direct) return direct;

  const target = (items ?? []).find((item) => item.seq === seq);
  const batch = target?.batchNo.trim().toLowerCase();
  const sample = (target?.commonName || target?.sampleName || '').trim().toLowerCase();
  if (!batch || !sample) return '';

  for (const item of items ?? []) {
    if (item.seq === seq || item.batchNo.trim().toLowerCase() !== batch) continue;
    if ((item.commonName || item.sampleName || '').trim().toLowerCase() !== sample) continue;
    const sibling = resolveSpecificGravity(qcResults, item.seq, sgParam);
    if (sibling) return sibling;
  }
  return '';
}
