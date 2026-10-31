import { SG_FIELD_LABEL } from '@/lib/formSpecificGravity';

// The two visible fields of the "ค่า ถพ." parameter.
export const SG_VALUE_LABEL = SG_FIELD_LABEL; // 'ค่าถพ.'
export const SG_TEMP_LABEL = 'อุณหภูมิ';
const SG_VALUE_KEY_PREFIX = `${SG_VALUE_LABEL}::`;

// Result-Density column keys (raw DMA 501 export).
const COL_DENSITY_3 = 'Density (3 ตำแหน่ง)';
const COL_DENSITY = 'Density [g/cm³]';
const COL_DENSITIES = [COL_DENSITY_3, COL_DENSITY, 'Density [g/cmÂ³]'];
const COL_TBLOCKS = ['T(block) [°C]', 'T (block) [°C]'];
const COL_TSETS = ['T(set) [°C]', 'T (set) [°C]'];
const COL_INSTRUMENT = 'Instrument name';
const COL_SAMPLE = 'Sample name';
const COL_STATUS = 'Measurement status';
const TARGET_TBLOCK = 30;

// Provenance sibling convention: "<label>__source" (mirrors LabTestingDetailPage).
export function sourceSiblingKey(label: string): string {
  return `${label}__source`;
}

export function isSgValueKey(key: string): boolean {
  return key === SG_VALUE_LABEL || key.startsWith(`${SG_VALUE_LABEL} —`) || (key.startsWith(SG_VALUE_KEY_PREFIX) && !key.endsWith('__source'));
}

export function isSgMachineUnitKey(key: string, label: string): boolean {
  return isSgValueKey(key) || label === SG_VALUE_LABEL || label.startsWith(`${SG_VALUE_LABEL} —`) || label === SG_TEMP_LABEL;
}

// ช่องอุณหภูมิของ "ค่า ถพ." ล็อกไว้เฉพาะตอนค่ามาจากเครื่อง (Result-Density)
// QC เลือก "กรอกค่าเอง" หรือค่า ถพ./อุณหภูมิที่บันทึกไว้ไม่มีที่มาจากเครื่อง → ต้องกรอกอุณหภูมิเองได้
export function isSgTemperatureEditable(
  values: Record<string, unknown> | undefined,
  manualSelected: boolean,
): boolean {
  if (manualSelected) return true;
  for (const [key, value] of Object.entries(values ?? {})) {
    if (key !== SG_TEMP_LABEL && !isSgValueKey(key)) continue;
    if (value == null || value === '') continue;
    const src = values?.[sourceSiblingKey(key)] as { source?: string } | undefined;
    if (src?.source !== 'instrument') return true;
  }
  return false;
}

function firstDensityColumnValue(row: Record<string, unknown>, columns: string[]): unknown {
  for (const column of columns) {
    const value = row[column];
    if (value != null && value !== '') return value;
  }
  return '';
}

export function readDensityTBlock(row: Record<string, unknown>): unknown {
  return firstDensityColumnValue(row, COL_TBLOCKS);
}

export function readDensityTSet(row: Record<string, unknown>): unknown {
  return firstDensityColumnValue(row, COL_TSETS);
}

export function readDensityValue(row: Record<string, unknown>): unknown {
  return firstDensityColumnValue(row, COL_DENSITIES);
}

export function formatDensity3(row: Record<string, unknown>): string {
  const density = toNum(readDensityValue(row));
  return density === '' ? '' : density.toFixed(3);
}

