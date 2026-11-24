import { calculatePaclobutrazol } from './paclobutrazolFields';
export type AiCalculationResult = {
  areaAverage: number | null;
  sampleAverage: number | null;
  areaRsd: number | null;
  sampleRsd: number | null;
  ai: number | null;
};

export type CcsCalculationResult = {
  difference: number | null;
  result: '' | 'Pass' | 'No pass';
};

export const CCS_DIFFERENCE_LIMIT = 10;
export const STANDARD_NO_LABEL = 'เลขที่ Standard';
export const CORRELATION_LABEL = 'ค่า Correlation coefficient ( r ) ที่ได้';
export const MID_LEVEL_STANDARD_LABEL = 'Mid-level Standard Conc. (mg/mL)';
export const CCS_CONC_LABEL = 'CCS Conc. (mg/mL)';
export const CCS_DIFFERENCE_LABEL = '% Difference';
export const CCS_RESULT_LABEL = 'CCS Result';

const numberValues = (values: Record<string, unknown>, matcher: RegExp) =>
  Object.entries(values)
    .filter(([label]) => matcher.test(label))
    .filter(([, value]) => value != null && String(value).trim() !== '')
    .map(([, value]) => (typeof value === 'number' ? value : Number(String(value).trim())))
    .filter((value) => Number.isFinite(value));

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const finiteNumber = (value: unknown) => {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
};

const sampleStandardDeviation = (values: number[], mean: number | null) => {
  if (mean == null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};

const rsd = (values: number[], mean: number | null) => {
  const sd = sampleStandardDeviation(values, mean);
  return sd != null && mean !== 0 ? (sd * 100) / mean : null;
};

// รองรับ "Density", "ค่าถพ.", "ค่า ถพ.", "ค่า ถ.พ." และแบบรายสาร เช่น `ค่าถพ.::OMETHOATE`
const DENSITY_LABEL = /^(?:density|ค่า\s*ถ\.?\s*พ\.?)\s*(?:::(.*))?$/i;

const keySubstance = (label: string) => {
  const index = label.indexOf('::');
  return index >= 0 ? label.slice(index + 2).trim().toLowerCase() : '';
};

export function isDensityLabel(label: string) {
  return DENSITY_LABEL.test(label.trim()) && !/__source$/i.test(label);
}

// เลือกค่า ถพ. ของสารนั้นก่อน ถ้าไม่มีใช้ค่า ถพ. รวมของตัวอย่าง; ไม่พบเลยคืน null
export function findAiDensity(records: Record<string, unknown>[], substance = ''): number | null {
  const wanted = substance.trim().toLowerCase();
  let unscoped: number | null = null;
  let anyScoped: number | null = null;
  for (const record of records) {
    for (const [label, rawValue] of Object.entries(record ?? {})) {
      if (!isDensityLabel(label)) continue;
      const value = Number(rawValue);
      if (rawValue === '' || rawValue == null || !Number.isFinite(value) || value <= 0) continue;
      const scoped = keySubstance(label);
      if (wanted && scoped === wanted) return value;
      if (!scoped) unscoped ??= value;
      else anyScoped ??= value;
    }
  }
  return unscoped ?? (wanted ? null : anyScoped);
}

// ใช้เฉพาะช่องของสารที่ระบุ ถ้าช่องไม่ได้แยกรายสารให้ใช้ช่องรวม
const valuesForSubstance = (values: Record<string, unknown>, substance: string) => {
  const wanted = substance.trim().toLowerCase();
  const inputs = Object.entries(values).filter(([label]) => /(area\s*inj|sample\s*[1-3])/i.test(label));
  const scoped = inputs.filter(([label]) => wanted && keySubstance(label) === wanted);
  if (scoped.length) return Object.fromEntries(scoped);
  const plain = inputs.filter(([label]) => !keySubstance(label));
  return Object.fromEntries(plain.length || wanted ? plain : inputs);
};

export function calculateAi(values: Record<string, unknown>, density: number | null = null, substance = ''): AiCalculationResult {
  // PACLOBUTRAZOL (Internal standard): %AI = Report %W/V จากใบคำนวณ
  // ใช้ค่าทั้งหมด (Std / %Std / Dilution) — valuesForSubstance เก็บไว้เฉพาะคีย์ Area Inj / Sample
  if (Object.keys(values).some((key) => key.startsWith('PBZ '))) {
    const pbz = calculatePaclobutrazol(values, density != null && Number(density) > 0 ? Number(density) : null);
    const pbzAreas = numberValues(valuesForSubstance(values, substance), /area\s*inj\.?\s*[1-3]/i);
    const pbzAreaAverage = average(pbzAreas);
    return { areaAverage: pbzAreaAverage, sampleAverage: pbz.average, areaRsd: rsd(pbzAreas, pbzAreaAverage), sampleRsd: null, ai: pbz.report == null ? null : Number(pbz.report.toFixed(2)) };
  }
  const own = valuesForSubstance(values, substance);
  const areas = numberValues(own, /area\s*inj\.?\s*[1-3]/i);
  const samples = numberValues(own, /%?\s*sample\s*[1-3]/i);
  const areaAverage = average(areas);
  const sampleAverage = average(samples);
  const safeDensity = density != null && Number.isFinite(Number(density)) && Number(density) > 0 ? Number(density) : null;
  return {
    areaAverage,
    sampleAverage,
    areaRsd: rsd(areas, areaAverage),
    sampleRsd: rsd(samples, sampleAverage),
    ai: sampleAverage == null || safeDensity == null ? null : sampleAverage * safeDensity,
  };
}

const valueByLabel = (values: Record<string, unknown>, label: string) =>
  Object.entries(values).find(([key]) => key.trim().toLowerCase() === label.toLowerCase())?.[1];

export function calculateCcs(mid: unknown, ccs: unknown): CcsCalculationResult {
  const midValue = finiteNumber(mid);
  const ccsValue = finiteNumber(ccs);
  if (midValue == null || ccsValue == null || midValue === 0) return { difference: null, result: '' };
  const difference = ((ccsValue - midValue) / midValue) * 100;
  return { difference, result: Math.abs(difference) <= CCS_DIFFERENCE_LIMIT ? 'Pass' : 'No pass' };
}

export function calculateCcsFromValues(values: Record<string, unknown>, substance = '') {
  const k = (label: string) => (substance ? label + '::' + substance : label);
  return calculateCcs(valueByLabel(values, k(MID_LEVEL_STANDARD_LABEL)), valueByLabel(values, k(CCS_CONC_LABEL)));
}

export function ccsDifference(mid: unknown, ccs: unknown) {
  const difference = calculateCcs(mid, ccs).difference;
  return difference == null ? '' : difference.toFixed(2);
}

export function calculatedCcsFieldKind(label: string): keyof CcsCalculationResult | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === CCS_DIFFERENCE_LABEL.toLowerCase()) return 'difference';
  if (normalized === CCS_RESULT_LABEL.toLowerCase()) return 'result';
  return null;
}

