import { describe, expect, it } from "vitest";
import { productionDateFromLotNo } from "./coaLot";

describe("productionDateFromLotNo", () => {
  it("reads the six-digit Buddhist date at the end of Lot No.", () => {
    expect(productionDateFromLotNo("26S-PCB25-480-091069")).toBe("2026-10-09");
    expect(productionDateFromLotNo("26S-PCB25-480X091069")).toBe("2026-10-09");
  });

  it("reads the six digits after FG as YYMMDD", () => {
    expect(productionDateFromLotNo("FG260404-002")).toBe("2026-04-04");
  });

  it("rejects invalid or missing Lot No. dates", () => {
    expect(productionDateFromLotNo("26S-PCB25-480-311369")).toBe("");
    expect(productionDateFromLotNo("L-CUSTOMER")).toBe("");
  });
});
