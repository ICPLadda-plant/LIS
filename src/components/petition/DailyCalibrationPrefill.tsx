import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { aiSubstanceFromKey, calculateCcsFromValues, CCS_CONC_LABEL, CCS_DIFFERENCE_LABEL, CCS_RESULT_LABEL, CORRELATION_LABEL, MID_LEVEL_STANDARD_LABEL } from "@/lib/aiCalculation";

export const DAILY_CALIBRATION_LABELS = [CORRELATION_LABEL, MID_LEVEL_STANDARD_LABEL, CCS_CONC_LABEL];

type Props = {
  keys: string[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
};

const baseLabel = (key: string) => key.split("::", 1)[0];
const suffix = (key: string) => (key.includes("::") ? "::" + key.split("::")[1] : "");

/** ค่า r / Mid-level Standard / CCS Conc.: ครั้งแรกของวันกรอกเอง รายการหรือสารถัดไปใช้ค่าที่กรอกไว้แล้ววันนี้ */
export function DailyCalibrationPrefill({ keys, values, onChange }: Props) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const missing = keys.filter((key) => DAILY_CALIBRATION_LABELS.includes(baseLabel(key)) && !String(values[key] ?? "").trim());
    if (!missing.length) return;
    api.getDailyCalibration().then((daily) => {
      const next = { ...values };
      const filled = missing.filter((key) => {
        const slot = daily?.[baseLabel(key)];
        const value = slot?.bySubstance?.[aiSubstanceFromKey(key)] ?? slot?.any;
        if (!value) return false;
        next[key] = value;
        onChange(key, value);
        return true;
      });
      // เติม Mid-level / CCS แล้วคำนวณ % Difference และผล CCS ต่อทันที
      new Set(filled.filter((key) => baseLabel(key) !== CORRELATION_LABEL).map(suffix)).forEach((sfx) => {
        const ccs = calculateCcsFromValues(next, sfx.slice(2));
        onChange(CCS_DIFFERENCE_LABEL + sfx, ccs.difference == null ? "" : ccs.difference.toFixed(2));
        onChange(CCS_RESULT_LABEL + sfx, ccs.result);
      });
    }).catch(() => undefined);
  }, [keys, values, onChange]);
  return null;
}
