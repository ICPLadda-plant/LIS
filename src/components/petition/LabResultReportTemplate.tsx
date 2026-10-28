import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import type { LabReportPage } from "@/lib/labReport";
import { A4_PRINT_FONT_FAMILY, A4_PRINT_FONT_SIZE, A4_PRINT_HEADING_FONT_WEIGHT } from "@/lib/printConfig";

export const LAB_REPORT_CSS = `
.lr-root, .lr-root * { box-sizing: border-box; color: #000; font-family: ${A4_PRINT_FONT_FAMILY}; font-size: ${A4_PRINT_FONT_SIZE}; }
.lr-page { width: 210mm; padding: 12mm; background: #fff; }
.lr-page + .lr-page { margin-top: 6mm; page-break-before: always; break-before: page; }
.lr-tbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
.lr-tbl td, .lr-tbl th { border: 0.8pt solid #000; padding: 2.4mm; vertical-align: top; word-break: break-word; }
.lr-nt { border-top: 0; }
.lr-strong { font-weight: 700; }
.lr-small { font-size: 9.5pt; line-height: 1.35; }
.lr-center { text-align: center; }
.lr-right { text-align: right; }
.lr-italic { font-style: italic; }
.lr-method { white-space: pre-line; }
.lr-half { width: 50%; }
.lr-logo { height: 16mm; margin-bottom: 1.5mm; }
.lr-hd-mid { text-align: center; vertical-align: middle; font-weight: 700; font-size: 13pt; }
.lr-title { text-align: center; font-weight: 700; font-size: 14pt; }
.lr-results th { text-align: center; background: #f3f3f3; }
.lr-muted { color: #555; }
.lr-remark { margin-top: 5mm; font-size: 11pt; }
.lr-sign { margin-top: 10mm; text-align: center; font-size: 11pt; }
.lr-sigline { display: inline-block; border-bottom: 0.8pt dotted #000; min-width: 62mm; margin: 0 2mm; }
.lr-sign-name { margin-top: 1mm; }
.lr-sign-gap { margin-top: 8mm; }
.lr-note { margin-top: 8mm; font-size: 9.5pt; }
.lr-note-ind { margin-left: 12mm; }
.lr-foot { display: flex; justify-content: space-between; margin-top: 6mm; font-size: 9.5pt; color: #444; }
@media screen { .lr-page { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
.lr-root, .lr-root * { font-size: ${A4_PRINT_FONT_SIZE} !important; }
.lr-root h1,
.lr-root h2,
.lr-root h3,
.lr-root h4,
.lr-root h5,
.lr-root h6,
.lr-root th,
.lr-title,
.lr-hd-mid,
.lr-strong,
.print-heading {
  font-weight: ${A4_PRINT_HEADING_FONT_WEIGHT} !important;
}
`;

