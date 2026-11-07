import type { ReactElement } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { fmtDate } from "@/lib/dailyCheckFormat";
import { cn } from "@/lib/utils";
import {
  CONTROL_STATUS_LABEL,
  classifyPoint,
  formatControlNumber,
  type ControlLimits,
  type MonthlyPoint,
} from "@/lib/balanceControlChart";

// กราฟควบคุมคุณภาพเครื่องชั่ง: จุดค่าที่ได้รายวัน + เส้น Mean, UWL/LWL (±2SD), UCL/LCL (±3SD)
// fixed = ขนาดคงที่สำหรับเอกสารพิมพ์ (ไม่ใช้ ResponsiveContainer และไม่มี animation)

interface BalanceChartPalette {
  value: string;
  mean: string;
  warningLine: string;
  controlLine: string;
  warningDot: string;
  outDot: string;
  dotStroke: string;
  grid: string;
  axis: string;
}

const SCREEN_CHART_PALETTE: BalanceChartPalette = {
  value: "hsl(var(--primary))",
  mean: "hsl(var(--destructive))",
  warningLine: "hsl(var(--lis-stat-green-icon))",
  controlLine: "hsl(var(--lis-stat-amber-icon))",
  warningDot: "hsl(var(--lis-stat-amber-icon))",
  outDot: "hsl(var(--destructive))",
  dotStroke: "hsl(var(--card))",
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
};

// เอกสารพิมพ์ใช้สีตายตัว เพื่อไม่ขึ้นกับ theme (dark mode) ของหน้าจอ
const PRINT_CHART_PALETTE: BalanceChartPalette = {
  value: "#1d4ed8",
  mean: "#dc2626",
  warningLine: "#16a34a",
  controlLine: "#d97706",
  warningDot: "#d97706",
  outDot: "#dc2626",
  dotStroke: "#ffffff",
  grid: "#d1d5db",
  axis: "#111827",
};

const CHART_CONFIG: ChartConfig = {
  value: { label: "ค่าที่ได้", color: "hsl(var(--primary))" },
};

interface ChartDatum {
  day: number;
  date: string;
  value: number | null;
}

interface DotRenderProps {
  key?: string;
  cx?: number | null;
  cy?: number | null;
  index?: number;
  payload?: ChartDatum;
}

const pointColor = (value: number | null | undefined, limits: ControlLimits | null, palette: BalanceChartPalette) => {
  const status = classifyPoint(value, limits);
  if (status === "out") return palette.outDot;
  if (status === "warning") return palette.warningDot;
  return palette.value;
};

function ControlTooltip({
  active,
  payload,
  limits,
  digits,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartDatum }>;
  limits: ControlLimits | null;
  digits: number;
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum || datum.value == null) return null;
  const status = classifyPoint(datum.value, limits);
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">วันที่ {fmtDate(datum.date)}</p>
      <p className="tabular-nums text-foreground">ค่าที่ได้ {formatControlNumber(datum.value, digits)} g</p>
      {status ? <p className="text-muted-foreground">{CONTROL_STATUS_LABEL[status]}</p> : null}
    </div>
  );
}

interface BalanceControlChartProps {
  series: MonthlyPoint[];
  limits: ControlLimits | null;
  domain: [number, number];
  digits: number;
  fixed?: boolean;
  className?: string;
}

