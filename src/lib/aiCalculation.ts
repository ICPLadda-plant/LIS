export type AiCalculationResult = {
  areaAverage: number | null;
  sampleAverage: number | null;
  areaRsd: number | null;
  sampleRsd: number | null;
  ai: number | null;
};

const numberValues = (values: Record<string, unknown>, matcher: RegExp) =>
  Object.entries(values)
    .filter(([label]) => matcher.test(label))
    .map(([, value]) => (typeof value === 'number' ? value : Number(String(value).trim())))
    .filter((value) => Number.isFinite(value));

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const sampleStandardDeviation = (values: number[], mean: number | null) => {
  if (mean == null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};

const rsd = (values: number[], mean: number | null) => {
  const sd = sampleStandardDeviation(values, mean);
  return sd != null && mean !== 0 ? (sd * 100) / mean : null;
};

export function findAiDensity(records: Record<string, unknown>[]) {
  for (const record of records) {
    for (const [label, rawValue] of Object.entries(record)) {
      // ค่า ถพ. แบบรายสารจะมี key เช่น `ค่าถพ.::OMETHOATE`
      if (!/^(density|ค่าถพ.)(?:::|$)/i.test(label.trim())) continue;
      const value = Number(rawValue);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 1;
}

export function calculateAi(values: Record<string, unknown>, density = 1): AiCalculationResult {
  const areas = numberValues(values, /area\s*inj\.?\s*[1-3]/i);
  const samples = numberValues(values, /%?\s*sample\s*[1-3]/i);
  const areaAverage = average(areas);
  const sampleAverage = average(samples);
  const safeDensity = Number.isFinite(Number(density)) && Number(density) > 0 ? Number(density) : 1;
  return {
    areaAverage,
    sampleAverage,
    areaRsd: rsd(areas, areaAverage),
    sampleRsd: rsd(samples, sampleAverage),
    ai: sampleAverage == null ? null : sampleAverage * safeDensity,
  };
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
  if (kind === 'areaAverage' || kind === 'areaRsd' || kind === 'sampleAverage' || kind === 'sampleRsd') return 'sm:col-span-3';
  if (/^(area\s*inj\.?|%\s*sample)/i.test(label.trim())) return 'sm:col-span-2';
  return '';
}
