import { describe, it, expect } from "vitest";
import { fmtThaiDate, isSunday } from "@/lib/dailyCheckFormat";

describe("fmtThaiDate", () => {
  it("puts the day before the month in Thai with a BE year", () => {
    expect(fmtThaiDate("2026-11-17")).toBe("17 พ.ย. 2569");
    expect(fmtThaiDate("2026-01-05")).toBe("5 ม.ค. 2569");
  });

  it("falls back for empty or malformed input", () => {
    expect(fmtThaiDate("")).toBe("—");
    expect(fmtThaiDate("17/11/2026")).toBe("—");
  });
});

describe("isSunday", () => {
  it("detects Sundays from a YYYY-MM-DD string", () => {
    expect(isSunday("2026-11-15")).toBe(true);
    expect(isSunday("2026-11-17")).toBe(false);
    expect(isSunday("")).toBe(false);
  });
});
