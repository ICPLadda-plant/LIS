import { describe, it, expect } from "vitest";
import { hasLabTrack, petitionExceptionScore, petitionStatusBadge, petitionStatusSteps, statusBadge, toneBadge } from "./statusBadge";
import type { Petition } from "@/types/petition.types";

describe("statusBadge", () => {
  it("returns label + variant for a known petition status", () => {
    const b = statusBadge("success");
    expect(b.label.length).toBeGreaterThan(0);
    expect(b.variant).toBe("green-soft");
  });

  it("falls back to a neutral gray badge for unknown status", () => {
    const b = statusBadge("totally-unknown-xyz");
    expect(b.label).toBe("totally-unknown-xyz");
    expect(b.variant).toBe("gray-soft");
  });

  it("uses the provided label override when given", () => {
    const b = statusBadge("success", "เสร็จแล้ว");
    expect(b.label).toBe("เสร็จแล้ว");
    expect(b.variant).toBe("green-soft");
  });

  it("shows approved petitions as completed with the purple final-result tone", () => {
    expect(statusBadge("approved")).toEqual({ label: "เสร็จสิ้น", variant: "purple-soft" });
  });

  it("shows rejected petitions as Rework with the existing red tone", () => {
    expect(statusBadge("rejected")).toEqual({ label: "Rework", variant: "red-soft" });
    expect(petitionStatusBadge({ status: "rejected" } as Petition)).toEqual({ label: "Rework", variant: "red-soft" });
  });
});

describe("toneBadge", () => {
  it("maps a semantic tone to a soft Badge variant", () => {
    expect(toneBadge("danger", "ผิดพลาด")).toEqual({ label: "ผิดพลาด", variant: "red-soft" });
    expect(toneBadge("info", "ข้อมูล").variant).toBe("blue-soft");
  });
});

describe("petitionStatusBadge", () => {
  it("shows delivering sample as an active yellow status before receive", () => {
    const badge = petitionStatusBadge({ status: "deliveringQC" } as Petition);
    expect(badge.label).toBe("กำลังส่งตัวอย่าง");
    expect(badge.variant).toBe("yellow-soft");
  });

  it("shows received label for stale deliveringQC petitions that already have a receive timestamp", () => {
    const badge = petitionStatusBadge({
      status: "deliveringQC",
      qcReceivedAt: "2026-09-03T06:05:34.767Z",
    } as Petition);
    expect(badge.label).toBe("รับตัวอย่างแล้ว");
    expect(badge.variant).toBe("yellow-soft");
  });

  it("shows QC completed instead of raw inProgress", () => {
    const b = petitionStatusBadge({ status: "inProgress", qcCompletedAt: "2026-07-02" } as Petition);
    expect(b.label).toBe("QC ตรวจครบ · รอส่วนอื่น");
    expect(b.variant).toBe("yellow-soft");
  });

  it("shows both-done pending Lab approval when QC + Lab tested but Lab not yet approved", () => {
    // P-2606-0018: qcCompletedAt + labCompletedAt but no labApprovedAt.
    // Must NOT read "QC ตรวจครบ · รอส่วนอื่น" — Lab is already done testing.
    const b = petitionStatusBadge({
      status: "inProgress",
      qcCompletedAt: "2026-07-02",
      labCompletedAt: "2026-07-02",
    } as Petition);
    expect(b.label).toBe("รอออกผล");
    expect(b.variant).toBe("yellow-soft");
  });

  it("shows pending results when Lab testing is complete", () => {
    const b = petitionStatusBadge({
      status: "inProgress",
      labCompletedAt: "2026-07-02",
    } as Petition);
    expect(b.label).toBe("รอออกผล");
    expect(b.variant).toBe("yellow-soft");
  });
});

describe("hasLabTrack", () => {
  it("returns false for a QC-only petition", () => {
    expect(
      hasLabTrack({
        status: "inProgress",
        items: [{ seq: 1, sampleName: "S", batchNo: "B-2" }],
      } as Petition),
    ).toBe(false);
  });

  it("returns true for a petition with a Lab batch", () => {
    expect(
      hasLabTrack({
        status: "inProgress",
        items: [{ seq: 1, sampleName: "S", batchNo: "B-1" }],
      } as Petition),
    ).toBe(true);
  });

  it("keeps legacy petitions with a Lab timestamp on the Lab track", () => {
    expect(
      hasLabTrack({ status: "inProgress", labReceivedAt: "2026-07-13T00:00:00.000Z" } as Petition),
    ).toBe(true);
  });

  it("returns true for R&D petitions even without a Lab batch", () => {
    expect(
      hasLabTrack({
        status: "sampleSent",
        submittedBy: { department: "R & D" },
        items: [{ seq: 1, sampleName: "R&D sample", batchNo: "" }],
      } as Petition),
    ).toBe(true);
  });
});

describe("petitionStatusSteps", () => {
  it("marks delivering as current while receive stays pending", () => {
    const steps = petitionStatusSteps({ status: "deliveringQC" } as Petition);
    expect(steps.find((s) => s.key === "delivering")?.label).toBe("กำลังส่งตัวอย่าง");
    expect(steps.find((s) => s.key === "delivering")?.current).toBe(true);
    expect(steps.find((s) => s.key === "received")?.done).toBe(false);
    expect(steps.find((s) => s.key === "received")?.current).toBeFalsy();
  });

  it("marks the next open gate as current", () => {
    const steps = petitionStatusSteps({
      status: "inProgress",
      qcReceivedAt: "2026-07-02",
      assignedTo: { employeeId: "1", name: "A" },
      qcCompletedAt: "2026-07-02",
      items: [{ seq: 1, sampleName: "S", batchNo: "B-1" }],
    } as Petition);
    expect(steps.find((s) => s.current)?.key).toBe("lab");
  });

  it("prioritizes stuck work above normal in-progress work", () => {
    const stuck = petitionExceptionScore({
      status: "inProgress",
      labCompletedAt: "2026-07-02",
    } as Petition);
    const normal = petitionExceptionScore({ status: "inProgress" } as Petition);
    expect(stuck).toBeGreaterThan(normal);
  });

  it("omits the QC step for R&D petitions", () => {
    const steps = petitionStatusSteps({
      status: "inProgress",
      submittedBy: { department: "R & D" },
      items: [{ seq: 1, sampleName: "R&D sample", batchNo: "" }],
    } as Petition);
    expect(steps.map((s) => s.key)).toEqual(["received", "assigned", "lab", "lab-approval", "qc-approval"]);
  });
});
