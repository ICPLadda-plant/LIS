import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isEnumAbnormal,
  isNumericAbnormal,
  isFieldAbnormal,
  countAbnormalInResults,
  timerDurationMs,
  timerRemainingMs,
  isTimerDone,
  partsToSec,
  secToParts,
  formatTimerHuman,
  findSubstanceStandard,
  isSubstanceAbnormal,
  expandFieldForItem,
  evalCondition,
  resolveStandard,
  resolveFieldStandard,
  getEntryValues,
  fieldValueList,
  optionOutputText,
  enumNormalValues,
  seedOptionOutputsFromLegacy,
  resolveConditionalOutput,
  isConditionalOutputAbnormal,
} from "./parameterValidation";
import type { ParameterItem, ParameterValueField, OptionOutput } from "./api";
import type { QCTestResult } from "@/types/petition.types";
import type { ConditionContext } from "./parameterValidation";

const makeField = (overrides: Partial<ParameterValueField>): ParameterValueField => ({
  label: "test",
  type: "enum",
  options: ["ดี", "ปานกลาง", "แย่"],
  expectedValues: [],
  ...overrides,
});

describe("isEnumAbnormal", () => {
  it("returns false for non-enum field types", () => {
    const field = makeField({ type: "text", expectedValues: ["x"] });
    expect(isEnumAbnormal(field, "anything")).toBe(false);
  });

  it("returns false when expectedValues is empty (no check configured)", () => {
    const field = makeField({ expectedValues: [] });
    expect(isEnumAbnormal(field, "แย่")).toBe(false);
  });

  it("returns false when expectedValues is undefined", () => {
    const field = makeField({ expectedValues: undefined });
    expect(isEnumAbnormal(field, "แย่")).toBe(false);
  });

  it("returns false for empty/null value (not entered yet)", () => {
    const field = makeField({ expectedValues: ["ดี"] });
    expect(isEnumAbnormal(field, "")).toBe(false);
    expect(isEnumAbnormal(field, null)).toBe(false);
    expect(isEnumAbnormal(field, undefined)).toBe(false);
  });

  it("returns false when value is in expectedValues (single)", () => {
    const field = makeField({ expectedValues: ["ดี"] });
    expect(isEnumAbnormal(field, "ดี")).toBe(false);
  });

  it("returns true when value is NOT in expectedValues (single)", () => {
    const field = makeField({ expectedValues: ["ดี"] });
    expect(isEnumAbnormal(field, "แย่")).toBe(true);
  });

  it("returns false when value matches any expectedValue (multi)", () => {
    const field = makeField({ expectedValues: ["ดี", "ปานกลาง"] });
    expect(isEnumAbnormal(field, "ดี")).toBe(false);
    expect(isEnumAbnormal(field, "ปานกลาง")).toBe(false);
  });

  it("returns true when value matches none of expectedValues (multi)", () => {
    const field = makeField({ expectedValues: ["ดี", "ปานกลาง"] });
    expect(isEnumAbnormal(field, "แย่")).toBe(true);
  });

  it("coerces non-string values to string for comparison", () => {
    const field = makeField({ options: ["1", "2"], expectedValues: ["1"] });
    expect(isEnumAbnormal(field, 1)).toBe(false);
    expect(isEnumAbnormal(field, 2)).toBe(true);
  });
});

describe("isEnumAbnormal with optionOutputs", () => {
  it("flags only options whose kind is 'abnormal'", () => {
    const field = makeField({
      options: ["ใส", "ขุ่น", "ตะกอน"],
      optionOutputs: {
        "ใส": { kind: "normal" },
        "ขุ่น": { kind: "abnormal" },
        "ตะกอน": { kind: "text", text: "เฝ้าระวัง" },
      },
    });
    expect(isEnumAbnormal(field, "ใส")).toBe(false);
    expect(isEnumAbnormal(field, "ขุ่น")).toBe(true);
    expect(isEnumAbnormal(field, "ตะกอน")).toBe(false);
  });

  it("takes precedence over expectedValues when both present", () => {
    const field = makeField({
      options: ["a", "b"],
      expectedValues: ["a"], // legacy would mark b abnormal
      optionOutputs: { "a": { kind: "normal" }, "b": { kind: "text", text: "-" } },
    });
    expect(isEnumAbnormal(field, "b")).toBe(false);
  });

  it("returns false for a value not present in the map", () => {
    const field = makeField({
      options: ["a"],
      optionOutputs: { "a": { kind: "abnormal" } },
    });
    expect(isEnumAbnormal(field, "unknown")).toBe(false);
    expect(isEnumAbnormal(field, "")).toBe(false);
    expect(isEnumAbnormal(field, null)).toBe(false);
  });
});

describe("optionOutputText", () => {
  const field = makeField({
    options: ["ใส", "ตะกอน"],
    optionOutputs: { "ใส": { kind: "normal" }, "ตะกอน": { kind: "text", text: "เฝ้าระวัง" } },
  });
  it("returns the custom text for a text-kind option", () => {
    expect(optionOutputText(field, "ตะกอน")).toBe("เฝ้าระวัง");
  });
  it("returns null for non-text kinds and empty/legacy fields", () => {
    expect(optionOutputText(field, "ใส")).toBeNull();
    expect(optionOutputText(field, "")).toBeNull();
    expect(optionOutputText(makeField({ optionOutputs: undefined }), "ใส")).toBeNull();
  });
});

describe("enumNormalValues", () => {
  it("returns options whose kind is normal when optionOutputs present", () => {
    const field = makeField({
      options: ["a", "b", "c"],
      optionOutputs: { "a": { kind: "normal" }, "b": { kind: "abnormal" }, "c": { kind: "normal" } },
    });
    expect(enumNormalValues(field).sort()).toEqual(["a", "c"]);
  });
  it("falls back to expectedValues for legacy fields", () => {
    expect(enumNormalValues(makeField({ expectedValues: ["a"] }))).toEqual(["a"]);
  });
});

describe("seedOptionOutputsFromLegacy", () => {
  it("maps expected->normal and the rest->abnormal when expectedValues is non-empty", () => {
    expect(seedOptionOutputsFromLegacy(["a", "b", "c"], ["a"])).toEqual({
      a: { kind: "normal" },
      b: { kind: "abnormal" },
      c: { kind: "abnormal" },
    });
  });
  it("maps everything to text=label when expectedValues is empty (no legacy detection)", () => {
    expect(seedOptionOutputsFromLegacy(["a", "b"], [])).toEqual({
      a: { kind: "text", text: "a" },
      b: { kind: "text", text: "b" },
    });
  });
});

const makeNum = (overrides: Partial<ParameterValueField>): ParameterValueField => ({
  label: "ph",
  type: "number",
  unit: "%",
  standardValue: 5,
  standardOperator: undefined,
  standardValue2: null,
  ...overrides,
});

