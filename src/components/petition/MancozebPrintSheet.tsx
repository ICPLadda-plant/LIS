import type { LabReportPage } from "@/lib/labReport";
import { MCZ_BLANK, MCZ_CONC, MCZ_FACTOR, calculateMancozeb, mczFixed, mczKey } from "@/lib/mancozebFields";
import { PBZ_PRINT_FORM_CODE } from "./PaclobutrazolPrintSheet";

/** ค่าที่กรอกในใบคำนวณ MANCOZEB (แถว "MCZ ...") ของหน้ารายงาน */
export function mancozebValues(page: LabReportPage): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const row of page.rows ?? []) {
    const key = row.testItem.split(" · ")[0].trim();
    if (!key.startsWith("MCZ ") || key in out) continue;
    const v = (row.result ?? "").trim();
    out[key] = v === "-" ? "" : v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export const MCZ_PRINT_CSS = `
.mcz-page { width: 297mm; min-height: 210mm; padding: 14mm 12mm 8mm; background: #fff; display: flex; flex-direction: column; color: #000; font-family: "Times New Roman", Tahoma, serif; font-size: 10pt; }
.mcz-page * { box-sizing: border-box; color: #000; }
.mcz-head { display: grid; grid-template-columns: 26mm 26mm 22mm 30mm 24mm 34mm 12mm 12mm 6mm 16mm; align-items: end; column-gap: 3mm; }
.mcz-u { display: block; min-height: 6mm; border-bottom: 1pt solid #000; text-align: center; font-weight: 700; }
.mcz-body { display: grid; grid-template-columns: 116mm 1fr; column-gap: 12mm; margin-top: 4mm; }
.mcz-table { width: 112mm; border-collapse: collapse; table-layout: fixed; }
.mcz-table td { height: 6.6mm; padding: 0 1mm; vertical-align: middle; white-space: nowrap; overflow: hidden; }
.mcz-table td.b { border: .6pt solid #000; }
.mcz-table td.v { text-align: center; }
.mcz-line { display: grid; align-items: end; row-gap: 1.5mm; }
.mcz-ul { display: block; border-bottom: 1pt solid #000; min-height: 6mm; text-align: center; }
.mcz-calc { display: grid; grid-template-columns: 24mm 24mm 8mm 24mm 8mm 22mm; align-items: end; row-gap: 1.5mm; text-align: center; }
.mcz-sum { display: grid; grid-template-columns: 22mm 10mm 28mm 16mm; row-gap: 2.5mm; align-items: end; text-align: center; margin: 8mm 0 0 20mm; }
.mcz-footer { margin-top: auto; padding-top: 8mm; font-family: Tahoma, sans-serif; font-size: 9pt; }
@media screen { .mcz-page { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
`;

const fix = (v: string | undefined, digits: number) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : (v ?? "");
};
const short = (n: number | null) => (n == null ? "" : String(Number(n.toFixed(4))));

