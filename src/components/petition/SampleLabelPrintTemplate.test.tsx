import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import SampleLabelPrintTemplate from "./SampleLabelPrintTemplate";

function petitionWith(item: Partial<Petition["items"][number]>): Petition {
  return {
    _id: "petition-1",
    petitionNo: "P-2607-0001",
    dept: "production",
    status: "inProgress",
    submittedBy: { name: "ทดสอบระบบ" },
    items: [{ seq: 1, sampleName: "", commonName: "", ...item }],
  } as Petition;
}

describe("SampleLabelPrintTemplate", () => {
  it("ไม่พิมพ์ชื่อผลิตภัณฑ์ซ้ำเมื่อ sampleName กับ commonName เหมือนกัน", () => {
    render(<SampleLabelPrintTemplate petition={petitionWith({
      sampleName: "PROCHLORAZ 45% W/V EC",
      commonName: "PROCHLORAZ 45% W/V EC",
    })} />);

    expect(screen.getByText("PROCHLORAZ 45% W/V EC")).toBeInTheDocument();
  });

  it("ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างหัวท้ายตอนเทียบชื่อซ้ำ", () => {
    render(<SampleLabelPrintTemplate petition={petitionWith({
      sampleName: " prochloraz 45% w/v ec ",
      commonName: "PROCHLORAZ 45% W/V EC",
    })} />);

    expect(screen.getByText("prochloraz 45% w/v ec")).toBeInTheDocument();
  });

  it("ยังแสดงทั้งสองชื่อเมื่อต่างกันจริง", () => {
    render(<SampleLabelPrintTemplate petition={petitionWith({
      sampleName: "โบรมาดิโอโลน - อ.ย.",
      commonName: "BROMADIOLONE 0.005% W/W",
    })} />);

    expect(screen.getByText("โบรมาดิโอโลน - อ.ย. BROMADIOLONE 0.005% W/W")).toBeInTheDocument();
  });

  it("ไม่แสดงค่า Uncertainty บนฉลากตัวอย่าง", () => {
    const petition = {
      ...petitionWith({ sampleName: "PROCHLORAZ 45% W/V EC", batchNo: "B-001" }),
      labRequests: [{ serviceAgreement: { requireUncertainty: true, uncertaintyValue: "±0.12" } }],
    } as unknown as Petition;

    const { container } = render(<SampleLabelPrintTemplate petition={petition} />);

    expect(container).not.toHaveTextContent("Uncertainty");
    expect(container).not.toHaveTextContent("±0.12");
  });

  it("พิมพ์ปริมาณแยกตามจำนวนตัวอย่าง", () => {
    render(<SampleLabelPrintTemplate petition={petitionWith({
      sampleName: "PROCHLORAZ 45% W/V EC",
      commonName: "PROCHLORAZ 45% W/V EC",
      batchNo: "B-001",
      sampleQuantity: 2,
      labelQuantities: ["5 g", "6 g"],
    })} />);

    expect(screen.getByText("5 g")).toBeInTheDocument();
    expect(screen.getByText("6 g")).toBeInTheDocument();
    expect(screen.getAllByText("Batch No.")).toHaveLength(2);
  });

  it("พิมพ์ footer ฟอร์มใหม่ เลขที่จากเลขคำร้อง และสุ่มโดยจาก QC รายวัน", () => {
    const petition = {
      ...petitionWith({ sampleName: "OMETHOATE", batchNo: "B-001", sampleId: "S-9" }),
      petitionNo: "P-2611-0002",
      sampledBy: { name: "นายสรรสกุล เหล็กอิ่ม" },
    } as Petition;

    const { container } = render(<SampleLabelPrintTemplate petition={petition} />);

    expect(container).toHaveTextContent("F-LAB-01-12 Rev : 00 02/11/69");
    expect(container).not.toHaveTextContent("F-LAB-01-10");
    expect(screen.getByTestId("sample-label-document-number")).toHaveTextContent("เลขที่2/69");
    expect(screen.getByText("นายสรรสกุล เหล็กอิ่ม")).toBeInTheDocument();
    expect(screen.queryByText("ทดสอบระบบ")).not.toBeInTheDocument();
  });

});
