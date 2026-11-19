import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  PBZ_DIL_SAMPLE,
  PBZ_DIL_STD,
  PBZ_STD_PCT,
  calculatePaclobutrazol,
  pbzFixed,
  pbzKey,
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
  density?: number | null;
  header?: PaclobutrazolSheetHeader;
  analyst?: string;
};


// ใบคำนวณ PACLOBUTRAZOL ตามแบบฟอร์ม FM-QP-07-08-002 (อ่านอย่างเดียว คำนวณจากตารางกรอก)
export function PaclobutrazolSheet({ values, density = null, header, analyst }: Props) {
  const calc = calculatePaclobutrazol(values, density);

  const field = (key: string) => (
    <span className="block rounded-md bg-muted px-2 py-1 text-center tabular-nums">{String(values[key] ?? "") || "\u00a0"}</span>
  );
  // ค่าในตารางแสดงทศนิยม 2 ตำแหน่ง (คำนวณด้วยค่าเต็มเหมือน Excel)
  const input = (row: Row, col: Col) => {
    const raw = values[pbzKey(row, col)];
    const n = raw === "" || raw == null ? null : Number(raw);
    return (
      <span className="block rounded-md bg-muted px-2 py-1 text-center tabular-nums">
        {n != null && Number.isFinite(n) ? n.toFixed(2) : String(raw ?? "") || "\u00a0"}
      </span>
    );
  };
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
      <span className="w-24">{field(key)}</span>
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
    </div>
  );
}
