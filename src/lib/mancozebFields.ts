// MANCOZEB ใช้วิธีไทเทรต 0.1 N I2: Sample = (mL I2 − Blank) × Conc I2 ÷ wt/g × factor
export const MCZ_FACTOR = 13.55;
export const MCZ_CONC = "MCZ Conc 0.1 N I2";
export const MCZ_BLANK = "MCZ mL of Blank";
export const MCZ_SAMPLES = ["Sample 1", "Sample 2"] as const;
export type MczSample = (typeof MCZ_SAMPLES)[number];

export const mczKey = (sample: MczSample, col: "wt/g" | "mL 0.1 N I2") => `MCZ ${sample} ${col}`;

export function isMancozebItem(commonName: string | undefined) {
  const name = String(commonName ?? "");
  return /mancozeb/i.test(name) && !name.includes("+");
}

const num = (v: unknown) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export type MczCalc = {
  conc: number | null;
  blank: number;
  sample: Array<{ wt: number | null; ml: number | null; net: number | null; result: number | null }>;
  average: number | null;
  density: number;
  report: number | null;
};

// ไม่มีค่า ถ.พ. (เช่น WP) ใช้ 1 ตามใบคำนวณ
export function calculateMancozeb(values: Record<string, unknown>, density: number | null): MczCalc {
  const conc = num(values[MCZ_CONC]);
  const blank = num(values[MCZ_BLANK]) ?? 0;
  const sample = MCZ_SAMPLES.map((row) => {
    const wt = num(values[mczKey(row, "wt/g")]);
    const ml = num(values[mczKey(row, "mL 0.1 N I2")]);
    const net = ml == null ? null : ml - blank;
    const result = net != null && conc != null && wt ? ((net * conc) / wt) * MCZ_FACTOR : null;
    return { wt, ml, net, result };
  });
  const [a, b] = sample.map((s) => s.result);
  const average = a != null && b != null ? (a + b) / 2 : null;
  const d = density != null && density > 0 ? density : 1;
  return { conc, blank, sample, average, density: d, report: average == null ? null : average * d };
}

export const mczFixed = (n: number | null | undefined, digits: number) => (n == null || !Number.isFinite(n) ? "" : n.toFixed(digits));
