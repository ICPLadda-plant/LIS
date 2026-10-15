import { describe, expect, it } from "vitest";
import { buildCoaReportPages } from "./coaReport";
import type { CoaDocument } from "@/types/coa.types";

describe("buildCoaReportPages", () => {
  it("prints manually entered ERP results in product-specific templates", () => {
    const doc = {
      sourceType: "erpManual",
      sampleSnapshots: [{ itemSeq: 10000, commonName: "Glyphosate 48% SL" }],
      resultSnapshots: [{ itemSeq: 10000, testItem: "Appearance", criteria: "Amber liquid", result: "Conform" }],
    } as CoaDocument;
    const [page] = buildCoaReportPages(doc);
    expect(page.template).toBe("liquid");
    expect(page.samples[0].selectedResultsOnly).toBe(true);
    expect(page.samples[0].rows).toEqual(doc.resultSnapshots);
  });
  it.each(["%AI", "% AI", "AI content", "active ingredient"])("reads the configured %s result", (testItem) => {
    const doc = {
      sampleSnapshots: [{ itemSeq: 1, commonName: "Glyphosate 48% SL" }],
      resultSnapshots: [{ itemSeq: 1, testItem, result: "48.3%" }],
    } as CoaDocument;
    expect(buildCoaReportPages(doc)[0].samples[0].aiContentResult).toBe("48.3%");
  });

  it("groups frozen result rows by selected sample", () => {
    const doc = {
      _id: "c1",
      coaNo: "00012026",
      revision: 1,
      status: "reissued",
      petitionId: "p1",
      petitionNoSnapshot: "P-2608-0001",
      selectedItemSeqs: [1],
      customerSnapshot: { name: "Customer A", company: "ICP Ladda" },
      sampleSnapshots: [{ itemSeq: 1, sampleName: "Sample A", batchNo: "B1" }],
      resultSnapshots: [{ itemSeq: 1, testItem: "pH", result: "7.0", criteria: "6.5-7.5", method: "M1" }],
      approval: { approvedBy: { name: "QC Head" }, approvedAt: "2026-08-04T00:00:00.000Z" },
    } as CoaDocument;

    const pages = buildCoaReportPages(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0].coaNo).toBe("00012026");
    expect(pages[0].revision).toBe(1);
    expect(pages[0].samples[0].rows[0].testItem).toBe("pH");
  });

  it("uses the special COA form data for common names ending with GR", () => {
    const doc = {
      _id: "c-gr",
      coaNo: "00052026",
      revision: 0,
      status: "approved",
      petitionId: "p-gr",
      petitionNoSnapshot: "P-2608-0005",
      selectedItemSeqs: [1],
      customerSnapshot: { name: "Customer A" },
      sampleSnapshots: [{
        itemSeq: 1,
        sampleName: "Trade Herbicide",
        commonName: "Glyphosate 48% SL GR",
        batchNo: "B-777",
        lotNo: "LOT-777",
        productionDate: "2026-08-15",
      }],
      resultSnapshots: [{ itemSeq: 1, testItem: "%AI content (W/W)", result: "48.2%" }],
      approval: { approvedBy: { name: "QC Head" }, approvedAt: "2026-08-20T00:00:00.000Z" },
    } as CoaDocument;

    const pages = buildCoaReportPages(doc);

    expect(pages[0].template).toBe("grWpSp");
    expect(pages[0].samples[0].product).toBe("Trade Herbicide (Glyphosate 48% SL GR)");
    expect(pages[0].samples[0].manufacturingDate).toBe("15/08/2026");
    expect(pages[0].samples[0].expiredDate).toBe("15/08/2028");
    expect(pages[0].samples[0].aiContentResult).toBe("48.2%");
    expect(pages[0].samples[0].aiContentCriteria).toBe("48% ± 2.40");
    expect(pages[0].samples[0].rows[0].criteria).toBe("48% ± 2.40");
  });

  it.each(["GR", "DS", "WP", "WG", "GB", "ST", "SP"])(
    "uses the special COA form for common names ending with %s",
    (suffix) => {
      const doc = {
        sampleSnapshots: [{ itemSeq: 1, commonName: `Product ${suffix}` }],
      } as CoaDocument;

      expect(buildCoaReportPages(doc)[0].template).toBe("grWpSp");
    },
  );

  it("uses the number before % in the common name for AI tolerance criteria", () => {
    const doc = {
      _id: "c-ai",
      coaNo: "00072026",
      revision: 0,
      status: "approved",
      petitionId: "p-ai",
      selectedItemSeqs: [1],
      customerSnapshot: {},
      sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade Liquid", commonName: "Glyphosate 48% SL" }],
      resultSnapshots: [{ itemSeq: 1, testItem: "%AI content (W/V)", result: "47.9%", criteria: "-" }],
    } as CoaDocument;

    const pages = buildCoaReportPages(doc);

    expect(pages[0].samples[0].aiContentCriteria).toBe("48% ± 2.40");
    expect(pages[0].samples[0].rows[0].criteria).toBe("48% ± 2.40");
  });

  it("uses formulation-specific AI tolerance criteria when available", () => {
    const doc = {
      _id: "c-gr-specific",
      coaNo: "00072026",
      revision: 0,
      status: "approved",
      petitionId: "p-gr-specific",
      selectedItemSeqs: [1],
      customerSnapshot: {},
      sampleSnapshots: [{ itemSeq: 1, sampleName: "Granule", commonName: "Insecticide 2% GR" }],
      resultSnapshots: [{ itemSeq: 1, testItem: "%AI content (W/W)", result: "2.1%" }],
    } as CoaDocument;

    const pages = buildCoaReportPages(doc);

    expect(pages[0].samples[0].aiContentCriteria).toBe("2% ± 0.50");
  });

  it.each(["SL", "EC", "EW", "SC", "ME", "ZC"].flatMap((formulation) => [
    `Glyphosate 48% ${formulation}`,
    `Glyphosate 48% W/V ${formulation}`,
    `Glyphosate 48%${formulation}`,
    `  Glyphosate 48%  ${formulation.toLowerCase()}  `,
  ]))(
    "uses the liquid COA form data for %s",
    (commonName) => {
      const doc = {
        _id: "c-liquid",
        coaNo: "00062026",
        revision: 0,
        status: "approved",
        petitionId: "p-liquid",
        petitionNoSnapshot: "P-2608-0006",
        selectedItemSeqs: [1],
        customerSnapshot: { name: "Customer A" },
        sampleSnapshots: [{
          itemSeq: 1,
          sampleName: "Trade Liquid",
          commonName,
          batchNo: "B-888",
          lotNo: "LOT-888",
          productionDate: "2026-08-15",
        }],
        resultSnapshots: [
          { itemSeq: 1, testItem: "%AI content (W/V)", result: "48.2%" },
          { itemSeq: 1, testItem: "Density at 30°C (g/cm³)", result: "1.120" },
          { itemSeq: 1, testItem: "Date of analysis", result: "2026-08-20" },
        ],
        approval: { approvedBy: { name: "QC Head" }, approvedAt: "2026-08-20T00:00:00.000Z" },
      } as CoaDocument;

      const pages = buildCoaReportPages(doc);

      expect(pages[0].template).toBe("liquid");
      expect(pages[0].issueDate).toBe("August 20, 2026");
      expect(pages[0].samples[0].product).toBe(`Trade Liquid (${commonName.trim()})`);
      expect(pages[0].samples[0].aiContentResult).toBe("48.2%");
      expect(pages[0].samples[0].aiContentCriteria).toBe("48% ± 2.40");
      expect(pages[0].samples[0].densityResult).toBe("1.120");
      expect(pages[0].samples[0].dateOfAnalysis).toBe("20/08/2026");
    },
  );

  it.each(["SL", "EC", "EW", "SC", "ME", "ZC"])("recognizes %s without a concentration", (formulation) => {
    const doc = {
      sampleSnapshots: [{ itemSeq: 1, commonName: `Product ${formulation}` }],
      resultSnapshots: [],
    } as CoaDocument;

    const [page] = buildCoaReportPages(doc);

    expect(page.template).toBe("liquid");
    expect(page.issueDate).toBe("-");
    expect(page.samples[0].aiContentCriteria).toBe("-");
  });

  it.each([undefined, "", "Product SC extra", "Product ESC", "Product SC WP"])(
    "does not classify %s as a liquid formulation",
    (commonName) => {
      const doc = { sampleSnapshots: [{ itemSeq: 1, commonName }] } as CoaDocument;

      expect(buildCoaReportPages(doc)[0].template).not.toBe("liquid");
    },
  );

  it("keeps every selected sample and its results on the matching form", () => {
    const doc = {
      sampleSnapshots: [
        { itemSeq: 1, commonName: "Other product" },
        { itemSeq: 2, commonName: "Product 48% W/V SC", batchNo: "B-SC" },
        { itemSeq: 3, commonName: "Product 10% EW", batchNo: "B-EW" },
        { itemSeq: 4, commonName: "Product 2% GR" },
      ],
      resultSnapshots: [
        { itemSeq: 1, testItem: "pH", result: "7" },
        { itemSeq: 2, testItem: "%AI content (W/V)", result: "48.2%" },
        { itemSeq: 3, testItem: "%AI content (W/V)", result: "10.1%" },
        { itemSeq: 4, testItem: "%AI content (W/W)", result: "2.1%" },
      ],
    } as CoaDocument;

    const pages = buildCoaReportPages(doc);

    expect(pages.map((page) => page.template)).toEqual(["standard", "liquid", "liquid", "grWpSp"]);
    expect(pages.map((page) => page.samples.map((sample) => sample.itemSeq))).toEqual([[1], [2], [3], [4]]);
    expect(pages.map((page) => page.samples[0].rows[0].result)).toEqual(["7", "48.2%", "10.1%", "2.1%"]);
    expect(pages[1].samples[0].batchLabel).toBe("B-SC");
    expect(pages[2].samples[0].batchLabel).toBe("B-EW");
  });

  it("keeps standard samples together and supports an empty draft", () => {
    const doc = {
      sampleSnapshots: [{ itemSeq: 1, commonName: "Other A" }, { itemSeq: 2, commonName: "Other B" }],
    } as CoaDocument;

    expect(buildCoaReportPages(doc)).toHaveLength(1);
    expect(buildCoaReportPages(doc)[0].samples).toHaveLength(2);
    expect(buildCoaReportPages({ ...doc, sampleSnapshots: [] })[0].samples).toEqual([]);
  });

  it("uses the BROMADIOLONE 0.005% wax block COA form data", () => {
    const doc = {
      _id: "c-brom",
      coaNo: "00082026",
      revision: 0,
      status: "approved",
      petitionId: "p-brom",
      petitionNoSnapshot: "P-2608-0008",
      selectedItemSeqs: [1],
      customerSnapshot: { name: "Customer A" },
      sampleSnapshots: [{
        itemSeq: 1,
        sampleName: "Red Wax Block",
        commonName: "BROMADIOLONE 0.005%",
        batchNo: "B-008",
        lotNo: "LOT-008",
        productionDate: "2026-08-15",
      }],
      resultSnapshots: [
        { itemSeq: 1, testItem: "%AI content (W/W)", result: "0.0051%" },
        { itemSeq: 1, testItem: "Wax block size", result: "5.90 gm" },
        { itemSeq: 1, testItem: "Date of analysis", result: "2026-08-20" },
      ],
      approval: { approvedBy: { name: "QC Head" }, approvedAt: "2026-08-20T00:00:00.000Z" },
    } as CoaDocument;

    const pages = buildCoaReportPages(doc);

    expect(pages[0].template).toBe("bromadiolone0005");
    expect(pages[0].samples[0].product).toBe("Red Wax Block (BROMADIOLONE 0.005%)");
    expect(pages[0].samples[0].batchLabel).toBe("LOT-008 / B-008");
    expect(pages[0].samples[0].aiContentResult).toBe("0.0051%");
    expect(pages[0].samples[0].aiContentCriteria).toBe("0.005% ± 0.00125");
    expect(pages[0].samples[0].waxBlockSizeResult).toBe("5.90 gm");
    expect(pages[0].samples[0].dateOfAnalysis).toBe("20/08/2026");
  });
});
