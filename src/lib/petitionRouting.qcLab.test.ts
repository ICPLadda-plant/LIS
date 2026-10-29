import { describe, expect, it } from "vitest";
import { pickQcLabSideItems } from "./petitionRouting";

const petition = { routeTargets: ["qc", "lab"] as Array<"qc" | "lab">, items: [], submittedBy: { name: "x", submittedAt: "" } };

describe("pickQcLabSideItems", () => {
  it("keeps the larger old duplicate row for Lab and the smaller for QC", () => {
    const items = [
      { seq: 1, sampleName: "FIPRONIL 0.3% GR", batchNo: "26S-FPN0.3-156", labelQuantities: ["100 G"] },
      { seq: 2, sampleName: "FIPRONIL 0.3% GR", batchNo: "26S-FPN0.3-156", labelQuantities: ["500 G"] },
    ];
    expect(pickQcLabSideItems(petition as never, items, "lab").map((i) => i.seq)).toEqual([2]);
    expect(pickQcLabSideItems(petition as never, items, "qc").map((i) => i.seq)).toEqual([1]);
  });

  it("splits a two-sample row into the Lab sample only", () => {
    const items = [{ seq: 1, sampleName: "A", batchNo: "B1", sampleQuantity: 2, labelQuantities: ["500 G", "100 G"] }];
    expect(pickQcLabSideItems(petition as never, items, "lab")).toEqual([
      { ...items[0], sampleQuantity: 1, labelQuantity: "500 G", labelQuantities: ["500 G"] },
    ]);
  });
});
