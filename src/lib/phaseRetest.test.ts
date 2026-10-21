import { describe, expect, it } from "vitest";
import type { ParameterItem } from "./api";
import {
  isPhaseTriggerParameter,
  missingValuesBeforePhaseTrigger,
  phaseTriggerBlockedReason,
  visibleFieldsForPhase,
} from "./phaseRetest";

const param = (overrides: Partial<ParameterItem>): ParameterItem => ({
  _id: "param",
  name: "Parameter",
  valueFields: [],
  ...overrides,
});

describe("phaseRetest", () => {
  it("identifies the trigger parameter by id", () => {
    expect(isPhaseTriggerParameter(param({ _id: "trigger" }), "trigger")).toBe(true);
    expect(isPhaseTriggerParameter(param({ _id: "other" }), "trigger")).toBe(false);
    expect(isPhaseTriggerParameter(param({
      _id: "trigger",
      valueFields: [{ label: "Timer", type: "timer", timerUnit: "hour", timerDurationSec: 3600, triggersPhase2: true }],
    }), null)).toBe(true);
  });

  it("shows non-phased parameters in both phases unless they are the trigger in phase 2", () => {
    const nonPhased = param({
      _id: "result-param",
      hasPhases: false,
      valueFields: [{ label: "ผล", type: "number", unit: "%" }],
    });
    const trigger = param({
      _id: "trigger-param",
      hasPhases: true,
      valueFields: [{ label: "Timer", type: "timer", timerUnit: "hour", timerDurationSec: 3600, triggersPhase2: true }],
    });

    expect(visibleFieldsForPhase(nonPhased, 1, "trigger-param").map((field) => field.label)).toEqual(["ผล"]);
    expect(visibleFieldsForPhase(nonPhased, 2, "trigger-param").map((field) => field.label)).toEqual(["ผล"]);
    expect(visibleFieldsForPhase(trigger, 2, "trigger-param")).toEqual([]);
    expect(visibleFieldsForPhase(trigger, 2, null)).toEqual([]);
  });

  it("honors field phase on phased non-trigger parameters", () => {
    const phased = param({
      _id: "phased-param",
      hasPhases: true,
      valueFields: [
        { label: "ก่อน", type: "number", unit: "%", phase: "before" },
        { label: "หลัง", type: "number", unit: "%", phase: "after" },
        { label: "ทั้งคู่", type: "text", phase: "both" },
      ],
    });

    expect(visibleFieldsForPhase(phased, 1, "trigger-param").map((field) => field.label)).toEqual(["ก่อน", "ทั้งคู่"]);
    expect(visibleFieldsForPhase(phased, 2, "trigger-param").map((field) => field.label)).toEqual(["หลัง", "ทั้งคู่"]);
  });

  describe("missingValuesBeforePhaseTrigger", () => {
    const oven = param({
      _id: "oven",
      name: "อบ 14 วัน",
      hasPhases: true,
      valueFields: [{ label: "เวลาอบ", type: "timer", timerUnit: "day", timerDurationSec: 14 * 86400, triggersPhase2: true }],
    });
    const ai = param({
      _id: "ai",
      name: "%AI",
      valueFields: [
        { label: "Area Inj.1", type: "float" },
        { label: "Area Average", type: "float" },
        { label: "%AI", type: "float" },
      ],
    });
    const sg = param({
      _id: "sg",
      name: "ค่า ถพ.",
      valueFields: [
        { label: "ค่าถพ.", type: "float" },
        { label: "อุณหภูมิ", type: "float" },
        { label: "รูปประกอบ", type: "photo" },
      ],
    });
    const units = (field: { label: string }) => [{ key: field.label, field: field as never }];

    it("lists empty measured values but skips the trigger, calculated %AI, machine temperature and photos", () => {
      const values: Record<string, Record<string, unknown>> = { ai: {}, sg: {} };
      const missing = missingValuesBeforePhaseTrigger([oven, ai, sg], (p) => [values[String(p._id)] ?? {}], units);
      expect(missing).toEqual(["%AI › Area Inj.1", "ค่า ถพ. › ค่าถพ."]);
      expect(phaseTriggerBlockedReason(missing)).toBe("กรอกค่าก่อนอบให้ครบก่อนเริ่มจับเวลา: %AI › Area Inj.1, ค่า ถพ. › ค่าถพ.");
    });

    it("allows the oven timer once every value is filled", () => {
      const values: Record<string, Record<string, unknown>> = { ai: { "Area Inj.1": "100" }, sg: { "ค่าถพ.": "1.05" } };
      const missing = missingValuesBeforePhaseTrigger([oven, ai, sg], (p) => [values[String(p._id)] ?? {}], units);
      expect(missing).toEqual([]);
      expect(phaseTriggerBlockedReason(missing)).toBeUndefined();
    });
  });
});
