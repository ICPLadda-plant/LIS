import { describe, expect, it } from "vitest";
import { formatCoaAiResult } from "./coaAiResult";

describe("formatCoaAiResult", () => {
  it.each([
    ["0.295%", "0.30%"],
    ["24.305", "24.31%"],
    ["10.1%", "10.10%"],
  ])("formats %s with two decimals", (value, expected) => {
    expect(formatCoaAiResult(value)).toBe(expected);
  });

  it("keeps non-numeric lab text unchanged", () => {
    expect(formatCoaAiResult("Not detected")).toBe("Not detected");
  });
});
