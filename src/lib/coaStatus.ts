import type { CoaDocument, CoaPerson, CoaStatus } from "@/types/coa.types";

type CoaAccessUser = CoaPerson & {
  activeRole?: string;
  roles?: string[];
  permissions?: string[];
  position?: string;
};

function normalizeRole(value?: string) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isCoaQcHead(user?: CoaAccessUser | null): boolean {
  if (!user) return false;
  const roleSignals = [user.role, user.activeRole];
  return roleSignals.some((value) => normalizeRole(value) === "qc_head")
    || (user.permissions ?? []).includes("coa.approve");
}

export function isCoaCreator(user: CoaAccessUser | null | undefined, doc: Pick<CoaDocument, "createdBy">): boolean {
  const userEmail = user?.email?.trim().toLowerCase();
  const creatorEmail = doc.createdBy?.email?.trim().toLowerCase();
  return Boolean(userEmail && creatorEmail && userEmail === creatorEmail);
}

export function canReviewCoa(user: CoaAccessUser | null | undefined, doc: Pick<CoaDocument, "createdBy">): boolean {
  return isCoaQcHead(user) || isCoaCreator(user, doc);
}

export const COA_STATUS_LABELS: Record<CoaStatus, string> = {
  requested: "ขอ COA",
  draft: "ร่าง",
  pendingApproval: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  printed: "พิมพ์แล้ว",
  revisionDraft: "ร่างฉบับแก้ไข",
  pendingRevisionApproval: "รออนุมัติฉบับแก้ไข",
  reissued: "ออกใหม่แล้ว",
  cancelled: "ยกเลิก",
  superseded: "ถูกแทนที่",
  rejected: "ไม่อนุมัติ",
};

export function coaStatusLabel(status: CoaStatus): string {
  return COA_STATUS_LABELS[status];
}

export function canPrintCoa(status: CoaStatus): boolean {
  return status === "approved" || status === "printed" || status === "reissued";
}

export function allowedCoaActions(status: CoaStatus, canReview: boolean): string[] {
  if (status === "draft" || status === "revisionDraft") return ["save", "submit"];
  if ((status === "pendingApproval" || status === "pendingRevisionApproval") && canReview) return ["approve", "reject"];
  if (status === "approved" || status === "printed" || status === "reissued") return ["print", "revise", "cancel"];
  return [];
}
