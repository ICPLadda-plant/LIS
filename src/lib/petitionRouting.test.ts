import { describe, expect, it } from "vitest";
import {
  defaultSendItemToLab,
  duplicateBatchError,
  hasLabTrack,
  hasSendToLabOverride,
  labSendOverrideNoteError,
  isResearchAndDevelopmentPetition,
  requiresQcTrack,
  shouldSendItemToLab,
} from "./petitionRouting";
import type { Petition } from "@/types/petition.types";

describe("petitionRouting", () => {
  it("recognizes R&D submitter department variants", () => {
    expect(isResearchAndDevelopmentPetition({ submittedBy: { department: "R & D" } } as Petition)).toBe(true);
    expect(isResearchAndDevelopmentPetition({ submittedBy: { department: "r&d" } } as Petition)).toBe(true);
    expect(isResearchAndDevelopmentPetition({ submittedBy: { department: "Production" } } as Petition)).toBe(false);
  });

  it("routes every R&D petition to Lab and not QC even without a Lab batch number", () => {
    const petition = {
      submittedBy: { department: "R & D" },
      items: [{ seq: 1, sampleName: "R&D sample", batchNo: "" }],
    } as Petition;
    expect(hasLabTrack(petition)).toBe(true);
    expect(requiresQcTrack(petition)).toBe(false);
  });

  it("keeps non-R&D routing based on Lab batch suffix", () => {
    expect(hasLabTrack({ items: [{ seq: 1, sampleName: "S", batchNo: "B-1" }] } as Petition)).toBe(true);
    expect(hasLabTrack({ items: [{ seq: 1, sampleName: "S", batchNo: "B-2" }] } as Petition)).toBe(false);
    expect(requiresQcTrack({ submittedBy: { department: "Production" } } as Petition)).toBe(true);
  });

  it("honors explicit QC department route targets", () => {
    const qcOnly = { submittedBy: { department: "ควบคุมคุณภาพ" }, routeTargets: ["qc"], items: [{ batchNo: "B-1" }] } as Petition;
    const labOnly = { submittedBy: { department: "ควบคุมคุณภาพ" }, routeTargets: ["lab"], items: [{ batchNo: "B-2" }] } as Petition;
    expect(requiresQcTrack(qcOnly)).toBe(true);
    expect(hasLabTrack(qcOnly)).toBe(false);
    expect(requiresQcTrack(labOnly)).toBe(false);
    expect(hasLabTrack(labOnly)).toBe(true);
  });

  it("lets explicit sendToLab override the batch suffix default", () => {
    expect(shouldSendItemToLab({ batchNo: "B-1" })).toBe(true);
    expect(shouldSendItemToLab({ batchNo: "B-1", sendToLab: false })).toBe(false);
    expect(shouldSendItemToLab({ batchNo: "B-2", sendToLab: true })).toBe(true);
    expect(hasLabTrack({ items: [{ seq: 1, sampleName: "S", batchNo: "B-1", sendToLab: false }] } as Petition)).toBe(false);
    expect(hasLabTrack({ items: [{ seq: 1, sampleName: "S", batchNo: "B-2", sendToLab: true }] } as Petition)).toBe(true);
  });

  it("always routes PUBLIC HEALTH and LIVE STOCK products to Lab", () => {
    const publicHealth = { sampleName: "S", commonName: "DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)", batchNo: "B-2", sendToLab: false };
    const liveStock = { sampleName: "BIFENTHRIN 10% W/V EC (LIVE STOCK)", batchNo: "B-2" };

    expect(defaultSendItemToLab(publicHealth)).toBe(true);
    expect(shouldSendItemToLab(publicHealth)).toBe(true);
    expect(shouldSendItemToLab(liveStock)).toBe(true);
    expect(hasSendToLabOverride(publicHealth)).toBe(false);
    expect(hasLabTrack({ items: [publicHealth] } as Petition)).toBe(true);
  });

  it("always routes rodenticide products to Lab for every batch", () => {
    const rodenticide = { sampleName: "โบรมาดิโอโลน", commonName: "BROMADIOLONE 0.005% W/W SAND GRANULE", batchNo: "B-2", sendToLab: false };

    expect(defaultSendItemToLab(rodenticide)).toBe(true);
    expect(shouldSendItemToLab(rodenticide)).toBe(true);
    expect(hasSendToLabOverride(rodenticide)).toBe(false);
    expect(hasLabTrack({ items: [rodenticide] } as Petition)).toBe(true);
  });

  it("routes MF items to Lab for the first 5 batches after a 30-day gap", () => {
    expect(defaultSendItemToLab({
      batchNo: "BN240602",
      MF_Before: "2026-08-01",
      MF_Lasted: "2026-09-01",
      MF_BatchAfterGap: 1,
    })).toBe(true);

    expect(defaultSendItemToLab({
      batchNo: "BN240602",
      MF_Before: "2026-08-01",
      MF_Lasted: "2026-09-01",
      MF_BatchAfterGap: 5,
    })).toBe(true);
  });

  it("returns to the legacy 1/6 batch rule after the 5-batch MF hold is cleared", () => {
    expect(defaultSendItemToLab({
      batchNo: "BN240602",
      MF_Before: "2026-08-01",
      MF_Lasted: "2026-09-01",
      MF_BatchAfterGap: 6,
    })).toBe(false);

    expect(defaultSendItemToLab({
      batchNo: "BN240606",
      MF_Before: "2026-08-01",
      MF_Lasted: "2026-09-01",
      MF_ConsecutivePassCount: 5,
    })).toBe(true);
  });

  it("requires note when sendToLab differs from the default", () => {
    const override = { seq: 2, sampleName: "S", batchNo: "B-2", sendToLab: true, note: "" };
    expect(hasSendToLabOverride(override)).toBe(true);
    expect(labSendOverrideNoteError([override])).toBe("ตัวอย่างลำดับ 2: โปรดระบุเหตุผล");
    expect(labSendOverrideNoteError([{ ...override, note: "ส่งทดสอบเพิ่ม" }])).toBeNull();
  });

  it("allows duplicate production batch text for QC-only rows", () => {
    const items = [
      { batchNo: "*ขายต.ย.ให้ QC = 1 ขวด", sendToLab: false },
      { batchNo: "*ขายต.ย.ให้ QC = 1 ขวด", sendToLab: false },
    ];

    expect(duplicateBatchError(items, { allowDuplicates: true })).toBeNull();
  });

  it("allows duplicate production batches sent to Lab", () => {
    const items = [
      { batchNo: "BATCH001", sendToLab: true },
      { batchNo: "BATCH001", sendToLab: true },
    ];

    expect(duplicateBatchError(items, { allowDuplicates: true })).toBeNull();
  });

  it("keeps duplicate checks for other petition types", () => {
    const items = [
      { batchNo: "BATCH002", sendToLab: false },
      { batchNo: "BATCH002", sendToLab: false },
    ];

    expect(duplicateBatchError(items)).toBe("พบ batch ซ้ำ: BATCH002");
  });
});
