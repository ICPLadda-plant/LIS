import type { Petition, PetitionItem } from "@/types/petition.types";
import { getClassification, getCommonName } from "./productClassification";
import { isResearchAndDevelopmentPetition, requiresQcTrack, shouldSendItemToLab, shouldSendItemToQc } from "./petitionRouting";

// mirror: server/lib/sgConfirmation.js — แก้กฎต้องแก้ทั้งสองฝั่ง
export const SG_PENDING_LABEL = "รอยืนยันค่า ถพ.";

type SgItem = Pick<PetitionItem, "commonName" | "sendToLab" | "sendToQc" | "batchNo" | "sampleName"> & {
  formulation?: unknown;
  sgConfirmedAt?: string | null;
};

type SgPetition = Pick<Petition, "submittedBy" | "routeTargets"> & {
  items?: SgItem[];
  labReceivedAt?: string | null;
  qcReceivedAt?: string | null;
  receivedAt?: string | null;
  labCompletedAt?: string | null;
  labApprovedAt?: string | null;
  assignedTo?: unknown;
};

/** ตัวอย่างกลุ่มน้ำ (ULV, EC, EW, SC, SL, ME, ZC, W/V) จาก formulation หรือ commonName */
export function isWaterFormulationItem(item: Pick<SgItem, "commonName" | "formulation"> | null | undefined): boolean {
  if (!item) return false;
  const formulation = String(item.formulation ?? "").trim();
  if (formulation) {
    const byFormulation = getClassification(formulation);
    if (byFormulation) return byFormulation.group === "water";
  }
  const code = getCommonName(item.commonName);
  return code ? getClassification(code)?.group === "water" : false;
}

/** ตัวอย่างที่ต้องให้ QC ยืนยันค่า ถพ. ก่อนปล่อยไป Lab */
export function itemNeedsSgConfirmation(item: SgItem | null | undefined): boolean {
  return Boolean(item) && isWaterFormulationItem(item) && shouldSendItemToLab(item) && shouldSendItemToQc(item);
}

export function itemAwaitingSgConfirmation(item: SgItem | null | undefined): boolean {
  return itemNeedsSgConfirmation(item) && !item?.sgConfirmedAt;
}

function labTrackStarted(petition: SgPetition): boolean {
  const legacyReceived = !petition.labReceivedAt && !petition.qcReceivedAt && Boolean(petition.receivedAt);
  return Boolean(petition.labReceivedAt || legacyReceived || petition.labCompletedAt || petition.labApprovedAt || petition.assignedTo);
}

/**
 * Lab ยังรับ/มอบหมายงานคำร้องนี้ไม่ได้ เพราะมีตัวอย่างกลุ่มน้ำที่ส่ง Lab แต่ QC ยังไม่ยืนยันค่า ถพ.
 * งานที่ Lab รับหรือเริ่มไปแล้วไม่ถูกดึงกลับ
 */
export function isLabAwaitingSgConfirmation(petition: SgPetition | null | undefined): boolean {
  if (!petition || !Array.isArray(petition.items)) return false;
  if (isResearchAndDevelopmentPetition(petition as Petition) || !requiresQcTrack(petition)) return false;
  if (labTrackStarted(petition)) return false;
  return petition.items.some((item) => itemAwaitingSgConfirmation(item));
}
