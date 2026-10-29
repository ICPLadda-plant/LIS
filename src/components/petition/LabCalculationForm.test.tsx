import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LabCalculationForm, { parseSampleName } from "./LabCalculationForm";
import type { LabReportPage } from "@/lib/labReport";

const row = (testItem: string, result: string) => ({ testItem, result, criteria: "-", method: "-" });

function page(rows: ReturnType<typeof row>[]): LabReportPage {
  return {
    reportNo: "L-2610-0001",
    reportDate: "28/10/2569",
    customer: { name: "", company: "", department: "", email: "", phone: "" },
    sample: { name: "OMETHOATE 50% SL", batchNo: "", productionDate: "", submissionNo: "P-2610-0001", manufacturer: "", sampleNo: "L-2610-0001", receivedDate: "", testedDate: "", reportedDate: "", condition: "" },
    rows,
    analystName: "",
    labHeadName: "",
    remark: "",
  };
}

describe("LabCalculationForm", () => {
  it("splits the sample name into common name, strength and form", () => {
    expect(parseSampleName("OMETHOATE 50% SL")).toEqual({ commonName: "OMETHOATE", strength: "50", form: "SL" });
  });

  it("prints Control Sample and its acceptance range saved from Lab testing", () => {
    const { container } = render(<LabCalculationForm page={page([
      row("Control Sample", "0.24949"),
      row("Control ช่วงต่ำสุด", "0.24692"),
      row("Control ช่วงสูงสุด", "0.27363"),
    ])} />);
    const values = Array.from(container.querySelectorAll(".brom-form-control-row .brom-form-value")).map((el) => el.textContent);
    expect(values).toEqual(["0.24949", "0.24692", "0.27363"]);
  });

  it("shows dashes when Control Sample was not entered", () => {
    const { container } = render(<LabCalculationForm page={page([row("Area Inj.1", "255.156")])} />);
    const values = Array.from(container.querySelectorAll(".brom-form-control-row .brom-form-value")).map((el) => el.textContent);
    expect(values).toEqual(["-", "-", "-"]);
  });
});
