import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type LabCalcStepField = { key: string; label: string; readOnly?: boolean; hint?: string; suffix?: string };
export type LabCalcStepResult = { label: string; value: string; emphasis?: boolean };
export type LabCalcStepSample = { name: string; fields: LabCalcStepField[]; results?: LabCalcStepResult[] };

type Props = {
  samples: LabCalcStepSample[];
  values: Record<string, unknown>;
  onFieldChange: (key: string, value: string) => void;
  disabled?: boolean;
  /** ช่องที่ใช้ร่วมกันทุก Sample เช่น Conc / Blank */
  settings?: LabCalcStepField[];
  settingsTitle?: string;
  /** สรุปผลรวมใต้การ์ด เช่น Average / Report */
  summary?: ReactNode;
  /** ควบคุมลำดับ Sample จากภายนอก (แถบล่างของหน้า) */
  index?: number;
  onIndexChange?: (index: number) => void;
  /** แสดงปุ่มก่อนหน้า/ถัดไปในการ์ด เมื่อไม่มีแถบล่าง */
  inlineNav?: boolean;
};

/** มุมมองมือถือ (< md): กรอกใบคำนวณทีละ Sample เป็นการ์ด ค่าทั้งหมดยังเก็บที่ state ของหน้า */
export function LabCalcSampleStepper({ samples, values, onFieldChange, disabled, settings, settingsTitle = "ค่าที่ใช้ร่วมกัน", summary, index, onIndexChange, inlineNav }: Props) {
  const baseId = useId();
  const [ownIndex, setOwnIndex] = useState(0);
  const total = samples.length;
  const current = Math.min(Math.max(index ?? ownIndex, 0), Math.max(total - 1, 0));
  const go = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), total - 1);
    setOwnIndex(clamped);
    onIndexChange?.(clamped);
  };
  useEffect(() => {
    if (index != null && index !== current) onIndexChange?.(current);
  }, [current, index, onIndexChange]);
  if (!total) return null;
  const sample = samples[current];

  const field = (f: LabCalcStepField) => {
    const id = baseId + "-" + f.key.replace(/\W+/g, "-");
    return (
      <div key={f.key} className="space-y-1.5">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {f.label}
          {f.suffix && <span className="ml-1 font-normal text-muted-foreground">({f.suffix})</span>}
        </Label>
        <Input
          id={id}
          className="h-11 w-full text-base"
          inputMode="decimal"
          value={String(values[f.key] ?? "")}
          disabled={disabled || f.readOnly}
          onChange={(e) => onFieldChange(f.key, e.target.value)}
        />
        {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-3 md:hidden" data-testid="lab-calc-stepper">
      {settings && settings.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          <p className="text-sm font-semibold text-foreground">{settingsTitle}</p>
          {settings.map(field)}
        </div>
      )}
      <Card className="space-y-4 p-4" role="group" aria-label={sample.name + " (" + (current + 1) + " / " + total + ")"}>
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-base font-semibold text-foreground">{sample.name}</h5>
          <Badge variant="gray-soft" className="tabular-nums">{current + 1} / {total}</Badge>
        </div>
        <div className="space-y-3">{sample.fields.map(field)}</div>
        {sample.results && sample.results.length > 0 && (
          <dl className="space-y-2 rounded-md bg-muted p-3 text-sm">
            {sample.results.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className={r.emphasis ? "text-base font-semibold tabular-nums text-foreground" : "tabular-nums text-foreground"}>{r.value || "-"}</dd>
              </div>
            ))}
          </dl>
        )}
        {inlineNav && total > 1 && (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="gap-1" disabled={current === 0} onClick={() => go(current - 1)}>
              <ChevronLeft className="h-4 w-4" />Sample ก่อนหน้า
            </Button>
            <Button type="button" variant="outline" className="gap-1" disabled={current >= total - 1} onClick={() => go(current + 1)}>
              Sample ถัดไป<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </Card>
      {summary}
    </div>
  );
}
