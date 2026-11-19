import type { ReactNode } from "react";
import type { LabReportPage } from "@/lib/labReport";
import { PBZ_DIL_SAMPLE, PBZ_DIL_STD, PBZ_STD_PCT, calculatePaclobutrazol, pbzFixed, pbzKey } from "@/lib/paclobutrazolFields";

export const PBZ_PRINT_FORM_CODE = "FM-QP-07-08-002-R01 (16/12/67) P1/1";

/** ค่าที่กรอกในตาราง PACLOBUTRAZOL (แถว "PBZ ...") ของหน้ารายงาน */
export function paclobutrazolValues(page: LabReportPage): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const row of page.rows ?? []) {
    const key = row.testItem.split(" · ")[0].trim();
    if (!key.startsWith("PBZ ") || key in out) continue;
    const v = (row.result ?? "").trim();
    out[key] = v === "-" ? "" : v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export const PBZ_PRINT_CSS = `
.pbz-print-page { width: 297mm; min-height: 210mm; padding: 12mm 14mm 8mm; background: #fff; display: flex; flex-direction: column; color: #000; font-family: "Times New Roman", Tahoma, serif; font-size: 10pt; }
.pbz-print-page * { box-sizing: border-box; color: #000; }
.pbz-print-head { display: grid; grid-template-columns: 34mm 26mm 24mm 34mm 24mm 46mm 14mm 16mm 10mm 10mm; align-items: center; row-gap: 1.5mm; }
.pbz-print-head b { font-weight: 700; }
.pbz-print-grey, .pbz-print-table td.g { background: #d9d9d9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pbz-print-box { display: block; padding: 1mm 2mm; text-align: center; }
.pbz-print-table { width: 236mm; margin-top: 1mm; border-collapse: collapse; table-layout: fixed; }
.pbz-print-table td { border: .6pt solid #000; height: 7.5mm; padding: 0 1.5mm; text-align: center; vertical-align: middle; font-variant-numeric: tabular-nums; }
.pbz-print-table tr.top td { border-top: 1.4pt solid #000; }
.pbz-print-sum { display: grid; grid-template-columns: 28mm 52mm 30mm; align-items: end; row-gap: 2.5mm; margin: 10mm 0 0 8mm; }
.pbz-print-sum .lbl { text-align: center; }
.pbz-print-sum .line { min-height: 6mm; border-bottom: 1pt solid #000; text-align: center; }
.pbz-print-sign { display: grid; grid-template-columns: 28mm 52mm 30mm 40mm 70mm; align-items: end; margin: 2.5mm 0 0 8mm; row-gap: 1.5mm; }
.pbz-print-sign .line { min-height: 6mm; border-bottom: 1pt solid #000; text-align: center; }
.pbz-print-footer { margin-top: auto; padding-top: 8mm; font-family: Tahoma, sans-serif; font-size: 9pt; }
@media screen { .pbz-print-page { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
`;

const num = (v: string | undefined) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
const fix = (v: string | undefined, digits: number) => {
  const n = num(v);
  return n == null ? (v ?? "") : n.toFixed(digits);
};

type Props = { page: LabReportPage; values: Record<string, string> };

/** ใบคำนวณ PACLOBUTRAZOL FM-QP-07-08-002-R01 ตามแบบ Excel (A4 แนวนอน) */
export function PaclobutrazolPrintSheet({ page, values }: Props) {
  const densityRaw = (page.rows ?? []).find((row) => /density|ถ\.?\s*พ\.?/i.test(row.testItem))?.result?.trim();
  const density = num(densityRaw && densityRaw !== "-" ? densityRaw : undefined);
  const calc = calculatePaclobutrazol(values, density);
  const sampleName = page.sample.name || "";
  const formula = /(\d+(?:\.\d+)?)\s*%\s*([A-Z]{2,3})\b/i.exec(sampleName);
  const common = sampleName.replace(/\s*\d+(?:\.\d+)?\s*%.*$/, "").trim() || sampleName;
  const v = (key: string, digits = 2) => fix(values[key], digits);

  const block = (label: string, kind: "std" | "sample", index: 0 | 1): ReactNode => {
    const row = kind === "std" ? (index === 0 ? "Std 1" : "Std 2") : (index === 0 ? "Sample 1" : "Sample 2");
    const data = kind === "std" ? calc.std[index] : calc.sample[index];
    return ([0, 1] as const).map((inj) => {
      const area = pbzKey(row, inj === 0 ? "Peak area 1" : "Peak area 2");
      const is = pbzKey(row, inj === 0 ? "Internal std 1" : "Internal std 2");
      const s = kind === "std";
      return (
        <tr key={`${row}-${inj}`} className={inj === 0 ? "top" : undefined}>
          <td className={inj === 1 ? "g" : undefined}>{inj === 0 ? label : v(pbzKey(row, "wt/mg"))}</td>
          <td className={s ? "g" : undefined}>{s ? v(area) : ""}</td>
          <td className={s ? undefined : "g"}>{s ? "" : v(area)}</td>
          <td className={inj === 0 ? "g" : undefined}>{inj === 0 ? pbzFixed(data.conc, 3) : ""}</td>
          <td className="g">{v(is)}</td>
          <td className={s ? "g" : undefined}>{s ? pbzFixed(calc.std[index].inj[inj].fi, 4) : ""}</td>
          <td>{s && index === 0 && inj === 1 ? pbzFixed(calc.meanFactor, 4) : ""}</td>
          <td className={s ? undefined : "g"}>{s ? "" : pbzFixed(calc.sample[index].inj[inj].content, 4)}</td>
          <td className={!s && inj === 1 ? "g" : undefined}>{!s && inj === 1 ? pbzFixed(calc.sample[index].meanContent, 4) : ""}</td>
        </tr>
      );
    });
  };

  const name = (n: string) => (n && n !== "-" ? `(......${n}......)` : "(..............................)");

  return (
    <section className="pbz-print-page">
      <div className="pbz-print-head">
        <b>ตัวอย่างเลขที่</b><b>{page.sample.sampleNo || page.sample.submissionNo}</b><b>ชื่อการค้า</b><span>-</span>
        <b>ชื่อสามัญ</b><b>{common}</b><b>สูตร</b><b>{formula?.[1] ?? ""}</b><b>%</b><b>{formula?.[2]?.toUpperCase() ?? ""}</b>
        <span /><span style={{ textAlign: "right" }}>% Std =</span><span className="pbz-print-grey pbz-print-box">{v(PBZ_STD_PCT)}</span>
        <span>%&nbsp;&nbsp;Dilution Std =</span><span className="pbz-print-grey pbz-print-box">{values[PBZ_DIL_STD] ?? ""}</span>
        <span style={{ textAlign: "right" }}>Dilution Sample =</span><span /><span className="pbz-print-grey pbz-print-box">{values[PBZ_DIL_SAMPLE] ?? ""}</span>
      </div>
      <table className="pbz-print-table">
        <colgroup>
          <col style={{ width: "28mm" }} /><col style={{ width: "22mm" }} /><col style={{ width: "21mm" }} /><col style={{ width: "11mm" }} />
          <col style={{ width: "27mm" }} /><col style={{ width: "28mm" }} /><col style={{ width: "14mm" }} /><col style={{ width: "14mm" }} /><col style={{ width: "19mm" }} />
        </colgroup>
        <tbody>
          <tr><td>Weight Std</td><td>Peak aera</td><td>Peak area sample</td><td>Conc</td><td>Peak area Internol</td><td>Resolution</td><td>Mean</td><td>Content</td><td>Mean Content</td></tr>
          <tr><td>Sample</td><td>Standard</td><td /><td>mg/mL</td><td>Standard</td><td>Factor (fi)</td><td>Factor (f)</td><td>%</td><td>%</td></tr>
          {block("Std1", "std", 0)}
          {block("Std 2", "std", 1)}
          {block("Sample1", "sample", 0)}
          {block("Sample 2", "sample", 1)}
          <tr className="top"><td>Average</td><td colSpan={5} /><td colSpan={3}>{pbzFixed(calc.average, 4)}</td></tr>
        </tbody>
      </table>
      <div className="pbz-print-sum">
        <span className="lbl">Average</span><span className="line">{pbzFixed(calc.average, 4)}</span><span>% W/W</span>
        <span className="lbl">Density</span><span className="line">{density == null ? "" : density.toFixed(3)}</span><span>g/cm<sup>3</sup></span>
        <span className="lbl">Report</span><span className="line">{pbzFixed(calc.report, 2)}</span><span>% W/V</span>
        <span className="lbl">Date</span><span className="line">{page.sample.testedDate && page.sample.testedDate !== "-" ? page.sample.testedDate : ""}</span><span />
      </div>
      <div className="pbz-print-sign">
        <span style={{ textAlign: "center" }}>Analyst</span><span className="line" /><span /><span style={{ textAlign: "right", paddingRight: "4mm" }}>Approved</span><span className="line" />
        <span /><span style={{ textAlign: "center" }}>{name(page.analystName)}</span><span /><span /><span style={{ textAlign: "center" }}>{name(page.labHeadName)}</span>
      </div>
      <div className="pbz-print-footer">{PBZ_PRINT_FORM_CODE}</div>
    </section>
  );
}