describe("isNumericAbnormal", () => {
  it("returns false for non-numeric types", () => {
    const field: ParameterValueField = {
      label: "x", type: "enum", standardValue: 5, standardOperator: "eq",
    };
    expect(isNumericAbnormal(field, 10)).toBe(false);
  });

  it("returns false when operator is undefined (no check)", () => {
    const field = makeNum({ standardOperator: undefined });
    expect(isNumericAbnormal(field, 999)).toBe(false);
  });

  it("returns false when standardValue is null", () => {
    const field = makeNum({ standardOperator: "eq", standardValue: null });
    expect(isNumericAbnormal(field, 5)).toBe(false);
  });

  it("returns false for empty/null/undefined value", () => {
    const field = makeNum({ standardOperator: "eq", standardValue: 5 });
    expect(isNumericAbnormal(field, "")).toBe(false);
    expect(isNumericAbnormal(field, null)).toBe(false);
    expect(isNumericAbnormal(field, undefined)).toBe(false);
  });

  it("returns false for NaN value", () => {
    const field = makeNum({ standardOperator: "eq", standardValue: 5 });
    expect(isNumericAbnormal(field, "abc")).toBe(false);
  });

  it("coerces numeric string to number", () => {
    const field = makeNum({ standardOperator: "eq", standardValue: 5 });
    expect(isNumericAbnormal(field, "5")).toBe(false);
    expect(isNumericAbnormal(field, "6")).toBe(true);
  });

  describe("operator: lt (<)", () => {
    const field = makeNum({ standardOperator: "lt", standardValue: 5 });
    it("normal when value < standard", () => expect(isNumericAbnormal(field, 4)).toBe(false));
    it("abnormal when value == standard", () => expect(isNumericAbnormal(field, 5)).toBe(true));
    it("abnormal when value > standard", () => expect(isNumericAbnormal(field, 6)).toBe(true));
  });

  describe("operator: lte (<=)", () => {
    const field = makeNum({ standardOperator: "lte", standardValue: 5 });
    it("normal when value < standard", () => expect(isNumericAbnormal(field, 4)).toBe(false));
    it("normal when value == standard", () => expect(isNumericAbnormal(field, 5)).toBe(false));
    it("abnormal when value > standard", () => expect(isNumericAbnormal(field, 6)).toBe(true));
  });

  describe("operator: eq (=)", () => {
    const field = makeNum({ standardOperator: "eq", standardValue: 5 });
    it("normal when value == standard", () => expect(isNumericAbnormal(field, 5)).toBe(false));
    it("abnormal when value < standard", () => expect(isNumericAbnormal(field, 4)).toBe(true));
    it("abnormal when value > standard", () => expect(isNumericAbnormal(field, 6)).toBe(true));
  });

  describe("operator: gte (>=)", () => {
    const field = makeNum({ standardOperator: "gte", standardValue: 5 });
    it("abnormal when value < standard", () => expect(isNumericAbnormal(field, 4)).toBe(true));
    it("normal when value == standard", () => expect(isNumericAbnormal(field, 5)).toBe(false));
    it("normal when value > standard", () => expect(isNumericAbnormal(field, 6)).toBe(false));
  });

  describe("operator: gt (>)", () => {
    const field = makeNum({ standardOperator: "gt", standardValue: 5 });
    it("abnormal when value < standard", () => expect(isNumericAbnormal(field, 4)).toBe(true));
    it("abnormal when value == standard", () => expect(isNumericAbnormal(field, 5)).toBe(true));
    it("normal when value > standard", () => expect(isNumericAbnormal(field, 6)).toBe(false));
  });

  describe("operator: between", () => {
    const field = makeNum({
      standardOperator: "between", standardValue: 4, standardValue2: 6,
    });
    it("normal at lower bound", () => expect(isNumericAbnormal(field, 4)).toBe(false));
    it("normal in range", () => expect(isNumericAbnormal(field, 5)).toBe(false));
    it("normal at upper bound", () => expect(isNumericAbnormal(field, 6)).toBe(false));
    it("abnormal below lower", () => expect(isNumericAbnormal(field, 3.99)).toBe(true));
    it("abnormal above upper", () => expect(isNumericAbnormal(field, 6.01)).toBe(true));
    it("returns false when standardValue2 missing", () => {
      const bad = makeNum({ standardOperator: "between", standardValue: 4, standardValue2: null });
      expect(isNumericAbnormal(bad, 10)).toBe(false);
    });
  });

  describe("operator: tolerance", () => {
    const field = makeNum({
      standardOperator: "tolerance", standardValue: 100, standardValue2: 5,
    });
    it("normal at center", () => expect(isNumericAbnormal(field, 100)).toBe(false));
    it("normal at +5% boundary", () => expect(isNumericAbnormal(field, 105)).toBe(false));
    it("normal at -5% boundary", () => expect(isNumericAbnormal(field, 95)).toBe(false));
    it("abnormal above tolerance", () => expect(isNumericAbnormal(field, 105.01)).toBe(true));
    it("abnormal below tolerance", () => expect(isNumericAbnormal(field, 94.99)).toBe(true));
    it("returns false when standardValue2 missing", () => {
      const bad = makeNum({ standardOperator: "tolerance", standardValue: 100, standardValue2: null });
      expect(isNumericAbnormal(bad, 200)).toBe(false);
    });
    it("returns false when standardValue2 <= 0", () => {
      const bad = makeNum({ standardOperator: "tolerance", standardValue: 100, standardValue2: 0 });
      expect(isNumericAbnormal(bad, 200)).toBe(false);
    });
    it("uses absolute value of center for tolerance calc (negative center)", () => {
      const neg = makeNum({ standardOperator: "tolerance", standardValue: -10, standardValue2: 10 });
      expect(isNumericAbnormal(neg, -10)).toBe(false);
      expect(isNumericAbnormal(neg, -9)).toBe(false);
      expect(isNumericAbnormal(neg, -8.99)).toBe(true);
    });
  });
});

describe("countAbnormalInResults", () => {
  const enumField: ParameterValueField = {
    label: "สถานะ", type: "enum",
    options: ["ปกติ", "ผิดปกติ"], expectedValues: ["ปกติ"],
  };
  const numField: ParameterValueField = {
    label: "pH", type: "number", unit: "%",
    standardOperator: "between", standardValue: 4, standardValue2: 6,
  };
  const param: ParameterItem = {
    _id: "p1", name: "ทดสอบ", valueFields: [enumField, numField],
  };
  const param2: ParameterItem = {
    _id: "p2", name: "อีกอัน", valueFields: [enumField],
  };

  const result = (parameterId: string, values: Record<string, unknown>): QCTestResult => ({
    petitionId: "x", itemSeq: 1, parameterId, values,
  });

  it("returns 0 for empty inputs", () => {
    expect(countAbnormalInResults([], [param])).toBe(0);
    expect(countAbnormalInResults([result("p1", {})], [])).toBe(0);
  });

  it("returns 0 when all values are normal", () => {
    const results = [result("p1", { "สถานะ": "ปกติ", "pH": 5 })];
    expect(countAbnormalInResults(results, [param])).toBe(0);
  });

  it("counts a single abnormal enum", () => {
    const results = [result("p1", { "สถานะ": "ผิดปกติ", "pH": 5 })];
    expect(countAbnormalInResults(results, [param])).toBe(1);
  });

  it("counts a single abnormal numeric", () => {
    const results = [result("p1", { "สถานะ": "ปกติ", "pH": 99 })];
    expect(countAbnormalInResults(results, [param])).toBe(1);
  });

  it("counts both abnormal fields in same result", () => {
    const results = [result("p1", { "สถานะ": "ผิดปกติ", "pH": 99 })];
    expect(countAbnormalInResults(results, [param])).toBe(2);
  });

  it("counts across multiple results & parameters", () => {
    const results = [
      result("p1", { "สถานะ": "ผิดปกติ", "pH": 5 }),
      result("p2", { "สถานะ": "ผิดปกติ" }),
      result("p1", { "สถานะ": "ปกติ", "pH": 100 }),
    ];
    expect(countAbnormalInResults(results, [param, param2])).toBe(3);
  });

  it("ignores result with unknown parameterId", () => {
    const results = [result("unknown", { "สถานะ": "ผิดปกติ" })];
    expect(countAbnormalInResults(results, [param])).toBe(0);
  });

  it("ignores empty/unfilled fields (not yet entered)", () => {
    const results = [result("p1", { "สถานะ": "", "pH": null })];
    expect(countAbnormalInResults(results, [param])).toBe(0);
  });

  it("handles parameter without valueFields", () => {
    const bare: ParameterItem = { _id: "p3", name: "เปล่า" };
    const results = [result("p3", { x: "y" })];
    expect(countAbnormalInResults(results, [bare])).toBe(0);
  });

  it("counts per-substance abnormals via composite keys", () => {
    const p = {
      _id: "ps",
      name: "active",
      valueFields: [subField],
    } as unknown as ParameterItem;
    const r = {
      parameterId: "ps",
      itemSeq: 1,
      values: {
        "ปริมาณสารสำคัญ::abamectin": 90,      // < 95 → abnormal
        "ปริมาณสารสำคัญ::imidacloprid": 95,   // within 90-100 → normal
      },
    } as unknown as QCTestResult;
    expect(countAbnormalInResults([r], [p])).toBe(1);
  });
});

