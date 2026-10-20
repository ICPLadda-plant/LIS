import { describe, expect, it } from "vitest";
import { allowedCoaActions, canPrintCoa, canReviewCoa, coaStatusLabel, isCoaCreator, isCoaQcHead } from "./coaStatus";

describe("coaStatus", () => {
  it("labels statuses for COA Center", () => {
    expect(coaStatusLabel("pendingApproval")).toBe("รออนุมัติ");
    expect(coaStatusLabel("superseded")).toBe("ถูกแทนที่");
  });

  it("allows printing only for active approved document states", () => {
    expect(canPrintCoa("approved")).toBe(true);
    expect(canPrintCoa("printed")).toBe(true);
    expect(canPrintCoa("reissued")).toBe(true);
    expect(canPrintCoa("draft")).toBe(false);
    expect(canPrintCoa("pendingApproval")).toBe(false);
    expect(canPrintCoa("cancelled")).toBe(false);
  });

  it("shows approval actions to an authorized reviewer", () => {
    expect(allowedCoaActions("pendingApproval", true)).toEqual(["approve", "reject"]);
    expect(allowedCoaActions("pendingApproval", false)).toEqual([]);
    expect(allowedCoaActions("draft", false)).toEqual(["save", "submit"]);
    expect(allowedCoaActions("printed", true)).toEqual(["print", "revise", "cancel"]);
  });

  it("allows QC Head and the document creator to review a pending COA", () => {
    const doc = { createdBy: { email: "creator@example.com" } };
    expect(isCoaQcHead({ role: "qc-head" })).toBe(true);
    expect(isCoaCreator({ email: "CREATOR@example.com" }, doc)).toBe(true);
    expect(canReviewCoa({ email: "creator@example.com", role: "lab-staff" }, doc)).toBe(true);
    expect(canReviewCoa({ email: "other@example.com", role: "lab-staff" }, doc)).toBe(false);
  });
});
