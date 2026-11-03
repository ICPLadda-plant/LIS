import { describe, expect, it } from "vitest";
import { formatSampleLabelDocumentNumber, labelManufacturerName, labelSampledByName, presetDelivererFor } from "./petitionSampler";

describe("formatSampleLabelDocumentNumber", () => {
  it("ตัด 0 นำหน้าของลำดับ และแปลงปี ค.ศ. 2 หลักเป็น พ.ศ. 2 หลัก", () => {
    expect(formatSampleLabelDocumentNumber("P-2611-0002")).toBe("2/69");
    expect(formatSampleLabelDocumentNumber("P-2701-0120")).toBe("120/70");
  });

  it("คืนค่าว่างเมื่อเลขคำร้องไม่ใช่รูปแบบ P-YYMM-NNNN", () => {
    expect(formatSampleLabelDocumentNumber("P26070001")).toBe("");
    expect(formatSampleLabelDocumentNumber("")).toBe("");
    expect(formatSampleLabelDocumentNumber(undefined)).toBe("");
  });
});

describe("labelSampledByName / presetDelivererFor", () => {
  it("ใช้ QC รายวันที่ผลิตเลือกก่อนชื่อผู้ขอ", () => {
    const petition = { sampledBy: { employeeId: "7", name: "นายอติภัทร  จารุณ" }, submittedBy: { name: "ผู้ขอ", submittedAt: "" } };
    expect(labelSampledByName(petition)).toBe("นายอติภัทร  จารุณ");
    expect(presetDelivererFor(petition)).toEqual({ employeeId: "7", name: "นายอติภัทร  จารุณ" });
  });

  it("คำร้องเก่าที่ไม่มีสุ่มโดย fallback เป็นของเดิม", () => {
    const petition = { sampledBy: undefined, submittedBy: { name: "ผู้ขอ", submittedAt: "" } };
    expect(labelSampledByName(petition)).toBe("ผู้ขอ");
    expect(presetDelivererFor(petition)).toBeNull();
  });

  it("ไม่แสดงชื่อเล่นในวงเล็บบนเอกสาร", () => {
    const petition = { sampledBy: { employeeId: "7", name: "นายสรรสกุล เหล็กอิ่ม (กุล)" }, submittedBy: { name: "ผู้ขอ", submittedAt: "" } };
    expect(labelSampledByName(petition)).toBe("นายสรรสกุล เหล็กอิ่ม");
  });
});

describe("labelManufacturerName", () => {
  const by = (department: string) => ({ submittedBy: { name: "Achara Boontha", department, submittedAt: "" } });
  const item = { labelManufacturer: "บริษัท ก" };

  it("ผู้ยื่นจากสายผลิต 1–5 ใช้ชื่อสายผลิต", () => {
    expect(labelManufacturerName(by("ผลิต 4"), item)).toBe("ผลิต 4");
    expect(labelManufacturerName(by("ผลิต 01"), item)).toBe("ผลิต 1");
    expect(labelManufacturerName(by("Production 5"), item)).toBe("ผลิต 5");
  });

  it("ผู้ยื่นจาก LDI ใช้ LDI", () => {
    expect(labelManufacturerName(by("LDI"), item)).toBe("LDI");
  });

  it("แผนกอื่นใช้ผู้ผลิตของรายการตามเดิม", () => {
    expect(labelManufacturerName(by("IT"), item)).toBe("บริษัท ก");
    expect(labelManufacturerName(by("คลังสินค้า RM"), item)).toBe("บริษัท ก");
  });
});