describe("isFieldAbnormal", () => {
  it("returns true when enum is abnormal", () => {
    const field: ParameterValueField = {
      label: "e", type: "enum",
      options: ["ดี", "แย่"], expectedValues: ["ดี"],
    };
    expect(isFieldAbnormal(field, "แย่")).toBe(true);
    expect(isFieldAbnormal(field, "ดี")).toBe(false);
  });

  it("returns true when numeric is abnormal", () => {
    const field = makeNum({ standardOperator: "lte", standardValue: 5 });
    expect(isFieldAbnormal(field, 6)).toBe(true);
    expect(isFieldAbnormal(field, 4)).toBe(false);
  });

  it("returns false for text fields", () => {
    const field: ParameterValueField = { label: "t", type: "text" };
    expect(isFieldAbnormal(field, "anything")).toBe(false);
  });
});

const makeTimer = (overrides: Partial<ParameterValueField>): ParameterValueField => ({
  label: "incubation",
  type: "timer",
  timerDurationSec: 1800,
  timerUnit: "minute",
  ...overrides,
});

describe("timerDurationMs", () => {
  it("returns null for non-timer types", () => {
    const f: ParameterValueField = { label: "x", type: "number", timerDurationSec: 1800, timerUnit: "minute" };
    expect(timerDurationMs(f)).toBeNull();
  });

  it("returns null when durationSec is null/0/negative", () => {
    expect(timerDurationMs(makeTimer({ timerDurationSec: null }))).toBeNull();
    expect(timerDurationMs(makeTimer({ timerDurationSec: 0 }))).toBeNull();
    expect(timerDurationMs(makeTimer({ timerDurationSec: -5 }))).toBeNull();
  });

  it("converts sec to ms", () => {
    expect(timerDurationMs(makeTimer({ timerDurationSec: 1800 }))).toBe(1_800_000);
    expect(timerDurationMs(makeTimer({ timerDurationSec: 7200 }))).toBe(7_200_000);
    expect(timerDurationMs(makeTimer({ timerDurationSec: 86400 }))).toBe(86_400_000);
    expect(timerDurationMs(makeTimer({ timerDurationSec: 2592000 }))).toBe(2_592_000_000);
  });
});

describe("timerRemainingMs", () => {
  const FIXED_NOW = new Date("2026-05-23T15:30:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when field has no duration", () => {
    const f = makeTimer({ timerDurationSec: null });
    expect(timerRemainingMs(f, new Date(FIXED_NOW).toISOString())).toBeNull();
  });

  it("returns full duration when startedAt is null/undefined", () => {
    const f = makeTimer({ timerDurationSec: 1800 });
    expect(timerRemainingMs(f, null)).toBe(1_800_000);
    expect(timerRemainingMs(f, undefined)).toBe(1_800_000);
  });

  it("computes remaining when partially elapsed", () => {
    const startedAt = new Date(FIXED_NOW - 5 * 60_000).toISOString();
    const f = makeTimer({ timerDurationSec: 1800 });
    expect(timerRemainingMs(f, startedAt)).toBe(25 * 60_000);
  });

  it("returns 0 when fully elapsed (clamped, not negative)", () => {
    const startedAt = new Date(FIXED_NOW - 31 * 60_000).toISOString();
    const f = makeTimer({ timerDurationSec: 1800 });
    expect(timerRemainingMs(f, startedAt)).toBe(0);
  });

  it("returns null for invalid ISO string", () => {
    const f = makeTimer({ timerDurationSec: 1800 });
    expect(timerRemainingMs(f, "not-a-date")).toBeNull();
  });
});

describe("isTimerDone", () => {
  const FIXED_NOW = new Date("2026-05-23T15:30:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false when not started", () => {
    const f = makeTimer({});
    expect(isTimerDone(f, null)).toBe(false);
  });

  it("returns false when still running", () => {
    const startedAt = new Date(FIXED_NOW - 5 * 60_000).toISOString();
    const f = makeTimer({ timerDurationSec: 1800 });
    expect(isTimerDone(f, startedAt)).toBe(false);
  });

  it("returns true when fully elapsed", () => {
    const startedAt = new Date(FIXED_NOW - 60 * 60_000).toISOString();
    const f = makeTimer({ timerDurationSec: 1800 });
    expect(isTimerDone(f, startedAt)).toBe(true);
  });

  it("returns true at exact boundary", () => {
    const startedAt = new Date(FIXED_NOW - 30 * 60_000).toISOString();
    const f = makeTimer({ timerDurationSec: 1800 });
    expect(isTimerDone(f, startedAt)).toBe(true);
  });
});

