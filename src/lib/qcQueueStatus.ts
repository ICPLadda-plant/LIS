import type { Petition, PetitionStatus } from "@/types/petition.types";
import { requiresQcTrack } from "./petitionRouting";
import { isVisibleInQcTestingQueue } from "./petitionQueueVisibility";
import { qcReceivedAt } from "./receiveStatus";

const OPEN_STATUSES: readonly PetitionStatus[] = ["sampleSent", "pendingReview", "inProgress"];

/**
 * สถานะของคำร้องบนบอร์ด QC (/queue/qc) อิงงานฝั่ง QC เอง
 *
 * petition.status ใช้ร่วมกับ Lab: Lab รับตัวอย่างก่อนจะกลายเป็น pendingReview/inProgress
 * ทั้งที่ QC ยังไม่ได้รับ — ต้องค้างช่อง "ตัวอย่างใหม่" จนกว่า QC รับตัวอย่างหรือเริ่มบันทึกผล
 * (`qcStarted` = มีค่าในพารามิเตอร์ QC แล้วอย่างน้อย 1 ช่อง) แล้วจึงไป "กำลังดำเนินการ"
 */
export function qcQueueStatus(petition: Petition, qcStarted = false): PetitionStatus {
  if (petition.status === "deliveringQC") {
    return isVisibleInQcTestingQueue(petition) ? "inProgress" : "deliveringQC";
  }
  if (!OPEN_STATUSES.includes(petition.status) || !requiresQcTrack(petition)) return petition.status;
  const qcTouched = Boolean(qcReceivedAt(petition)) || qcStarted;
  if (!qcTouched) return "sampleSent";
  return petition.status === "sampleSent" ? "inProgress" : petition.status;
}
