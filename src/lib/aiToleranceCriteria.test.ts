import { describe, expect, it } from "vitest";
import {
  aiPercentFromCommonName,
  aiToleranceCriteriaForCommonName,
  isAiContentTestItem,
  plusMinusAiCriteriaFromRange,
  resolveAiToleranceCriteria,
} from "./aiToleranceCriteria";

describe("AI tolerance criteria", () => {
  it("uses the number before % in the common name", () => {
    expect(aiPercentFromCommonName("Glyphosate 48% SL")).toBe("48");
    expect(aiToleranceCriteriaForCommonName("Glyphosate 48% SL")).toBe("48% ± 2.40");
  });

  it("uses formulation-specific tolerance rows when present", () => {
    expect(aiToleranceCriteriaForCommonName("Product 1% SG")).toBe("1% ± 0.25");
    expect(aiToleranceCriteriaForCommonName("Product 1% EC")).toBe("1% ± 0.15");
    expect(aiToleranceCriteriaForCommonName("Product 2% GR")).toBe("2% ± 0.50");
    expect(aiToleranceCriteriaForCommonName("Product 2% SL")).toBe("2% ± 0.30");
  });

  it("returns a plus-minus criterion for every AI percentage in a mixed common name", () => {
    expect(aiToleranceCriteriaForCommonName("2,4-D 45.2% + PICLORAM 11.6% SL"))
      .toBe("45.2% ± 2.26 / 11.6% ± 0.70");
  });

  it("converts a legacy lower-upper range to a center plus-minus criterion", () => {
    expect(plusMinusAiCriteriaFromRange("18.80-21.20")).toBe("20% ± 1.20");
    expect(resolveAiToleranceCriteria("Acetamiprid SP", "18.80-21.20 %W/W"))
      .toBe("20% ± 1.20");
  });

  it("keeps the common-name criterion authoritative over a stored legacy range", () => {
    expect(resolveAiToleranceCriteria("Product 20% SP", "18.00-22.00"))
      .toBe("20% ± 1.20");
  });

  it("matches AI content test item labels", () => {
    expect(isAiContentTestItem("%AI content (W/W)")).toBe(true);
    expect(isAiContentTestItem("Density at 30°C")).toBe(false);
  });
});
