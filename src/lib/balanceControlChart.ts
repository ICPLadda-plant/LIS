// Quality Control Chart ของเครื่องชั่ง (Daily check ด้วยตุ้ม 100 g)
// - ค่า Control (Mean / STD) ตั้งต่อเครื่อง → คำนวณเส้น UWL/LWL (±2SD) และ UCL/LCL (±3SD)
// - ค่าที่ได้ของแต่ละวัน = avg100 ของการบันทึกล่าสุดในวันนั้น แล้วนำมาเทียบกับเส้นควบคุม
// ฝั่ง server (server/routes/balanceControlConfig.js) ใช้ default และข้อความ validate ชุดเดียวกัน

export interface BalanceScale {
  id: string;
  /** รหัสเครื่องมือ เช่น LD-005 */
  code: string;
  /** ชื่อเต็มที่บันทึกลง daily check record (scaleName) */
  name: string;
  model: string;
  /** ความละเอียดของเครื่อง (จำนวนตำแหน่งทศนิยม) */
  decimals: number;
}

export const BALANCE_SCALES: BalanceScale[] = [
  { id: "scale-1", code: "LD-005", name: "LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง", model: "Balance A", decimals: 2 },
  { id: "scale-2", code: "LD-006", name: "LD-006 - เครื่องชั่งดิจิตอล 4 ตำแหน่ง", model: "Balance B", decimals: 4 },
  { id: "scale-3", code: "LD-021", name: "LD-021 - เครื่องชั่งดิจิตอล 5 ตำแหน่ง", model: "Balance C", decimals: 5 },
  { id: "scale-4", code: "LD-047", name: "LD-047 - เครื่องชั่งดิจิตอล 5 ตำแหน่ง", model: "Balance D", decimals: 5 },
  { id: "scale-5", code: "LD-048", name: "LD-048 - เครื่องชั่งดิจิตอล 5 ตำแหน่ง", model: "Balance E", decimals: 5 },
];

export const balanceScaleTypeLabel = (scale: BalanceScale) => `เครื่องชั่งดิจิตอล ${scale.decimals} ตำแหน่ง`;

export interface BalanceControlConfig {
  scaleId: string;
  brand: string;
  model: string;
  weightCode: string;
  /** น้ำหนักตุ้มที่ใช้ Daily check (g) */
  nominal: number;
  mean: number | null;
  sd: number | null;
  mpe: number | null;
  /** วันที่ปรับปรุงค่า Control (YYYY-MM-DD) หรือ "" */
  updatedDate: string;
}

export interface BalanceControlConfigInput {
  brand?: string;
  model?: string;
  weightCode?: string;
  nominal?: number | null;
  mean: number;
  sd: number;
  mpe?: number | null;
  updatedDate?: string;
}

const DEFAULT_SCALE_META = [
  { scaleId: "scale-1", brand: "Mettler Toledo", model: "MS3002S" },
  { scaleId: "scale-2", brand: "Mettler Toledo", model: "MS204" },
  { scaleId: "scale-3", brand: "Sartorius", model: "CPA225D" },
  { scaleId: "scale-4", brand: "Mettler Toledo", model: "MX205DU" },
  { scaleId: "scale-5", brand: "Sartorius", model: "MCE225P-3S00-D" },
];

export const BALANCE_CONTROL_DEFAULTS: BalanceControlConfig[] = DEFAULT_SCALE_META.map((meta) => ({
  ...meta,
  weightCode: "",
  nominal: 100,
  mean: null,
  sd: null,
  mpe: 0.5,
  updatedDate: "",
}));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** ค่า Control ของเครื่อง: ใช้ค่าจาก server ถ้ามี ไม่งั้นใช้ default */
export function getBalanceControlConfig(
  configs: BalanceControlConfig[] | undefined,
  scaleId: string,
): BalanceControlConfig {
  return (
    configs?.find((config) => config.scaleId === scaleId) ??
    BALANCE_CONTROL_DEFAULTS.find((config) => config.scaleId === scaleId) ?? {
      scaleId,
      brand: "",
      model: "",
      weightCode: "",
      nominal: 100,
      mean: null,
      sd: null,
      mpe: null,
      updatedDate: "",
    }
  );
}

export interface ControlLimits {
  mean: number;
  sd: number;
  uwl: number;
  lwl: number;
  ucl: number;
  lcl: number;
}

/** UWL/LWL = Mean ± 2SD, UCL/LCL = Mean ± 3SD; null ถ้ายังไม่ได้ตั้งค่า */
export function computeLimits(
  mean: number | null | undefined,
  sd: number | null | undefined,
): ControlLimits | null {
  if (!isFiniteNumber(mean) || !isFiniteNumber(sd) || sd <= 0) return null;
  return {
    mean,
    sd,
    uwl: mean + 2 * sd,
    lwl: mean - 2 * sd,
    ucl: mean + 3 * sd,
    lcl: mean - 3 * sd,
  };
}

export type ControlPointStatus = "in" | "warning" | "out";

/** in = อยู่ใน ±2SD, warning = เกิน 2SD แต่ไม่เกิน 3SD, out = เกิน 3SD */
export function classifyPoint(
  value: number | null | undefined,
  limits: ControlLimits | null,
): ControlPointStatus | null {
  if (!isFiniteNumber(value) || !limits) return null;
  const deviation = Math.abs(value - limits.mean);
  // กัน floating-point ที่อยู่บนเส้นพอดี (เช่น 100 + 3*0.001) ไม่ให้ถูกนับว่าเกินเส้น
  const epsilon = limits.sd * 1e-6;
  if (deviation > 3 * limits.sd + epsilon) return "out";
  if (deviation > 2 * limits.sd + epsilon) return "warning";
  return "in";
}