/** ใบคำนวณ MANCOZEB (ไทเทรต 0.1 N I2) ตามแบบ Excel (A4 แนวนอน) */
export function MancozebPrintSheet({ page, values }: { page: LabReportPage; values: Record<string, string> }) {
  const densityRaw = (page.rows ?? []).find((row) => /density|ถ\.?\s*พ\.?/i.test(row.testItem))?.result?.trim();
  const densityNum = densityRaw && densityRaw !== "-" ? Number(densityRaw) : NaN;
  const hasDensity = Number.isFinite(densityNum) && densityNum > 0;
  const calc = calculateMancozeb(values, hasDensity ? densityNum : null);
  const sampleName = page.sample.name || "";
  const formula = /(\d+(?:\.\d+)?)\s*%\s*([A-Z]{2,3})\b/i.exec(sampleName);
  const common = sampleName.replace(/\s*\d+(?:\.\d+)?\s*%.*$/, "").trim() || sampleName;
  const sampleNo = page.sample.sampleNo || page.sample.submissionNo;
  const strength = formula?.[1] ?? "";
  const form = formula?.[2]?.toUpperCase() ?? "";
  const conc = fix(values[MCZ_CONC], 4);
  const signName = (n: string) => `(......${n && n !== "-" ? n : "...................."}......)`;
  const rows = (["Sample 1", "Sample 2"] as const).map((row, i) => ({
    row,
    wt: fix(values[mczKey(row, "wt/g")], 5),
    ml: fix(values[mczKey(row, "mL 0.1 N I2")], 4),
    net: mczFixed(calc.sample[i].net, 4),
  }));

  const calcBlock = (label: string, i: 0 | 1) => {
    const s = calc.sample[i];
    return (
      <div className="mcz-calc" style={{ marginTop: i === 0 ? "3mm" : "8mm" }}>
        <span style={{ textAlign: "left" }}>{label}</span>
        <span className="mcz-ul">{short(s.net)}</span><span>x</span>
        <span className="mcz-ul">{calc.conc == null ? "" : calc.conc.toFixed(5)}</span><span>x</span>
        <span className="mcz-ul">{MCZ_FACTOR}</span>
        <span /><span /><span /><span>{s.wt == null ? "" : s.wt.toFixed(4)}</span><span /><span />
        <span /><span /><span>=</span><span>{mczFixed(s.result, 4)}</span><span /><span />
      </div>
    );
  };

  return (
    <section className="mcz-page">
      <div className="mcz-head">
        <b>ตัวอย่างเลขที่</b><span className="mcz-u">{sampleNo}</span><b>ชื่อการค้า</b><span className="mcz-u">-</span>
        <b>ชื่อสามัญ</b><span className="mcz-u">{common}</span><b>สูตร</b><span className="mcz-u">{strength}</span><b>%</b><span className="mcz-u">{form}</span>
      </div>
      <div className="mcz-body">
        <div>
          <table className="mcz-table">
            <colgroup><col style={{ width: "24mm" }} /><col style={{ width: "26mm" }} /><col style={{ width: "28mm" }} /><col style={{ width: "34mm" }} /></colgroup>
            <tbody>
              <tr><td /><td className="b">เลขที่ตัวอย่าง</td><td className="b v">{sampleNo}</td><td /></tr>
              <tr><td /><td className="b">ชื่อการค้า</td><td className="b v">-</td><td /></tr>
              <tr><td /><td className="b">ชื่อสามัญ</td><td className="b v">{common}</td><td /></tr>
              <tr><td /><td className="b">สูตร</td><td className="b v">{strength}</td><td /></tr>
              <tr><td /><td className="b">ลักษณะยา</td><td className="b v">{form}</td><td /></tr>
              <tr><td /><td className="b">Conc 0.1 N I2</td><td className="b v">{conc}</td><td>N</td></tr>
              <tr><td /><td className="b">mL of Blank</td><td className="b v">{fix(values[MCZ_BLANK] || "0", 4)}</td><td>mL</td></tr>
              <tr><td className="b" /><td className="b v">wt/g</td><td className="b v">Conc 0.1 N I2</td><td className="b v">mL 0.1 N I2 - Blank</td></tr>
              {rows.map((r) => (
                <tr key={r.row}><td className="b">{r.row}</td><td className="b v">{r.wt}</td><td className="b v">{r.ml}</td><td className="b v">{r.net}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mcz-line" style={{ gridTemplateColumns: "26mm 30mm", marginTop: "8mm" }}>
            <span>Factor</span><span className="mcz-ul">{MCZ_FACTOR}</span>
          </div>
          <div className="mcz-line" style={{ gridTemplateColumns: "40mm 72mm", marginTop: "6mm" }}>
            <span style={{ textAlign: "center" }}>Analyst</span><span className="mcz-ul" />
            <span /><span style={{ textAlign: "center", fontSize: "8pt" }}>{signName(page.analystName)}</span>
            <span style={{ textAlign: "center", marginTop: "4mm" }}>Approved</span><span className="mcz-ul" />
            <span /><span style={{ textAlign: "center", fontSize: "8pt" }}>{signName(page.labHeadName)}</span>
          </div>
        </div>
        <div>
          <div style={{ textAlign: "right", marginRight: "14mm" }}>Conc 0.1 N I2&nbsp;&nbsp;&nbsp;&nbsp;{conc}&nbsp;&nbsp;N</div>
          {calcBlock("Sample A", 0)}
          {calcBlock("Sample B", 1)}
          <div className="mcz-sum">
            <span>Average</span><span>=</span><span className="mcz-ul">{mczFixed(calc.average, 4)}</span><span>%W/W</span>
            <span>Density</span><span>=</span><span className="mcz-ul">{calc.density}</span><span />
            <span>Report</span><span>=</span><span className="mcz-ul">{mczFixed(calc.report, 2)}</span><span>{hasDensity ? "%W/V" : "%W/W"}</span>
            <span>Date</span><span>=</span><span className="mcz-ul">{page.sample.testedDate && page.sample.testedDate !== "-" ? page.sample.testedDate : ""}</span><span />
          </div>
        </div>
      </div>
      <div className="mcz-footer">{PBZ_PRINT_FORM_CODE}</div>
    </section>
  );
}
