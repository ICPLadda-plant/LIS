import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import { labApprovalItems, labApprovalSampleNo, labApprovalTesterName } from "./LabApproval";

const petition = {
  sampleLabelNumbers: { year: 2569 },
  items: [
    { seq: 1, sampleName: "ยังไม่รับ", sendToLab: true },
    { seq: 2, sampleName: "ไม่ได้ส่ง Lab", sendToQc: true, sendToLab: false, sampleId: "3522" },
    { seq: 3, sampleName: "รับและคำนวณผล", sendToLab: true, sampleId: "3523" },
  ],
} as Petition;

describe("LabApproval list", () => {
  it("แสดงเฉพาะรายการที่ส่ง Lab และรับตัวอย่างแล้ว", () => {
    expect(labApprovalItems(petition).map((item) => item.seq)).toEqual([3]);
  });

  it("แสดงเลขที่ตัวอย่างพร้อมปีสองหลัก", () => {
    expect(labApprovalSampleNo(petition, "3523")).toBe("3523/69");
  });

  it("แสดงผู้ล็อกอินที่ส่งผลพร้อมคำนำหน้าเต็ม", () => {
    const completed = {
      labCompletedBy: "น.ส. คนที่ส่งผล",
      assignedTo: { name: "นายคนรับมอบหมายเดิม" },
    } as Petition;

    expect(labApprovalTesterName(completed)).toBe("นางสาวคนที่ส่งผล");
  });
});