export default function BalanceControlChart({ series, limits, domain, digits, fixed = false, className }: BalanceControlChartProps) {
  const palette = fixed ? PRINT_CHART_PALETTE : SCREEN_CHART_PALETTE;
  const data: ChartDatum[] = series.map((point) => ({ day: point.day, date: point.date, value: point.value }));
  const tickFont = fixed ? 13 : 11;

  const renderDot = (props: DotRenderProps): ReactElement => {
    const key = props.key ?? `dot-${props.index ?? 0}`;
    const value = props.payload?.value;
    if (props.cx == null || props.cy == null || value == null) return <g key={key} />;
    const status = classifyPoint(value, limits);
    return (
      <circle
        key={key}
        cx={props.cx}
        cy={props.cy}
        r={status === "out" ? 5 : 4}
        fill={pointColor(value, limits, palette)}
        stroke={palette.dotStroke}
        strokeWidth={1.5}
      />
    );
  };

  const referenceLine = (key: string, y: number, stroke: string, label: string, dash?: string) => (
    <ReferenceLine
      key={key}
      y={y}
      stroke={stroke}
      strokeWidth={1.5}
      strokeDasharray={dash}
      ifOverflow="extendDomain"
      label={{ value: label, position: "right", fill: stroke, fontSize: tickFont }}
    />
  );

  const elements: ReactElement[] = [
    <CartesianGrid key="grid" strokeDasharray="3 3" stroke={palette.grid} vertical={false} />,
    <XAxis
      key="x"
      dataKey="day"
      tick={{ fontSize: tickFont, fill: palette.axis }}
      tickLine={false}
      interval={fixed ? 0 : "preserveStartEnd"}
      minTickGap={4}
    />,
    <YAxis
      key="y"
      domain={domain}
      allowDataOverflow
      tickCount={7}
      tickFormatter={(value: number) => value.toFixed(digits)}
      tick={{ fontSize: tickFont, fill: palette.axis }}
      tickLine={false}
      width={digits >= 5 ? 88 : 76}
    />,
  ];

  if (limits) {
    elements.push(
      referenceLine("ucl", limits.ucl, palette.controlLine, "UCL", "2 4"),
      referenceLine("uwl", limits.uwl, palette.warningLine, "UWL", "6 4"),
      referenceLine("mean", limits.mean, palette.mean, "Mean"),
      referenceLine("lwl", limits.lwl, palette.warningLine, "LWL", "6 4"),
      referenceLine("lcl", limits.lcl, palette.controlLine, "LCL", "2 4"),
    );
  }

  elements.push(
    <Line
      key="value"
      type="linear"
      dataKey="value"
      name="ค่าที่ได้"
      stroke={palette.value}
      strokeWidth={2}
      connectNulls
      dot={renderDot}
      activeDot={{ r: 6 }}
      isAnimationActive={!fixed}
    />,
  );

  const margin = { top: 12, right: 52, bottom: 4, left: 4 };

  if (fixed) {
    return (
      <LineChart width={980} height={300} data={data} margin={margin} className={className}>
        {elements}
      </LineChart>
    );
  }

  return (
    <ChartContainer config={CHART_CONFIG} className={cn("aspect-auto h-[320px] w-full", className)}>
      <LineChart data={data} margin={margin}>
        {elements}
        <Tooltip content={<ControlTooltip limits={limits} digits={digits} />} />
      </LineChart>
    </ChartContainer>
  );
}

interface LegendItem {
  key: string;
  label: string;
  stroke?: string;
  dash?: string;
  dot?: string;
}

export function BalanceControlLegend({ fixed = false, className }: { fixed?: boolean; className?: string }) {
  const palette = fixed ? PRINT_CHART_PALETTE : SCREEN_CHART_PALETTE;
  const items: LegendItem[] = [
    { key: "value", label: "ค่าที่ได้ (เฉลี่ยตุ้ม 100 g)", stroke: palette.value, dot: palette.value },
    { key: "mean", label: "Mean", stroke: palette.mean },
    { key: "warning-line", label: "UWL / LWL (±2SD)", stroke: palette.warningLine, dash: "6 4" },
    { key: "control-line", label: "UCL / LCL (±3SD)", stroke: palette.controlLine, dash: "2 4" },
    { key: "warning-dot", label: "จุดเกิน 2SD", dot: palette.warningDot },
    { key: "out-dot", label: "จุดเกิน 3SD", dot: palette.outDot },
  ];

  return (
    <ul className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs", className)}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <svg width="24" height="10" aria-hidden="true">
            {item.stroke ? (
              <line x1="0" y1="5" x2="24" y2="5" stroke={item.stroke} strokeWidth="2" strokeDasharray={item.dash} />
            ) : null}
            {item.dot ? <circle cx="12" cy="5" r="3.5" fill={item.dot} /> : null}
          </svg>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