describe("partsToSec", () => {
  it("returns 0 for empty parts", () => {
    expect(partsToSec({})).toBe(0);
  });

  it("computes seconds only", () => {
    expect(partsToSec({ seconds: 45 })).toBe(45);
  });

  it("computes minutes + seconds", () => {
    expect(partsToSec({ minutes: 1, seconds: 30 })).toBe(90);
  });

  it("computes hour + minute + second", () => {
    expect(partsToSec({ hours: 1, minutes: 30, seconds: 45 })).toBe(5445);
  });

  it("computes day + lower parts", () => {
    expect(partsToSec({ days: 1, hours: 1, minutes: 1, seconds: 1 })).toBe(90061);
  });

  it("computes month + lower parts (30-day month)", () => {
    expect(partsToSec({
      months: 1, days: 2, hours: 3, minutes: 4, seconds: 5,
    })).toBe(1 * 2592000 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });

  it("treats undefined fields as 0", () => {
    expect(partsToSec({ hours: 2 })).toBe(7200);
  });
});

describe("secToParts", () => {
  it("zero seconds returns zeroed parts for hour unit", () => {
    expect(secToParts(0, "hour")).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it("90 sec + minute unit → 1m 30s", () => {
    expect(secToParts(90, "minute")).toEqual({ minutes: 1, seconds: 30 });
  });

  it("5445 sec + hour unit → 1h 30m 45s", () => {
    expect(secToParts(5445, "hour")).toEqual({ hours: 1, minutes: 30, seconds: 45 });
  });

  it("90061 sec + day unit → 1d 1h 1m 1s", () => {
    expect(secToParts(90061, "day")).toEqual({
      days: 1, hours: 1, minutes: 1, seconds: 1,
    });
  });

  it("2592000 sec + month unit → 1mo 0d 0h 0m 0s", () => {
    expect(secToParts(2592000, "month")).toEqual({
      months: 1, days: 0, hours: 0, minutes: 0, seconds: 0,
    });
  });

  it("5445 sec + day unit redistributes (no day component)", () => {
    expect(secToParts(5445, "day")).toEqual({
      days: 0, hours: 1, minutes: 30, seconds: 45,
    });
  });

  it("negative seconds clamps to 0", () => {
    expect(secToParts(-100, "hour")).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it("fractional seconds are floored", () => {
    expect(secToParts(90.7, "minute")).toEqual({ minutes: 1, seconds: 30 });
  });

  it("roundtrip: secToParts → partsToSec returns same value", () => {
    const sec = 90061;
    const parts = secToParts(sec, "day");
    expect(partsToSec(parts)).toBe(sec);
  });
});

describe("formatTimerHuman", () => {
  it("0 → '0 วินาที'", () => {
    expect(formatTimerHuman(0)).toBe("0 วินาที");
  });

  it("60 → '1 นาที'", () => {
    expect(formatTimerHuman(60)).toBe("1 นาที");
  });

  it("3600 → '1 ชม'", () => {
    expect(formatTimerHuman(3600)).toBe("1 ชม");
  });

  it("3661 → '1 ชม 1 นาที 1 วินาที'", () => {
    expect(formatTimerHuman(3661)).toBe("1 ชม 1 นาที 1 วินาที");
  });

  it("5445 → '1 ชม 30 นาที 45 วินาที'", () => {
    expect(formatTimerHuman(5445)).toBe("1 ชม 30 นาที 45 วินาที");
  });

  it("90061 → '1 วัน 1 ชม 1 นาที 1 วินาที'", () => {
    expect(formatTimerHuman(90061)).toBe("1 วัน 1 ชม 1 นาที 1 วินาที");
  });

  it("2592000 (30 days) → '1 เดือน'", () => {
    expect(formatTimerHuman(2592000)).toBe("1 เดือน");
  });

  it("skips zero parts", () => {
    expect(formatTimerHuman(3600 + 45)).toBe("1 ชม 45 วินาที");
  });
});

const subField: ParameterValueField = {
  label: "ปริมาณสารสำคัญ",
  type: "number",
  unit: "%",
  substanceMode: true,
  substanceStandards: [
    { substance: "ABAMECTIN", operator: "gte", value: 95, value2: null },
    { substance: "IMIDACLOPRID", operator: "between", value: 90, value2: 100 },
  ],
};

describe("findSubstanceStandard", () => {
  it("matches by first-token, case-insensitive, ignoring form spec", () => {
    expect(findSubstanceStandard(subField, "abamectin 1.8% w/v ec")?.value).toBe(95);
  });
  it("prefers exact full commonName standards before falling back to active substance rules", () => {
    const field: ParameterValueField = {
      label: "AI",
      type: "number",
      unit: "%",
      substanceMode: true,
      substanceStandards: [
        { substance: "CYPERMETHRIN", operator: "gte", value: 80, value2: null },
        { substance: "CYPERMETHRIN 25% W/V BIO EC(LIVE STOCK)", operator: "gte", value: 95, value2: null },
        { substance: "CYPERMETHRIN 25% W/V EC(GMP)", operator: "gte", value: 90, value2: null },
      ],
    };

    expect(findSubstanceStandard(field, "CYPERMETHRIN 25% W/V BIO EC(LIVE STOCK)")?.value).toBe(95);
    expect(findSubstanceStandard(field, "CYPERMETHRIN 25% W/V EC(GMP)")?.value).toBe(90);
    expect(findSubstanceStandard(field, "CYPERMETHRIN 10% W/V EC")?.value).toBe(80);
  });
  it("returns undefined when no substance matches", () => {
    expect(findSubstanceStandard(subField, "GLYPHOSATE")).toBeUndefined();
  });
  it("prefers the substance rule matching product type and RM/FG category", () => {
    const field: ParameterValueField = {
      label: "AI",
      type: "number",
      unit: "%",
      substanceMode: true,
      substanceStandards: [
        { substance: "ABAMECTIN", operator: "gte", value: 80, value2: null },
        {
          substance: "ABAMECTIN",
          operator: "gte",
          value: 95,
          value2: null,
          productTypes: ["water"],
          categories: ["RM"],
        } as any,
        {
          substance: "ABAMECTIN",
          operator: "gte",
          value: 90,
          value2: null,
          productTypes: ["sand"],
          categories: ["FG"],
        } as any,
      ],
    };

    expect(findSubstanceStandard(field, "ABAMECTIN 1% W/V EC", { category: "RM" })?.value).toBe(95);
    expect(findSubstanceStandard(field, "ABAMECTIN 1% W/W GR", { category: "FG" })?.value).toBe(90);
    expect(findSubstanceStandard(field, "ABAMECTIN 1% W/V EC", { category: "FG" })?.value).toBe(80);
  });

  it("prefers the substance rule matching regulatory type markers", () => {
    const field: ParameterValueField = {
      label: "AI",
      type: "number",
      unit: "%",
      substanceMode: true,
      substanceStandards: [
        { substance: "CHLORFENAPYR", operator: "gte", value: 80, value2: null },
        {
          substance: "CHLORFENAPYR",
          operator: "gte",
          value: 90,
          value2: null,
          regulatoryTypes: ["GMP"],
        } as any,
        {
          substance: "CHLORFENAPYR",
          operator: "gte",
          value: 95,
          value2: null,
          regulatoryTypes: ["BIO"],
        } as any,
      ],
    };

    expect(findSubstanceStandard(field, "CHLORFENAPYR 10% W/V SC (GMP)")?.value).toBe(90);
    expect(findSubstanceStandard(field, "CHLORFENAPYR 10% W/V SC (BIO)")?.value).toBe(95);
    expect(findSubstanceStandard(field, "CHLORFENAPYR 10% W/V SC")?.value).toBe(80);
  });
});

describe("isSubstanceAbnormal", () => {
  it("flags a value below a gte standard", () => {
    const std = findSubstanceStandard(subField, "ABAMECTIN");
    expect(isSubstanceAbnormal(subField, std, 90)).toBe(true);
    expect(isSubstanceAbnormal(subField, std, 96)).toBe(false);
  });
  it("never flags when there is no standard", () => {
    expect(isSubstanceAbnormal(subField, undefined, 0)).toBe(false);
  });
});

describe("expandFieldForItem", () => {
  it("returns the field unchanged for non-substance fields", () => {
    const plain: ParameterValueField = { label: "pH", type: "number" };
    const units = expandFieldForItem(plain, "ABAMECTIN");
    expect(units).toHaveLength(1);
    expect(units[0].key).toBe("pH");
    expect(units[0].field).toBe(plain);
  });

  it("expands one unit per substance with injected standard + composite key", () => {
    const units = expandFieldForItem(subField, "ABAMECTIN + IMIDACLOPRID");
    expect(units).toHaveLength(2);
    expect(units[0].key).toBe("ปริมาณสารสำคัญ::abamectin");
    expect(units[0].field.label).toBe("ปริมาณสารสำคัญ — ABAMECTIN");
    expect(units[0].field.standardOperator).toBe("gte");
    expect(units[0].field.standardValue).toBe(95);
    expect(units[0].field.substanceMode).toBe(false);
  });

  it("injects the substance standard matching inferred product type and category", () => {
    const field: ParameterValueField = {
      label: "AI",
      type: "number",
      unit: "%",
      substanceMode: true,
      substanceStandards: [
        { substance: "ABAMECTIN", operator: "gte", value: 80, value2: null },
        {
          substance: "ABAMECTIN",
          operator: "gte",
          value: 95,
          value2: null,
          productTypes: ["water"],
          categories: ["RM"],
        } as any,
      ],
    };

    const units = expandFieldForItem(field, "ABAMECTIN 1% W/V EC", { category: "RM" });

    expect(units[0].field.standardValue).toBe(95);
  });

  it("expands substances with no standard (no operator → no validation)", () => {
    const units = expandFieldForItem(subField, "GLYPHOSATE");
    expect(units).toHaveLength(1);
    expect(units[0].field.standardOperator).toBeUndefined();
  });

  it("falls back to a single plain unit when commonName is empty", () => {
    const units = expandFieldForItem(subField, "");
    expect(units).toHaveLength(1);
    expect(units[0].key).toBe("ปริมาณสารสำคัญ");
  });

  describe("whole-product standards (ค่า ถพ.)", () => {
    const sgField: ParameterValueField = {
      label: "ค่าถพ.",
      type: "float",
      unit: "g/cm3",
      substanceMode: true,
      substanceStandards: [
        { substance: "DIFENOCONAZOLE 12.5% + AZOXYSTROBIN 20% W/V SC", operator: "between", value: 1.1, value2: 1.12 },
        { substance: "PROPANIL 36% W/V EC", operator: "between", value: 1.0, value2: 1.03 },
        { substance: "ANILOFOS 18% + PROPANIL 36% W/V EC", operator: "between", value: 1.1, value2: 1.13 },
        { substance: "ABAMECTIN 1.8% W/V EC", operator: "between", value: 0.9, value2: 0.95 },
      ],
    };

    it("uses one unit with the whole-product standard for a mixture", () => {
      const units = expandFieldForItem(sgField, "ANILOFOS 18% + PROPANIL 36% W/V EC");
      expect(units).toHaveLength(1);
      expect(units[0].key).toBe("ค่าถพ.::anilofos");
      expect(units[0].field.label).toBe("ค่าถพ.");
      expect(units[0].field.standardValue).toBe(1.1);
      expect(units[0].field.standardValue2).toBe(1.13);
    });

    it("matches mixtures regardless of order, W/V, IMPORTED and trailing zeros", () => {
      const units = expandFieldForItem(sgField, "AZOXYSTROBIN 20%+DIFENOCONAZOLE 12.50% SC (IMPORTED)");
      expect(units).toHaveLength(1);
      expect(units[0].field.standardValue).toBe(1.1);
    });

    it("matches an IMPORTED product to the standard set for the same product", () => {
      const units = expandFieldForItem(sgField, "ABAMECTIN 1.8% W/V EC (IMPORTED)");
      expect(units[0].field.standardValue).toBe(0.9);
      expect(findSubstanceStandard(sgField, "ABAMECTIN 1.8% W/V EC (BROWN, IMPORTED)")).toBeUndefined();
    });

    it("still splits a mixture without a whole-product standard", () => {
      const units = expandFieldForItem(subField, "ABAMECTIN 1.8% + IMIDACLOPRID 5% W/V EC");
      expect(units.map((unit) => unit.key)).toEqual(["ปริมาณสารสำคัญ::abamectin", "ปริมาณสารสำคัญ::imidacloprid"]);
    });
  });
});

describe("expandFieldForItem — labelTolerance", () => {
  const ltField: ParameterValueField = {
    label: "%w/v", type: "number", unit: "%", labelToleranceMode: true,
    labelToleranceStandards: [{ substance: "ABAMECTIN", autoPct: 2.5, headPct: 5 }],
  };
  it("expands per substance with rawSpec (keeps % for center)", () => {
    const units = expandFieldForItem(ltField, "ABAMECTIN 1.8% W/V EC");
    expect(units).toHaveLength(1);
    expect(units[0].key).toBe("%w/v::abamectin");
    expect(units[0].labelTolerance?.rawSpec).toBe("ABAMECTIN 1.8% W/V EC");
    expect(units[0].labelTolerance?.std?.autoPct).toBe(2.5);
    expect(units[0].field.labelToleranceMode).toBe(false);
  });
  it("substance without a configured std → unit with undefined std", () => {
    const units = expandFieldForItem(ltField, "GLYPHOSATE 48% SL");
    expect(units[0].labelTolerance?.std).toBeUndefined();
  });
  it("falls back to single plain unit when commonName empty", () => {
    const units = expandFieldForItem(ltField, "");
    expect(units).toHaveLength(1);
    expect(units[0].key).toBe("%w/v");
    expect(units[0].labelTolerance).toBeUndefined();
  });
});

const ctx = (sameParam: Record<string, unknown>, otherParams: Record<string, Record<string, unknown>> = {}): ConditionContext =>
  ({ sameParam, otherParams });

describe("evalCondition", () => {
  it("eq matches enum string from sibling field", () => {
    expect(evalCondition(
      { sourceFieldLabel: "ลักษณะ", op: "eq", value: "ก้อนใหญ่" },
      ctx({ "ลักษณะ": "ก้อนใหญ่" }),
    )).toBe(true);
  });

  it("eq fails when sibling value missing", () => {
    expect(evalCondition(
      { sourceFieldLabel: "ลักษณะ", op: "eq", value: "ก้อนใหญ่" },
      ctx({}),
    )).toBe(false);
  });

  it("ne is the inverse of eq", () => {
    expect(evalCondition(
      { sourceFieldLabel: "ลักษณะ", op: "ne", value: "ก้อนเล็ก" },
      ctx({ "ลักษณะ": "ก้อนใหญ่" }),
    )).toBe(true);
  });

  it("numeric gte compares as numbers", () => {
    expect(evalCondition(
      { sourceFieldLabel: "ขนาด", op: "gte", value: 10 },
      ctx({ "ขนาด": "12" }),
    )).toBe(true);
    expect(evalCondition(
      { sourceFieldLabel: "ขนาด", op: "gte", value: 10 },
      ctx({ "ขนาด": "9" }),
    )).toBe(false);
  });

  it("between is inclusive", () => {
    const c = { sourceFieldLabel: "x", op: "between" as const, value: 5, value2: 10 };
    expect(evalCondition(c, ctx({ x: 5 }))).toBe(true);
    expect(evalCondition(c, ctx({ x: 10 }))).toBe(true);
    expect(evalCondition(c, ctx({ x: 11 }))).toBe(false);
  });

  it("reads from another parameter via sourceParameterId", () => {
    expect(evalCondition(
      { sourceParameterId: "P2", sourceFieldLabel: "สี", op: "eq", value: "แดง" },
      ctx({}, { P2: { "สี": "แดง" } }),
    )).toBe(true);
  });

  it("ne with missing source value is false by design (rule needs determining field filled)", () => {
    expect(evalCondition(
      { sourceFieldLabel: "ลักษณะ", op: "ne", value: "ก้อนใหญ่" },
      ctx({}),
    )).toBe(false);
  });

  it("lt/lte/gt compare numerically", () => {
    expect(evalCondition({ sourceFieldLabel: "x", op: "lt", value: 10 }, ctx({ x: 9 }))).toBe(true);
    expect(evalCondition({ sourceFieldLabel: "x", op: "lt", value: 10 }, ctx({ x: 10 }))).toBe(false);
    expect(evalCondition({ sourceFieldLabel: "x", op: "lte", value: 10 }, ctx({ x: 10 }))).toBe(true);
    expect(evalCondition({ sourceFieldLabel: "x", op: "gt", value: 10 }, ctx({ x: 11 }))).toBe(true);
    expect(evalCondition({ sourceFieldLabel: "x", op: "gt", value: 10 }, ctx({ x: 10 }))).toBe(false);
  });
});

const condField = (rules): ParameterValueField => ({
  label: "น้ำหนัก", type: "number", unit: "ก.",
  conditionalMode: true, conditionalStandards: rules,
});

describe("resolveStandard", () => {
  const rules = [
    { label: "ก้อนใหญ่", conditions: [{ sourceFieldLabel: "ลักษณะ", op: "eq", value: "ก้อนใหญ่" }], operator: "between", value: 23.5, value2: 26 },
    { label: "ก้อนเล็ก", conditions: [{ sourceFieldLabel: "ลักษณะ", op: "eq", value: "ก้อนเล็ก" }], operator: "between", value: 5.5, value2: 5.6 },
  ];

  it("returns the first matching rule's standard", () => {
    const r = resolveStandard(condField(rules), ctx({ "ลักษณะ": "ก้อนใหญ่" }));
    expect(r).toMatchObject({ operator: "between", value: 23.5, value2: 26, matchedRuleLabel: "ก้อนใหญ่" });
  });

  it("returns null when no rule matches", () => {
    expect(resolveStandard(condField(rules), ctx({}))).toBeNull();
  });

  it("empty-conditions rule acts as default (always matches, placed last)", () => {
    const withDefault = [...rules, { conditions: [], operator: "between" as const, value: 0, value2: 100 }];
    const r = resolveStandard(condField(withDefault), ctx({ "ลักษณะ": "อื่นๆ" }));
    expect(r).toMatchObject({ operator: "between", value: 0, value2: 100 });
  });

  it("non-conditional field falls back to single standard", () => {
    const f: ParameterValueField = { label: "x", type: "number", standardOperator: "lt", standardValue: 5 };
    expect(resolveStandard(f, ctx({}))).toMatchObject({ operator: "lt", value: 5, value2: null });
  });

  it("resolveFieldStandard injects resolved standard so isFieldAbnormal works", () => {
    const vf = resolveFieldStandard(condField(rules), ctx({ "ลักษณะ": "ก้อนใหญ่" }));
    expect(vf.conditionalMode).toBe(false);
    expect(isFieldAbnormal(vf, 30)).toBe(true);   // 30 อยู่นอก 23.5–26
    expect(isFieldAbnormal(vf, 24)).toBe(false);
  });

  it("resolveFieldStandard with no match → no abnormal check", () => {
    const vf = resolveFieldStandard(condField(rules), ctx({}));
    expect(isFieldAbnormal(vf, 9999)).toBe(false);
  });
});

describe("countAbnormalInResults with conditional standards", () => {
  it("counts a conditional field as abnormal using sibling value in same result", () => {
    const param: ParameterItem = {
      _id: "P1", name: "ทดสอบ", scope: "qc",
      valueFields: [
        { label: "ลักษณะ", type: "enum", options: ["ก้อนเล็ก", "ก้อนใหญ่"] },
        { label: "น้ำหนัก", type: "number", unit: "ก.", conditionalMode: true, conditionalStandards: [
          { label: "ก้อนใหญ่", conditions: [{ sourceFieldLabel: "ลักษณะ", op: "eq", value: "ก้อนใหญ่" }], operator: "between", value: 23.5, value2: 26 },
        ] },
      ],
    } as ParameterItem;
    const results = [
      { parameterId: "P1", petitionId: "X", itemSeq: 1, values: { "ลักษณะ": "ก้อนใหญ่", "น้ำหนัก": 30 } },
    ] as any;
    expect(countAbnormalInResults(results, [param])).toBe(1);
  });
});

const meNumField = { label: "pH", type: "number" as const, unit: "x", standardOperator: "lte" as const, standardValue: 7 };

describe("getEntryValues", () => {
  it("non-multiEntry → single entry from values", () => {
    const r = { values: { pH: 5 } } as any;
    expect(getEntryValues(r, { valueFields: [meNumField] } as any)).toEqual([{ pH: 5 }]);
  });
  it("multiEntry → entries array", () => {
    const r = { values: {}, entries: [{ pH: 5 }, { pH: 6 }] } as any;
    expect(getEntryValues(r, { multiEntry: true, valueFields: [meNumField] } as any)).toEqual([{ pH: 5 }, { pH: 6 }]);
  });
  it("multiEntry but empty entries → [{}]", () => {
    const r = { values: {} } as any;
    expect(getEntryValues(r, { multiEntry: true, valueFields: [meNumField] } as any)).toEqual([{}]);
  });
});

describe("fieldValueList", () => {
  it("non-multiple → wraps scalar", () => {
    expect(fieldValueList({ pH: 5 }, meNumField as any)).toEqual([5]);
  });
  it("multiple → returns array as-is", () => {
    expect(fieldValueList({ pH: [5, 6] }, { ...meNumField, multiple: true } as any)).toEqual([5, 6]);
  });
  it("multiple but missing → []", () => {
    expect(fieldValueList({}, { ...meNumField, multiple: true } as any)).toEqual([]);
  });
});

describe("countAbnormalInResults strictest (multi-entry)", () => {
  const baseParam = { _id: "p1", valueFields: [meNumField] } as any;
  const mk = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ([{ petitionId: "x", itemSeq: 1, parameterId: "p1", values, ...extra }] as any);

  it("one bad value among a multiple field → counts abnormal", () => {
    const p = { ...baseParam, valueFields: [{ ...meNumField, multiple: true }] };
    expect(countAbnormalInResults(mk({ pH: [5, 9] }), [p])).toBe(1);
  });
  it("all good multiple values → 0", () => {
    const p = { ...baseParam, valueFields: [{ ...meNumField, multiple: true }] };
    expect(countAbnormalInResults(mk({ pH: [5, 6] }), [p])).toBe(0);
  });
  it("multiEntry: one bad entry → counts abnormal", () => {
    const p = { ...baseParam, multiEntry: true };
    expect(countAbnormalInResults(mk({}, { entries: [{ pH: 5 }, { pH: 9 }] }), [p])).toBe(1);
  });
});

const outField: ParameterValueField = {
  label: "ขนาดก้อน", type: "number", unit: "mm",
  conditionalMode: true, conditionalResult: "output",
  conditionalStandards: [
    { label: "เล็ก", conditions: [{ sourceFieldLabel: "ขนาดก้อน", op: "between", value: 5.5, value2: 6.5 }], outputText: "ก้อนเล็ก", outputKind: "normal", operator: "between", value: null, value2: null },
    { label: "ใหญ่", conditions: [{ sourceFieldLabel: "ขนาดก้อน", op: "between", value: 23.5, value2: 26 }], outputText: "", outputKind: "abnormal", operator: "between", value: null, value2: null },
  ],
};
const ctxWith = (v: unknown) => ({ sameParam: { "ขนาดก้อน": v }, otherParams: {} });

describe("resolveConditionalOutput", () => {
  it("first-match returns rule text+kind", () => {
    expect(resolveConditionalOutput(outField, ctxWith(6))).toEqual({ text: "ก้อนเล็ก", kind: "normal", matchedRuleLabel: "เล็ก" });
  });
  it("falls back to label when outputText blank", () => {
    expect(resolveConditionalOutput(outField, ctxWith(24))).toEqual({ text: "ใหญ่", kind: "abnormal", matchedRuleLabel: "ใหญ่" });
  });
  it("no-match (in a gap) → abnormal, empty text", () => {
    expect(resolveConditionalOutput(outField, ctxWith(10))).toEqual({ text: "", kind: "abnormal" });
  });
  it("blank self value → null (not flagged yet)", () => {
    expect(resolveConditionalOutput(outField, ctxWith(""))).toBeNull();
  });
  it("returns null when not output mode", () => {
    expect(resolveConditionalOutput({ ...outField, conditionalResult: "standard" }, ctxWith(6))).toBeNull();
  });
  it("isConditionalOutputAbnormal true on no-match", () => {
    expect(isConditionalOutputAbnormal(outField, ctxWith(10))).toBe(true);
    expect(isConditionalOutputAbnormal(outField, ctxWith(6))).toBe(false);
  });
});

import {
  resolveLabelTolerance,
  isLabelToleranceAbnormal,
  findLabelToleranceStandard,
} from "./parameterValidation";

describe("resolveLabelTolerance", () => {
  const std = { substance: "ABAMECTIN", autoPct: 2.5, headPct: 5 };
  it("pass when within auto band (center from label %)", () => {
    const r = resolveLabelTolerance(std, "ABAMECTIN 1% W/V EC", 1.0);
    expect(r.center).toBe(1);
    expect(r.autoRange).toEqual([0.975, 1.025]);
    expect(r.headRange).toEqual([0.95, 1.05]);
    expect(r.status).toBe("pass");
  });
  it("review when between auto and head band", () => {
    expect(resolveLabelTolerance(std, "ABAMECTIN 1%", 1.04).status).toBe("review");
  });
  it("fail when beyond head band", () => {
    expect(resolveLabelTolerance(std, "ABAMECTIN 1%", 1.2).status).toBe("fail");
  });
  it("none (skip) when name has no percent — center null", () => {
    const r = resolveLabelTolerance(std, "ABAMECTIN 480 G/L", 1.0);
    expect(r.center).toBeNull();
    expect(r.status).toBe("none");
  });
  it("none but keeps ranges when value is empty (not yet filled)", () => {
    const r = resolveLabelTolerance(std, "ABAMECTIN 1%", "");
    expect(r.status).toBe("none");
    expect(r.center).toBe(1);
    expect(r.autoRange).toEqual([0.975, 1.025]);
  });
  it("no head band → outside auto is fail directly", () => {
    const noHead = { substance: "A", autoPct: 2.5, headPct: null };
    expect(resolveLabelTolerance(noHead, "A 1%", 1.04).status).toBe("fail");
    expect(resolveLabelTolerance(noHead, "A 1%", 1.0).status).toBe("pass");
  });
  it("isLabelToleranceAbnormal true for review and fail, false for pass/none", () => {
    expect(isLabelToleranceAbnormal(std, "A 1%", 1.04)).toBe(true);
    expect(isLabelToleranceAbnormal(std, "A 1%", 1.2)).toBe(true);
    expect(isLabelToleranceAbnormal(std, "A 1%", 1.0)).toBe(false);
    expect(isLabelToleranceAbnormal(std, "A no-percent", 1.0)).toBe(false);
  });
  it("supports custom range mode", () => {
    const rangeStd = { substance: "", mode: "range" as const, autoPct: null, headPct: null, failLow: 0.225, passLow: 0.2438, passHigh: 0.3563, failHigh: 0.375 };
    expect(resolveLabelTolerance(rangeStd, "ANY 0.3%", 0.3).status).toBe("pass");
    expect(resolveLabelTolerance(rangeStd, "ANY 0.3%", 0.23).status).toBe("review");
    expect(resolveLabelTolerance(rangeStd, "ANY 0.3%", 0.38).status).toBe("fail");
  });
});

describe("resolveLabelTolerance — abs mode", () => {
  const std = { substance: "ABAMECTIN", mode: "abs" as const, autoPct: null, headPct: null, autoAbs: 0.05, headAbs: 0.1 };

  it("centers on the label percent and derives ranges from absolute deltas", () => {
    const r = resolveLabelTolerance(std, "ABAMECTIN 1.8% W/V EC", 1.8);
    expect(r.center).toBe(1.8);
    expect(r.autoRange).toEqual([1.75, 1.85]);
    expect(r.headRange).toEqual([1.7, 1.9]);
  });
  it("pass on the auto boundary, review on the head boundary", () => {
    expect(resolveLabelTolerance(std, "ABAMECTIN 1.8%", 1.85).status).toBe("pass");
    expect(resolveLabelTolerance(std, "ABAMECTIN 1.8%", 1.75).status).toBe("pass");
    expect(resolveLabelTolerance(std, "ABAMECTIN 1.8%", 1.9).status).toBe("review");
    expect(resolveLabelTolerance(std, "ABAMECTIN 1.8%", 1.7).status).toBe("review");
  });
  it("fail beyond the head band", () => {
    expect(resolveLabelTolerance(std, "ABAMECTIN 1.8%", 1.91).status).toBe("fail");
    expect(resolveLabelTolerance(std, "ABAMECTIN 1.8%", 1.69).status).toBe("fail");
  });
  it("no head delta → outside auto is fail directly", () => {
    const noHead = { substance: "A", mode: "abs" as const, autoPct: null, headPct: null, autoAbs: 0.05, headAbs: null };
    const r = resolveLabelTolerance(noHead, "A 1.8%", 1.86);
    expect(r.status).toBe("fail");
    expect(r.headRange).toBeNull();
    expect(resolveLabelTolerance(noHead, "A 1.8%", 1.8).status).toBe("pass");
  });
  it("none (skip) when name has no percent — center null", () => {
    const r = resolveLabelTolerance(std, "ABAMECTIN 480 G/L", 1.8);
    expect(r.center).toBeNull();
    expect(r.status).toBe("none");
    expect(r.autoRange).toBeNull();
  });
  it("returns none when autoAbs is missing or non-positive even if head band exists", () => {
    expect(resolveLabelTolerance({ ...std, autoAbs: null }, "A 1.8%", 1.8)).toEqual({
      status: "none",
      center: 1.8,
      autoRange: null,
      headRange: null,
    });
    expect(resolveLabelTolerance({ ...std, autoAbs: 0 }, "A 1.8%", 1.8)).toEqual({
      status: "none",
      center: 1.8,
      autoRange: null,
      headRange: null,
    });
  });
  it("none but keeps ranges when value is empty (not yet filled)", () => {
    const r = resolveLabelTolerance(std, "ABAMECTIN 1.8%", "");
    expect(r.status).toBe("none");
    expect(r.autoRange).toEqual([1.75, 1.85]);
  });
  it("ignores autoPct/headPct left over from percent mode", () => {
    const stale = { substance: "A", mode: "abs" as const, autoPct: 50, headPct: 90, autoAbs: 0.05, headAbs: 0.1 };
    expect(resolveLabelTolerance(stale, "A 1.8%", 1.86).status).toBe("review");
  });
  it("supports split modes where pass percent is derived from the head band", () => {
    const split = { substance: "A", autoMode: "percent" as const, headMode: "abs" as const, autoPct: 50, headPct: null, headAbs: 0.1 };
    const r = resolveLabelTolerance(split, "A 1.8%", 1.8);
    expect(r.autoRange).toEqual([1.75, 1.85]);
    expect(r.headRange).toEqual([1.7, 1.9]);
    expect(resolveLabelTolerance(split, "A 1.8%", 1.86).status).toBe("review");
  });
  it("insets split pass percent from the head band edges", () => {
    const split = { substance: "A", autoMode: "percent" as const, headMode: "percent" as const, autoPct: 25, headPct: 15 };
    const r = resolveLabelTolerance(split, "A 1%", 1);
    expect(r.headRange).toEqual([0.85, 1.15]);
    expect(r.autoRange).toEqual([0.8875, 1.1125]);
    expect(resolveLabelTolerance(split, "A 1%", 0.8875).status).toBe("pass");
    expect(resolveLabelTolerance(split, "A 1%", 1.1125).status).toBe("pass");
    expect(resolveLabelTolerance(split, "A 1%", 0.88).status).toBe("review");
    expect(resolveLabelTolerance(split, "A 1%", 1.12).status).toBe("review");
  });
  it("supports split range modes for pass and head bands", () => {
    const split = {
      substance: "A",
      autoMode: "range" as const,
      headMode: "range" as const,
      autoPct: null,
      headPct: null,
      passLow: 1.75,
      passHigh: 1.85,
      failLow: 1.7,
      failHigh: 1.9,
    };
    const r = resolveLabelTolerance(split, "A 1.8%", 1.8);
    expect(r.autoRange).toEqual([1.75, 1.85]);
    expect(r.headRange).toEqual([1.7, 1.9]);
    expect(resolveLabelTolerance(split, "A 1.8%", 1.85).status).toBe("pass");
    expect(resolveLabelTolerance(split, "A 1.8%", 1.86).status).toBe("review");
    expect(resolveLabelTolerance(split, "A 1.8%", 1.91).status).toBe("fail");
  });
  it("supports head-only split mode when autoMode is none", () => {
    const std = {
      substance: "A",
      autoMode: "none" as const,
      headMode: "abs" as const,
      autoPct: null,
      headPct: null,
      headAbs: 0.1,
    };

    const r = resolveLabelTolerance(std, "A 1.8%", 1.8);

    expect(r.autoRange).toBeNull();
    expect(r.headRange).toEqual([1.7, 1.9]);
    expect(r.status).toBe("review");
    expect(resolveLabelTolerance(std, "A 1.8%", 1.91).status).toBe("fail");
    expect(isLabelToleranceAbnormal(std, "A 1.8%", 1.8)).toBe(true);
  });

  it("returns none when split auto band is missing even if head band exists", () => {
    const std = {
      substance: "A",
      autoMode: "abs" as const,
      headMode: "abs" as const,
      autoPct: null,
      headPct: null,
      autoAbs: null,
      headAbs: 0.1,
    };

    expect(resolveLabelTolerance(std, "A 1.8%", 1.8)).toEqual({
      status: "none",
      center: 1.8,
      autoRange: null,
      headRange: null,
    });
  });

  it("supports auto-only split mode when headMode is none", () => {
    const std = {
      substance: "A",
      autoMode: "abs" as const,
      headMode: "none" as const,
      autoPct: null,
      headPct: null,
      autoAbs: 0.05,
    };

    const r = resolveLabelTolerance(std, "A 1.8%", 1.8);

    expect(r.autoRange).toEqual([1.75, 1.85]);
    expect(r.headRange).toBeNull();
    expect(r.status).toBe("pass");
    expect(resolveLabelTolerance(std, "A 1.8%", 1.86).status).toBe("fail");
  });

  it("returns none for split mode with both bands disabled", () => {
    const std = {
      substance: "A",
      autoMode: "none" as const,
      headMode: "none" as const,
      autoPct: null,
      headPct: null,
    };

    expect(resolveLabelTolerance(std, "A 1.8%", 1.8)).toEqual({
      status: "none",
      center: 1.8,
      autoRange: null,
      headRange: null,
    });
  });
  it("isLabelToleranceAbnormal true for review and fail", () => {
    expect(isLabelToleranceAbnormal(std, "A 1.8%", 1.86)).toBe(true);
    expect(isLabelToleranceAbnormal(std, "A 1.8%", 1.95)).toBe(true);
    expect(isLabelToleranceAbnormal(std, "A 1.8%", 1.8)).toBe(false);
  });
});

describe("findLabelToleranceStandard", () => {
  const field: any = { label: "v", type: "number", labelToleranceMode: true,
    labelToleranceStandards: [{ substance: "ABAMECTIN", autoPct: 2.5, headPct: 5 }] };
  it("matches by substance key regardless of trailing spec", () => {
    expect(findLabelToleranceStandard(field, "ABAMECTIN 1.8% W/V EC")?.autoPct).toBe(2.5);
  });
  it("returns undefined for unlisted substance", () => {
    expect(findLabelToleranceStandard(field, "GLYPHOSATE")).toBeUndefined();
  });
  it("matches by label percent and product type without substance", () => {
    const nextField: any = {
      label: "v", type: "number", labelToleranceMode: true,
      labelToleranceStandards: [
        { substance: "", labelPercent: 1, productTypes: ["water"], autoPct: 11.25, headPct: 15 },
        { substance: "", labelPercent: 1, productTypes: ["sand"], autoPct: 18.75, headPct: 25 },
      ],
    };
    expect(findLabelToleranceStandard(nextField, "ANY 1% W/V EC", "water")?.autoPct).toBe(11.25);
    expect(findLabelToleranceStandard(nextField, "ANY 1% W/W GR", "sand")?.autoPct).toBe(18.75);
  });
});

describe("countAbnormalInResults — labelTolerance", () => {
  const param: any = {
    _id: "p1", multiEntry: false,
    valueFields: [{
      label: "%w/v", type: "number", unit: "%", labelToleranceMode: true,
      labelToleranceStandards: [{ substance: "ABAMECTIN", autoPct: 2.5, headPct: 5 }],
    }],
  };
  const mk = (val: number) => ([{
    petitionId: "pt1", itemSeq: 0, parameterId: "p1",
    commonName: "ABAMECTIN 1% W/V EC",
    values: { "%w/v::abamectin": val },
  }] as any);
  it("counts review + fail, not pass", () => {
    expect(countAbnormalInResults(mk(1.0), [param])).toBe(0);   // pass
    expect(countAbnormalInResults(mk(1.04), [param])).toBe(1);  // review
    expect(countAbnormalInResults(mk(1.2), [param])).toBe(1);   // fail
  });
  it("skips substance without percent in name", () => {
    const noPct = [{ petitionId: "pt1", itemSeq: 0, parameterId: "p1",
      commonName: "ABAMECTIN 480 G/L", values: { "%w/v::abamectin": 999 } }] as any;
    expect(countAbnormalInResults(noPct, [param])).toBe(0);
  });
  it("distinguishes the same percent by product type", () => {
    const mixedParam: any = {
      _id: "p2", multiEntry: false,
      valueFields: [{
        label: "%AI", type: "number", unit: "%", labelToleranceMode: true,
        labelToleranceStandards: [
          { substance: "", labelPercent: 1, productTypes: ["water"], autoPct: 11.25, headPct: 15 },
          { substance: "", labelPercent: 1, productTypes: ["sand"], autoPct: 18.75, headPct: 25 },
        ],
      }],
    };
    const water = [{ petitionId: "pt2", itemSeq: 0, parameterId: "p2", commonName: "X 1% W/V EC", values: { "%AI::x": 1.14 } }] as any;
    const sand = [{ petitionId: "pt2", itemSeq: 0, parameterId: "p2", commonName: "X 1% W/W GR", values: { "%AI::x": 1.14 } }] as any;
    expect(countAbnormalInResults(water, [mixedParam])).toBe(1);
    expect(countAbnormalInResults(sand, [mixedParam])).toBe(0);
  });
  it("flags review and fail for custom range mode", () => {
    const rangeParam: any = {
      _id: "p3", multiEntry: false,
      valueFields: [{
        label: "%AI", type: "number", unit: "%", labelToleranceMode: true,
        labelToleranceStandards: [
          { substance: "", labelPercent: 0.3, productTypes: ["sand"], mode: "range", failLow: 0.225, passLow: 0.2438, passHigh: 0.3563, failHigh: 0.375 },
        ],
      }],
    };
    const pass = [{ petitionId: "pt3", itemSeq: 0, parameterId: "p3", commonName: "X 0.3% W/W GR", values: { "%AI::x": 0.3 } }] as any;
    const review = [{ petitionId: "pt3", itemSeq: 0, parameterId: "p3", commonName: "X 0.3% W/W GR", values: { "%AI::x": 0.23 } }] as any;
    const fail = [{ petitionId: "pt3", itemSeq: 0, parameterId: "p3", commonName: "X 0.3% W/W GR", values: { "%AI::x": 0.4 } }] as any;
    expect(countAbnormalInResults(pass, [rangeParam])).toBe(0);
    expect(countAbnormalInResults(review, [rangeParam])).toBe(1);
    expect(countAbnormalInResults(fail, [rangeParam])).toBe(1);
  });
});
