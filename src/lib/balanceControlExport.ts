import type { Borders, Cell, Font, Workbook, Worksheet } from "exceljs";
import type { DailyCheckRecord } from "@/lib/api";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import {
  chartDomain,
  classifyPoint,
  displayDigits,
  type BalanceControlConfig,
  type BalanceScale,
  type ControlLimits,
  type MonthlyPoint,
} from "@/lib/balanceControlChart";

// Export Excel รายงาน Daily check เครื่องชั่ง ตามแบบฟอร์ม FM-WI-06-04-001-R00
// Sheet 1 = แบบบันทึก (หัวฟอร์ม + ตารางรายวัน + หมายเหตุ + กราฟ + ช่องลงชื่อ)
// Sheet 2 = "Control Chart" (Mean/STD/UWL/LWL/UCL/LCL + ข้อมูลที่ใช้ทำกราฟ)
// หมายเหตุ: exceljs สร้างกราฟ native ไม่ได้ จึงวาดกราฟเป็นรูป PNG แล้วแทรกลงใน sheet 1

export interface BalanceControlExportInput {
  scale: BalanceScale;
  config: BalanceControlConfig;
  limits: ControlLimits | null;
  series: MonthlyPoint<DailyCheckRecord>[];
  month: string;
}

export const BALANCE_FORM_CODE = "FM-WI-06-04-001-R00 (01/06/65)";
export const BALANCE_FORM_TITLE = "แบบบันทึกการตรวจสอบเครื่องชั่ง (Daily Check)";
export const BALANCE_CHART_TITLE = "Quality Control Chart For Balance Daliy Check";

const BASE_FONT: Partial<Font> = { name: "Cordia New", size: 14 };
const THIN = { style: "thin" } as const;
const MEDIUM = { style: "medium" } as const;
const FIRST_DATA_ROW = 8;

// สีกราฟเดียวกับ PRINT_CHART_PALETTE ใน BalanceControlChart (เอกสารพิมพ์ใช้สีตายตัว)
const CHART_COLORS = {
  value: "#1d4ed8",
  mean: "#dc2626",
  warningLine: "#16a34a",
  controlLine: "#d97706",
  warningDot: "#d97706",
  outDot: "#dc2626",
  grid: "#d1d5db",
  axis: "#111827",
};

const CHART_WIDTH = 900;
const CHART_HEIGHT = 520;
const CHART_FONT = "Tahoma, 'Leelawadee UI', Sarabun, sans-serif";

export function balanceControlFileName(scale: BalanceScale, month: string): string {
  return `QC-Balance-${scale.code}-${month}.xlsx`;
}

/** "YYYY-MM-DD" → "dd/mm/พ.ศ." (ว่างถ้ารูปแบบไม่ถูกต้อง) */
export function ddmmBE(date: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!match) return "";
  return `${match[3]}/${match[2]}/${Number(match[1]) + 543}`;
}

const numFmtFor = (decimals: number) => (decimals > 0 ? `0.${"0".repeat(decimals)}` : "0");

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

interface CellOptions {
  bold?: boolean;
  horizontal?: "left" | "center";
  border?: Partial<Borders>;
  numFmt?: string;
  font?: Partial<Font>;
}

/** กำหนด style ใหม่ทั้งก้อนให้แต่ละ cell (cell ใน merge ใช้ object style ร่วมกับ master ถ้าไม่สร้างใหม่) */
function styleCell(cell: Cell, { bold, horizontal, border, numFmt, font }: CellOptions = {}) {
  cell.style = {
    font: { ...BASE_FONT, ...(bold ? { bold: true } : {}), ...font },
    alignment: { vertical: "middle", ...(horizontal ? { horizontal } : {}) },
    ...(border ? { border } : {}),
    ...(numFmt ? { numFmt } : {}),
  };
}

function put(ws: Worksheet, address: string, value: Cell["value"], options: CellOptions = {}) {
  const cell = ws.getCell(address);
  cell.value = value;
  styleCell(cell, options);
  return cell;
}

