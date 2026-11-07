// แผนกฝ่ายผลิตในข้อมูลพนักงานเขียนได้หลายแบบ เช่น "ผลิต 01" กับ "ผลิต 1" คือสายเดียวกัน
const PRODUCTION_PREFIX_RX = /^\s*(?:ผลิต|prod(?:uction)?\b)/i;
const PRODUCTION_LINE_RX = /^\s*(?:ผลิต|prod(?:uction)?)\s*0*(\d+)\s*$/i;

export function isProductionDepartment(department?: string | null): boolean {
  return PRODUCTION_PREFIX_RX.test(String(department ?? ''));
}

/** ชื่อสายผลิตแบบมาตรฐาน: "ผลิต 01" → "ผลิต 1"; แผนกอื่นคืน null */
export function productionLineLabel(department?: string | null): string | null {
  const text = String(department ?? '').trim();
  if (!isProductionDepartment(text)) return null;
  const line = text.match(PRODUCTION_LINE_RX);
  return line ? `ผลิต ${Number(line[1])}` : text;
}

export function compareProductionLines(a: string, b: string): number {
  return a.localeCompare(b, 'th', { numeric: true });
}
