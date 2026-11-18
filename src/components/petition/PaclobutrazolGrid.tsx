import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { PBZ_COLS, PBZ_ROWS, isPbzReadOnly, pbzKey, pbzMirrorKey } from "@/lib/paclobutrazolFields";

type Props = {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  petitionId?: string;
};

export function PaclobutrazolGrid({ values, onChange, disabled, petitionId }: Props) {
  const prefilled = useRef(false);
  const std1Key = pbzKey("Std 1", "wt/mg");
  const std2Key = pbzKey("Std 2", "wt/mg");

  // A1/B1: ใช้น้ำหนัก Std ล่าสุดจนกว่าจะเบิก Std PACLOBUTRAZOL ขวดใหม่
  useEffect(() => {
    if (prefilled.current || disabled) return;
    if (String(values[std1Key] ?? "") || String(values[std2Key] ?? "")) return;
    prefilled.current = true;
    api.getPaclobutrazolStdWeights(petitionId ?? "")
      .then((res) => {
        if (res.std1) onChange(std1Key, res.std1);
        if (res.std2) onChange(std2Key, res.std2);
      })
      .catch(() => undefined);
  }, [disabled, onChange, petitionId, std1Key, std2Key, values]);

  const handle = (key: string, val: string) => {
    onChange(key, val);
    const mirror = pbzMirrorKey(key);
    if (mirror) onChange(mirror, val);
  };

  return (
    <div className="overflow-x-auto rounded-lg border bg-card shadow-sm sm:col-span-6">
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
        wt/mg ของ Std ใช้ค่าล่าสุดอัตโนมัติจนกว่าจะเบิก Std PACLOBUTRAZOL ขวดใหม่ · Sample ครั้งที่ 2 ใช้ค่าเดียวกับครั้งที่ 1
      </p>
    </div>
  );
}
