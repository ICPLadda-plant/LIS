import type { ReactNode } from "react";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import { CHEM_REPORT_SAMPLES_PER_SHEET, type ChemReportSheet } from "@/lib/chemAnalysisReport";
import { A4_PRINT_FONT_FAMILY } from "@/lib/printConfig";

export const CHEM_ANALYSIS_REPORT_CSS = `
.ca-root, .ca-root * { box-sizing: border-box; color: #000; font-family: ${A4_PRINT_FONT_FAMILY}; font-size: 14pt; line-height: 1.15; }
.ca-page { width: 210mm; height: 297mm; padding: 8mm 16mm 7mm; background: #fff; display: flex; flex-direction: column; overflow: hidden; }
.ca-page + .ca-page { margin-top: 6mm; page-break-before: always; break-before: page; }
.ca-head { display: grid; grid-template-columns: 35mm 1fr; align-items: center; min-height: 23mm; }
.ca-brand { text-align: left; }
.ca-logo { display: block; width: 27mm; height: auto; margin: 0; }
.ca-brand-name { width: 35mm; margin-top: 1mm; white-space: nowrap; text-align: center; font-size: 9pt !important; }
.ca-company { text-align: left; font-size: 16pt !important; }
.ca-title { margin-top: 0.5mm; text-align: center; font-weight: 700; font-size: 19pt !important; line-height: 1 !important; }
.ca-sub { margin-top: 1mm; text-align: right; font-size: 12pt !important; }
.ca-box { position: relative; margin-top: 3mm; padding: 3mm 2.5mm 2mm; border: 0.8pt solid #000; }
.ca-tag { position: absolute; top: -2.4mm; left: 4mm; padding: 0 1.5mm; background: #fff; font-size: 12pt !important; font-style: italic; }
.ca-line { display: flex; align-items: flex-end; column-gap: 1mm; margin-top: 1.5mm; }
.ca-field { display: flex; flex: 0 0 auto; align-items: flex-end; gap: 1mm; min-width: 0; max-width: 100%; }
.ca-grow { flex: 1 1 45mm; }
.ca-label { white-space: nowrap; font-size: 13pt !important; }
.ca-val { flex: 1 1 auto; min-width: 22mm; min-height: 5.5mm; padding: 0 1mm; border-bottom: 0.8pt dotted #000; overflow-wrap: anywhere; font-size: 11.5pt !important; }
.ca-lab { position: relative; margin-top: 4mm; }
.ca-tbl { width: 100%; margin-top: 1.5mm; border-collapse: collapse; table-layout: fixed; }
.ca-tbl th, .ca-tbl td { border: 0.8pt solid #000; height: 7mm; padding: 0.7mm 0.5mm; text-align: center; vertical-align: middle; overflow-wrap: anywhere; line-height: 1.05 !important; }
.ca-tbl th { font-weight: 700; }
.ca-tbl .ca-diagonal { position: relative; height: 14mm; padding: 0; border: 0.8pt solid #000 !important; }
.ca-diagonal-line { position: absolute; inset: 0; width: 100%; height: 100%; }
.ca-diagonal-top { position: absolute; top: 1.5mm; left: 2mm; }
.ca-diagonal-bottom { position: absolute; right: 8mm; bottom: 1.5mm; }
.ca-tbl .ca-group { width: 12mm; padding: 1mm 0; font-size: 12pt !important; font-weight: 400; writing-mode: vertical-rl; transform: rotate(180deg); }
.ca-tbl .ca-rowhead { text-align: left; padding-left: 2mm; font-size: 13pt !important; overflow-wrap: normal; }
.ca-tbl td.ca-cell { font-size: 12pt !important; overflow-wrap: anywhere; word-break: normal; }
.ca-tbl td.ca-cell-long { font-size: 8.5pt !important; line-height: 1 !important; }
.ca-ai-row td { height: 8mm; }
.ca-sign { display: flex; align-items: flex-end; justify-content: center; gap: 1.5mm; margin-top: 2.5mm; text-align: center; }
.ca-sign .ca-val { flex: 0 1 48mm; min-width: 26mm; text-align: center; }
.ca-sign > span { min-width: 0; overflow-wrap: anywhere; font-size: 13pt !important; }
.ca-sign-lab { display: grid; grid-template-columns: 42mm minmax(0, 48mm) minmax(0, 72mm); column-gap: 2mm; }
.ca-sign-lab .ca-val { min-width: 0; }
.ca-sign-lab > span:first-child { white-space: nowrap; }
.ca-sign-lab > span:last-child { text-align: left; }
.ca-qc { position: relative; margin-top: 4mm; padding: 5mm 2.5mm 0; border-top: 0.8pt solid #000; }
.ca-qc-tag { position: absolute; top: 1mm; right: 3mm; font-size: 10pt !important; font-style: italic; }
.ca-qc .ca-sign .ca-val { flex: 0 0 58mm; }
.ca-cb { display: inline-block; width: 5mm; height: 5mm; margin-right: 1.5mm; border: 0.8pt solid #000; vertical-align: -1mm; text-align: center; line-height: 4.5mm; font-weight: 700; }
.ca-check-row { display: grid; grid-template-columns: 20mm 5mm 30mm minmax(0, 1fr); align-items: end; column-gap: 1.5mm; margin-top: 1.2mm; }
.ca-check-row-simple { grid-template-columns: 5mm 25mm minmax(0, 1fr); }
.ca-check-heading { align-self: center; white-space: nowrap; font-size: 13pt !important; }
.ca-check-row .ca-cb { margin-right: 0; align-self: center; }
.ca-check-row .ca-val { width: 100%; }
.ca-note { display: flex; justify-content: center; gap: 3mm; margin-top: 3mm; font-size: 13pt !important; }
.ca-note-mark { font-size: 15pt !important; line-height: 0.8; }
.ca-final { padding-top: 3mm; }
.ca-final .ca-tag { width: 100%; top: 0; left: 0; padding: 0.5mm 1mm; border-bottom: 0.8pt solid #000; text-align: center; font-size: 12pt !important; font-weight: 700; font-style: italic; }
.ca-final-body { padding-top: 5mm; }
.ca-foot { margin-top: auto; padding-top: 1.5mm; text-align: left; font-size: 9pt !important; }
@media screen { .ca-page { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
@media print { .ca-box, .ca-lab, .ca-qc, .ca-tbl tr { break-inside: avoid; page-break-inside: avoid; } }
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

function Sheet({ sheet }: { sheet: ChemReportSheet }) {
  const { customer, lab, qc } = sheet;
  const columns = Array.from({ length: CHEM_REPORT_SAMPLES_PER_SHEET }, (_, index) => lab.samples[index]);
  return (
    <section className="ca-page">
      <div className="ca-head">
        <div className="ca-brand">
          <img className="ca-logo" src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" />
          <div className="ca-brand-name">บริษัท ไอ ซี พี ลัดดา จำกัด</div>
        </div>
        <span className="ca-company">บริษัท ไอ ซี พี ลัดดา จำกัด</span>
      </div>
      <div className="ca-title">รายงานผลการวิเคราะห์</div>
      <div className="ca-sub">(สำหรับส่วนห้องปฏิบัติการเคมีวิเคราะห์)</div>

      <div className="ca-box">
        <span className="ca-tag">ข้อมูลจากลูกค้า</span>
        <div className="ca-line"><Field grow label="ชื่อผู้รับผลวิเคราะห์" value={customer.recipientName} /><Field label="หน่วยงาน" value={customer.department} /></div>
        <div className="ca-line"><Field grow label="ชื่อตัวอย่าง" value={customer.sampleName} /><Field label="จำนวนตัวอย่างที่ส่ง" value={customer.sampleCount} /></div>
        <div className="ca-line"><Field grow label="เลขที่ใบนำส่ง" value={customer.submissionNo} /><Field label="วันที่ส่งตัวอย่าง" value={customer.sentDate} /><Field label="เวลาส่งตัวอย่าง" value={customer.sentTime} /></div>
        <div className="ca-line"><Check checked={Boolean(customer.importDate)} /><Field grow label="วันที่นำเข้า" value={customer.importDate} /><Field grow label="แบชนัมเบอร์" value={customer.batchNo} /><Field label="ทดสอบครั้งที่" value={customer.testRound} /></div>
        <div className="ca-line"><Field grow label="นำเข้ามาจาก" value={customer.importedFrom} /></div>
      </div>

      <div className="ca-lab">
        <div className="ca-line"><Field grow label="เลขที่ตัวอย่าง" value={lab.sampleNo} /><Field grow label="วันที่รายงาน" value={lab.reportDate} /></div>
        <table className="ca-tbl">
          <colgroup><col style={{ width: "12mm" }} /><col style={{ width: "44mm" }} />{columns.map((_, index) => <col key={index} />)}</colgroup>
          <thead>
            <tr><th className="ca-diagonal" rowSpan={2} colSpan={2}><svg className="ca-diagonal-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="100" x2="100" y2="0" stroke="black" strokeWidth="0.8" /></svg><span className="ca-diagonal-top">รายการทดสอบ</span><span className="ca-diagonal-bottom">ตัวอย่างที่</span></th><th colSpan={CHEM_REPORT_SAMPLES_PER_SHEET}>ผลการทดสอบ</th></tr>
            <tr>{columns.map((_, index) => <th key={index}>{index + 1}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="ca-ai-row">
              <td className="ca-group" rowSpan={3}>ข้อมูลห้องปฏิบัติการเคมี</td>
              <td className="ca-rowhead" rowSpan={3}>1. สารออกฤทธิ์ (%AI)</td>
              {columns.map((sample, index) => <td key={index} className="ca-cell">{sample?.ai ?? ""}</td>)}
            </tr>
            <tr className="ca-ai-row">{columns.map((_, index) => <td key={index} className="ca-cell" />)}</tr>
            <tr className="ca-ai-row">{columns.map((_, index) => <td key={index} className="ca-cell" />)}</tr>
            <tr>
              <td className="ca-group" rowSpan={4}>ข้อมูลจากลูกค้า</td>
              <td className="ca-rowhead">2. ความถ่วงจำเพาะ (ถ.พ.)</td>
              {columns.map((sample, index) => <td key={index} className="ca-cell">{sample?.sg ?? ""}</td>)}
            </tr>
            <tr><td>Batch No.</td>{columns.map((sample, index) => <td key={index} className="ca-cell ca-cell-long">{sample?.batchNo ?? ""}</td>)}</tr>
            <tr><td>วันที่ผลิต</td>{columns.map((sample, index) => <td key={index} className="ca-cell">{sample?.productionDate ?? ""}</td>)}</tr>
            <tr><td>ทดสอบครั้งที่</td>{columns.map((sample, index) => <td key={index} className="ca-cell">{sample?.testRound ?? ""}</td>)}</tr>
          </tbody>
        </table>
        <div className="ca-line"><Field grow label="เกณฑ์มาตรฐาน" value={lab.criteria} /></div>
        <div className="ca-sign ca-sign-lab"><span>ผู้วิเคราะห์/ผู้รายงาน</span><span className="ca-val" /><span>นักเคมี</span></div>
        <div className="ca-sign ca-sign-lab"><span>ผู้ทบทวนและอนุมัติ</span><span className="ca-val" /><span>หัวหน้าฝ่ายห้องปฏิบัติการเคมีวิเคราะห์</span></div>
      </div>

      <div className="ca-qc">
        <span className="ca-qc-tag">(สำหรับส่วนควบคุมคุณภาพ)</span>
        <div className="ca-check-row"><span className="ca-check-heading">ผลทดสอบ</span><Check checked={Boolean(qc.passBatches)} /><span>ผ่าน Batch</span><span className="ca-val">{qc.passBatches}</span></div>
        <div className="ca-check-row"><span /><Check checked={Boolean(qc.failBatches)} /><span>ไม่ผ่าน Batch</span><span className="ca-val">{qc.failBatches}</span></div>
        <div className="ca-line"><Field grow label="หมายเหตุ" value={qc.remark} /></div>
        <div className="ca-sign"><span>ผู้รายงาน</span><span className="ca-val">{qc.qcHeadName}</span><span>หัวหน้าฝ่ายควบคุมคุณภาพ</span></div>
        <div className="ca-note"><span className="ca-note-mark">•</span><span>กรณีผลวิเคราะห์สารออกฤทธิ์ (%AI) “ ไม่ผ่าน/มีปัญหา ” ขอให้สุ่มตัวอย่างในแบชนัมเบอร์เดียวกันมาใหม่</span></div>
      </div>

      <div className="ca-box ca-final">
        <span className="ca-tag">กรณีการทดสอบสารออกฤทธิ์ (%AI) ไม่เป็นไปตามเกณฑ์</span>
        <div className="ca-final-body">
          <div className="ca-check-row ca-check-row-simple"><Check checked={Boolean(qc.usableBatches)} /><span>นำไปใช้ได้</span><span className="ca-val">{qc.usableBatches}</span></div>
          <div className="ca-check-row ca-check-row-simple"><Check checked={Boolean(qc.unusableBatches)} /><span>ห้ามนำไปใช้</span><span className="ca-val">{qc.unusableBatches}</span></div>
          <div className="ca-sign"><span>ผู้อนุมัติ</span><span className="ca-val">{qc.managerName}</span><span>ผู้จัดการแผนกตรวจสอบคุณภาพ</span><span>วันที่</span><span className="ca-val" style={{ flexBasis: "26mm" }}>{qc.managerDate}</span></div>
        </div>
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

