import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import { batchApprovalSummaries, sideApprovalProgress } from "./itemApprovals";

const base = {
  _id: "p1",
  petitionNo: "P-2611-0002",
  dept: "production",
  status: "inProgress",
  submittedBy: { name: "ผลิต", department: "ผลิต 01" },
  createdAt: "",
  updatedAt: "",
} as unknown as Petition;

describe("batchApprovalSummaries", () => {
  it("shows physical only for QC batches and %AI only for Lab batches", () => {
    const petition = {
      ...base,
      items: [
        { seq: 1, sampleName: "A", batchNo: "B1", sendToQc: true, sendToLab: true },
        { seq: 2, sampleName: "B", batchNo: "B2", sendToQc: false, sendToLab: true },
        { seq: 3, sampleName: "C", batchNo: "B3", sendToQc: true, sendToLab: false },
      ],
      itemApprovals: [
        { seq: 1, side: "qc", status: "approved", conclusion: "pass" },
        { seq: 1, side: "lab", status: "approved", conclusion: "accepted-oos" },
        { seq: 2, side: "lab", status: "approved", conclusion: "pass" },
      ],
    } as Petition;

    expect(batchApprovalSummaries(petition).map(({ batchNo, physical, ai }) => ({ batchNo, physical, ai }))).toEqual([
      { batchNo: "B1", physical: "approved", ai: "fail" },
      { batchNo: "B2", physical: "none", ai: "pass" },
      { batchNo: "B3", physical: "pending", ai: "none" },
    ]);
    expect(sideApprovalProgress(petition, "qc")).toEqual({ total: 2, approved: 1, pending: 1 });
  });
});
