import { describe, expect, it } from "vitest";
import {
  BALANCE_CONTROL_DEFAULTS,
  buildMonthlySeries,
  chartDomain,
  classifyPoint,
  computeLimits,
  countByStatus,
  displayDigits,
  formatSd,
  formatThaiMonth,
  getBalanceControlConfig,
  monthlyStats,
  monthRange,
  validateBalanceControlInput,
} from "./balanceControlChart";

describe("computeLimits", () => {
  it("คำนวณ UWL/LWL ที่ ±2SD และ UCL/LCL ที่ ±3SD", () => {
    const limits = computeLimits(99.99972, 0.0000476)!;
    expect(limits.uwl).toBeCloseTo(99.9998152, 7);
    expect(limits.lwl).toBeCloseTo(99.9996248, 7);
    expect(limits.ucl).toBeCloseTo(99.9998628, 7);
    // LCL ต้องเป็น Mean − 3SD (ไม่ใช่ค่าเดียวกับ UCL)
    expect(limits.lcl).toBeCloseTo(99.9995772, 7);
  });

  it("คืน null เมื่อยังไม่ได้ตั้งค่าหรือ SD ไม่ถูกต้อง", () => {
    expect(computeLimits(null, 0.1)).toBeNull();
    expect(computeLimits(100, null)).toBeNull();
    expect(computeLimits(100, 0)).toBeNull();
  });
});

describe("classifyPoint", () => {
  const limits = computeLimits(100, 0.001);

  it("แยกสถานะตามระยะห่างจาก Mean", () => {
    expect(classifyPoint(100.0015, limits)).toBe("in");
    expect(classifyPoint(100.002, limits)).toBe("in");
    expect(classifyPoint(99.9975, limits)).toBe("warning");
    expect(classifyPoint(100.003, limits)).toBe("warning");
    expect(classifyPoint(100.0031, limits)).toBe("out");
  });

  it("คืน null เมื่อไม่มีค่าหรือไม่มีเส้นควบคุม", () => {
    expect(classifyPoint(null, limits)).toBeNull();
    expect(classifyPoint(100, null)).toBeNull();
  });

  it("นับจำนวนจุดตามสถานะ", () => {
    expect(countByStatus([100, null, 99.9975, 100.004], limits)).toEqual({ in: 1, warning: 1, out: 1 });
  });
});

describe("buildMonthlySeries", () => {
  it("สร้าง 1 จุดต่อวันและใช้ค่าล่าสุดของวัน", () => {
    const series = buildMonthlySeries(
      [
        { date: "2026-11-03", avg100: 100.01, checkedAt: "2026-11-03T01:00:00.000Z" },
        { date: "2026-11-03", avg100: 100.02, checkedAt: "2026-11-03T08:00:00.000Z" },
        { date: "2026-11-30", avg100: 99.99, checkedAt: "2026-11-30T01:00:00.000Z" },
        { date: "2026-10-31", avg100: 50, checkedAt: "2026-10-31T01:00:00.000Z" },
      ],
      "2026-11",
    );
    expect(series).toHaveLength(30);
    expect(series[0]).toMatchObject({ day: 1, date: "2026-11-01", value: null });
    expect(series[2].value).toBe(100.02);
    expect(series[29].value).toBe(99.99);
  });

  it("รองรับเดือนกุมภาพันธ์และเดือนที่รูปแบบผิด", () => {
    expect(buildMonthlySeries([], "2028-02")).toHaveLength(29);
    expect(buildMonthlySeries([], "2026-13")).toEqual([]);
  });
});

describe("monthRange / formatThaiMonth", () => {
  it("คืนวันแรกและวันสุดท้ายของเดือน", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange("bad")).toBeNull();
  });

  it("แสดงเดือนแบบไทย พ.ศ.", () => {
    expect(formatThaiMonth("2026-11")).toBe("พฤศจิกายน 2569");
  });
});

describe("monthlyStats", () => {
  it("ใช้ SD แบบ sample (n − 1)", () => {
    const stats = monthlyStats([2, 4, 4, 4, 5, 5, 7, 9, null]);
    expect(stats.n).toBe(8);
    expect(stats.mean).toBe(5);
    expect(stats.sd).toBeCloseTo(2.13809, 5);
  });

  it("ข้อมูลไม่พอคำนวณ SD", () => {
    expect(monthlyStats([])).toEqual({ n: 0, mean: null, sd: null });
    expect(monthlyStats([100])).toEqual({ n: 1, mean: 100, sd: null });
  });
});

describe("chartDomain / formatSd", () => {
  it("ครอบทั้งเส้นควบคุมและค่าที่ได้", () => {
    const [min, max] = chartDomain(computeLimits(100, 0.001), [100.01])!;
    expect(min).toBeLessThan(99.997);
    expect(max).toBeGreaterThan(100.01);
  });

  it("แสดง SD 3 ตำแหน่งนัยสำคัญ", () => {
    expect(formatSd(0.0000476)).toBe("0.0000476");
    expect(formatSd(null)).toBe("—");
  });

  it("เพิ่มทศนิยมให้พอเห็นระยะ 1SD", () => {
    expect(displayDigits(2, null)).toBe(4);
    expect(displayDigits(5, null)).toBe(5);
    expect(displayDigits(2, 0.01)).toBe(4);
    expect(displayDigits(5, 0.0000476)).toBe(6);
    expect(displayDigits(5, 1e-12)).toBe(8);
  });
});

describe("config defaults / validation", () => {
  it("มีค่าเริ่มต้นครบ 5 เครื่องและยังไม่มีค่า Control", () => {
    expect(BALANCE_CONTROL_DEFAULTS.map((config) => config.scaleId)).toEqual([
      "scale-1", "scale-2", "scale-3", "scale-4", "scale-5",
    ]);
    expect(getBalanceControlConfig(undefined, "scale-1")).toMatchObject({ mean: null, sd: null, nominal: 100 });
  });

  it("ตรวจค่าที่กรอกด้วยข้อความเดียวกับ server", () => {
    expect(validateBalanceControlInput({ mean: NaN, sd: 1 })).toBe("ค่า Mean ต้องเป็นตัวเลข");
    expect(validateBalanceControlInput({ mean: 100, sd: NaN })).toBe("ค่า STD ต้องเป็นตัวเลข");
    expect(validateBalanceControlInput({ mean: 100, sd: 0 })).toBe("ค่า STD ต้องมากกว่า 0");
    expect(validateBalanceControlInput({ mean: 100, sd: 1, nominal: 0 })).toBe("น้ำหนักตุ้มต้องมากกว่า 0");
    expect(validateBalanceControlInput({ mean: 100, sd: 1, mpe: -1 })).toBe("ค่า MPE ต้องไม่ติดลบ");
    expect(validateBalanceControlInput({ mean: 100, sd: 1, updatedDate: "26/10/2569" })).toBe(
      "วันที่ปรับปรุงต้องอยู่ในรูปแบบ YYYY-MM-DD",
    );
    expect(validateBalanceControlInput({ mean: 99.99972, sd: 0.0000476, mpe: 0.5, updatedDate: "2026-10-26" })).toBeNull();
  });
});
