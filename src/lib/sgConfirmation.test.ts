import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import { isLabAwaitingSgConfirmation, isWaterFormulationItem, itemNeedsSgConfirmation } from "./sgConfirmation";
import { isVisibleInAssignQueue } from "./petitionQueueVisibility";
import { labTrackStatusBadge } from "./receiveStatus";

const waterItem = { seq: 1, sampleName: "ไซเปอร์", commonName: "CYPERMETHRIN 25% W/V EC", batchNo: "26S-CYP-001", sendToLab: true, sendToQc: true };
const petition = (overrides: Partial<Petition> = {}) =>
  ({
    _id: "p1",
    petitionNo: "P-2611-0002",
    dept: "production",
    status: "sampleSent",
    submittedBy: { name: "ผู้ขอ", department: "LDI", submittedAt: "2026-11-01T00:00:00.000Z" },
    items: [waterItem],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  }) as Petition;

describe("sgConfirmation", () => {
  it("recognises water formulations from the common name", () => {
    expect(isWaterFormulationItem({ commonName: "CYPERMETHRIN 25% W/V EC" })).toBe(true);
    expect(isWaterFormulationItem({ commonName: "GLYPHOSATE 48% SL" })).toBe(true);
    expect(isWaterFormulationItem({ commonName: "THIAMETHOXAM 25% WG" })).toBe(false);
    // W/V ในชื่อสามัญเป็นหน่วยความเข้มข้น ไม่ใช่สูตร
    expect(isWaterFormulationItem({ commonName: "ABAMECTIN 1.8% W/V" })).toBe(false);
    expect(isWaterFormulationItem({ commonName: "ANY", formulation: "W/V" })).toBe(true);
  });

  it("needs confirmation only for water samples sent to both QC and Lab", () => {
    expect(itemNeedsSgConfirmation(waterItem)).toBe(true);
    expect(itemNeedsSgConfirmation({ ...waterItem, sendToLab: false })).toBe(false);
    expect(itemNeedsSgConfirmation({ ...waterItem, sendToQc: false })).toBe(false);
  });

  it("holds the Lab track until QC confirms the ถพ. value", () => {
    const pending = petition();
    expect(isLabAwaitingSgConfirmation(pending)).toBe(true);
    expect(isVisibleInAssignQueue(pending)).toBe(false);
    expect(labTrackStatusBadge(pending).label).toBe("รอยืนยันค่า ถพ.");

    const confirmed = petition({ items: [{ ...waterItem, sgConfirmedAt: "2026-11-01T02:00:00.000Z" }] });
    expect(isLabAwaitingSgConfirmation(confirmed)).toBe(false);
    expect(isVisibleInAssignQueue(confirmed)).toBe(true);
    expect(labTrackStatusBadge(confirmed).label).toBe("รอรับ");
  });

  it("does not pull back Lab work that already started", () => {
    expect(isLabAwaitingSgConfirmation(petition({ status: "pendingReview", labReceivedAt: "2026-11-01T01:00:00.000Z" }))).toBe(false);
  });
});
