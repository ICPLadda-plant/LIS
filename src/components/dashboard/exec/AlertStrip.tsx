import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardList, Clock, Flame, ShieldCheck, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { highlightPath, type ExecSummary } from "@/lib/execSummary";

type Counts = ExecSummary["live"]["counts"];

interface Props {
  counts: Counts;
  totalIds?: string[];
  overdueIds: string[];
  waitingHeadIds?: string[];
  urgentIds?: string[];
  abnormalIds?: string[];
  unassignedIds?: string[];
}

const TONE: Record<string, string> = {
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
};

function Tile({ label, value, icon: Icon, tone, to }: {
  label: string; value: number; icon: LucideIcon; tone: keyof typeof TONE; to: string;
}) {
  return (
    <Link to={to} className="shrink-0 md:flex-1 md:min-w-[140px]">
      <Card className={cn("flex min-h-11 items-center gap-2 rounded-full border px-3 py-1.5 transition hover:shadow-md md:gap-3 md:rounded-lg md:p-3", TONE[tone])}>
        <Icon className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
        <div className="flex min-w-0 items-baseline gap-1.5 md:block">
          <div className="text-base font-semibold leading-none md:text-2xl">{value}</div>
          <div className="whitespace-nowrap text-xs md:truncate">{label}</div>
        </div>
      </Card>
    </Link>
  );
}

export default function AlertStrip({
  counts, totalIds = [], overdueIds, waitingHeadIds = [],
  urgentIds = [], abnormalIds = [], unassignedIds = [],
}: Props) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:gap-3 md:px-0">
      <Tile label="งานทั้งหมด" value={counts.total} icon={ClipboardList} tone="neutral" to={highlightPath(totalIds)} />
      <Tile label="งานด่วน" value={counts.urgent} icon={Flame} tone="red" to={highlightPath(urgentIds)} />
      <Tile label="เกินเวลา" value={counts.overdue} icon={Clock} tone="red" to={highlightPath(overdueIds)} />
      <Tile label="ยังไม่ assign" value={counts.unassigned} icon={UserX} tone="amber" to={highlightPath(unassignedIds)} />
      <Tile label="รออนุมัติ" value={counts.waitingHead} icon={ShieldCheck} tone="blue" to={highlightPath(waitingHeadIds)} />
      <Tile label="ผลผิดปกติ" value={counts.abnormal} icon={AlertTriangle} tone="red" to={highlightPath(abnormalIds)} />
    </div>
  );
}