export const CONTROL_STATUS_LABEL: Record<ControlPointStatus, string> = {
  in: "อยู่ในเกณฑ์",
  warning: "เกิน 2SD (เฝ้าระวัง)",
  out: "เกิน 3SD (นอกเกณฑ์)",
};

export function monthRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (monthIndex < 1 || monthIndex > 12) return null;
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function currentMonthStr(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** "2026-11" → "พฤศจิกายน 2569" */
export function formatThaiMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month || "—";
  const name = THAI_MONTHS[Number(match[2]) - 1];
  return name ? `${name} ${Number(match[1]) + 543}` : month;
}

export interface ControlSeriesRecord {
  date: string;
  avg100: number;
  checkedAt: string;
}

export interface MonthlyPoint<R extends ControlSeriesRecord = ControlSeriesRecord> {
  day: number;
  date: string;
  value: number | null;
  record: R | null;
}

const timeOf = (iso: string) => Date.parse(iso) || 0;

/** 1 จุดต่อวันของเดือน (ใช้การบันทึกล่าสุดของวัน); วันไม่มีข้อมูล value = null */
export function buildMonthlySeries<R extends ControlSeriesRecord>(records: R[], month: string): MonthlyPoint<R>[] {
  const range = monthRange(month);
  if (!range) return [];
  const latestByDate = new Map<string, R>();
  for (const record of records) {
    if (!record?.date?.startsWith(`${month}-`) || !isFiniteNumber(record.avg100)) continue;
    const previous = latestByDate.get(record.date);
    if (!previous || timeOf(record.checkedAt) > timeOf(previous.checkedAt)) latestByDate.set(record.date, record);
  }
  const days = Number(range.to.slice(8));
  return Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const record = latestByDate.get(date) ?? null;
    return { day: index + 1, date, value: record ? record.avg100 : null, record };
  });
}

/** ค่าเฉลี่ยและ SD แบบ sample (n − 1) เหมือน STDEV ใน Excel */
export function monthlyStats(values: Array<number | null | undefined>): { n: number; mean: number | null; sd: number | null } {
  const nums = values.filter(isFiniteNumber);
  const n = nums.length;
  if (n === 0) return { n, mean: null, sd: null };
  const mean = nums.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { n, mean, sd: null };
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { n, mean, sd: Math.sqrt(variance) };
}

export function countByStatus(
  values: Array<number | null | undefined>,
  limits: ControlLimits | null,
): Record<ControlPointStatus, number> {
  const counts: Record<ControlPointStatus, number> = { in: 0, warning: 0, out: 0 };
  for (const value of values) {
    const status = classifyPoint(value, limits);
    if (status) counts[status] += 1;
  }
  return counts;
}

/** ขอบเขตแกน Y ที่ครอบทั้งเส้น UCL/LCL และค่าที่ได้ พร้อมเว้นขอบ 15% */
export function chartDomain(
  limits: ControlLimits | null,
  values: Array<number | null | undefined>,
): [number, number] | null {
  const nums = [...values.filter(isFiniteNumber), ...(limits ? [limits.lcl, limits.ucl] : [])];
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const pad = max > min ? (max - min) * 0.15 : Math.abs(max) * 0.0001 || 1;
  return [min - pad, max + pad];
}

/** จำนวนทศนิยมที่แสดงค่า Control: อย่างน้อย 4 ตำแหน่ง หรือเท่าความละเอียดเครื่อง */
export function controlDigits(scaleDecimals: number): number {
  return Math.max(scaleDecimals, 4);
}

/**
 * ทศนิยมที่ใช้แสดงค่า Control/ค่าที่ได้: อย่างน้อย controlDigits และละเอียดพอให้เห็นระยะ 1SD
 * เช่น SD 0.0000476 → 6 ตำแหน่ง (ไม่งั้น UWL/LWL/UCL/LCL จะปัดเป็นเลขเดียวกัน)
 */
export function displayDigits(scaleDecimals: number, sd: number | null | undefined): number {
  const base = controlDigits(scaleDecimals);
  if (!isFiniteNumber(sd) || sd <= 0) return base;
  return Math.min(8, Math.max(base, Math.ceil(-Math.log10(sd)) + 1));
}

export function formatControlNumber(value: number | null | undefined, digits: number): string {
  return isFiniteNumber(value) ? value.toFixed(digits) : "—";
}

/** SD แสดง 3 ตำแหน่งนัยสำคัญ เช่น 0.0000476 */
export function formatSd(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  if (value === 0) return "0";
  const digits = Math.min(20, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value)))));
  return value.toFixed(digits);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ข้อความเดียวกับ validate() ฝั่ง server */
export function validateBalanceControlInput(input: BalanceControlConfigInput): string | null {
  const { mean, sd, nominal, mpe, updatedDate } = input;
  if (!isFiniteNumber(mean)) return "ค่า Mean ต้องเป็นตัวเลข";
  if (!isFiniteNumber(sd)) return "ค่า STD ต้องเป็นตัวเลข";
  if (sd <= 0) return "ค่า STD ต้องมากกว่า 0";
  if (nominal != null && (!isFiniteNumber(nominal) || nominal <= 0)) return "น้ำหนักตุ้มต้องมากกว่า 0";
  if (mpe != null && (!isFiniteNumber(mpe) || mpe < 0)) return "ค่า MPE ต้องไม่ติดลบ";
  if (updatedDate && !DATE_RE.test(updatedDate)) return "วันที่ปรับปรุงต้องอยู่ในรูปแบบ YYYY-MM-DD";
  return null;
}