export default function LabResultReportTemplate({ pages }: { pages: LabReportPage[] }) {
  return (
    <div className="lr-root">
      <style>{LAB_REPORT_CSS}</style>
      {pages.map((page, i) => (
        <section className="lr-page" key={i}>
          {/* Header */}
          <table className="lr-tbl">
            <tbody>
              <tr>
                <td style={{ width: "34%" }}>
                  <img className="lr-logo" src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" />
                  <div className="lr-strong">บริษัท ไอ ซี พี ลัดดา จำกัด</div>
                  <div className="lr-small">
                    151 หมู่ 8 ตำบลสามควายเผือก อำเภอเมือง<br />
                    นครปฐม จังหวัดนครปฐม 73000<br />
                    โทรศัพท์ : 034-305281-2
                  </div>
                </td>
                <td className="lr-hd-mid">ห้องปฏิบัติการบริษัท ไอ ซี พี ลัดดา จำกัด</td>
                <td style={{ width: "27%" }}>
                  <div className="lr-right lr-small">หน้า {i + 1}/{pages.length}</div>
                  <div className="lr-small">เลขที่รายงาน {page.reportNo}</div>
                  <div className="lr-small">วันที่ {page.reportDate || "-"}</div>
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="lr-title">รายงานผลการทดสอบ</td>
              </tr>
            </tbody>
          </table>

          {/* Customer + sample */}
          <table className="lr-tbl lr-nt">
            <tbody>
              <tr>
                <td className="lr-half">
                  <div className="lr-right lr-italic lr-small">ข้อมูลจากลูกค้า</div>
                  <div>ชื่อ : {page.customer.name}</div>
                  <div>บริษัท : {page.customer.company}</div>
                  <div>หน่วยงาน : {page.customer.department}</div>
                  <div>Email : {page.customer.email}</div>
                  <div>โทร : {page.customer.phone}</div>
                </td>
                <td className="lr-half">
                  <div className="lr-right lr-italic lr-small">ข้อมูลตัวอย่าง</div>
                  <div>ชื่อตัวอย่าง : {page.sample.name}</div>
                  <div>แบทช์หมายเลข : {page.sample.batchNo}</div>
                  <div>วันที่ผลิต/นำเข้า : {page.sample.productionDate}</div>
                  <div>เลขที่ใบนำส่ง : {page.sample.submissionNo}</div>
                  <div>ผู้ผลิต/ผู้ขาย : {page.sample.manufacturer}</div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Sample dates */}
          <table className="lr-tbl lr-nt">
            <tbody>
              <tr>
                <td className="lr-half">เลขที่ตัวอย่าง : {page.sample.sampleNo}</td>
                <td className="lr-half">วันที่รับตัวอย่าง : {page.sample.receivedDate}</td>
              </tr>
              <tr>
                <td>วันที่ทดสอบ : {page.sample.testedDate}</td>
                <td>วันที่รายงานผล : {page.sample.reportedDate}</td>
              </tr>
              <tr>
                <td colSpan={2}>สภาพตัวอย่าง : {page.sample.condition}</td>
              </tr>
            </tbody>
          </table>

          {/* Results */}
          <table className="lr-tbl lr-results lr-nt">
            <thead>
              <tr>
                <th style={{ width: "32%" }}>รายการทดสอบ</th>
                <th style={{ width: "22%" }}>ผลการทดสอบ</th>
                <th style={{ width: "24%" }}>เกณฑ์กำหนด</th>
                <th style={{ width: "22%" }}>วิธีทดสอบ</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length ? (
                page.rows.map((r, ri) => (
                  <tr key={ri}>
                    <td className="lr-center">{r.testItem}</td>
                    <td className="lr-center">{r.result}</td>
                    <td className="lr-center">{r.criteria}</td>
                    <td className="lr-center lr-method">{r.method}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="lr-center lr-muted">ไม่พบผลทดสอบฝั่ง Lab</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="lr-remark">หมายเหตุ : {page.remark || "................"}</div>

          {/* Signatures */}
          <div className="lr-sign">
            <div>ผู้ทดสอบ <span className="lr-sigline" /> นักเคมี</div>
            <div className="lr-sign-name">( {page.analystName} )</div>
            <div className="lr-sign-gap">ผู้อนุมัติ / ผู้ตรวจสอบ <span className="lr-sigline" /> หัวหน้าห้องปฏิบัติการ</div>
            <div className="lr-sign-name">( {page.labHeadName} )</div>
          </div>

          <div className="lr-note">
            <div><strong>หมายเหตุ</strong> รายงานนี้มีผลเฉพาะกับตัวอย่างที่นำมาทดสอบเท่านั้น</div>
            <div className="lr-note-ind">
              รายงานผลทดสอบต้องไม่ถูกทำสำเนาเฉพาะเพียงบางส่วน โดยได้รับความยินยอมเป็นลายลักษณ์อักษรจากห้องปฏิบัติการ ยกเว้นทำทั้งฉบับ
            </div>
          </div>

          <div className="lr-foot">
            <span>F-CHM-01-03 Rev 00 16/01/69</span>
          </div>
        </section>
      ))}
    </div>
  );
}
