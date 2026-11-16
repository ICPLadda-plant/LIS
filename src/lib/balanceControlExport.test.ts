import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DailyCheckRecord } from "@/lib/api";
import {
  BALANCE_SCALES,
  buildMonthlySeries,
  computeLimits,
  getBalanceControlConfig,
} from "@/lib/balanceControlChart";
import {
  balanceControlFileName,
  buildBalanceChartSvg,
  buildBalanceControlWorkbook,
  ddmmBE,
} from "@/lib/balanceControlExport";

const record = {
  scaleId: "scale-4",
  scaleName: "LD-047",
  weights100: ["100.0001", "100.0002", "100.0003"],
  weights10: ["", "", ""],
  avg100: 100.0002,
  avg10: 0,
  status100: "pass",
  status10: "pass",
  status: "pass",
  recorder: "สมชาย",
  date: "2026-09-04",
  checkedAt: "2026-09-04T01:00:00.000Z",
} as DailyCheckRecord;

const failRecord = {
  ...record,
  weights100: ["100.0010", "100.0010", "100.0010"],
  avg100: 100.001,
  status100: "fail",
  status: "fail",
  recorder: "สมหญิง",
  date: "2026-09-05",
  checkedAt: "2026-09-05T01:00:00.000Z",
} as DailyCheckRecord;

const scale = BALANCE_SCALES[3];
const config = getBalanceControlConfig([], "scale-4");
const series = buildMonthlySeries([record, failRecord], "2026-09");
const limits = computeLimits(100, 0.0001);

describe("balanceControlExport", () => {
  beforeAll(() => {
    // jsdom ไม่มี canvas → ข้ามรูปกราฟ/โลโก้ (ไม่ให้ jsdom log not-implemented)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("แปลงวันที่เป็น dd/mm/พ.ศ.", () => {
    expect(ddmmBE("2026-09-04")).toBe("04/09/2569");
    expect(ddmmBE("")).toBe("");
  });

  it("ตั้งชื่อไฟล์ตามรหัสเครื่องและเดือน", () => {
    expect(balanceControlFileName(scale, "2026-09")).toBe("QC-Balance-LD-047-2026-09.xlsx");
  });

  it("สร้าง sheet แบบบันทึกตามฟอร์ม FM-WI-06-04-001", async () => {
    const workbook = await buildBalanceControlWorkbook({ scale, config, limits, series, month: "2026-09" });
    const ws = workbook.getWorksheet("เครื่องชั่ง 5 ตำแหน่ง");
    expect(ws).toBeDefined();
    if (!ws) return;

    const merges = (ws.model as { merges: string[] }).merges;
    expect(merges).toEqual(
      expect.arrayContaining(["A1:I1", "A3:B3", "F3:G3", "A6:A7", "B6:D6", "E6:E7", "F6:F7", "G6:G7", "H6:H7", "A40:B40", "C40:D40"]),
    );
    expect(ws.getCell("A1").value).toBe("แบบบันทึกการตรวจสอบเครื่องชั่ง (Daily Check)");
    expect(ws.getCell("C3").value).toBe("LD-047");
    expect(ws.getCell("F3").value).toBe("Mettler Toledo");
    expect(ws.getCell("I3").value).toBe("MX205DU");
    expect(ws.getCell("H4").value).toBe(100);
    expect(ws.getCell("A6").value).toBe("ว/ด/ป");
    expect(ws.getCell("B6").value).toBe("ครั้งที่");
    expect([ws.getCell("B7").value, ws.getCell("C7").value, ws.getCell("D7").value]).toEqual([1, 2, 3]);
    expect(ws.getCell("F6").value).toBe("Result *");
    expect(ws.getCell("H6").value).toBe("ผู้บันทึก");

    // 1 แถวต่อวัน เริ่มแถว 8 (01/09) → 04/09 อยู่แถว 11
    expect(ws.getCell("A8").value).toBe("01/09/2569");
    expect(ws.getCell("A37").value).toBe("30/09/2569");
    expect(ws.getCell("A11").value).toBe("04/09/2569");
    expect(ws.getCell("B11").value).toBe(100.0001);
    expect(ws.getCell("D11").numFmt).toBe("0.00000");
    expect(ws.getCell("E11").value).toEqual({ formula: 'IFERROR(AVERAGE(B11:D11),"")', result: 100.0002 });
    expect(ws.getCell("F11").value).toBe("∕");
    expect(ws.getCell("F12").value).toBe("X");
    expect(ws.getCell("H11").value).toBe("สมชาย");
    expect(ws.getCell("A11").border?.left?.style).toBe("medium");
    expect(ws.getCell("H11").border?.right?.style).toBe("medium");
    expect(ws.getCell("A6").border?.top?.style).toBe("medium");
    expect(ws.getCell("A8").border?.top?.style).toBe("thin");

    expect(ws.getCell("A40").value).toBe("  หมายเหตุ :");
    expect(ws.getCell("A60").value).toBe("ผู้ตรวจสอบ : __________________________________");
    expect(ws.getCell("G60").value).toBe("วันที่ : ____________________________");
    expect(ws.pageSetup.orientation).toBe("portrait");
    expect(ws.headerFooter.oddFooter).toContain("FM-WI-06-04-001-R00");
  });

  it("สร้าง sheet Control Chart พร้อมสูตร UWL/LWL/UCL/LCL", async () => {
    const workbook = await buildBalanceControlWorkbook({ scale, config, limits, series, month: "2026-09" });
    const ws = workbook.getWorksheet("Control Chart");
    expect(ws).toBeDefined();
    if (!ws) return;
    expect(ws.getCell("B1").value).toBe(100);
    expect(ws.getCell("D1").value).toBe(0.0001);
    expect(ws.getCell("B4").value).toMatchObject({ formula: "B1+D2" });
    expect(ws.getCell("B5").value).toMatchObject({ formula: "B1-D2" });
    expect(ws.getCell("B6").value).toMatchObject({ formula: "B1+D3" });
    expect(ws.getCell("B7").value).toMatchObject({ formula: "B1-D3" });
    expect(ws.getCell("A9").value).toBe(" ซ้ำที่");
    expect(ws.getCell("A10").value).toBe(1);
    expect(ws.getCell("B10").value).toBe(100.0002);
    expect(ws.getCell("B11").value).toBe(100.001);
    expect(ws.getCell("G10").value).toMatchObject({ formula: "B$7" });
  });

  it("ไม่ error เมื่อยังไม่ได้ตั้งค่า Control", async () => {
    const workbook = await buildBalanceControlWorkbook({ scale, config, limits: null, series: [], month: "2026-09" });
    expect(workbook.worksheets).toHaveLength(2);
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("วาดกราฟ SVG มีเส้น Control ครบ", () => {
    if (!limits) throw new Error("limits");
    const svg = buildBalanceChartSvg(series, limits, [99.9995, 100.0015], 5);
    expect(svg).toContain("Quality Control Chart For Balance Daliy Check");
    for (const label of ["UCL", "UWL", "Mean", "LWL", "LCL"]) expect(svg).toContain(`>${label}<`);
    expect(svg).toContain("<polyline");
  });
});
