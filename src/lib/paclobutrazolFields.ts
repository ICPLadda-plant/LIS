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
