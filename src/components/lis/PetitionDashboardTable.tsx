import { useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { petitionExceptionScore, petitionStatusBadge } from "@/lib/statusBadge";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import PetitionStatusTimeline from "@/components/lis/PetitionStatusTimeline";
import StatusStepBadge from "@/components/lis/StatusStepBadge";
import type { Petition, StatusBadgeVariant } from "@/types/petition.types";

const STATUS_BAR_CLASS: Record<StatusBadgeVariant, string> = {
  "primary": "bg-primary-500",
  "primary-soft": "bg-primary-400",
  "yellow": "bg-yellow-500",
  "yellow-soft": "bg-yellow-400",
  "green": "bg-green-500",
  "green-soft": "bg-green-400",
  "red": "bg-red-500",
  "red-soft": "bg-red-400",
  "blue": "bg-primary-500",
  "blue-soft": "bg-primary-400",
  "gray": "bg-grey-500",
  "gray-soft": "bg-grey-300",
  "purple": "bg-violet-500",
  "purple-soft": "bg-violet-400",
};

interface PetitionDashboardTableProps {
  title: string;
  petitions: Petition[];
  loading: boolean;
  emptyText: string;
  actionPathPrefix?: string;
  viewAllPath?: string;
  /** ถ้าตั้งค่า: คำร้องที่ยังไม่สแกนรับ (status `sampleSent`) จะเด้งไปหน้า list นี้แทน detail */
  unreceivedListPath?: string;
  emptyAction?: { label: string; onClick: () => void };
  headerSlot?: ReactNode;
  maxHeight?: string;
}

export default function PetitionDashboardTable({
  title,
  petitions,
  loading,
  emptyText,
  actionPathPrefix = "/petition",
  viewAllPath = "/petition",
  unreceivedListPath,
  emptyAction,
  headerSlot,
  maxHeight = "560px",
}: PetitionDashboardTableProps) {
  const navigate = useNavigate();

  // ซ่อนคอลัมน์ "ผู้ยื่น" เมื่อช่องตารางแคบเกินจะใส่ครบ 5 คอลัมน์ (เลี่ยง scrollbar แนวนอน)
  // วัดความกว้างจริงของช่องด้วย ResizeObserver — แม่นกว่า breakpoint ตอนถูก right-rail บีบ
  // ใช้ callback ref เพราะ div ตารางโผล่หลัง data โหลด (ตอน mount ยังเป็น loading) — effect [] จะพลาด node
  const [compact, setCompact] = useState(false);
  const roRef = useRef<ResizeObserver | null>(null);
  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (el && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => {
        setCompact(entries[0].contentRect.width < 600);
      });
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  const showHeader = Boolean(title) || Boolean(headerSlot);
  const displayPetitions = [...petitions].sort((a, b) => petitionExceptionScore(b) - petitionExceptionScore(a));

  // ยังไม่สแกนรับ → ไปหน้า list (สแกนรับ); รับแล้ว → เข้า detail พร้อม flash
  const goToPetition = (petition: Petition) => {
    if (unreceivedListPath && petition.status === "sampleSent") {
      navigate(unreceivedListPath, { state: { flashId: petition._id } });
    } else {
      navigate(`${actionPathPrefix}/${petition._id}`, { state: { flash: true } });
    }
  };

  return (
    <Card className="shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
      {showHeader ? (
        <CardHeader className="pb-3">
          {title ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">{title}</CardTitle>
              <Button variant="primary-outline" size="sm" onClick={() => navigate(viewAllPath)}>
                ดูรายการคำร้องทั้งหมด
              </Button>
            </div>
          ) : null}
          {headerSlot ? <div className={cn(title && "mt-3")}>{headerSlot}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent>
        {loading ? (
          <LoadingRows />
        ) : petitions.length === 0 ? (
          <EmptyState text={emptyText} action={emptyAction} />
        ) : (
          <div ref={scrollRef} className="overflow-x-auto overflow-y-auto" style={{ maxHeight }}>
            <Table className={compact ? "min-w-0" : "min-w-[600px]"}>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">คำร้อง</TableHead>
                  {!compact && (
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">ผู้ยื่น</TableHead>
                  )}
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">ตัวอย่าง</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">สถานะ</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayPetitions.map((petition) => {
                  const statusCfg = petitionStatusBadge(petition);
                  const barClass = STATUS_BAR_CLASS[statusCfg.variant] ?? "bg-grey-300";
                  const firstItem = petition.items[0];
                  const extraCount = Math.max(0, petition.items.length - 1);

                  return (
                    <TableRow
                      key={petition._id}
                      tabIndex={0}
                      onClick={() => goToPetition(petition)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          goToPetition(petition);
                        }
                      }}
                      className={cn(
                        "relative h-12 cursor-pointer transition-colors",
                        "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
                      )}
                    >
                      <TableCell className="relative">
                        <span className={cn("absolute left-0 top-1 bottom-1 w-[3px] rounded-r", barClass)} aria-hidden />
                        <div className="pl-2">
                          <div className="whitespace-nowrap font-semibold text-primary">{petition.petitionNo}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {petitionDepartmentLabel(petition)}
                          </div>
                        </div>
                      </TableCell>
                      {!compact && (
                        <TableCell className="text-sm">{petition.submittedBy?.name ?? "-"}</TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium tabular-nums shrink-0">{petition.items.length}</span>
                          <span className="truncate text-sm text-muted-foreground max-w-[200px]">
                            {firstItem?.sampleName ?? "-"}
                          </span>
                          {extraCount > 0 ? (
                            <Badge variant="gray-soft" className="shrink-0">+{extraCount}</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusStepBadge label={statusCfg.label} variant={statusCfg.variant} status={petition.status} />
                          <PetitionStatusTimeline petition={petition} compact />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-12" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{text}</p>
        <p className="text-xs text-muted-foreground mt-1">งานใหม่จะปรากฏที่นี่อัตโนมัติ</p>
      </div>
      {action ? (
        <Button size="sm" variant="primary-outline" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
