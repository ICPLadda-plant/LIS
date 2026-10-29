import type { BadgeProps } from "@/components/ui/badge";
import { PETITION_STATUS_CONFIG, type Petition } from "@/types/petition.types";
import { hasLabTrack, requiresQcTrack } from "./petitionRouting";

export { hasLabTrack } from "./petitionRouting";

export type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export type StatusBadge = { label: string; variant: BadgeVariant };
export type PetitionStatusStep = { key: string; label: string; done: boolean; current?: boolean };

/** Generic semantic tone → Badge soft variant, for statuses that are not petition statuses. */
const TONE_VARIANT = {
  neutral: "gray-soft",
  info: "blue-soft",
  success: "green-soft",
  warning: "yellow-soft",
  danger: "red-soft",
} satisfies Record<string, BadgeVariant>;

export type StatusTone = keyof typeof TONE_VARIANT;

export function toneBadge(tone: StatusTone, label: string): StatusBadge {
  return { label, variant: TONE_VARIANT[tone] };
}

/**
 * Resolve a status string to a badge label + Badge variant.
 * Seeded from PETITION_STATUS_CONFIG so petition statuses render identically everywhere;
 * unknown statuses fall back to a neutral gray badge using the raw status as the label.
 */
export function statusBadge(status: string, labelOverride?: string): StatusBadge {
  const cfg = (PETITION_STATUS_CONFIG as Record<string, { label: string; variant: BadgeVariant }>)[
    status
  ];
  return {
    label: labelOverride ?? cfg?.label ?? status,
    variant: cfg?.variant ?? "gray-soft",
  };
}

export function petitionStatusBadge(petition: Petition): StatusBadge {
  if (["success", "approved", "rejected"].includes(petition.status)) {
    return statusBadge(petition.status);
  }
  if (petition.status === "deliveringQC" && (petition.qcReceivedAt || petition.labReceivedAt || petition.receivedAt)) {
    return statusBadge("pendingReview");
  }
  const hasQc = requiresQcTrack(petition);
  // ทั้ง QC และ Lab บันทึกผลครบแล้ว เหลือเพียงหัวหน้า Lab ออกผล — ต้องมาก่อน
  // สาขา qcCompletedAt ด้านล่าง ไม่งั้นจะถูกกลืนเป็น "รอส่วนอื่น" ทั้งที่ Lab ตรวจครบแล้ว
  // (เช่น P-2606-0018: qcCompletedAt + labCompletedAt แต่ยังไม่ labApprovedAt)
  if (hasQc && petition.qcCompletedAt && petition.labCompletedAt && !petition.labApprovedAt) {
    return toneBadge("warning", "รอตรวจ");
  }
  if (hasQc && petition.qcCompletedAt) return toneBadge("warning", "QC ตรวจครบ · รอส่วนอื่น");
  if (petition.labApprovedAt) return toneBadge("warning", hasQc ? "ผล Lab ออกแล้ว · รอ QC" : "ผล Lab ออกแล้ว · รอ Final Result");
  if (petition.labCompletedAt) return toneBadge("warning", "รอออกผล");
  return statusBadge(petition.status);
}

export function petitionStatusSteps(petition: Petition): PetitionStatusStep[] {
  const closed = ["success", "approved", "rejected"].includes(petition.status);
  const hasLab = hasLabTrack(petition);
  const hasQc = requiresQcTrack(petition);
  const qcDone = !hasQc || !!petition.qcCompletedAt || closed;
  const labDone = !hasLab || !!petition.labCompletedAt || closed;
  const labApproved = !hasLab || !!petition.labApprovedAt || closed;
  const received = !!(petition.qcReceivedAt || petition.labReceivedAt || petition.receivedAt);
  const steps: PetitionStatusStep[] = petition.status === "deliveringQC" && !received
    ? [{ key: "delivering", label: "กำลังส่งตัวอย่าง", done: false }]
    : [];
  steps.push({ key: "received", label: "รับตัวอย่าง", done: received || closed });
  // ขั้น Assign มีเฉพาะงาน Lab — QC ไม่มีการมอบหมาย
  if (hasLab) {
    steps.push({ key: "assigned", label: "Assign", done: !!petition.assignedTo || closed });
  }
  if (hasQc) {
    steps.push({ key: "qc", label: "QC กำลังวิเคราะห์", done: qcDone });
  }
  if (hasLab) {
    steps.push(
      { key: "lab", label: "Lab", done: labDone },
      { key: "lab-approval", label: "ออกผล Lab", done: labApproved },
    );
  }
  steps.push({ key: "qc-approval", label: "ออก Final Result", done: petition.status === "approved" });

  const firstOpen = steps.find((step) => !step.done);
  return steps.map((step) => ({ ...step, current: step === firstOpen }));
}

export function petitionExceptionScore(petition: Petition): number {
  if (["approved", "rejected"].includes(petition.status)) return 0;
  let score = 0;
  if (petition.qcCompletedAt && !petition.labCompletedAt && hasLabTrack(petition)) score += 40;
  if (petition.labCompletedAt && !petition.labApprovedAt) score += 35;
  if (petition.labApprovedAt && !petition.qcCompletedAt) score += 30;
  if (petition.status === "success") score += 25;
  if (petition.qcReturnNote || petition.labReturnNote) score += 20;
  const waitFrom = petition.completedAt || petition.labCompletedAt || petition.qcCompletedAt || petition.updatedAt;
  if (waitFrom && Date.now() - new Date(waitFrom).getTime() > 24 * 60 * 60 * 1000) score += 10;
  return score;
}
