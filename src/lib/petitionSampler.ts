import type { Petition, PetitionDeliverer } from "@/types/petition.types";

/**
 * เลขที่มุมขวาบนของป้ายนำส่งตัวอย่าง จากเลขคำร้อง P-YYMM-NNNN
 * P-2611-0002 → { seq: "2", year: "69" } (ตัด 0 นำหน้า, ปี = 2 หลักท้ายของ พ.ศ. จาก YY ค.ศ.)
 * รูปแบบอื่นคืน null ให้ป้ายคงช่องว่างแบบเดิม
 */
export function sampleLabelDocumentNumber(petitionNo: string | null | undefined): { seq: string; year: string } | null {
  const match = String(petitionNo ?? "").trim().match(/^P-(\d{2})(\d{2})-(\d+)$/i);
  if (!match) return null;
  const seq = String(Number(match[3]));
  const year = String((Number(match[1]) + 43) % 100).padStart(2, "0");
  return { seq, year };
}

export function formatSampleLabelDocumentNumber(petitionNo: string | null | undefined): string {
  const number = sampleLabelDocumentNumber(petitionNo);
  return number ? `${number.seq}/${number.year}` : "";
}

/** "สุ่มโดย" บนป้าย: QC รายวันที่ฝ่ายผลิตเลือกก่อน แล้ว fallback ของเดิม */
export function labelSampledByName(
  petition: Pick<Petition, "sampledBy" | "submittedBy">,
  item?: Pick<Petition["items"][number], "labelSampledBy">,
): string {
  return petition.sampledBy?.name?.trim() || petition.submittedBy?.name || item?.labelSampledBy || "";
}

/** ผู้นำส่งที่ /scanner: คำร้องที่มี "สุ่มโดย" จากผลิตใช้ชื่อนั้นอัตโนมัติ, คำร้องเก่าคืน null (ให้เลือกเอง) */
export function presetDelivererFor(petition: Pick<Petition, "sampledBy"> | null | undefined): PetitionDeliverer | null {
  const name = petition?.sampledBy?.name?.trim();
  if (!name) return null;
  return petition.sampledBy.employeeId ? { employeeId: petition.sampledBy.employeeId, name } : { name };
}