function formula(expression: string, result: number | string | null | undefined): Cell["value"] {
  return isNum(result) || typeof result === "string" ? { formula: expression, result } : { formula: expression };
}

// ---------------------------------------------------------------------------
// รูปภาพ (กราฟ + โลโก้) — วาดผ่าน canvas; ถ้าไม่มี canvas (เช่นใน test) จะข้ามรูป
// ---------------------------------------------------------------------------

interface PngImage {
  base64: string;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function rasterize(
  src: string,
  size: (image: HTMLImageElement) => { width: number; height: number },
  background?: string,
): Promise<PngImage | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = await withTimeout(loadImage(src), 3000);
    if (!image) return null;
    const { width, height } = size(image);
    if (!(width > 0 && height > 0)) return null;
    canvas.width = width;
    canvas.height = height;
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const url = canvas.toDataURL("image/png");
    const prefix = "data:image/png;base64,";
    if (!url.startsWith(prefix)) return null;
    return { base64: url.slice(prefix.length), width, height };
  } catch {
    return null;
  }
}

/** โลโก้เป็น webp ซึ่ง Excel ไม่รองรับ จึงแปลงเป็น PNG ก่อน */
function logoToPng(): Promise<PngImage | null> {
  return rasterize(ICP_LADDA_LOGO_URL, (image) => ({
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  }));
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** ประมาณความกว้างข้อความ (ไม่นับสระ/วรรณยุกต์ไทยที่ไม่กินที่) */
const estimateTextWidth = (text: string, fontSize: number) =>
  text.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length * fontSize * 0.56;

/** SVG กราฟ Quality Control (1 จุดต่อวัน) สำหรับแปลงเป็น PNG ใส่ใน Excel */
export function buildBalanceChartSvg(
  series: MonthlyPoint[],
  limits: ControlLimits,
  domain: [number, number],
  digits: number,
): string {
  const W = CHART_WIDTH;
  const H = CHART_HEIGHT;
  const left = 100;
  const right = W - 56;
  const top = 52;
  const bottom = 420;
  const days = Math.max(series.length, 1);
  const [low, high] = domain;
  const span = high - low || 1;
  const x = (day: number) => (days > 1 ? left + ((day - 1) / (days - 1)) * (right - left) : (left + right) / 2);
  const y = (value: number) => top + ((high - value) / span) * (bottom - top);
  const c = CHART_COLORS;
  const parts: string[] = [];

  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${W / 2}" y="30" text-anchor="middle" font-size="20" font-weight="700" fill="${c.axis}">${escapeXml(BALANCE_CHART_TITLE)}</text>`,
  );

  const ticks = 7;
  for (let index = 0; index < ticks; index += 1) {
    const value = low + (span * index) / (ticks - 1);
    const yy = y(value).toFixed(1);
    parts.push(`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="${c.grid}" stroke-dasharray="3 3"/>`);
    parts.push(
      `<text x="${left - 8}" y="${Number(yy) + 4}" text-anchor="end" font-size="12" fill="${c.axis}">${value.toFixed(digits)}</text>`,
    );
  }

  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="${c.axis}"/>`);
  parts.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${c.axis}"/>`);
  for (const point of series) {
    const xx = x(point.day).toFixed(1);
    parts.push(`<line x1="${xx}" y1="${bottom}" x2="${xx}" y2="${bottom + 5}" stroke="${c.axis}"/>`);
    parts.push(`<text x="${xx}" y="${bottom + 20}" text-anchor="middle" font-size="12" fill="${c.axis}">${point.day}</text>`);
  }
  parts.push(
    `<text x="${(left + right) / 2}" y="${bottom + 42}" text-anchor="middle" font-size="13" fill="${c.axis}">วันที่</text>`,
  );

  const referenceLines: Array<[string, number, string, string | null]> = [
    ["UCL", limits.ucl, c.controlLine, "2 4"],
    ["UWL", limits.uwl, c.warningLine, "6 4"],
    ["Mean", limits.mean, c.mean, null],
    ["LWL", limits.lwl, c.warningLine, "6 4"],
    ["LCL", limits.lcl, c.controlLine, "2 4"],
  ];
  for (const [label, value, stroke, dash] of referenceLines) {
    const yy = y(value).toFixed(1);
    parts.push(
      `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="${stroke}" stroke-width="1.6"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
    );
    parts.push(`<text x="${right + 6}" y="${Number(yy) + 4}" font-size="12" fill="${stroke}">${label}</text>`);
  }

  const points = series.filter((point): point is MonthlyPoint & { value: number } => isNum(point.value));
  if (points.length > 1) {
    const path = points.map((point) => `${x(point.day).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
    parts.push(`<polyline points="${path}" fill="none" stroke="${c.value}" stroke-width="2"/>`);
  }
  for (const point of points) {
    const status = classifyPoint(point.value, limits);
    const fill = status === "out" ? c.outDot : status === "warning" ? c.warningDot : c.value;
    const radius = status === "in" ? 3.5 : 5;
    parts.push(
      `<circle cx="${x(point.day).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="${radius}" fill="${fill}" stroke="#ffffff" stroke-width="1"/>`,
    );
  }

  const legend: Array<{ label: string; stroke?: string; dash?: string; dot?: string }> = [
    { label: "ค่าที่ได้ (เฉลี่ยตุ้ม 100 g)", stroke: c.value, dot: c.value },
    { label: "Mean", stroke: c.mean },
    { label: "UWL / LWL (±2SD)", stroke: c.warningLine, dash: "6 4" },
    { label: "UCL / LCL (±3SD)", stroke: c.controlLine, dash: "2 4" },
    { label: "จุดเกิน 2SD", dot: c.warningDot },
    { label: "จุดเกิน 3SD", dot: c.outDot },
  ];
  const legendFont = 12;
  const swatch = 24;
  const gap = 20;
  const widths = legend.map((item) => swatch + 6 + estimateTextWidth(item.label, legendFont));
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (legend.length - 1);
  let cursor = Math.max(10, (W - total) / 2);
  const legendY = H - 22;
  legend.forEach((item, index) => {
    if (item.stroke) {
      parts.push(
        `<line x1="${cursor}" y1="${legendY}" x2="${cursor + swatch}" y2="${legendY}" stroke="${item.stroke}" stroke-width="2"${item.dash ? ` stroke-dasharray="${item.dash}"` : ""}/>`,
      );
    }
    if (item.dot) parts.push(`<circle cx="${cursor + swatch / 2}" cy="${legendY}" r="4" fill="${item.dot}"/>`);
    parts.push(
      `<text x="${cursor + swatch + 6}" y="${legendY + 4}" font-size="${legendFont}" fill="${c.axis}">${escapeXml(item.label)}</text>`,
    );
    cursor += widths[index] + gap;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${CHART_FONT}">${parts.join("")}</svg>`;
}

function renderChartPng(
  series: MonthlyPoint[],
  limits: ControlLimits | null,
  digits: number,
): Promise<PngImage | null> {
  const domain = chartDomain(
    limits,
    series.map((point) => point.value),
  );
  if (!limits || !domain) return Promise.resolve(null);
  const svg = buildBalanceChartSvg(series, limits, domain, digits);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  // วาดที่ 2 เท่าให้รูปคมเมื่อพิมพ์
  return rasterize(src, () => ({ width: CHART_WIDTH * 2, height: CHART_HEIGHT * 2 }), "#ffffff");
}

// ---------------------------------------------------------------------------
// Sheet 1: แบบบันทึก Daily check
// ---------------------------------------------------------------------------

function buildFormSheet(workbook: Workbook, input: BalanceControlExportInput, logo: PngImage | null, chart: PngImage | null) {
  const { scale, config, series } = input;
  const ws = workbook.addWorksheet(`เครื่องชั่ง ${scale.decimals} ตำแหน่ง`, {
    pageSetup: {
      orientation: "portrait",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: `&L${BALANCE_FORM_CODE} P1/1` },
  });
  ws.columns = [13.44, 9.44, 9.44, 9.44, 9.44, 9.11, 9.11, 9.11, 9.11, 9.11].map((width) => ({ width }));
  const valueFmt = numFmtFor(scale.decimals);

  // หัวฟอร์ม
  ws.getRow(1).height = 20.25;
  ws.mergeCells("A1:I1");
  put(ws, "A1", BALANCE_FORM_TITLE, { bold: true, horizontal: "center" });
  if (logo) {
    const height = 37;
    const width = Math.round((logo.width / logo.height) * height);
    const id = workbook.addImage({ base64: logo.base64, extension: "png" });
    ws.addImage(id, { tl: { col: 0.05, row: 0.05 }, ext: { width, height } });
  }
  ws.getRow(2).height = 12;

  ws.getRow(3).height = 19.5;
  ws.mergeCells("A3:B3");
  ws.mergeCells("F3:G3");
  put(ws, "A3", "รหัสเครื่องมือ  :", { bold: true, horizontal: "left" });
  put(ws, "C3", scale.code, { bold: true, horizontal: "center", border: { bottom: THIN } });
  put(ws, "E3", "ยี่ห้อ : ", { bold: true, horizontal: "left" });
  put(ws, "F3", config.brand ?? "", { bold: true, horizontal: "center", border: { bottom: THIN } });
  styleCell(ws.getCell("G3"), { bold: true, horizontal: "center", border: { bottom: THIN } });
  put(ws, "H3", "     รุ่น  :", { bold: true });
  put(ws, "I3", config.model || scale.model || "", { bold: true, horizontal: "center", border: { bottom: THIN } });

  ws.getRow(4).height = 18.75;
  put(ws, "A4", "รหัสตุ้มน้ำหนัก  : ", { bold: true });
  put(ws, "C4", config.weightCode ?? "", { bold: true, horizontal: "center", border: { top: THIN, bottom: THIN } });
  put(ws, "E4", "น้ำหนักตุ้ม Daily check  :", { bold: true });
  put(ws, "H4", isNum(config.nominal) ? config.nominal : "", { bold: true, horizontal: "center", border: { bottom: THIN } });
  put(ws, "I4", "g", { bold: true });
  ws.getRow(5).height = 12;

  // หัวตาราง 2 ชั้น
  ws.getRow(6).height = 12;
  ws.getRow(7).height = 12;
  for (const range of ["A6:A7", "B6:D6", "E6:E7", "F6:F7", "G6:G7", "H6:H7"]) ws.mergeCells(range);
  const columns = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (const row of [6, 7]) {
    for (const column of columns) {
      styleCell(ws.getCell(`${column}${row}`), {
        horizontal: "center",
        border: {
          top: row === 6 ? MEDIUM : THIN,
          bottom: THIN,
          left: column === "A" ? MEDIUM : THIN,
          right: column === "H" ? MEDIUM : THIN,
        },
      });
    }
  }
  ws.getCell("A6").value = "ว/ด/ป";
  ws.getCell("B6").value = "ครั้งที่";
  ws.getCell("B7").value = 1;
  ws.getCell("C7").value = 2;
  ws.getCell("D7").value = 3;
  ws.getCell("E6").value = "Mean ";
  ws.getCell("F6").value = "Result *";
  ws.getCell("G6").value = "หมายเหตุ";
  ws.getCell("H6").value = "ผู้บันทึก";

  // แถวข้อมูล 1 แถวต่อวัน
  series.forEach((point, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    ws.getRow(rowNumber).height = 12;
    const record = point.record;
    const border = (column: string): Partial<Borders> => ({
      top: THIN,
      bottom: THIN,
      left: column === "A" ? MEDIUM : THIN,
      right: column === "H" ? MEDIUM : THIN,
    });
    put(ws, `A${rowNumber}`, ddmmBE(point.date), { horizontal: "center", border: border("A") });
    ["B", "C", "D"].forEach((column, weightIndex) => {
      const weight = Number(record?.weights100?.[weightIndex]);
      const hasWeight = record?.weights100?.[weightIndex] !== undefined && record?.weights100?.[weightIndex] !== "";
      put(ws, `${column}${rowNumber}`, hasWeight && isNum(weight) ? weight : null, {
        horizontal: "center",
        border: border(column),
        numFmt: valueFmt,
      });
    });
    put(ws, `E${rowNumber}`, formula(`IFERROR(AVERAGE(B${rowNumber}:D${rowNumber}),"")`, record ? record.avg100 : ""), {
      horizontal: "center",
      border: border("E"),
      numFmt: valueFmt,
    });
    const result = record?.status100 ?? record?.status;
    put(ws, `F${rowNumber}`, result === "pass" ? "∕" : result === "fail" ? "X" : null, {
      horizontal: "center",
      border: border("F"),
      font: result === "pass" ? { name: "Calibri" } : undefined,
    });
    put(ws, `G${rowNumber}`, null, { horizontal: "center", border: border("G") });
    put(ws, `H${rowNumber}`, record?.recorder ?? null, { horizontal: "center", border: border("H") });
  });

  const lastDataRow = FIRST_DATA_ROW + Math.max(series.length, 1) - 1;
  const noteRow = lastDataRow + 3;
  for (let row = lastDataRow + 1; row < noteRow; row += 1) ws.getRow(row).height = 12;

  // หมายเหตุ
  ws.getRow(noteRow).height = 14.25;
  ws.mergeCells(`A${noteRow}:B${noteRow}`);
  ws.mergeCells(`C${noteRow}:D${noteRow}`);
  put(ws, `A${noteRow}`, "  หมายเหตุ :", { bold: true, horizontal: "center" });
  put(ws, `C${noteRow}`, "*   Result :          ", { horizontal: "left" });
  put(ws, `E${noteRow}`, {
    richText: [
      { font: { name: "Wingdings", size: 14 }, text: "ü" },
      { font: { name: "Cordia New", size: 14 }, text: "  " },
      { font: { name: "Cordia New", size: 14, bold: true }, text: "=   ผ่าน" },
    ],
  });
  put(ws, `G${noteRow}`, {
    richText: [
      { font: { name: "Cordia New", size: 14 }, text: "X  = " },
      { font: { name: "Cordia New", size: 14, bold: true }, text: "ไม่ผ่าน" },
    ],
  });

  // กราฟ (รูป PNG) ใต้หมายเหตุ
  for (let row = noteRow + 1; row < noteRow + 20; row += 1) ws.getRow(row).height = 15;
  if (chart) {
    const id = workbook.addImage({ base64: chart.base64, extension: "png" });
    ws.addImage(id, { tl: { col: 0, row: noteRow }, ext: { width: 655, height: Math.round((655 * CHART_HEIGHT) / CHART_WIDTH) } });
  } else {
    const message = input.limits
      ? "สร้างรูปกราฟไม่สำเร็จ ดูข้อมูลใน sheet Control Chart"
      : "ยังไม่ได้ตั้งค่า Control (Mean/STD) จึงยังไม่มีกราฟ";
    put(ws, `A${noteRow + 2}`, message, { horizontal: "left" });
  }

  // ช่องลงชื่อผู้ตรวจสอบ
  const signRow = noteRow + 20;
  ws.getRow(signRow).height = 20.25;
  put(ws, `A${signRow}`, "ผู้ตรวจสอบ : __________________________________");
  put(ws, `G${signRow}`, "วันที่ : ____________________________");

  ws.pageSetup.printArea = `A1:I${signRow}`;
}

// ---------------------------------------------------------------------------
// Sheet 2: Control Chart (ค่า Control + ข้อมูลที่ใช้ทำกราฟ)
// ---------------------------------------------------------------------------

function buildControlSheet(workbook: Workbook, input: BalanceControlExportInput) {
  const { scale, config, limits, series } = input;
  const ws = workbook.addWorksheet("Control Chart", {
    pageSetup: { orientation: "portrait", paperSize: 9, fitToPage: false },
  });
  ws.getColumn("A").width = 10;
  ws.getColumn("D").width = 9.44;
  ws.getColumn("I").width = 14.55;

  const center = (options: CellOptions = {}): CellOptions => ({ horizontal: "center", ...options });
  const valueFmt = numFmtFor(Math.max(scale.decimals, 5));
  const limitFmt = numFmtFor(displayDigits(scale.decimals, limits?.sd ?? config.sd));
  const mean = limits?.mean ?? config.mean;
  const sd = limits?.sd ?? config.sd;

  put(ws, "A1", "Mean", center());
  put(ws, "B1", isNum(mean) ? mean : null, center({ numFmt: limitFmt, border: { bottom: THIN } }));
  put(ws, "C1", "STD", center());
  put(ws, "D1", isNum(sd) ? sd : null, center({ numFmt: "0.0000000", border: { bottom: THIN } }));
  put(ws, "F1", isNum(config.nominal) ? config.nominal : null, center({ numFmt: valueFmt }));
  put(ws, "H1", "Update ", center());
  put(ws, "I1", ddmmBE(config.updatedDate), center());

  const sd2 = isNum(sd) ? sd * 2 : null;
  const sd3 = isNum(sd) ? sd * 3 : null;
  put(ws, "C2", "2SD", center());
  put(ws, "D2", formula("D1*2", sd2), center({ numFmt: "0.0000000", border: { top: THIN, bottom: THIN } }));
  put(ws, "C3", "3SD", center());
  put(ws, "D3", formula("D1*3", sd3), center({ numFmt: "0.0000000", border: { bottom: THIN } }));

  const limitRows: Array<[number, string, string, number | undefined, string]> = [
    [4, "UWL", "B1+D2", limits?.uwl, " +2SD"],
    [5, "LWL", "B1-D2", limits?.lwl, " -2SD"],
    [6, "UCL", "B1+D3", limits?.ucl, " +3SD"],
    [7, "LCL", "B1-D3", limits?.lcl, " -3SD"],
  ];
  for (const [row, label, expression, result, note] of limitRows) {
    put(ws, `A${row}`, label, center());
    put(ws, `B${row}`, formula(expression, result), center({ numFmt: limitFmt }));
    put(ws, `D${row}`, note, center());
  }
  put(ws, "E4", "MPE", center());
  put(ws, "F4", isNum(config.mpe) ? config.mpe : null, center({ numFmt: "0.00" }));

  const allBorders: Partial<Borders> = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  const header = [" ซ้ำที่", "ค่าที่ได้", "Mean", "UWL", "LWL", "UCL", "LCL"];
  header.forEach((label, index) => {
    put(ws, `${String.fromCharCode(65 + index)}9`, label, center({ border: allBorders }));
  });

  const refs: Array<[string, string, number | undefined]> = [
    ["C", "B$1", limits?.mean],
    ["D", "B$4", limits?.uwl],
    ["E", "B$5", limits?.lwl],
    ["F", "B$6", limits?.ucl],
    ["G", "B$7", limits?.lcl],
  ];
  const points = series.filter((point) => isNum(point.value));
  points.forEach((point, index) => {
    const row = 10 + index;
    put(ws, `A${row}`, index + 1, center({ border: allBorders, numFmt: "0" }));
    put(ws, `B${row}`, point.value, center({ border: allBorders, numFmt: valueFmt }));
    for (const [column, expression, result] of refs) {
      put(ws, `${column}${row}`, formula(expression, result), center({ border: allBorders, numFmt: limitFmt }));
    }
  });

  const lastRow = Math.max(9 + points.length, 9);
  for (let row = 1; row <= lastRow; row += 1) ws.getRow(row).height = 21;
}

export async function buildBalanceControlWorkbook(input: BalanceControlExportInput): Promise<Workbook> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LIS";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const digits = displayDigits(input.scale.decimals, input.limits?.sd ?? input.config.sd);
  const [logo, chart] = await Promise.all([logoToPng(), renderChartPng(input.series, input.limits, digits)]);

  buildFormSheet(workbook, input, logo, chart);
  buildControlSheet(workbook, input);
  return workbook;
}

export async function exportBalanceControlExcel(input: BalanceControlExportInput): Promise<void> {
  const workbook = await buildBalanceControlWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = balanceControlFileName(input.scale, input.month);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
