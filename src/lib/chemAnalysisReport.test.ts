import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import type { LabReportPage } from "@/lib/labReport";
import { buildChemAnalysisSheets, canPrintChemAnalysisReport } from "./chemAnalysisReport";

function page(batchNo: string, ai: string): LabReportPage {
  return {
    reportNo: "LR-1",
    reportDate: "02/11/2569",
    customer: { name: "ผู้ขอ", company: "ICP", department: "ฝ่ายผลิต", email: "-", phone: "-" },
    sample: {
      name: "Cypermethrin 35% EC", batchNo, productionDate: "01/11/2569", submissionNo: "SUB-1", manufacturer: "Maker",
      sampleNo: "S-" + batchNo, receivedDate: "-", testedDate: "-", reportedDate: "-", condition: "ปกติ",
    },
    rows: [{ testItem: "Cypermethrin · %AI (%w/w)", result: ai, criteria: "33.25-36.75", method: "-" }],
    analystName: "นักเคมี ก",
    labHeadName: "หัวหน้า Lab",
    remark: "",
  };
}

function petition(count: number, approvals: Petition["itemApprovals"] = []): Petition {
  return {
    _id: "p1", petitionNo: "PT-1", dept: "production", status: "approved",
    submittedBy: { name: "ผู้ขอ", submittedAt: "2026-11-01T00:00:00Z" },
    items: Array.from({ length: count }, (_, i) => ({ seq: i + 1, sampleName: "Cyper", commonName: "Cypermethrin", batchNo: "B" + (i + 1), sendToLab: true, sendToQc: true, sgConfirmedValue: "1.05" })),
    itemApprovals: approvals,
    createdAt: "", updatedAt: "",
  } as unknown as Petition;
}

describe("buildChemAnalysisSheets", () => {
  it("แยก Batch ผ่าน / นอกเกณฑ์แต่นำไปใช้ได้ / ห้ามนำไปใช้ จากผลอนุมัติทั้ง 2 ฝั่ง", () => {
    const p = petition(3, [
      { seq: 1, side: "qc", status: "approved", conclusion: "pass", by: "หัวหน้า QC", at: "2026-11-02T01:00:00Z" },
      { seq: 1, side: "lab", status: "approved", conclusion: "pass", by: "หัวหน้า Lab", at: "2026-11-02T01:00:00Z" },
      { seq: 2, side: "lab", status: "approved", conclusion: "accepted-oos", by: "ผู้จัดการ QA", at: "2026-11-02T02:00:00Z" },
      { seq: 3, side: "qc", status: "rejected", by: "หัวหน้า QC", at: "2026-11-02T03:00:00Z" },
    ]);
    const [sheet] = buildChemAnalysisSheets(p, [page("B1", "35.1"), page("B2", "32.9"), page("B3", "30.0")]);
    expect(sheet.lab.samples.map((s) => s.ai)).toEqual(["35.1", "32.9", "30.0"]);
    expect(sheet.lab.samples[0].sg).toBe("1.05");
    expect(sheet.qc.passBatches).toBe("B1");
    expect(sheet.qc.failBatches).toBe("B2, B3");
    expect(sheet.qc.usableBatches).toBe("B2");
    expect(sheet.qc.unusableBatches).toBe("B3");
    expect(sheet.qc.managerName).toBe("หัวหน้า QC");
  });

  it("แบ่งใบละ 7 ตัวอย่างตามช่องในฟอร์ม", () => {
    const p = petition(9);
    const sheets = buildChemAnalysisSheets(p, p.items.map((item) => page(item.batchNo, "35")));
    expect(sheets).toHaveLength(2);
    expect(sheets[0].lab.samples).toHaveLength(7);
    expect(sheets[1].lab.samples.map((s) => s.batchNo)).toEqual(["B8", "B9"]);
    expect(sheets[0].qc.managerName).toBe("");
  });

  it("เปิดใบได้เมื่อหัวหน้า Lab อนุมัติผลแล้ว ให้ QC ดูและพิมพ์ก่อนออก Final Result", () => {
    expect(canPrintChemAnalysisReport(petition(1))).toBe(true);
    expect(canPrintChemAnalysisReport({ ...petition(1), status: "pending" } as unknown as Petition)).toBe(false);
    expect(canPrintChemAnalysisReport({ ...petition(1), status: "pending", labApprovedAt: "2026-11-02T01:00:00Z" } as unknown as Petition)).toBe(true);
  });

  it("รายการที่ QC ยังไม่ตัดสินจะไม่ถูกติ๊กผ่าน/ไม่ผ่านในส่วนของ QC", () => {
    const p = { ...petition(1), status: "pending", labApprovedAt: "2026-11-02T01:00:00Z" } as unknown as Petition;
    const [sheet] = buildChemAnalysisSheets(p, [page("B1", "35.1")]);
    expect(sheet.lab.samples[0].ai).toBe("35.1");
    expect(sheet.qc.passBatches).toBe("");
    expect(sheet.qc.failBatches).toBe("");
  });
});

