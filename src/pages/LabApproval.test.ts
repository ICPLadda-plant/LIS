import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import { formatLabSampleNo } from "@/lib/petitionSampler";
import { groupLabApprovalByName, labApprovalItems, labApprovalSampleNo, labApprovalTesterName } from "./LabApproval";

const petition = {
  sampleLabelNumbers: { year: 2569 },
  items: [
    { seq: 1, sampleName: "ยังไม่รับ", sendToLab: true },
    { seq: 2, sampleName: "ไม่ได้ส่ง Lab", sendToQc: true, sendToLab: false, sampleId: "3522" },
    { seq: 3, sampleName: "รับและคำนวณผล", sendToLab: true, sampleId: "3523" },
  ],
} as Petition;

describe("LabApproval list", () => {
  it("รวมแถวที่ชื่อยาเหมือนกัน ไม่สนสีในวงเล็บ/batch", () => {
    const mk = (id: string, name: string) => ({ _id: id, items: [{ seq: 1, sampleName: name, sendToLab: true, sampleId: id }] }) as Petition;
    const groups = groupLabApprovalByName([
      mk("a", "GLUFOSINATE-AMMONIUM 15% W/V SL (GREEN)"),
      mk("b", "GLUFOSINATE-AMMONIUM 15% W/V SL (BLUE)"),
      mk("c", "MANCOZEB 80% WP"),
    ]);
    expect(groups.map((g) => g.map((p) => p._id))).toEqual([["a", "b"], ["c"]]);
  });

  it("แสดงเฉพาะรายการที่ส่ง Lab", () => {
    expect(labApprovalItems(petition).map((item) => item.seq)).toEqual([1, 3]);
  });

  it("ไม่มีเลขตัวอย่างให้แสดงเลขใบนำส่ง L", () => {
    const legacy = {
      sampleLabelNumbers: { year: 2569, groups: [{ key: "B1|", lab: "L20" }] },
      items: [{ seq: 1, batchNo: "B1", sendToLab: true }],
    } as Petition;
    expect(labApprovalSampleNo(legacy, legacy.items[0])).toBe("L20/69");
  });

  it("แสดงเลขที่ตัวอย่างพร้อมปีสองหลัก", () => {
    expect(formatLabSampleNo(petition, "3523")).toBe("3523/69");
  });

  it("แสดงผู้ล็อกอินที่ส่งผลพร้อมคำนำหน้าเต็ม", () => {
    const completed = {
      labCompletedBy: "น.ส. คนที่ส่งผล",
      assignedTo: { name: "นายคนรับมอบหมายเดิม" },
    } as Petition;

    expect(labApprovalTesterName(completed)).toBe("นางสาวคนที่ส่งผล");
  });
});
