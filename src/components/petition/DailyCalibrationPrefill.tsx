import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { aiSubstanceFromKey, calculateAi, calculateCcsFromValues, formatCalculatedAi, CCS_CONC_LABEL, CCS_DIFFERENCE_LABEL, CCS_RESULT_LABEL, CORRELATION_LABEL, MID_LEVEL_STANDARD_LABEL } from "@/lib/aiCalculation";

const AREA_LABELS = ["Area Inj.1", "Area Inj.2", "Area Inj.3"];
export const DAILY_CALIBRATION_LABELS = [CORRELATION_LABEL, MID_LEVEL_STANDARD_LABEL, CCS_CONC_LABEL, ...AREA_LABELS];

type Props = {
  keys: string[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** ชื่อสามัญของรายการ ใช้จับคู่ Area Inj กรณีช่องไม่ได้แยกตามสาร */
  commonName?: string;
  /** key ของ Area Average / Area %RSD ให้คำนวณต่อหลังเติม Area Inj */
  areaDerivedKeys?: { key: string; kind: "areaAverage" | "areaRsd" }[];
};

const baseLabel = (key: string) => key.split("::", 1)[0];
const suffix = (key: string) => (key.includes("::") ? "::" + key.split("::")[1] : "");

/** ค่า r / Mid-level Standard / CCS Conc. / Area Inj.1-3: ครั้งแรกของวันกรอกเอง รายการหรือสารถัดไปใช้ค่าที่กรอกไว้แล้ววันนี้ */
export function DailyCalibrationPrefill({ keys, values, onChange, commonName = "", areaDerivedKeys = [] }: Props) {
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
        const isArea = AREA_LABELS.includes(baseLabel(key));
        // ลองชื่อสารจาก key ก่อน แล้วค่อยใช้ชื่อสามัญเต็ม (ผล Lab ที่ไม่ได้แยกช่องตามสารจะถูกเก็บด้วยชื่อสามัญ)
        const candidates = [aiSubstanceFromKey(key), isArea ? commonName.trim().toLowerCase() : ""].filter(Boolean);
        const value = candidates.map((name) => slot?.bySubstance?.[name]).find(Boolean) ?? (isArea ? undefined : slot?.any);
        if (!value) return false;
        next[key] = value;
        onChange(key, value);
        return true;
      });
      // เติม Mid-level / CCS แล้วคำนวณ % Difference และผล CCS ต่อทันที
      new Set(filled.filter((key) => baseLabel(key) !== CORRELATION_LABEL && !AREA_LABELS.includes(baseLabel(key))).map(suffix)).forEach((sfx) => {
        const ccs = calculateCcsFromValues(next, sfx.slice(2));
        onChange(CCS_DIFFERENCE_LABEL + sfx, ccs.difference == null ? "" : ccs.difference.toFixed(2));
        onChange(CCS_RESULT_LABEL + sfx, ccs.result);
      });
      // เติม Area Inj แล้วคำนวณ Area Average / %RSD ต่อทันที
      const areaSuffixes = new Set(filled.filter((key) => AREA_LABELS.includes(baseLabel(key))).map(suffix));
      areaDerivedKeys.filter(({ key }) => areaSuffixes.has(suffix(key))).forEach(({ key, kind }) => {
        const substance = aiSubstanceFromKey(key);
        onChange(key, formatCalculatedAi(calculateAi(next, 1, substance)[kind]));
      });
    }).catch(() => undefined);
  }, [keys, values, onChange, commonName, areaDerivedKeys]);
  return null;
}
