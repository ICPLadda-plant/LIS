import type { Workbook } from "exceljs";
import type { DailyCheckRecord } from "@/lib/api";
import {
  CONTROL_STATUS_LABEL,
  balanceScaleTypeLabel,
  classifyPoint,
  countByStatus,
  formatThaiMonth,
  monthlyStats,
  type BalanceControlConfig,
  type BalanceScale,
  type ControlLimits,
  type MonthlyPoint,
} from "@/lib/balanceControlChart";

// Export Excel ของ Quality Control Chart เครื่องชั่ง — คอลัมน์ตามแบบฟอร์ม Excel เดิม
// (ซ้ำที่, ค่าที่ได้, Mean, UWL, LWL, UCL, LCL) เพื่อให้นำไปทำกราฟต่อใน Excel ได้ทันที

export interface BalanceControlExportInput {
  scale: BalanceScale;
  config: BalanceControlConfig;
  limits: ControlLimits | null;
  series: MonthlyPoint<DailyCheckRecord>[];
  month: string;
}

export const BALANCE_CONTROL_TABLE_HEADER = [
  "ซ้ำที่",
  "วันที่",
  "ค่าที่ได้ (g)",
  "Mean",
  "UWL",
  "LWL",
  "UCL",
  "LCL",
  "ผลเทียบเส้น Control",
  "ผู้บันทึก",
];

export function balanceControlFileName(scale: BalanceScale, month: string): string {
  return `QC-Balance-${scale.code}-${month}.xlsx`;
}

const ddmmyyyy = (date: string) => {
  const [y, m, d] = date.split("-");
  return y && m && d ? `${d}/${m}/${y}` : date;
};

export async function buildBalanceControlWorkbook({
  scale,
  config,
  limits,
  series,
  month,
}: BalanceControlExportInput): Promise<Workbook> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LIS";
  const sheet = workbook.addWorksheet(`QC ${scale.code}`);
  const numFmt = `0.${"0".repeat(Math.max(scale.decimals + 2, 6))}`;

  sheet.columns = [
    { width: 8 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 22 },
    { width: 24 },
  ];

  sheet.addRow(["Quality Control Chart For Balance Daily Check"]).font = { bold: true, size: 14 };
  sheet.addRow([]);

  const info: Array<[string, string | number]> = [
    ["รหัสเครื่องมือ", scale.code],
    ["ชื่อเครื่องมือ", balanceScaleTypeLabel(scale)],
    ["ยี่ห้อ", config.brand],
    ["รุ่น", config.model],
    ["รหัสตุ้มน้ำหนัก", config.weightCode],
    ["น้ำหนักตุ้ม Daily check (g)", config.nominal],
    ["ประจำเดือน/ปี", formatThaiMonth(month)],
    ["ปรับปรุงค่า Control", config.updatedDate ? ddmmyyyy(config.updatedDate) : ""],
  ];
  for (const [label, value] of info) {
    const row = sheet.addRow([label, "", value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow([]);

  const control: Array<[string, number | null]> = [
    ["Mean", limits?.mean ?? null],
    ["STD", limits?.sd ?? null],
    ["2SD", limits ? limits.sd * 2 : null],
    ["3SD", limits ? limits.sd * 3 : null],
    ["UWL (+2SD)", limits?.uwl ?? null],
    ["LWL (−2SD)", limits?.lwl ?? null],
    ["UCL (+3SD)", limits?.ucl ?? null],
    ["LCL (−3SD)", limits?.lcl ?? null],
    ["MPE (g)", config.mpe],
  ];
  sheet.addRow(["ค่า Control"]).font = { bold: true };
  for (const [label, value] of control) {
    const row = sheet.addRow([label, "", value ?? "—"]);
    row.getCell(1).font = { bold: true };
    if (typeof value === "number") row.getCell(3).numFmt = label.includes("SD") && !label.includes("(") ? "0.0000000" : numFmt;
  }
  sheet.addRow([]);

  const header = sheet.addRow(BALANCE_CONTROL_TABLE_HEADER);
  header.font = { bold: true };
  header.alignment = { horizontal: "center" };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  const recorded = series.filter((point) => point.record && point.value != null);
  recorded.forEach((point, index) => {
    const status = classifyPoint(point.value, limits);
    const row = sheet.addRow([
      index + 1,
      ddmmyyyy(point.date),
      point.value,
      limits?.mean ?? "",
      limits?.uwl ?? "",
      limits?.lwl ?? "",
      limits?.ucl ?? "",
      limits?.lcl ?? "",
      status ? CONTROL_STATUS_LABEL[status] : "",
      point.record?.recorder ?? "",
    ]);
    for (let col = 3; col <= 8; col += 1) row.getCell(col).numFmt = numFmt;
    row.eachCell((c) => {
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
  });

  const values = series.map((point) => point.value);
  const counts = countByStatus(values, limits);
  const stats = monthlyStats(values);
  sheet.addRow([]);
  sheet.addRow(["สรุป", "", `บันทึก ${stats.n} วัน`, `อยู่ในเกณฑ์ ${counts.in}`, `เกิน 2SD ${counts.warning}`, `เกิน 3SD ${counts.out}`]).font = {
    bold: true,
  };
  const statRow = sheet.addRow(["ค่าเฉลี่ยจริง", "", stats.mean ?? "—", "STD จริง", stats.sd ?? "—"]);
  if (stats.mean != null) statRow.getCell(3).numFmt = numFmt;
  if (stats.sd != null) statRow.getCell(5).numFmt = "0.0000000";

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
