import type { LabRequest } from "@/types/labRequest.types";
import type { Petition } from "@/types/petition.types";
import { hasLabTrack, shouldSendItemToLab } from "@/lib/petitionRouting";

/**
 * ใบคำขอรับบริการที่ใช้พิมพ์: ใช้ข้อมูลที่บันทึกไว้ก่อน ถ้าคำร้องส่ง LAB แต่ไม่มีใบคำขอบันทึก
 * (เช่นคำร้องเก่า/ส่งผ่านระบบผลิต) ให้สร้างฉบับว่างจากข้อมูลคำร้อง เพื่อให้ยังพิมพ์ได้
 */
export function serviceLabRequestFor(petition: Petition | null | undefined, labRequests: LabRequest[] | null | undefined): LabRequest | null {
  if (labRequests?.length) return labRequests[0];
  if (!petition || !hasLabTrack(petition)) return null;
  const item = (petition.items ?? []).find((it) => shouldSendItemToLab(it)) ?? petition.items?.[0];
  return {
    _id: "",
    labRequestNo: "",
    petitionId: petition._id,
    petitionNo: petition.petitionNo,
    batchNo: item?.batchNo ?? "",
    sampleSeq: item?.seq ?? 1,
    requester: {
      fullName: petition.submittedBy?.name ?? "",
      email: petition.submittedBy?.email ?? "",
      department: petition.submittedBy?.department ?? "",
    },
    createdAt: petition.createdAt,
    updatedAt: petition.createdAt,
  } as unknown as LabRequest;
}
