import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LabCalculationForm, { ccsDifference, controlResult, parseSampleName } from "./LabCalculationForm";
import type { LabReportPage } from "@/lib/labReport";

const row = (testItem: string, result: string) => ({ testItem, result, criteria: "-", method: "-" });

function page(rows: ReturnType<typeof row>[]): LabReportPage {
  return {
    reportNo: "L-2610-0001",
    reportDate: "28/10/2569",
    customer: { name: "", company: "", department: "", email: "", phone: "" },
    sample: { name: "OMETHOATE 50% SL", batchNo: "", productionDate: "", submissionNo: "S-2610-0007", manufacturer: "", sampleNo: "L-2610-0001", receivedDate: "", testedDate: "27/10/2569", reportedDate: "", condition: "" },
    rows,
    analystName: "นักเคมี ก",
    labHeadName: "-",
    remark: "",
  };
}

const field = (container: HTMLElement, name: string) => container.querySelector(`[data-field="${name}"]`)?.textContent;

describe("LabCalculationForm", () => {
  it("splits the sample name into common name, strength and form", () => {
    expect(parseSampleName("OMETHOATE 50% SL")).toEqual({ commonName: "OMETHOATE", strength: "50", form: "SL" });
  });

  it("fills the sample header and uses form FM-QP-07-08-002-R02", () => {
    const { container } = render(<LabCalculationForm page={page([])} />);
    expect(field(container, "sampleNo")).toBe("S-2610-0007");
    expect(field(container, "sampleName")).toBe("OMETHOATE 50% SL");
    expect(field(container, "testedDate")).toBe("27/10/2569");
    expect(field(container, "analyst")).toBe("นักเคมี ก");
    expect(field(container, "approved")).toBe("");
    expect(container.textContent).toContain("FM-QP-07-08-002-R02 (02/11/69) P1/1");
  });

  it("prints Control Sample, its acceptance range and the pass result", () => {
    const { container } = render(<LabCalculationForm page={page([
      row("Control Sample", "0.24949"),
      row("Control ช่วงต่ำสุด", "0.24692"),
      row("Control ช่วงสูงสุด", "0.27363"),
    ])} />);
    expect(field(container, "controlValue")).toBe("0.24949");
    expect(field(container, "controlRange")).toBe("0.24692 - 0.27363");
    expect(field(container, "controlResult")).toBe("ผ่าน");
  });

  it("leaves lines blank for handwriting when values were not entered", () => {
    const { container } = render(<LabCalculationForm page={page([row("Area Inj.1", "255.156")])} />);
    expect(field(container, "area-0")).toBe("255.156");
    expect(field(container, "area-1")).toBe("");
    expect(field(container, "controlValue")).toBe("");
    expect(field(container, "controlResult")).toBe("");
    expect(field(container, "blankFound")).toBe("");
    expect(field(container, "blankNotFound")).toBe("");
  });

  it("fills CCS and Solvent Blank when they are recorded", () => {
    const { container } = render(<LabCalculationForm page={page([
      row("Mid-level Standard Conc. (mg/mL)", "0.500"),
      row("CCS Conc. (mg/mL)", "0.510"),
      row("Solvent Blank", "ไม่พบ Peak"),
    ])} />);
    expect(field(container, "ccs-2")).toBe("2.00");
    expect(field(container, "blankNotFound")).toBe("✓");
    expect(field(container, "blankFound")).toBe("");
  });

  it("calculates CCS % difference and Control result only from complete numbers", () => {
    expect(ccsDifference("0.5", "0.49")).toBe("2.00");
    expect(ccsDifference("", "0.49")).toBe("");
    expect(controlResult("0.3", "0.24692", "0.27363")).toBe("ไม่ผ่าน");
    expect(controlResult("0.25", "", "0.27")).toBe("");
  });
});
