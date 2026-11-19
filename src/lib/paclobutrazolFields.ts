// PACLOBUTRAZOL ใช้วิธี Internal standard: ตาราง Std 1/2, Sample 1/2 × wt/mg, Peak area, Internal std
export const PBZ_ROWS = ["Std 1", "Std 2", "Sample 1", "Sample 2"] as const;
export const PBZ_COLS = ["wt/mg", "Peak area 1", "Internal std 1", "Peak area 2", "Internal std 2"] as const;

export function pbzKey(row: (typeof PBZ_ROWS)[number], col: (typeof PBZ_COLS)[number]) {
  return `PBZ ${row} ${col}`;
}

export function isPaclobutrazolItem(commonName: string | undefined) {
  const name = String(commonName ?? "");
  return /paclobutrazol/i.test(name) && !name.includes("+");
}

// Sample: Peak area 2 = Peak area 1, Internal std 2 = Internal std 1 (C4=C2, C5=C3, D4=D2, D5=D3)
export function pbzMirrorKey(key: string): string | null {
  const m = /^PBZ (Sample [12]) (Peak area|Internal std) 1$/.exec(key);
  return m ? `PBZ ${m[1]} ${m[2]} 2` : null;
}

export function isPbzReadOnly(row: string, col: string) {
  return row.startsWith("Sample") && (col === "Peak area 2" || col === "Internal std 2");
}

export const PBZ_STD_PCT = "PBZ %Std";
export const PBZ_DIL_STD = "PBZ Dilution Std";
export const PBZ_DIL_SAMPLE = "PBZ Dilution Sample";

const num = (v: unknown) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const mean = (xs: Array<number | null>) => {
  const ok = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return ok.length === xs.length && ok.length > 0 ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

export type PbzInjection = { fi: number | null; content: number | null };
export type PbzCalc = {
  std: Array<{ conc: number | null; inj: PbzInjection[] }>;
  sample: Array<{ conc: number | null; inj: PbzInjection[]; meanContent: number | null }>;
  meanFactor: number | null;
  average: number | null;
  report: number | null;
};

// ใบคำนวณ FM-QP-07-08-002: conc = wt/dilution, fi = conc·IS/area std, f = mean(fi),
// content = f·(area sample/IS)/conc·%Std, average = mean(mean content), report %W/V = average·density
export function calculatePaclobutrazol(values: Record<string, unknown>, density: number | null): PbzCalc {
  const v = (row: (typeof PBZ_ROWS)[number], col: (typeof PBZ_COLS)[number]) => num(values[pbzKey(row, col)]);
  const pct = num(values[PBZ_STD_PCT]);
  const dilStd = num(values[PBZ_DIL_STD]);
  const dilSample = num(values[PBZ_DIL_SAMPLE]);
  const conc = (wt: number | null, dil: number | null) => (wt != null && dil ? wt / dil : null);
  const pairs = [["Peak area 1", "Internal std 1"], ["Peak area 2", "Internal std 2"]] as const;

  const std = (["Std 1", "Std 2"] as const).map((row) => {
    const c = conc(v(row, "wt/mg"), dilStd);
    return {
      conc: c,
      inj: pairs.map(([a, is]) => {
        const area = v(row, a);
        const isv = v(row, is);
        return { fi: c != null && area && isv != null ? (c * isv) / area : null, content: null };
      }),
    };
  });
  const meanFactor = mean(std.flatMap((s) => s.inj.map((i) => i.fi)));
  const sample = (["Sample 1", "Sample 2"] as const).map((row) => {
    const c = conc(v(row, "wt/mg"), dilSample);
    const inj = pairs.map(([a, is]) => {
      const area = v(row, a);
      const isv = v(row, is);
      // ตามสูตร Excel คอลัมน์ M: =$L$6*(E/H)*($E$2/100)/G*100
      const content = meanFactor != null && c && area != null && isv && pct != null ? ((meanFactor * (area / isv) * (pct / 100)) / c) * 100 : null;
      return { fi: null, content };
    });
    return { conc: c, inj, meanContent: mean(inj.map((i) => i.content)) };
  });
  const average = mean(sample.map((s) => s.meanContent));
  const report = average != null && density != null && density > 0 ? average * density : null;
  return { std, sample, meanFactor, average, report };
}

export const pbzFixed = (n: number | null | undefined, digits: number) => (n == null || !Number.isFinite(n) ? "" : n.toFixed(digits));

