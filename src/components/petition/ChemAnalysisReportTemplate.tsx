import type { ReactNode } from "react";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import { CHEM_REPORT_SAMPLES_PER_SHEET, type ChemReportSample, type ChemReportSheet } from "@/lib/chemAnalysisReport";
import { A4_PRINT_FONT_FAMILY, A4_PRINT_FONT_SIZE } from "@/lib/printConfig";

export const CHEM_ANALYSIS_REPORT_CSS = `
.ca-root, .ca-root * { box-sizing: border-box; color: #000; font-family: ${A4_PRINT_FONT_FAMILY}; font-size: ${A4_PRINT_FONT_SIZE}; line-height: 1.2; }
.ca-page { width: 210mm; height: 297mm; padding: 6mm 12mm 5mm; background: #fff; display: flex; flex-direction: column; overflow: hidden; }
.ca-page + .ca-page { margin-top: 6mm; page-break-before: always; break-before: page; }
.ca-head { display: flex; align-items: center; gap: 3mm; padding-bottom: 2mm; border-bottom: 0.8pt solid #000; }
.ca-logo { height: 10mm; }
.ca-company { font-weight: 700; font-size: 13pt !important; }
.ca-title { margin-top: 1.5mm; text-align: center; font-weight: 700; font-size: 18pt !important; line-height: 1 !important; }
.ca-sub { text-align: center; font-weight: 700; }
.ca-box { position: relative; margin-top: 2.8mm; padding: 2.2mm 3mm 1.4mm; border: 0.8pt solid #000; border-radius: 2mm; }
.ca-tag { position: absolute; top: -2.6mm; left: 4mm; padding: 0 2mm; background: #fff; font-weight: 700; }
.ca-line { display: flex; flex-wrap: wrap; align-items: flex-end; column-gap: 2mm; row-gap: 0.6mm; margin-top: 0.8mm; }
.ca-field { display: flex; flex: 0 0 auto; align-items: flex-end; gap: 1mm; max-width: 100%; }
.ca-grow { flex: 1 1 45mm; }
.ca-label { white-space: nowrap; }
.ca-val { flex: 1 1 auto; min-width: 22mm; min-height: 5mm; padding: 0 1mm; border-bottom: 0.8pt dotted #000; overflow-wrap: anywhere; }
.ca-tbl { width: 100%; margin-top: 1.5mm; border-collapse: collapse; table-layout: fixed; }
.ca-tbl th, .ca-tbl td { border: 0.8pt solid #000; padding: 0.3mm 0.4mm; text-align: center; vertical-align: middle; overflow-wrap: anywhere; line-height: 1.1 !important; }
.ca-tbl th { font-weight: 700; }
.ca-tbl .ca-rowhead { text-align: left; padding-left: 1mm; font-size: 13pt !important; overflow-wrap: normal; }
.ca-tbl td.ca-cell { font-size: 12pt !important; white-space: nowrap; }
.ca-sign { display: flex; align-items: flex-end; justify-content: flex-end; gap: 1.5mm; margin-top: 1.8mm; white-space: nowrap; }
.ca-sign .ca-val { flex: 0 0 48mm; text-align: center; }
.ca-cb { display: inline-block; width: 3.4mm; height: 3.4mm; margin-right: 1.5mm; border: 0.8pt solid #000; vertical-align: -0.6mm; text-align: center; line-height: 3mm; font-weight: 700; }
.ca-note { margin-top: 1mm; }
.ca-foot { margin-top: auto; padding-top: 1.5mm; text-align: right; font-size: 13pt !important; }
@media screen { .ca-page { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
@media print { .ca-box, .ca-tbl tr { break-inside: avoid; page-break-inside: avoid; } }
`;

function Field({ label, value, grow = false }: { label: ReactNode; value?: string; grow?: boolean }) {
  return (
    <div className={grow ? "ca-field ca-grow" : "ca-field"}>
      <span className="ca-label">{label}</span>
      <span className="ca-val">{value}</span>
    </div>
  );
}

function Check({ checked }: { checked: boolean }) {
  return <span className="ca-cb">{checked ? "✓" : ""}</span>;
}

const SAMPLE_ROWS: Array<{ label: string; key: keyof ChemReportSample }> = [
  { label: "1. สารออกฤทธิ์ (%AI)", key: "ai" },
  { label: "2. ความถ่วงจำเพาะ (ถ.พ.)", key: "sg" },
  { label: "Batch No.", key: "batchNo" },
  { label: "วันที่ผลิต", key: "productionDate" },
  { label: "ทดสอบครั้งที่", key: "testRound" },
];

