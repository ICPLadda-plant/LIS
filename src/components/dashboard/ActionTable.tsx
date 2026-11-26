import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusStepBadge } from "@/components/lis/StatusStepBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import {
  PETITION_STATUS_CONFIG,
  type Petition,
  type StatusBadgeVariant,
} from "@/types/petition.types";
import { ageHours } from "@/lib/dashboardMetrics";

const OLD_AGE_HOURS = 48;

interface Props {
  petitions: Petition[];
  actionLabel: string;
  actionPathPrefix: string;
  urgentIds: Set<string>;
  title?: string;
  emptyMessage?: string;
  sortRows?: boolean;
  footer?: ReactNode;
  statusBadge?: (petition: Petition) => { label: string; variant: StatusBadgeVariant };
}

export default function ActionTable({
  petitions,
  actionLabel,
  actionPathPrefix,
  urgentIds,
  title = "ต้องดำเนินการ",
  emptyMessage,
  sortRows = true,
  footer,
  statusBadge,
}: Props) {
  const navigate = useNavigate();
  const now = Date.now();
  const firstTs = (p: Petition) => p.sampleSentAt ?? p.receivedAt ?? p.createdAt;
  const rows = sortRows
    ? [...petitions].sort((a, b) => {
      const urgency = Number(urgentIds.has(b._id)) - Number(urgentIds.has(a._id));
      return urgency || (ageHours(firstTs(b), now) ?? 0) - (ageHours(firstTs(a), now) ?? 0);
    })
    : petitions;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>คำร้อง</TableHead>
                <TableHead className="hidden sm:table-cell">ผู้ขอ</TableHead>
                <TableHead>ขั้นตอน</TableHead>
                <TableHead>ความสำคัญ</TableHead>
                <TableHead className="text-right">อายุงาน</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    {emptyMessage ?? "ไม่มีรายการที่ต้องดำเนินการ"}
                  </TableCell>
                </TableRow>
              ) : rows.map((p) => {
                const age = ageHours(firstTs(p), now);
                const urgent = urgentIds.has(p._id);
                const old = (age ?? 0) >= OLD_AGE_HOURS;
                const status = statusBadge?.(p) ?? PETITION_STATUS_CONFIG[p.status];
                return (
                  <TableRow
                    key={p._id}
                    className={cn("cursor-pointer", (urgent || old) && "bg-red-50/60 hover:bg-red-50")}
                    onClick={() => navigate(`${actionPathPrefix}/${p._id}`)}
                  >
                    <TableCell>
                      <div className="font-semibold text-primary whitespace-nowrap">{p.petitionNo}</div>
                      <div className="text-[11px] text-muted-foreground">{petitionDepartmentLabel(p)}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">{p.submittedBy?.name ?? "-"}</TableCell>
                    <TableCell><StatusStepBadge label={status?.label ?? "-"} variant={status?.variant ?? "gray-soft"} status={p.status} /></TableCell>
                    <TableCell>
                      {urgent
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> ด่วน</span>
                        : <span className="text-xs text-muted-foreground">ปกติ</span>}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums text-sm", old && "font-semibold text-red-600")}>
                      {age === null ? "—" : `${age} ชม.`}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" className="h-8 w-full"
                        onClick={(e) => { e.stopPropagation(); navigate(`${actionPathPrefix}/${p._id}`); }}>
                        {actionLabel}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {footer ? <div className="border-t px-4 py-3">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
