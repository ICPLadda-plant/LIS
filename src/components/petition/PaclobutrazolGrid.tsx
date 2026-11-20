import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { PBZ_COLS, PBZ_DIL_SAMPLE, PBZ_DIL_STD, PBZ_ROWS, PBZ_STD_PCT, isPbzReadOnly, pbzKey, pbzMirrorKey } from "@/lib/paclobutrazolFields";
import { PaclobutrazolSheet, type PaclobutrazolSheetHeader } from "./PaclobutrazolSheet";

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

export function PaclobutrazolGrid({ values, onChange, disabled, petitionId, density, header, analyst }: Props) {
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
    const isKeys = (["Std 1", "Std 2"] as const).flatMap((row) => [pbzKey(row, "Internal std 1"), pbzKey(row, "Internal std 2")]);
    const hasIs = isKeys.some((key) => String(values[key] ?? ""));
    if (hasWeights && hasPct && hasIs) return;
    api.getPaclobutrazolStdWeights(petitionId ?? "")
      .then((res) => {
        if (!hasWeights && res.std1) onChange(std1Key, res.std1);
        if (!hasWeights && res.std2) onChange(std2Key, res.std2);
        if (!hasPct && res.stdPct) onChange(PBZ_STD_PCT, res.stdPct);
        // Internal std ของ Std: ใช้ค่าที่กรอกแล้วในวันนี้ (ครั้งแรกของวันต้องกรอกเอง)
        if (!hasIs) isKeys.forEach((key) => { const v = res.internalStd?.[key]; if (v) onChange(key, v); });
      })
      .catch(() => undefined);
  }, [disabled, onChange, petitionId, std1Key, std2Key, values]);

  const handle = (key: string, val: string) => {
    onChange(key, val);
    const mirror = pbzMirrorKey(key);
    if (mirror) onChange(mirror, val);
  };

  const setting = (key: string, label: string, suffix?: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input className="h-8 w-24" inputMode="decimal" aria-label={label} value={String(values[key] ?? "")} disabled={disabled} onChange={(e) => onChange(key, e.target.value)} />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  );

  return (
    <div className="space-y-4 sm:col-span-6">
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {setting(PBZ_STD_PCT, "% Std =", "%")}
      {setting(PBZ_DIL_STD, "Dilution Std =")}
      {setting(PBZ_DIL_SAMPLE, "Dilution Sample =")}
    </div>
    <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium" />
            {PBZ_COLS.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-medium">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {PBZ_ROWS.map((row) => (
            <tr key={row}>
              <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">{row}</th>
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
        wt/mg ของ Std ใช้ค่าล่าสุดอัตโนมัติจนกว่าจะเบิก Std PACLOBUTRAZOL ขวดใหม่ · Internal std ของ Std ใช้ค่าที่กรอกแล้วในวันนี้ (ครั้งแรกของวันต้องกรอกเอง) · Sample ครั้งที่ 2 ใช้ค่าเดียวกับครั้งที่ 1
      </p>
    </div>
    <PaclobutrazolSheet values={values} density={density} header={header} analyst={analyst} />
    </div>
  );
}