function Sheet({ sheet }: { sheet: ChemReportSheet }) {
  const { customer, lab, qc } = sheet;
  const columns = Array.from({ length: CHEM_REPORT_SAMPLES_PER_SHEET }, (_, index) => lab.samples[index]);
  return (
    <section className="ca-page">
      <div className="ca-head">
        <img className="ca-logo" src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" />
        <span className="ca-company">บริษัท ไอ ซี พี ลัดดา จำกัด</span>
      </div>
      <div className="ca-title">รายงานผลการวิเคราะห์</div>
      <div className="ca-sub">(สำหรับส่วนห้องปฏิบัติการเคมีวิเคราะห์)</div>

      <div className="ca-box">
        <span className="ca-tag">ข้อมูลจากลูกค้า</span>
        <div className="ca-line"><Field grow label="ชื่อผู้รับผลวิเคราะห์" value={customer.recipientName} /><Field label="หน่วยงาน" value={customer.department} /></div>
        <div className="ca-line"><Field grow label="ชื่อตัวอย่าง" value={customer.sampleName} /><Field label="จำนวนตัวอย่างที่ส่ง" value={customer.sampleCount} /></div>
        <div className="ca-line"><Field grow label="เลขที่ใบนำส่ง" value={customer.submissionNo} /><Field label="วันที่ส่งตัวอย่าง" value={customer.sentDate} /><Field label="เวลาส่งตัวอย่าง" value={customer.sentTime} /></div>
        <div className="ca-line"><Field grow label="วันที่นำเข้า" value={customer.importDate} /><Field label="ทดสอบครั้งที่" value={customer.testRound} /></div>
        <div className="ca-line"><Field grow label="แบชนัมเบอร์" value={customer.batchNo} /></div>
        <div className="ca-line"><Field grow label="นำเข้ามาจาก" value={customer.importedFrom} /></div>
      </div>

      <div className="ca-box">
        <span className="ca-tag">ข้อมูลห้องปฏิบัติการเคมี</span>
        <div className="ca-line"><Field grow label="เลขที่ตัวอย่าง" value={lab.sampleNo} /><Field grow label="วันที่รายงาน" value={lab.reportDate} /></div>
        <table className="ca-tbl">
          <colgroup><col style={{ width: "22%" }} />{columns.map((_, index) => <col key={index} />)}</colgroup>
          <thead>
            <tr><th rowSpan={2}>รายการทดสอบ</th><th colSpan={CHEM_REPORT_SAMPLES_PER_SHEET}>ผลการทดสอบ ตัวอย่างที่</th></tr>
            <tr>{columns.map((_, index) => <th key={index}>{index + 1}</th>)}</tr>
          </thead>
          <tbody>
            {SAMPLE_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="ca-rowhead">{row.label}</td>
                {columns.map((sample, index) => <td key={index} className="ca-cell">{sample?.[row.key] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ca-line"><Field grow label="เกณฑ์มาตรฐาน" value={lab.criteria} /></div>
        <div className="ca-sign"><span>ผู้วิเคราะห์/ผู้รายงาน</span><span className="ca-val">{lab.analystName}</span><span>นักเคมี</span></div>
        <div className="ca-sign"><span>ผู้ทบทวนและอนุมัติ</span><span className="ca-val">{lab.labHeadName}</span><span>หัวหน้าฝ่ายห้องปฏิบัติการเคมีวิเคราะห์</span></div>
      </div>

      <div className="ca-box">
        <span className="ca-tag">(สำหรับส่วนควบคุมคุณภาพ)</span>
        <div className="ca-line"><span className="ca-label">ผลทดสอบ</span><Check checked={Boolean(qc.passBatches)} /><Field grow label="ผ่าน Batch" value={qc.passBatches} /></div>
        <div className="ca-line" style={{ paddingLeft: "13mm" }}><Check checked={Boolean(qc.failBatches)} /><Field grow label="ไม่ผ่าน Batch" value={qc.failBatches} /></div>
        <div className="ca-line"><Field grow label="หมายเหตุ" value={qc.remark} /></div>
        <div className="ca-sign"><span>ผู้รายงาน</span><span className="ca-val">{qc.qcHeadName}</span><span>หัวหน้าฝ่ายควบคุมคุณภาพ</span></div>
        <div className="ca-note">กรณีผลวิเคราะห์สารออกฤทธิ์ (%AI) “ ไม่ผ่าน/มีปัญหา ” ขอให้สุ่มตัวอย่างในแบชนัมเบอร์เดียวกันมาใหม่</div>
      </div>

      <div className="ca-box">
        <span className="ca-tag">กรณีการทดสอบสารออกฤทธิ์ (%AI) ไม่เป็นไปตามเกณฑ์</span>
        <div className="ca-line"><Check checked={Boolean(qc.usableBatches)} /><Field grow label="นำไปใช้ได้" value={qc.usableBatches} /></div>
        <div className="ca-line"><Check checked={Boolean(qc.unusableBatches)} /><Field grow label="ห้ามนำไปใช้" value={qc.unusableBatches} /></div>
        <div className="ca-sign"><span>ผู้อนุมัติ</span><span className="ca-val">{qc.managerName}</span><span>ผู้จัดการแผนกตรวจสอบคุณภาพ</span><span>วันที่</span><span className="ca-val" style={{ flexBasis: "26mm" }}>{qc.managerDate}</span></div>
      </div>

      <div className="ca-foot">F-CHM-01-01 Rev 04 : 24/03/65</div>
    </section>
  );
}

/** ใบรายงานผลการวิเคราะห์ F-CHM-01-01 Rev 04 (ใบละ 7 ตัวอย่าง) */
export default function ChemAnalysisReportTemplate({ sheets }: { sheets: ChemReportSheet[] }) {
  return (
    <div className="ca-root">
      <style>{CHEM_ANALYSIS_REPORT_CSS}</style>
      {sheets.map((sheet, index) => <Sheet key={index} sheet={sheet} />)}
    </div>
  );
}

