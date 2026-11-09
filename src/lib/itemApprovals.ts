import type { Petition, PetitionItem, PetitionItemApproval } from "@/types/petition.types";
import {
  hasLabTrack,
  isResearchAndDevelopmentPetition,
  requiresQcTrack,
  shouldSendItemToLab,
  shouldSendItemToQc,
} from "@/lib/petitionRouting";

// สถานะอนุมัติรายรายการ (ต่อ batch × common name = ต่อ petition item) แยกฝั่ง QC / Lab
// Mirror ของ server/lib/itemApprovals.js — แก้คู่กัน

export type ApprovalSide = "qc" | "lab";
export type ItemSideStatus = "approved" | "rejected" | "pending" | "none";

type ApprovalPetition = Pick<
  Petition,
  "status" | "conclusion" | "items" | "routeTargets" | "submittedBy" | "itemApprovals" | "labReceivedAt" | "labCompletedAt" | "labApprovedAt" | "qcCompletedAt"
>;

export function itemRequiresSide(petition: ApprovalPetition, item: PetitionItem | undefined, side: ApprovalSide): boolean {
  if (!item) return false;
  if (side === "qc") return requiresQcTrack(petition) && shouldSendItemToQc(item);
  if (!hasLabTrack(petition)) return false;
  if (isResearchAndDevelopmentPetition(petition as Petition)) return true;
  const targets = petition.routeTargets ?? [];
  if (targets.length && targets.includes("lab") && !targets.includes("qc")) return true;
  return shouldSendItemToLab(item);
}

/** รายการที่อยู่ใน tab นั้นของหน้า /qc-approval */
export function itemsForSide(petition: ApprovalPetition, side: ApprovalSide): PetitionItem[] {
  return (petition.items ?? []).filter((item) => itemRequiresSide(petition, item, side));
}

export function findItemApproval(petition: ApprovalPetition, seq: number, side: ApprovalSide): PetitionItemApproval | null {
  return (petition.itemApprovals ?? []).find((entry) => Number(entry.seq) === Number(seq) && entry.side === side) ?? null;
}

/** คำร้องที่ออก Final Result แล้วแบบเดิม (ไม่มีข้อมูลรายรายการ) ถือว่าอนุมัติครบ */
export function itemSideStatus(petition: ApprovalPetition, item: PetitionItem, side: ApprovalSide): ItemSideStatus {
  if (!itemRequiresSide(petition, item, side)) return "none";
  const entry = findItemApproval(petition, item.seq, side);
  if (entry) return entry.status;
  return petition.status === "approved" ? "approved" : "pending";
}

export function sideApprovalProgress(petition: ApprovalPetition, side: ApprovalSide) {
  const items = itemsForSide(petition, side);
  const approved = items.filter((item) => itemSideStatus(petition, item, side) === "approved").length;
  return { total: items.length, approved, pending: items.length - approved };
}

/** ชื่อฝั่งที่ผู้ใช้เห็นในหน้า /qc-approval: QC = ค่ากายภาพ, Lab = %AI */
export const APPROVAL_SIDE_LABEL: Record<ApprovalSide, string> = { qc: "กายภาพ", lab: "AI" };

/** "กายภาพผ่าน" / "AI ผ่าน" — เว้นวรรคหลังคำภาษาอังกฤษ */
export function sideResultLabel(side: ApprovalSide, pass: boolean): string {
  return `${APPROVAL_SIDE_LABEL[side]}${side === "lab" ? " " : ""}${pass ? "ผ่าน" : "ไม่ผ่าน"}`;
}

export type SideApprovalStateKind = "none" | "waiting-result" | "returned" | "pending" | "approved";

export interface SideApprovalState {
  kind: SideApprovalStateKind;
  /** ข้อความสั้นสำหรับ badge เช่น "รอผล Lab", "รออนุมัติ", "กายภาพผ่าน" */
  label: string;
  total: number;
  pending: number;
  /** ผู้ให้ผ่านล่าสุดของฝั่งนี้ (เมื่ออนุมัติครบ) */
  approvedBy?: string;
  approvedAt?: string;
  /** มีรายการที่ยอมรับผลไม่ปกติ */
  acceptedOos?: boolean;
}

