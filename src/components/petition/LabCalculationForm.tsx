import type { ReactNode } from "react";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import type { LabReportPage } from "@/lib/labReport";
import { CONTROL_HIGH_LABEL, CONTROL_LOW_LABEL, CONTROL_SAMPLE_LABEL } from "@/lib/aiCalculation";

export const LAB_CALCULATION_FORM_CODE = "FM-QP-07-08-002-R02 (02/11/69) P1/1";

export const LAB_CALCULATION_CSS = `
.brom-form-root, .brom-form-root * { box-sizing: border-box; color: #000; font-family: Tahoma, sans-serif; font-size: 8.5pt; line-height: 1.25; }
.brom-form-page { width: 297mm; min-height: 210mm; padding: 8mm 9mm 7mm; background: #fff; display: flex; flex-direction: column; }
.brom-form-top { display: grid; grid-template-columns: 30mm 1fr 30mm; align-items: center; }
.brom-form-logo { width: 26mm; height: auto; object-fit: contain; }
.brom-form-title { text-align: center; font-size: 13pt; font-weight: 700; }
.brom-form-bar { display: flex; align-items: center; gap: 6mm; margin-top: 2.5mm; padding: 1mm 1mm; background: #f2f2f2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.brom-form-row { display: flex; align-items: flex-end; gap: 3mm; margin-top: 2mm; padding: 0 1mm; }
.brom-form-label { white-space: nowrap; }
.brom-form-line { display: block; min-height: 5.5mm; padding: 0 1mm 0.6mm; border-bottom: .6pt solid #000; text-align: center; overflow-wrap: anywhere; }
.brom-form-row .brom-form-line { flex: 0 0 38mm; }
.brom-form-row .brom-form-grow { flex: 1 1 auto; }
.brom-form-grid { display: grid; column-gap: 12mm; margin-top: 2mm; }
.brom-form-grid-5 { grid-template-columns: repeat(5, 1fr); }
.brom-form-grid-4 { grid-template-columns: repeat(4, 1fr); }
.brom-form-cell { text-align: center; }
.brom-form-cell .brom-form-line { margin-top: 3mm; }
.brom-form-check { display: inline-flex; align-items: center; gap: 1.5mm; }
.brom-form-box { display: inline-block; width: 3.2mm; height: 3.2mm; border: .6pt solid #000; background: #fff; text-align: center; line-height: 3mm; font-weight: 700; }
.brom-form-summary { display: grid; grid-template-columns: auto 1fr auto auto 1fr auto auto 1fr auto; align-items: end; column-gap: 4mm; margin-top: 7mm; padding: 0 6mm; }
.brom-form-signatures { display: grid; grid-template-columns: 1fr 1fr; align-items: start; column-gap: 18mm; margin-top: 12mm; padding: 0 6mm; }
.brom-form-sign { display: grid; grid-template-columns: auto 1fr; align-items: end; column-gap: 6mm; }
.brom-form-sign-role { grid-column: 1; grid-row: 2; text-align: center; margin-top: 2mm; }
.brom-form-sign-name { grid-column: 2; grid-row: 2; text-align: center; margin-top: 1.5mm; }
.brom-form-footer { margin-top: auto; padding-top: 6mm; font-size: 8pt; }
@media screen { .brom-form-page { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
`;

const BLANK = /^[-–—]?$/;

function values(page: LabReportPage, pattern: RegExp): string[] {
  return (page.rows ?? [])
    .filter((row) => pattern.test(row.testItem))
    .map((row) => row.result?.trim() ?? "")
    .filter((v) => !BLANK.test(v));
}

function firstValue(page: LabReportPage, pattern: RegExp, fallback = "") {
  return values(page, pattern)[0] || fallback;
}

/** แยกชื่อตัวอย่าง เช่น "OMETHOATE 50% SL" → ชื่อสามัญ / สูตร / รูปแบบ */
export function parseSampleName(name: string): { commonName: string; strength: string; form: string } {
  const clean = (name || "").trim();
  const m = clean.match(/^(.*?)\s+([\d.,]+)\s*%\s*(.*)$/);
  if (!m) return { commonName: clean || "-", strength: "-", form: "-" };
  return { commonName: m[1].trim() || "-", strength: m[2], form: m[3].trim() || "-" };
}

const AREA_INJ = /^Area\s*Inj/i;
const SAMPLE_N = /^%\s*Sample\s*\d/i;

