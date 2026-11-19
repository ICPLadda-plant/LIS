import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LabResultReportTemplate from "./LabResultReportTemplate";
import type { LabReportPage } from "@/lib/labReport";

const page: LabReportPage = {
  reportNo: "LR-001",
  reportDate: "13/07/2569",
  customer: {
    name: "ลูกค้า",
    company: "บริษัท",
    department: "QA",
    email: "qa@example.com",
    phone: "0999999999",
  },
  sample: {
    name: "Sample A",
    batchNo: "B-001",
    productionDate: "01/07/2569",
    submissionNo: "SUB-001",
    manufacturer: "Maker",
    sampleNo: "S-001",
    sampleId: "",
    receivedDate: "02/07/2569",
    testedDate: "03/07/2569",
    reportedDate: "04/07/2569",
    condition: "ปกติ",
  },
  rows: [],
  analystName: "นักวิเคราะห์",
  labHeadName: "หัวหน้าแล็บ",
  remark: "",
};

describe("LabResultReportTemplate", () => {
  it("does not print the legacy end marker", () => {
    render(<LabResultReportTemplate pages={[page]} />);

    expect(screen.queryByText("End of Report")).not.toBeInTheDocument();
  });

  it("prints a dotted blank remark line when no remark is provided", () => {
    render(<LabResultReportTemplate pages={[page]} />);

    expect(screen.getByText(/หมายเหตุ\s*:\s*\.{8,}/)).toBeInTheDocument();
  });
});
