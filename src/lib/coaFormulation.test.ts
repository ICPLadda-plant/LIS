import { describe, expect, it } from "vitest";
import { aiContentTestItemForCommonName, isGrWpSpCommonName } from "./coaFormulation";

describe("COA formulation selection", () => {
  it.each(["WG", "WP", "ST", "GR", "DS", "SP", "GB"])(
    "uses the attached dry-product form for common names ending with %s",
    (suffix) => {
      expect(isGrWpSpCommonName(`THIAMETHOXAM 25% ${suffix}`)).toBe(true);
      expect(aiContentTestItemForCommonName(`THIAMETHOXAM 25% ${suffix}`)).toBe("%AI content (W/W)");
    },
  );

  it("keeps liquid formulations on the W/V result item", () => {
    expect(isGrWpSpCommonName("GLYPHOSATE 48% W/V SL")).toBe(false);
    expect(aiContentTestItemForCommonName("GLYPHOSATE 48% W/V SL")).toBe("%AI content (W/V)");
  });
});
