import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import { awaitingFinalReport, batchApprovalSummaries, sideApprovalProgress, sideApprovalState } from "./itemApprovals";

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

describe("sideApprovalState", () => {
  const petition = {
    ...base,
    routeTargets: ["qc", "lab"],
    qcCompletedAt: "2026-11-07T08:00:00.000Z",
    labCompletedAt: null,
    items: [{ seq: 1, sampleName: "A", batchNo: "B1", sendToQc: true, sendToLab: true }],
  } as unknown as Petition;

  it("shows waiting for Lab while physical results wait for a decision", () => {
    expect(sideApprovalState(petition, "qc")).toMatchObject({ kind: "pending", label: "รออนุมัติ" });
    expect(sideApprovalState(petition, "lab")).toMatchObject({ kind: "waiting-result", label: "รอผล Lab" });
  });

  it("tells who already passed the physical results", () => {
    const approved = {
      ...petition,
      itemApprovals: [{ seq: 1, side: "qc", status: "approved", conclusion: "pass", by: "QC A", at: "2026-11-07T09:00:00.000Z" }],
    } as Petition;
    expect(sideApprovalState(approved, "qc")).toMatchObject({ kind: "approved", label: "กายภาพผ่าน", approvedBy: "QC A" });
  });

  it("treats a QC-only request with physical passed as a Pre Result waiting for the Final Report", () => {
    const qcOnly = {
      ...base,
      routeTargets: ["qc"],
      qcCompletedAt: "2026-11-07T08:00:00.000Z",
      items: [{ seq: 1, sampleName: "A", sendToQc: true }],
      itemApprovals: [{ seq: 1, side: "qc", status: "approved", conclusion: "pass" }],
    } as unknown as Petition;
    expect(awaitingFinalReport(qcOnly)).toBe(true);
    expect(awaitingFinalReport({ ...qcOnly, status: "approved" } as Petition)).toBe(false);
    expect(awaitingFinalReport(petition)).toBe(false);
  });
});
