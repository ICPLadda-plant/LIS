import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMonth, formatTime } from "./dateTime";

describe("dateTime", () => {
  it("formats dates and times with day first and a 24-hour clock", () => {
    const value = new Date(2026, 9, 12, 22, 5);

    expect(formatDate(value)).toBe("12/10/2026");
    expect(formatMonth(value)).toBe("10/2026");
    expect(formatTime(value)).toBe("22:05");
    expect(formatDateTime(value)).toBe("12/10/2026 22:05");
  });

  it("parses the month-first AM/PM value returned by the density instrument", () => {
    expect(formatDateTime("10/12/2026 10:40 PM")).toBe("12/10/2026 22:40");
  });

  it("returns the requested fallback for an invalid value", () => {
    expect(formatDateTime("invalid", "ยังไม่มี")).toBe("ยังไม่มี");
  });
});
