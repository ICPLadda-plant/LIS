import { describe, expect, it } from "vitest";
import { formatLabResultText } from "./resultNumberFormat";

describe("formatLabResultText", () => {
  it.each([
    ["12.554", "12.55"],
    ["12.5", "12.50"],
    ["0.4484", "0.45"],
    ["0.02549", "0.025"],
    ["0.005897", "0.0059"],
    ["0.0996", "0.10"],
    ["-0.02549", "-0.025"],
    ["<0.01", "<0.01"],
    ["ผ่าน", "ผ่าน"],
  ])("%s → %s", (input, expected) => {
    expect(formatLabResultText(input)).toBe(expected);
  });
});
