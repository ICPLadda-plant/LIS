import { describe, expect, it } from "vitest";
import { formatSampleLabelDocumentNumber, labelSampledByName, presetDelivererFor } from "./petitionSampler";

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
});
