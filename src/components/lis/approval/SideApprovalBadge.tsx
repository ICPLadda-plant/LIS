import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dateTime";
import type { SideApprovalState } from "@/lib/itemApprovals";

const VARIANT = {
  none: "gray-soft",
  "waiting-result": "gray-soft",
  returned: "red-soft",
  pending: "yellow-soft",
  approved: "green-soft",
} as const;

interface SideApprovalBadgeProps {
  state: SideApprovalState;
  /** แสดงชื่อผู้ให้ผ่านใต้ badge */
  showApprover?: boolean;
}

/** สถานะฝั่งกายภาพ / AI ของคำร้องในหน้า /qc-approval */
export default function SideApprovalBadge({ state, showApprover = false }: SideApprovalBadgeProps) {
  if (state.kind === "none") return <span className="text-sm text-muted-foreground">-</span>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant={state.kind === "approved" && state.acceptedOos ? "yellow-soft" : VARIANT[state.kind]}>
        {state.label}
      </Badge>
      {showApprover && state.kind === "approved" && state.approvedBy && (
        <span className="text-xs text-muted-foreground">
          โดย {state.approvedBy}
          {state.approvedAt ? ` · ${formatDateTime(state.approvedAt)}` : ""}
        </span>
      )}
    </div>
  );
}