export function aiSubstanceFromKey(key: string) {
  return keySubstance(key);
}

// ช่อง Control Sample ของ parameter %AI (ผู้ใช้กรอกในหน้าการทดสอบ Lab; ใบคำนวณอ่านไปแสดง)
export const CONTROL_SAMPLE_LABEL = 'Control Sample';
export const CONTROL_LOW_LABEL = 'Control ช่วงต่ำสุด';
export const CONTROL_HIGH_LABEL = 'Control ช่วงสูงสุด';
export const CONTROL_LABELS = new Set<string>([CONTROL_SAMPLE_LABEL, CONTROL_LOW_LABEL, CONTROL_HIGH_LABEL]);
const SHARED_DAILY_AI_LABELS = new Set([
  STANDARD_NO_LABEL, CORRELATION_LABEL,
  'Area Inj.1', 'Area Inj.2', 'Area Inj.3',
  MID_LEVEL_STANDARD_LABEL, CCS_CONC_LABEL,
  CONTROL_SAMPLE_LABEL, CONTROL_LOW_LABEL, CONTROL_HIGH_LABEL,
].map((label) => label.toLowerCase()));

export function isSharedDailyAiField(label: string) {
  return SHARED_DAILY_AI_LABELS.has(label.split('::', 1)[0].trim().toLowerCase());
}

export function isControlSampleLabel(label: string) {
  return CONTROL_LABELS.has(label.trim());
}

export function calculatedAiFieldKind(label: string): keyof AiCalculationResult | null {
  const normalized = label.trim().toLowerCase();
  if (/^%?ai(?:\s*[-—:]|$)|%ai\s*(result|ผลลัพธ์)/i.test(normalized)) return 'ai';
  if (/(area.*(average|avg|mean|เฉลี่ย))|((average|avg|mean|เฉลี่ย).*area)/i.test(normalized)) return 'areaAverage';
  if (/(sample.*(average|avg|mean|เฉลี่ย))|((average|avg|mean|เฉลี่ย).*sample)/i.test(normalized)) return 'sampleAverage';
  if (/area.*rsd|rsd.*area/i.test(normalized)) return 'areaRsd';
  if (/sample.*rsd|rsd.*sample/i.test(normalized)) return 'sampleRsd';
  return null;
}

export function formatCalculatedAi(value: number | null) {
  if (value == null) return '';
  const absolute = Math.abs(value);
  if (absolute === 0 || absolute >= 1) return value.toFixed(2);
  const leadingDecimalZeros = Math.max(0, Math.ceil(-Math.log10(absolute)) - 1);
  return value.toFixed(leadingDecimalZeros + 3);
}

export function aiGridClass(label: string) {
  const kind = calculatedAiFieldKind(label);
  if (kind === 'ai') return 'sm:col-span-6';
  if (isControlSampleLabel(label)) return 'sm:col-span-2';
  if ([STANDARD_NO_LABEL, CORRELATION_LABEL].includes(label)) return 'sm:col-span-3';
  // แถว CCS: ชิดล่าง ให้กรอบกรอกตรงกันแม้ป้ายของช่องแคบ (CCS Result) ขึ้นสองบรรทัด
  if ([MID_LEVEL_STANDARD_LABEL, CCS_CONC_LABEL].includes(label)) return 'sm:col-span-2 sm:self-end';
  if ([CCS_DIFFERENCE_LABEL, CCS_RESULT_LABEL].includes(label)) return 'sm:col-span-1 sm:self-end';
  if (kind === 'areaAverage' || kind === 'areaRsd' || kind === 'sampleAverage' || kind === 'sampleRsd') return 'sm:col-span-3';
  if (/^(area\s*inj\.?|%\s*sample)/i.test(label.trim())) return 'sm:col-span-2';
  return '';
}