function toNum(v: unknown): number | '' {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

function density3Key(row: Record<string, unknown>): string | null {
  return formatDensity3(row) || null;
}

function tBlockDistance(row: Record<string, unknown>): number {
  const tBlock = toNum(readDensityTBlock(row));
  return tBlock === '' ? Number.POSITIVE_INFINITY : Math.abs(tBlock - TARGET_TBLOCK);
}

function isValidDensityRow(row: Record<string, unknown>): boolean {
  return String(row[COL_STATUS] ?? '').trim().toLowerCase() === 'valid';
}

export function selectDensitySyncRow(rows: Record<string, unknown>[]): Record<string, unknown> | undefined {
  if (rows.length === 1) {
    return isValidDensityRow(rows[0]) && density3Key(rows[0]) ? rows[0] : undefined;
  }

  type DensityRun = { key: string; firstIndex: number; rows: { row: Record<string, unknown>; index: number }[] };
  const runs: DensityRun[] = [];
  let currentRun: DensityRun | null = null;
  let validCount = 0;

  rows.forEach((row, index) => {
    const valid = isValidDensityRow(row);
    if (valid) validCount += 1;
    const key = valid ? density3Key(row) : null;
    if (key && currentRun?.key === key) {
      currentRun.rows.push({ row, index });
      return;
    }
    if (currentRun && currentRun.rows.length >= 2) runs.push(currentRun);
    currentRun = key ? { key, firstIndex: index, rows: [{ row, index }] } : null;
  });
  if (currentRun && currentRun.rows.length >= 2) runs.push(currentRun);

  if (validCount <= 1 || !runs.length) return undefined;

  const bestRun = runs.sort((a, b) => (
    b.rows.length - a.rows.length || a.firstIndex - b.firstIndex
  ))[0];

  return bestRun.rows.reduce((best, current) => {
    const distanceDiff = tBlockDistance(current.row) - tBlockDistance(best.row);
    if (distanceDiff < 0) return current;
    if (distanceDiff === 0 && current.index < best.index) return current;
    return best;
  }).row;
}

// Map one Result-Density row to a QCTestResult entry for the "ค่า ถพ." parameter.
// `fetchedAt` is passed in (pure: no Date access here) and recorded in provenance.
export function densityRowToEntry(
  row: Record<string, unknown>,
  fetchedAt: string,
  valueKeys: string[] = [SG_VALUE_LABEL],
): Record<string, unknown> {
  const instrument = String(row[COL_INSTRUMENT] || 'DMA 501');
  const sampleName = row[COL_SAMPLE];
  const densityText = formatDensity3(row);
  const density = densityText === '' ? '' : Number(densityText);
  const tBlock = toNum(readDensityTBlock(row));
  const tSet = toNum(readDensityTSet(row));
  const entry: Record<string, unknown> = {
    [SG_TEMP_LABEL]: tBlock,
    [sourceSiblingKey(SG_TEMP_LABEL)]: {
      source: 'instrument', instrument, sampleName, fetchedAt,
      tSet, tBlock,
    },
  };
  const keys = Array.from(new Set(valueKeys.map((key) => key.trim()).filter(Boolean)));
  for (const key of keys.length ? keys : [SG_VALUE_LABEL]) {
    entry[key] = density;
    entry[sourceSiblingKey(key)] = { source: 'instrument', instrument, sampleName, fetchedAt };
  }
  return entry;
}

// True if any entry holds a non-empty SG value/temp without instrument provenance
// (i.e. it was hand-typed) — drives the overwrite confirm.
export function hasHandTypedEntries(entries?: Record<string, unknown>[]): boolean {
  for (const e of entries ?? []) {
    if (!e) continue;
    for (const [label, v] of Object.entries(e)) {
      if (label !== SG_TEMP_LABEL && !isSgValueKey(label)) continue;
      if (v === '' || v == null) continue;
      const src = e[sourceSiblingKey(label)] as { source?: string } | undefined;
      if (!src || src.source !== 'instrument') return true;
    }
  }
  return false;
}

export interface TSetComparison {
  text: string;
  status: 'match' | 'differ' | 'no-standard';
}

// T(set) stays in provenance for traceability, but no visible comparison line is shown.
export function formatTSetComparison(tSet: unknown, standardValue: unknown): TSetComparison | null {
  void tSet;
  void standardValue;
  return null;
}
