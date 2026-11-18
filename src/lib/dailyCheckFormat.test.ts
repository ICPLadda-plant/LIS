import { describe, it, expect } from "vitest";
import {
  fmtDate,
  roomFilterLabel,
  statusFilterLabel,
  dateFilterLabel,
  formatReadings,
  firstNameOnly,
} from "./dailyCheckFormat";

describe("dailyCheckFormat", () => {
  it("fmtDate: YYYY-MM-DD → DD/MM/YYYY", () => {
    expect(fmtDate("2026-07-02")).toBe("02/07/2026");
  });
  it("fmtDate: empty → em dash", () => {
    expect(fmtDate("")).toBe("—");
  });
  it("firstNameOnly ตัดคำนำหน้าและนามสกุล", () => {
    expect(firstNameOnly("นายนคร อ่อนคง")).toBe("นคร");
    expect(firstNameOnly("Dev Administrator")).toBe("Dev");
  });
  it("roomFilterLabel: all → ทุกห้อง", () => {
    expect(roomFilterLabel("all")).toBe("ทุกห้อง");
  });
  it("statusFilterLabel maps all/normal/abnormal", () => {
    expect(statusFilterLabel("all")).toBe("ทั้งหมด");
    expect(statusFilterLabel("normal")).toBe("ปกติ");
    expect(statusFilterLabel("abnormal")).toBe("ผิดปกติ");
  });
  it("dateFilterLabel: empty → ทุกวัน, else formatted", () => {
    expect(dateFilterLabel("")).toBe("ทุกวัน");
    expect(dateFilterLabel("2026-07-02")).toBe("02/07/2026");
  });
  it("formatReadings: joins multiple readings, em dash when none", () => {
    expect(formatReadings([
      { key: "a", label: "อุณหภูมิ", value: 25, unit: "°C" },
      { key: "b", label: "ความชื้น", value: 50, unit: "%" },
    ])).toBe("อุณหภูมิ 25 °C, ความชื้น 50 %");
    expect(formatReadings([])).toBe("—");
  });
});
