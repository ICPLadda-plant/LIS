import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { PBZ_COLS, PBZ_DIL_SAMPLE, PBZ_DIL_STD, PBZ_ROWS, PBZ_STD_PCT, calculatePaclobutrazol, isPbzReadOnly, pbzFixed, pbzKey, pbzMirrorKey } from "@/lib/paclobutrazolFields";
import { PaclobutrazolSheet, type PaclobutrazolSheetHeader } from "./PaclobutrazolSheet";
import { LabCalcSampleStepper, type LabCalcStepResult } from "./LabCalcSampleStepper";

type Props = {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  petitionId?: string;
  density?: number | null;
  header?: PaclobutrazolSheetHeader;
  analyst?: string;
  /** ลำดับแถว (Std/Sample) ที่แสดงบนมือถือ (ควบคุมจากแถบล่างของหน้า) */
  mobileIndex?: number;
  onMobileIndexChange?: (index: number) => void;
  mobileInlineNav?: boolean;
};

const DEFAULT_DILUTION = "50";

export function PaclobutrazolGrid({ values, onChange, disabled, petitionId, density, header, analyst, mobileIndex, onMobileIndexChange, mobileInlineNav }: Props) {
  const prefilled = useRef(false);
  const std1Key = pbzKey("Std 1", "wt/mg");
  const std2Key = pbzKey("Std 2", "wt/mg");

  // A1/B1: ใช้น้ำหนัก Std ล่าสุดจนกว่าจะเบิก Std PACLOBUTRAZOL ขวดใหม่
  useEffect(() => {
    if (prefilled.current || disabled) return;
    prefilled.current = true;
    if (!String(values[PBZ_DIL_STD] ?? "")) onChange(PBZ_DIL_STD, DEFAULT_DILUTION);
    if (!String(values[PBZ_DIL_SAMPLE] ?? "")) onChange(PBZ_DIL_SAMPLE, DEFAULT_DILUTION);
    const hasWeights = Boolean(String(values[std1Key] ?? "") || String(values[std2Key] ?? ""));
    const hasPct = Boolean(String(values[PBZ_STD_PCT] ?? ""));
    const isKeys = (["Std 1", "Std 2"] as const).flatMap((row) => (["Peak area 1", "Internal std 1", "Peak area 2", "Internal std 2"] as const).map((col) => pbzKey(row, col)));
    const missingIs = isKeys.filter((key) => !String(values[key] ?? ""));
    if (hasWeights && hasPct && !missingIs.length) return;
    api.getPaclobutrazolStdWeights(petitionId ?? "", header?.commonName ?? "")
      .then((res) => {
        if (!hasWeights && res.std1) onChange(std1Key, res.std1);
        if (!hasWeights && res.std2) onChange(std2Key, res.std2);
        if (!hasPct && res.stdPct) onChange(PBZ_STD_PCT, res.stdPct);
        // Peak area / Internal std ของ Std: ใช้ค่าที่กรอกแล้วในวันนี้ (ครั้งแรกของวันต้องกรอกเอง)
        missingIs.forEach((key) => { const v = res.internalStd?.[key]; if (v) onChange(key, v); });
      })
      .catch(() => undefined);
  }, [disabled, header?.commonName, onChange, petitionId, std1Key, std2Key, values]);

  const handle = (key: string, val: string) => {
    onChange(key, val);
    const mirror = pbzMirrorKey(key);
    if (mirror) onChange(mirror, val);
  };
  const calc = calculatePaclobutrazol(values, density ?? null);

  const setting = (key: string, label: string, suffix?: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input className="h-8 w-24" inputMode="decimal" aria-label={label} value={String(values[key] ?? "")} disabled={disabled} onChange={(e) => onChange(key, e.target.value)} />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  );

  return (
    <div className="space-y-4 sm:col-span-6">
    <section className="space-y-3 rounded-lg border border-indigo-200 border-l-4 border-l-indigo-400 bg-indigo-50 p-3 shadow-sm dark:bg-indigo-950/60">
    <h4 className="text-base font-semibold text-foreground">ตาราง Internal standard</h4>
    <div className="hidden md:flex flex-wrap gap-x-6 gap-y-2">
      {setting(PBZ_STD_PCT, "% Std =", "%")}
      {setting(PBZ_DIL_STD, "Dilution Std =")}
      {setting(PBZ_DIL_SAMPLE, "Dilution Sample =")}
    </div>
    <LabCalcSampleStepper
      values={values}
      onFieldChange={handle}
      disabled={disabled}
      index={mobileIndex}
      onIndexChange={onMobileIndexChange}
      inlineNav={mobileInlineNav}
      settings={[
        { key: PBZ_STD_PCT, label: "% Std", suffix: "%" },
        { key: PBZ_DIL_STD, label: "Dilution Std" },
        { key: PBZ_DIL_SAMPLE, label: "Dilution Sample" },
      ]}
      samples={PBZ_ROWS.map((row) => {
        const results: LabCalcStepResult[] = [];
        if (calc) {
          if (row.startsWith("Std")) {
            const s = calc.std[row === "Std 1" ? 0 : 1];
            results.push({ label: "Conc", value: pbzFixed(s.conc, 4) }, ...s.inj.map((inj, i) => ({ label: "fi ครั้งที่ " + (i + 1), value: pbzFixed(inj.fi, 6) })));
          } else {
            const s = calc.sample[row === "Sample 1" ? 0 : 1];
            results.push({ label: "Conc", value: pbzFixed(s.conc, 4) }, ...s.inj.map((inj, i) => ({ label: "%W/W ครั้งที่ " + (i + 1), value: pbzFixed(inj.content, 4) })), { label: "%W/W เฉลี่ย", value: pbzFixed(s.meanContent, 4), emphasis: true });
          }
        }
        return {
          name: row,
          fields: PBZ_COLS.map((col) => ({ key: pbzKey(row, col), label: col, readOnly: isPbzReadOnly(row, col), hint: isPbzReadOnly(row, col) ? "ใช้ค่าเดียวกับครั้งที่ 1" : undefined })),
          results,
        };
      })}
    />
    <div className="hidden md:block overflow-x-auto rounded-lg border border-indigo-200 bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-indigo-100 text-indigo-900 dark:bg-indigo-900/60 dark:text-indigo-100">
          <tr>
            <th className="px-3 py-2 text-left font-medium" />
            {PBZ_COLS.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-medium">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {PBZ_ROWS.map((row) => (
            <tr key={row} className={row.startsWith("Std") ? "bg-sky-50 dark:bg-sky-950/40" : "bg-emerald-50 dark:bg-emerald-950/40"}>
              <th scope="row" className={`px-3 py-2 text-left font-medium ${row.startsWith("Std") ? "text-sky-800 dark:text-sky-200" : "text-emerald-800 dark:text-emerald-200"}`}>{row}</th>
              {PBZ_COLS.map((col) => {
                const key = pbzKey(row, col);
                const readOnly = isPbzReadOnly(row, col);
                return (
                  <td key={col} className="px-2 py-1.5">
                    <Input
                      aria-label={`${row} ${col}`}
                      inputMode="decimal"
                      value={String(values[key] ?? "")}
                      disabled={disabled || readOnly}
                      title={readOnly ? "ใช้ค่าเดียวกับครั้งที่ 1" : undefined}
                      onChange={(e) => handle(key, e.target.value)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-muted-foreground">
        wt/mg ของ Std ใช้ค่าล่าสุดอัตโนมัติจนกว่าจะเบิก Std PACLOBUTRAZOL ขวดใหม่ · Peak area และ Internal std ของ Std ใช้ค่าที่กรอกแล้วในวันนี้ (ครั้งแรกของวันต้องกรอกเอง) · Sample ครั้งที่ 2 ใช้ค่าเดียวกับครั้งที่ 1
      </p>
    </div>
    </section>
    <PaclobutrazolSheet values={values} density={density} header={header} analyst={analyst} />
    </div>
  );
}
