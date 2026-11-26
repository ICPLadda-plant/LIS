import { useNavigate } from "react-router-dom";
import StatCard from "@/components/lis/StatCard";
import KpiMetricWidgetCard from "@/components/dashboard/KpiMetricWidgetCard";
import { Button } from "@/components/ui/button";
import { KPI_META, type KpiId } from "@/lib/dashboardProfiles";
import { computeKpi, type MetricsCtx } from "@/lib/dashboardMetrics";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const WIDGET_CAPTIONS: Partial<Record<KpiId, string>> = {
  labHeadAll: "ทั้งหมด",
  labHeadWaitingReceive: "ยังไม่รับ",
  assignedToMe: "คำขอล่าสุด",
  pendingAssign: "รอ assign",
  labHeadPendingApproval: "Lab",
  waitingReceive: "รอรับตัวอย่าง",
  inProgress: "รับงานแล้ว",
  waitingReview: "ส่งผลแล้ว",
  completedToday: "วันนี้",
  approvedToday: "วันนี้",
};

function usesThreeDesktopColumns(cardCount: number) {
  return cardCount === 5 || cardCount === 6 || cardCount === 9;
}

function gridClassFor(presentation: "default" | "widgets", cardCount: number) {
  const threeColumns = usesThreeDesktopColumns(cardCount);
  // < 768px การ์ด KPI ถูกย่อเป็นชิป — grid เหลือเฉพาะ extraCards (คอลัมน์เดียว)
  if (presentation === "widgets") {
    return threeColumns ? "grid-cols-1 md:grid-cols-6" : "grid-cols-1 md:grid-cols-8";
  }
  return threeColumns ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-4";
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-muted-foreground">±0 เทียบเมื่อวาน</span>;
  const up = delta > 0;
  return (
    <span className={up ? "text-green-600" : "text-red-600"}>
      {up ? "▲" : "▼"} {Math.abs(delta)} เทียบเมื่อวาน
    </span>
  );
}

interface KpiRowProps {
  kpis: KpiId[];
  ctx: MetricsCtx;
  activeKpi?: KpiId;
  onKpiClick?: (id: KpiId) => void;
  valueOverrides?: Partial<Record<KpiId, number | string>>;
  extraCards?: ReactNode;
  extraCardsAfter?: number;
  presentation?: "default" | "widgets";
}

export default function KpiRow({
  kpis,
  ctx,
  activeKpi,
  onKpiClick,
  valueOverrides,
  extraCards,
  extraCardsAfter,
  presentation = "default",
}: KpiRowProps) {
  const navigate = useNavigate();
  const chips: ReactNode[] = [];
  const renderedKpis = kpis.map((id) => {
    const meta = KPI_META[id];
    const { value, delta } = computeKpi(id, ctx);
    const overrideValue = valueOverrides?.[id];
    const displayValue = overrideValue ?? (id === "normalRateApprox" ? `${value}%` : value);
    const sublabel = delta !== undefined && overrideValue === undefined
      ? <DeltaBadge delta={delta} />
      : presentation === "widgets"
        ? WIDGET_CAPTIONS[id]
        : undefined;
    const handleClick = onKpiClick
      ? () => onKpiClick(id)
      : meta.drilldownPath
        ? () => navigate(meta.drilldownPath!)
        : undefined;
    const active = activeKpi === id;
    const chipContent = (
      <>
        {meta.label}
        <span className="font-semibold tabular-nums">{displayValue}</span>
      </>
    );
    chips.push(
      handleClick ? (
        <Button
          key={id}
          type="button"
          variant={active ? "default" : "outline"}
          aria-pressed={Boolean(active)}
          onClick={handleClick}
          className="h-11 shrink-0 rounded-full px-4"
        >
          {chipContent}
        </Button>
      ) : (
        <div
          key={id}
          className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground"
        >
          {chipContent}
        </div>
      ),
    );
    if (presentation === "widgets") {
      return (
        <div key={id} className="hidden md:contents">
        <KpiMetricWidgetCard
          icon={meta.icon}
          value={displayValue}
          label={meta.label}
          variant={meta.variant}
          sublabel={sublabel}
          active={active}
          onClick={handleClick}
        />
        </div>
      );
    }
    return (
      <div key={id} className="hidden md:contents">
      <StatCard
        icon={meta.icon}
        value={displayValue}
        label={meta.label}
        variant={meta.variant}
        sublabel={sublabel}
        active={active}
        onClick={handleClick}
      />
      </div>
    );
  });
  const extraCardsIndex = extraCardsAfter === undefined
    ? renderedKpis.length
    : Math.max(0, Math.min(extraCardsAfter, renderedKpis.length));
  const totalCards = renderedKpis.length + (extraCards ? 1 : 0);

  return (
    <>
      <div
        role="group"
        aria-label="ตัวกรองสรุป"
        className={cn("-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 md:hidden", extraCards ? "mb-3" : "mb-4")}
      >
        {chips}
      </div>
      <div
        className={cn(
          "mb-4 gap-3",
          extraCards ? "grid" : "hidden md:grid",
          gridClassFor(presentation, totalCards),
        )}
      >
        {renderedKpis.slice(0, extraCardsIndex)}
        {extraCards}
        {renderedKpis.slice(extraCardsIndex)}
      </div>
    </>
  );
}
