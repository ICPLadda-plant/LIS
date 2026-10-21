import { describe, expect, it } from "vitest";

import { getClassification, getCommonName } from "./productClassification";

describe("productClassification", () => {
  it("treats SG as a sand formulation common name", () => {
    expect(getClassification("SG")?.group).toBe("sand");
    expect(getCommonName("SG")).toBe("SG");
  });

  it("normalizes SAND GRANULE to SG", () => {
    const value = "BROMADIOLONE 0.005% W/W SAND GRANULE";

    expect(getClassification(value)?.code).toBe("SG");
    expect(getClassification(value)?.group).toBe("sand");
    expect(getCommonName(value)).toBe("SG");
  });

  it.each([
    ["ABAMECTIN 1.8% W/V EC", "EC"],
    ["CHLOROTHALONIL 50% W/V SC", "SC"],
    ["BROMADIOLONE 0.005% W/W GR", "GR"],
  ])("ignores concentration units and resolves the formulation from %s", (value, expected) => {
    expect(getClassification(value)?.code).toBe(expected);
  });

  it("still accepts a concentration unit when it is the entire value", () => {
    expect(getClassification("W/V")?.code).toBe("W/V");
    expect(getClassification("W/W")?.code).toBe("W/W");
  });
});