/** หน้าไหนมีข้อมูลพอสำหรับใบคำนวณ (มีค่า Area Inj หรือ % Sample) */
export function hasCalculationData(page: LabReportPage): boolean {
  return values(page, AREA_INJ).length > 0 || values(page, SAMPLE_N).length > 0;
}

function triple(list: string[]): string[] {
  return [0, 1, 2].map((i) => list[i] || "");
}

// ค่าที่กรอกในหน้าการทดสอบ Lab อาจมีต่อท้าย " · รายการที่ n" — จับเฉพาะต้นชื่อช่อง
function labelPattern(label: string) {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*·|\\s*\\(|$)`, "i");
}

const toNumber = (value: string) => {
  const n = Number(value.replace(/,/g, ""));
  return value && Number.isFinite(n) ? n : null;
};

// % Difference ของ CCS เทียบกับ Mid-level Standard = |CCS − Mid| / Mid × 100
export function ccsDifference(mid: string, ccs: string): string {
  const m = toNumber(mid);
  const c = toNumber(ccs);
  if (m == null || c == null || m === 0) return "";
  return ((Math.abs(c - m) / m) * 100).toFixed(2);
}

// ผล Control sample: อยู่ในช่วงเกณฑ์ยอมรับ = ผ่าน
export function controlResult(value: string, low: string, high: string): string {
  const v = toNumber(value);
  const lo = toNumber(low);
  const hi = toNumber(high);
  if (v == null || lo == null || hi == null) return "";
  return v >= Math.min(lo, hi) && v <= Math.max(lo, hi) ? "ผ่าน" : "ไม่ผ่าน";
}

// "ไม่พบ" ต้องเช็กก่อน "พบ" เพราะมีคำว่าพบอยู่ข้างใน
function solventBlankFinding(value: string): "found" | "not-found" | "" {
  if (/ไม่พบ|not\s*(found|detect)|no\s*peak/i.test(value)) return "not-found";
  if (/พบ|found|detect/i.test(value)) return "found";
  return "";
}

const name = (value?: string) => (value && !BLANK.test(value.trim()) ? value.trim() : "");

function Field({ label, value, grow = false, field }: { label: ReactNode; value?: string; grow?: boolean; field?: string }) {
  return <><span className="brom-form-label">{label}</span><span className={grow ? "brom-form-line brom-form-grow" : "brom-form-line"} data-field={field}>{value}</span></>;
}

function Columns({ labels, items, field }: { labels: string[]; items: string[]; field: string }) {
  return (
    <div className={`brom-form-grid brom-form-grid-${labels.length}`}>
      {labels.map((label, index) => <div className="brom-form-cell" key={label}>{label}<span className="brom-form-line" data-field={`${field}-${index}`}>{items[index]}</span></div>)}
    </div>
  );
}

function Check({ checked, label, field }: { checked: boolean; label: string; field: string }) {
  return <span className="brom-form-check"><span className="brom-form-box" data-field={field}>{checked ? "✓" : ""}</span>{label}</span>;
}

/** ใบคำนวณผลวิเคราะห์ FM-QP-07-08-002-R02 (A4 แนวนอน) */
export default function LabCalculationForm({ page }: { page: LabReportPage }) {
  const aiResult = firstValue(page, /^%\s*AI/i);
  const area = [
    ...triple(values(page, AREA_INJ)),
    firstValue(page, /^Area\s*Av/i),
    firstValue(page, /^Area\s*%?\s*RSD/i),
  ];
  const sampleAverage = firstValue(page, /^%\s*Sample\s*Av/i, aiResult);
  const sample = [
    ...triple(values(page, SAMPLE_N)),
    sampleAverage,
    firstValue(page, /^%\s*Sample\s*%?\s*RSD/i),
  ];
  const standardNo = (page.rows ?? []).filter((row) => /standard/i.test(row.testItem) && !/conc|mid/i.test(row.testItem))
    .map((row) => row.result?.trim() ?? "").find((v) => !BLANK.test(v)) ?? "";
  const correlation = firstValue(page, /correlation|^r(\s*·|\s*\(|$)/i);
  const midConc = firstValue(page, /mid[-\s]*level/i);
  const ccsConc = firstValue(page, /^ccs\s*conc/i);
  const ccs = {
    mid: midConc,
    conc: ccsConc,
    diff: firstValue(page, /difference|%\s*diff/i) || ccsDifference(midConc, ccsConc),
    result: firstValue(page, /^ccs\s*result/i),
  };
  const blank = solventBlankFinding(firstValue(page, /solvent\s*blank/i));
  // Control Sample + ช่วงยอมรับ มาจากผลที่บันทึกในหน้าการทดสอบ Lab
  const control = {
    value: firstValue(page, labelPattern(CONTROL_SAMPLE_LABEL)),
    low: firstValue(page, labelPattern(CONTROL_LOW_LABEL)),
    high: firstValue(page, labelPattern(CONTROL_HIGH_LABEL)),
  };
  const controlRange = control.low && control.high ? `${control.low} - ${control.high}` : control.low || control.high;
  const testedDate = name(page.sample.testedDate);

  return (
    <div className="brom-form-root">
      <style>{LAB_CALCULATION_CSS}</style>
      <section className="brom-form-page">
        <div className="brom-form-top"><img className="brom-form-logo" src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" /><div className="brom-form-title">ใบคำนวณผลวิเคราะห์</div></div>

        <div className="brom-form-bar">Sample</div>
        <div className="brom-form-row">
          <Field label="ตัวอย่างเลขที่ :" value={name(page.sample.submissionNo)} field="sampleNo" />
          <Field grow label="ชื่อสามัญ (sample name)" value={name(page.sample.name)} field="sampleName" />
          <Field label="วันที่วิเคราะห์" value={testedDate} field="testedDate" />
        </div>

        <div className="brom-form-bar">Calibration Curve</div>
        <div className="brom-form-row">
          <Field grow label="เลขที่ Standard" value={standardNo} field="standardNo" />
          <Field grow label="ค่า Correlation coefficient ( r ) ที่ได้" value={correlation} field="correlation" />
          <span className="brom-form-label" style={{ marginLeft: "8mm" }}>เกณฑ์</span><span className="brom-form-label" style={{ marginLeft: "6mm" }}>r ≥ 0.995</span>
        </div>

        <div className="brom-form-bar">System Suitability Test</div>
        <Columns labels={["Area Inj. 1", "Area Inj. 2", "Area Inj. 3", "Average", "%RSD (ไม่เกิน 2%)"]} items={area} field="area" />

        <div className="brom-form-bar">Continuing Calibration Standard Test ; CCS</div>
        <Columns labels={["Mid-level Standard Conc. (mg/mL)", "CCS Conc. (mg/mL)", "% Difference", "Result"]} items={[ccs.mid, ccs.conc, ccs.diff, ccs.result]} field="ccs" />

        <div className="brom-form-bar" style={{ marginTop: "4mm" }}>
          <span style={{ width: "30mm" }}>Solvent Blank</span>
          <Check checked={blank === "found"} label="พบ Peak สารที่วิเคราะห์" field="blankFound" />
          <span style={{ marginLeft: "40mm" }}><Check checked={blank === "not-found"} label="ไม่พบ Peak สารที่วิเคราะห์" field="blankNotFound" /></span>
        </div>

        <div className="brom-form-bar">Control sample Test</div>
        <div className="brom-form-row">
          <Field grow label="%Ai (W/W)" value={control.value} field="controlValue" />
          <Field grow label="ช่วงเกณฑ์การยอมรับ" value={controlRange} field="controlRange" />
          <Field label="Result" value={firstValue(page, /^control\s*result/i) || controlResult(control.value, control.low, control.high)} field="controlResult" />
        </div>

        <div className="brom-form-bar">Analytical Results</div>
        <Columns labels={["%Sample 1", "%Sample 2", "%Sample 3", "Average", "%RSD (ไม่เกิน 5)"]} items={sample} field="sample" />

        <div className="brom-form-summary">
          <span>Average</span><span className="brom-form-line" data-field="average">{sampleAverage}</span><span>%W/W</span>
          <span>Density (T<sub style={{ fontSize: "6pt" }}>30°C</sub>)</span><span className="brom-form-line" data-field="density">{firstValue(page, /density|ถ\.?\s*พ\.?/i, "1.000")}</span><span>g/cm3</span>
          <span>Report</span><span className="brom-form-line" data-field="report">{aiResult}</span><span>%W/V</span>
        </div>

        <div className="brom-form-signatures">
          <div className="brom-form-sign"><span>Analyst</span><span className="brom-form-line" /><span className="brom-form-sign-name" data-field="analyst">{name(page.analystName)}</span></div>
          <div className="brom-form-sign"><span>Approved</span><span className="brom-form-line" /><span className="brom-form-sign-role">(หัวหน้าห้องปฏิบัติการ)</span><span className="brom-form-sign-name" data-field="approved">{name(page.labHeadName)}</span></div>
        </div>
        <div className="brom-form-footer">{LAB_CALCULATION_FORM_CODE}</div>
      </section>
    </div>
  );
}
