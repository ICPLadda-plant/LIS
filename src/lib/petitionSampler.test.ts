import { describe, expect, it } from "vitest";
import { formatSampleLabelDocumentNumber, itemSubmissionNoText, labelManufacturerName, labelSampledByName, presetDelivererFor, serviceRequestSubmissionNo } from "./petitionSampler";

describe("itemSubmissionNoText", () => {
  const grouped = {
    petitionNo: "P-2611-0045",
    sampleLabelNumbers: { qc: "P01", lab: "L01", year: 2569, groups: [{ key: "001|", qc: "P01", lab: "L01" }, { key: "002|", qc: "P02" }] },
  };

  it("แสดงเลขป้าย P/L แทนเลขคำร้อง", () => {
    expect(itemSubmissionNoText(grouped, { submissionNo: "P-2611-0045", batchNo: "001" })).toBe("P01/69, L01/69");
    expect(itemSubmissionNoText(grouped, { submissionNo: "P-2611-0045", batchNo: "002" })).toBe("P02/69");
  });

  it("รายงาน LAB ใช้เลข L ก่อน และคงเลขที่ผู้ใช้กรอกเอง", () => {
    expect(itemSubmissionNoText(grouped, { submissionNo: "", batchNo: "001" }, "lab")).toBe("L01/69");
    expect(itemSubmissionNoText(grouped, { submissionNo: "TA-999", batchNo: "001" }, "lab")).toBe("TA-999");
  });
});

describe("serviceRequestSubmissionNo", () => {
  const petition = { petitionNo: "P-2611-0001", sampleLabelNumbers: { qc: "P01", lab: "L01", year: 2569 } };

  it("แทนเลขคำร้องเริ่มต้นด้วยเลขป้ายนำส่ง P", () => {
    expect(serviceRequestSubmissionNo(petition, { submissionNo: "P-2611-0001" })).toBe("P01/69");
    expect(serviceRequestSubmissionNo(petition, { submissionNo: "" })).toBe("P01/69");
  });

  it("คงเลขที่ใบนำส่งที่ผู้ใช้กรอกเอง", () => {
    expect(serviceRequestSubmissionNo(petition, { submissionNo: "TA-999" })).toBe("TA-999");
  });

  it("ใช้เลขของกลุ่ม batch + ส่วนของรายการนั้น", () => {
    const grouped = {
      petitionNo: "P-2611-0001",
      sampleLabelNumbers: { qc: "P01", lab: "L01", year: 2569, groups: [{ key: "001|", qc: "P01", lab: "L01" }, { key: "002|ล่าง", qc: "P02" }, { key: "003|", lab: "L02" }] },
    };
    expect(serviceRequestSubmissionNo(grouped, { submissionNo: "P-2611-0001", batchNo: "001" })).toBe("P01/69");
    expect(serviceRequestSubmissionNo(grouped, { submissionNo: "P-2611-0001", batchNo: "002", part: "ล่าง" })).toBe("P02/69");
    expect(serviceRequestSubmissionNo(grouped, { submissionNo: "P-2611-0001", batchNo: "003" })).toBe("L02/69");
  });

  it("คำร้องที่ส่ง LAB อย่างเดียวใช้เลข L และไม่แปลงเลขคำร้องรายเดือนเป็นเลขใบนำส่ง", () => {
    expect(serviceRequestSubmissionNo({ petitionNo: "P-2611-0003", sampleLabelNumbers: { lab: "L02", year: 2569 } }, { submissionNo: "P-2611-0003" })).toBe("L02/69");
    expect(serviceRequestSubmissionNo({ petitionNo: "P-2612-0001", sampleLabelNumbers: { qc: "P18", year: 2569 } }, { submissionNo: "P-2612-0001" })).toBe("P18/69");
    expect(serviceRequestSubmissionNo({ petitionNo: "P-2510-0004" }, { submissionNo: "P-2510-0004" })).toBe("P-2510-0004");
  });
});

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