/** สถานะรวมของฝั่ง QC (กายภาพ) / Lab (AI) ในคำร้อง — ใช้ทั้งหน้ารายการและหน้ารายละเอียด */
export function sideApprovalState(petition: ApprovalPetition, side: ApprovalSide): SideApprovalState {
  const items = itemsForSide(petition, side);
  const { total, pending } = sideApprovalProgress(petition, side);
  if (!total) return { kind: "none", label: "-", total, pending };
  if (pending === 0) {
    const entries = items
      .map((item) => findItemApproval(petition, item.seq, side))
      .filter((entry): entry is PetitionItemApproval => Boolean(entry));
    const latest = [...entries].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))[0];
    const acceptedOos = items.some((item) => itemOutOfSpec(petition, item, side));
    return {
      kind: "approved",
      label: acceptedOos ? `${sideResultLabel(side, true)} (ยอมรับผลไม่ปกติ)` : sideResultLabel(side, true),
      total,
      pending,
      approvedBy: latest?.by,
      approvedAt: latest?.at,
      acceptedOos,
    };
  }
  const done = side === "qc" ? petition.qcCompletedAt : petition.labCompletedAt;
  if (!done) {
    const returned = items.some((item) => itemSideStatus(petition, item, side) === "rejected");
    return returned
      ? { kind: "returned", label: `ไม่ผ่าน — รอ ${side === "qc" ? "QC" : "Lab"} ทดสอบใหม่`, total, pending }
      : { kind: "waiting-result", label: side === "qc" ? "รอผล QC" : "รอผล Lab", total, pending };
  }
  return { kind: "pending", label: "รออนุมัติ", total, pending };
}

function itemOutOfSpec(petition: ApprovalPetition, item: PetitionItem, side: ApprovalSide): boolean {
  const entry = findItemApproval(petition, item.seq, side);
  if (entry) return entry.status === "approved" && entry.conclusion === "accepted-oos";
  return petition.status === "approved" && petition.conclusion === "accepted-oos";
}

export type PhysicalBatchStatus = "approved" | "rejected" | "pending" | "none";
export type AiBatchStatus = "pass" | "fail" | "pending" | "none";

export interface BatchApprovalSummary {
  key: string;
  batchNo: string;
  items: PetitionItem[];
  physical: PhysicalBatchStatus;
  ai: AiBatchStatus;
}

/** สรุปสถานะต่อ batch สำหรับหน้า /petition: "กายภาพผ่าน" (QC อนุมัติ) และ "%AI ผ่าน/ไม่ผ่าน/รอ" (เฉพาะ batch ที่ส่ง Lab) */
export function batchApprovalSummaries(petition: ApprovalPetition): BatchApprovalSummary[] {
  const groups = new Map<string, PetitionItem[]>();
  for (const item of petition.items ?? []) {
    const batchNo = String(item.batchNo ?? "").trim();
    const key = batchNo || `#${item.seq}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, items]) => {
    const qcItems = items.filter((item) => itemRequiresSide(petition, item, "qc"));
    const labItems = items.filter((item) => itemRequiresSide(petition, item, "lab"));
    const qcStatuses = qcItems.map((item) => itemSideStatus(petition, item, "qc"));
    const labStatuses = labItems.map((item) => itemSideStatus(petition, item, "lab"));
    const physical: PhysicalBatchStatus = !qcItems.length
      ? "none"
      : qcStatuses.every((s) => s === "approved")
        ? "approved"
        : qcStatuses.some((s) => s === "rejected") ? "rejected" : "pending";
    const ai: AiBatchStatus = !labItems.length
      ? "none"
      : labStatuses.every((s) => s === "approved")
        ? (labItems.some((item) => itemOutOfSpec(petition, item, "lab")) ? "fail" : "pass")
        : "pending";
    return { key, batchNo: String(items[0]?.batchNo ?? "").trim(), items, physical, ai };
  });
}

