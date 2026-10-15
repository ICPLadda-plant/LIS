import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CoaReportTemplate, { COA_REPORT_CSS } from "./CoaReportTemplate";
import { buildCoaReportPages, type CoaReportPage } from "@/lib/coaReport";

describe("CoaReportTemplate", () => {
  it.each(["GLYPHOSATE 48% SL", "EMAMECTIN BENZOATE 2% W/V ME", "Product 2% GR", "BROMADIOLONE 0.005%", "Other product"])(
    "renders only selected parameter results in the existing %s form",
    (commonName) => {
      const pages = buildCoaReportPages({
        _id: "selected", revision: 0, status: "draft", petitionId: "p1", selectedItemSeqs: [1],
        sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade A", commonName, batchNo: "B1" }],
        resultSnapshots: [{ itemSeq: 1, testItem: "pH", result: "7.1", criteria: "6 - 8", unit: "pH" }],
        formSelections: [{ itemSeq: 1, resultKeys: ["ph"] }],
      });
      render(<CoaReportTemplate pages={pages} />);
      expect(screen.getByText("pH")).toBeInTheDocument();
      expect(screen.getByText("6 - 8")).toBeInTheDocument();
      expect(screen.getByText("7.1 pH")).toBeInTheDocument();
      expect(screen.queryByText("Appearance")).not.toBeInTheDocument();
      expect(screen.queryByText("Conform")).not.toBeInTheDocument();
      expect(screen.queryByText(/%AI content/)).not.toBeInTheDocument();
    },
  );

  it("renders the special GR/WP/SP COA form", () => {
    const page: CoaReportPage = {
      template: "grWpSp",
      coaNo: "00052026",
      revision: 0,
      issueDate: "20/08/2569",
      petitionNo: "P-2608-0005",
      customer: {},
      samples: [{
        itemSeq: 1,
        sampleName: "Trade Herbicide",
        commonName: "Glyphosate 48% SL GR",
        batchNo: "B-777",
        lotNo: "LOT-777",
        productionDate: "2026-08-15",
        product: "Trade Herbicide (Glyphosate 48% SL GR)",
        manufacturingDate: "15/08/2026",
        expiredDate: "15/08/2028",
        batchLabel: "LOT-777 / B-777",
        aiContentResult: "48.2%",
        aiContentCriteria: "48% ± 2.40",
        densityResult: "-",
        waxBlockSizeResult: "-",
        dateOfAnalysis: "05/09/2026",
        rows: [{ itemSeq: 1, testItem: "%AI content (W/W)", result: "48.2%" }],
      }],
      remark: "",
      approvedBy: "QC Head",
      approvedAt: "20/08/2569",
    };

    render(<CoaReportTemplate pages={[page]} />);

    expect(screen.getByText("CERTIFICATE OF ANALYSIS")).toBeInTheDocument();
    expect(screen.getByText(/PRODUCT/).closest("div")).toHaveTextContent("PRODUCT : Trade Herbicide (Glyphosate 48% SL GR)");
    expect(screen.getByText(/MANUFACTURING DATE/).closest("div")).toHaveTextContent("MANUFACTURING DATE : 15/08/2026");
    expect(screen.getByText(/EXPIRED DATE/).closest("div")).toHaveTextContent("EXPIRED DATE : 15/08/2028");
    expect(screen.getByText("BATCH NO.")).toBeInTheDocument();
    expect(screen.getByText("48% ± 2.40")).toBeInTheDocument();
    expect(screen.getByText("48.2%")).toBeInTheDocument();
    expect(screen.getByText("Date of analysis").nextElementSibling).toHaveTextContent("05/09/2026");
  });

  it("renders the liquid formulation COA form", () => {
    const page: CoaReportPage = {
      template: "liquid",
      coaNo: "00062026",
      revision: 0,
      issueDate: "August 20, 2026",
      petitionNo: "P-2608-0006",
      customer: {},
      samples: [{
        itemSeq: 1,
        sampleName: "Trade Liquid",
        commonName: "Glyphosate 48% SL",
        batchNo: "B-888",
        lotNo: "LOT-888",
        productionDate: "2026-08-15",
        product: "Trade Liquid (Glyphosate 48% SL)",
        manufacturingDate: "15/08/2026",
        expiredDate: "15/08/2028",
        batchLabel: "LOT-888 / B-888",
        aiContentResult: "48.2%",
        aiContentCriteria: "48% ± 2.40",
        densityResult: "1.120",
        waxBlockSizeResult: "-",
        dateOfAnalysis: "20/08/2026",
        rows: [
          { itemSeq: 1, testItem: "Appearance", criteria: "Clear liquid", result: "Conform" },
          { itemSeq: 1, testItem: "Density at 30°C (g/cm³)", criteria: "1.100 - 1.150", result: "1.120" },
        ],
      }],
      remark: "",
      approvedBy: "QC Head",
      approvedAt: "20/08/2569",
    };

    const { rerender } = render(<CoaReportTemplate pages={[page]} />);

    expect(screen.getByText("CERTIFICATE OF ANALYSIS")).toBeInTheDocument();
    expect(screen.getByText("CERTIFICATE OF ANALYSIS").closest("section")).toHaveClass("coa-liquid-page");
    expect(COA_REPORT_CSS).not.toContain("#fff3b0");
    expect(COA_REPORT_CSS).toContain(".coa-liquid-page .coa-special-title { font-size: 20pt; }");
    const section = screen.getByText("CERTIFICATE OF ANALYSIS").closest("section")!;
    expect(window.getComputedStyle(section).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(window.getComputedStyle(section).fontSize).toBe("18pt");
    expect(window.getComputedStyle(screen.getByText("CERTIFICATE OF ANALYSIS")).fontSize).toBe("20pt");
    expect(COA_REPORT_CSS).toContain(".coa-liquid-page .coa-special-table th { font-weight: 400 !important; }");
    expect(screen.getByText("August 20, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Month DATE, ค.ศ.")).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["TEST ITEM", "Specification", "Result"]);
    expect(screen.getByText("Clear liquid")).toBeInTheDocument();
    expect(screen.getByText("Conform")).toBeInTheDocument();
    expect(screen.queryByText("1.100 - 1.150")).not.toBeInTheDocument();
    const densityCells = within(screen.getByText("Density at 30°C (g/cm³)").closest("tr")!).getAllByRole("cell");
    expect(densityCells).toHaveLength(2);
    expect(densityCells[0]).toHaveAttribute("colspan", "2");
    expect(densityCells[1]).toHaveTextContent("1.120");
    expect(screen.getByText(/PRODUCT/).closest("div")).toHaveTextContent("PRODUCT : Trade Liquid (Glyphosate 48% SL)");
    expect(screen.getByText("%AI content (W/V)")).toBeInTheDocument();
    expect(screen.getByText("48% ± 2.40")).toBeInTheDocument();
    expect(screen.getByText("Density at 30°C (g/cm³)")).toBeInTheDocument();
    expect(screen.getByText("LOT-888 / B-888")).toBeInTheDocument();
    expect(screen.getByText("1.120")).toBeInTheDocument();
    expect(screen.getByText("20/08/2026")).toBeInTheDocument();
    expect(screen.getByText("(สิริพิชญ์ สงสมพันธ์)")).toBeInTheDocument();
    expect(screen.getByText("Asst. Quality Control Manager")).toBeInTheDocument();

    rerender(<CoaReportTemplate pages={[{
      ...page,
      samples: [{ ...page.samples[0], rows: [{ itemSeq: 1, testItem: "Appearance", result: "Not conform" }] }],
    }]} />);
    expect(screen.getByText("Not conform")).toBeInTheDocument();
    expect(screen.queryByText("Conform")).not.toBeInTheDocument();

    rerender(<CoaReportTemplate pages={[{
      ...page,
      issueDate: "-",
      samples: [{ ...page.samples[0], rows: [] }],
    }]} />);
    const appearanceCells = within(screen.getByText("Appearance").closest("tr")!).getAllByRole("cell");
    expect(appearanceCells[1]).toBeEmptyDOMElement();
    expect(appearanceCells[2]).toBeEmptyDOMElement();
    expect(screen.queryByText("August 20, 2026")).not.toBeInTheDocument();
  });

  it("renders the BROMADIOLONE 0.005% wax block COA form", () => {
    const page: CoaReportPage = {
      template: "bromadiolone0005",
      coaNo: "00082026",
      revision: 0,
      issueDate: "20/08/2569",
      petitionNo: "P-2608-0008",
      customer: {},
      samples: [{
        itemSeq: 1,
        sampleName: "Red Wax Block",
        commonName: "BROMADIOLONE 0.005%",
        batchNo: "B-008",
        lotNo: "LOT-008",
        productionDate: "2026-08-15",
        product: "Red Wax Block (BROMADIOLONE 0.005%)",
        manufacturingDate: "15/08/2026",
        expiredDate: "15/08/2028",
        batchLabel: "LOT-008 / B-008",
        aiContentResult: "0.0051%",
        aiContentCriteria: "0.005% ± 0.00125",
        densityResult: "-",
        waxBlockSizeResult: "5.90 gm",
        dateOfAnalysis: "20/08/2026",
        rows: [],
      }],
      remark: "",
      approvedBy: "QC Head",
      approvedAt: "20/08/2569",
    };

    render(<CoaReportTemplate pages={[page]} />);

    expect(screen.getByText("CERTIFICATE OF ANALYSIS")).toBeInTheDocument();
    expect(screen.getByText(/PRODUCT/).closest("div")).toHaveTextContent("PRODUCT : Red Wax Block (BROMADIOLONE 0.005%)");
    expect(screen.getByText("Red wax block")).toBeInTheDocument();
    expect(screen.getByText("0.005% ± 0.00125")).toBeInTheDocument();
    expect(screen.getByText("5.88 gm ± 5%")).toBeInTheDocument();
    expect(screen.getByText("LOT-008 / B-008")).toBeInTheDocument();
    expect(screen.getByText("5.90 gm")).toBeInTheDocument();
  });
});
