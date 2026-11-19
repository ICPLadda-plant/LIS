import { useEffect, useRef, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  PBZ_DIL_SAMPLE,
  PBZ_DIL_STD,
  PBZ_STD_PCT,
  calculatePaclobutrazol,
  pbzFixed,
  pbzKey,
  pbzMirrorKey,
  type PBZ_COLS,
  type PBZ_ROWS,
} from "@/lib/paclobutrazolFields";

type Row = (typeof PBZ_ROWS)[number];
type Col = (typeof PBZ_COLS)[number];

export type PaclobutrazolSheetHeader = {
  sampleNo?: string;
  tradeName?: string;
  commonName?: string;
  formula?: string;
};

type Props = {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  petitionId?: string;
  density?: number | null;
  header?: PaclobutrazolSheetHeader;
  analyst?: string;
};

const DEFAULT_DILUTION = "50";

// ใบคำนวณ PACLOBUTRAZOL ตามแบบฟอร์ม FM-QP-07-08-002
export function PaclobutrazolGrid({ values, onChange, disabled, petitionId, density = null, header, analyst }: Props) {
  const prefilled = useRef(false);
  const std1Key = pbzKey("Std 1", "wt/mg");
  const std2Key = pbzKey("Std 2", "wt/mg");

  // น้ำหนัก Std และ %Std ใช้ค่าล่าสุดจนกว่าจะเบิก Std PACLOBUTRAZOL ขวดใหม่; dilution เริ่มที่ 50
  useEffect(() => {
    if (prefilled.current || disabled) return;
    prefilled.current = true;
    if (!String(values[PBZ_DIL_STD] ?? "")) onChange(PBZ_DIL_STD, DEFAULT_DILUTION);
    if (!String(values[PBZ_DIL_SAMPLE] ?? "")) onChange(PBZ_DIL_SAMPLE, DEFAULT_DILUTION);
    if (String(values[std1Key] ?? "") || String(values[std2Key] ?? "")) return;
    api.getPaclobutrazolStdWeights(petitionId ?? "")
      .then((res) => {
        if (res.std1) onChange(std1Key, res.std1);
        if (res.std2) onChange(std2Key, res.std2);
        if (res.stdPct && !String(values[PBZ_STD_PCT] ?? "")) onChange(PBZ_STD_PCT, res.stdPct);
      })
      .catch(() => undefined);
  }, [disabled, onChange, petitionId, std1Key, std2Key, values]);

  const calc = calculatePaclobutrazol(values, density);

  const field = (key: string, label: string, readOnly = false) => (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="h-8 bg-muted text-center tabular-nums"
      value={String(values[key] ?? "")}
      disabled={disabled || readOnly}
      title={readOnly ? "ใช้ค่าเดียวกับครั้งที่ 1" : undefined}
      onChange={(e) => {
        onChange(key, e.target.value);
        const mirror = pbzMirrorKey(key);
        if (mirror) onChange(mirror, e.target.value);
      }}
    />
  );
  const input = (row: Row, col: Col) => field(pbzKey(row, col), `${row} ${col}`, row.startsWith("Sample") && col.endsWith("2"));
  const out = (n: number | null | undefined, digits: number) => <span className="tabular-nums">{pbzFixed(n, digits)}</span>;

  const td = "border border-border px-1.5 py-1 text-center align-middle";
  const th = "border border-border px-2 py-1.5 text-center font-medium";
  const groupTop = "border-t-2 border-t-foreground/40";

  const entityRows = (row: Row, index: number, kind: "std" | "sample"): ReactNode => {
    const pairs = [["Peak area 1", "Internal std 1"], ["Peak area 2", "Internal std 2"]] as const;
    const data = kind === "std" ? calc.std[index] : calc.sample[index];
    return pairs.map(([area, is], inj) => (
      <tr key={`${row}-${inj}`} className={inj === 0 ? groupTop : undefined}>
        <td className={cn(td, inj === 0 && "font-medium")}>{inj === 0 ? row.replace(" ", "") : input(row, "wt/mg")}</td>
        <td className={td}>{kind === "std" ? input(row, area) : null}</td>
        <td className={td}>{kind === "sample" ? input(row, area) : null}</td>
        <td className={td}>{inj === 0 ? out(data.conc, 3) : null}</td>
        <td className={td}>{input(row, is)}</td>
        <td className={td}>{kind === "std" ? out(calc.std[index].inj[inj].fi, 4) : null}</td>
        <td className={td}>{kind === "std" && index === 0 && inj === 1 ? out(calc.meanFactor, 4) : null}</td>
        <td className={td}>{kind === "sample" ? out(calc.sample[index].inj[inj].content, 4) : null}</td>
        <td className={td}>{kind === "sample" && inj === 1 ? out(calc.sample[index].meanContent, 4) : null}</td>
      </tr>
    ));
  };

  const headerItem = (label: string, value?: string) => (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value || "-"}</span>
    </div>
  );
  const topInput = (label: string, key: string, suffix?: string) => (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="w-24">{field(key, label)}</span>
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  );
  const summaryRow = (label: string, value: ReactNode, unit: ReactNode) => (
    <div className="grid grid-cols-[6rem_10rem_4rem] items-end gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="border-b border-border pb-0.5 text-center tabular-nums">{value}</span>
      <span className="text-muted-foreground">{unit}</span>
    </div>
  );

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 text-sm shadow-sm sm:col-span-6">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {headerItem("ตัวอย่างเลขที่", header?.sampleNo)}
        {headerItem("ชื่อการค้า", header?.tradeName)}
        {headerItem("ชื่อสามัญ", header?.commonName || "Paclobutrazol")}
        {headerItem("สูตร", header?.formula)}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {topInput("% Std =", PBZ_STD_PCT, "%")}
        {topInput("Dilution Std =", PBZ_DIL_STD)}
        {topInput("Dilution Sample =", PBZ_DIL_SAMPLE)}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className={th}>Weight Std</th>
              <th className={th}>Peak area</th>
              <th className={th}>Peak area sample</th>
              <th className={th}>Conc</th>
              <th className={th}>Peak area Internal</th>
              <th className={th}>Resolution</th>
              <th className={th}>Mean</th>
              <th className={th}>Content</th>
              <th className={th}>Mean Content</th>
            </tr>
            <tr>
              <th className={th}>Sample</th>
              <th className={th}>Standard</th>
              <th className={th} />
              <th className={th}>mg/mL</th>
              <th className={th}>Standard</th>
              <th className={th}>Factor (fi)</th>
              <th className={th}>Factor (f)</th>
              <th className={th}>%</th>
              <th className={th}>%</th>
            </tr>
          </thead>
          <tbody>
            {entityRows("Std 1", 0, "std")}
            {entityRows("Std 2", 1, "std")}
            {entityRows("Sample 1", 0, "sample")}
            {entityRows("Sample 2", 1, "sample")}
            <tr className={groupTop}>
              <td className={cn(td, "font-medium")}>Average</td>
              <td className={td} colSpan={6} />
              <td className={cn(td, "font-semibold")} colSpan={2}>{out(calc.average, 4)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        {summaryRow("Average", pbzFixed(calc.average, 4), "% W/W")}
        {summaryRow("Density", density != null ? String(density) : "", <>g/cm<sup>3</sup></>)}
        {summaryRow("Report", pbzFixed(calc.report, 2), "% W/V")}
        {summaryRow("Date", new Date().toLocaleDateString("th-TH"), null)}
        {summaryRow("Analyst", analyst ?? "", null)}
      </div>
      <p className="text-xs text-muted-foreground">
        ช่องพื้นเทาคือช่องที่ต้องกรอก น้ำหนัก Std และ %Std ใช้ค่าล่าสุดจนกว่าจะเบิก Std PACLOBUTRAZOL ขวดใหม่ Sample ครั้งที่ 2 ใช้ค่าเดียวกับครั้งที่ 1
      </p>
    </div>
  );
}
