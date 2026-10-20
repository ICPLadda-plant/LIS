import { describe, expect, it } from "vitest";

import type { ParameterItem } from "./api";
import { buildApplyPreview, buildMasterItemFacets } from "./parameterApplyPreview";

const items = buildMasterItemFacets([
  { item_no: "F-001", item_name1: "Product A", common_name: "ABAMECTIN 1.8% EC" },
  { item_no: "F-002", item_name1: "Product B", common_name: "CYPERMETHRIN 35% EC" },
  { item_no: "F-003", item_name1: "Product C", common_name: "GLYPHOSATE 48% SL" },
  { item_no: "R-001", item_name1: "Raw D", common_name: "XYLENE" },
]);

const form = (patch: Partial<ParameterItem>) => ({ name: "pH", valueFields: [], ...patch }) as ParameterItem;

describe("buildApplyPreview", () => {
  it("counts each rule, removes excluded items, and flags rules that add nothing", () => {
    const preview = buildApplyPreview(
      form({
        applyRules: [
          { categories: ["FG"] },
          { commonNames: ["EC"] },
          {},
        ],
        excludeItemNos: ["F-002"],
      }),
      items,
    );

    expect(preview.rows.map((row) => row.itemNo)).toEqual(["F-001", "F-003"]);
    expect(preview.rows[0].ruleIndexes).toEqual([0, 1]);
    expect(preview.ruleCounts).toEqual([3, 2, 0]);
    expect(preview.excludedCount).toBe(1);
    expect(preview.emptyRules).toEqual([2]);
    expect(preview.redundantRules).toEqual([1]);
    expect(preview.unmatchedRules).toEqual([]);
  });

  it("flags a rule that matches no master item", () => {
    const preview = buildApplyPreview(form({ applyRules: [{ itemNos: ["X-999"] }] }), items);
    expect(preview.rows).toEqual([]);
    expect(preview.unmatchedRules).toEqual([0]);
  });
});
