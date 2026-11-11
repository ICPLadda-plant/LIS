import BalanceControlChart, { BalanceControlLegend } from "@/components/lis/BalanceControlChart";
import type { DailyCheckRecord } from "@/lib/api";
import {
  formatControlNumber,
  type BalanceControlConfig,
  type BalanceScale,
  type ControlLimits,
  type MonthlyPoint,
} from "@/lib/balanceControlChart";
import { BALANCE_CHART_TITLE, BALANCE_FORM_CODE, BALANCE_FORM_TITLE } from "@/lib/balanceControlExport";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import { fmtDate, fmtTime } from "@/lib/dailyCheckFormat";
import { A4_PRINT_FONT_FAMILY, A4_PRINT_HEADING_FONT_WEIGHT } from "@/lib/printConfig";

// รายงานพิมพ์ Daily check เครื่องชั่ง ตามแบบฟอร์ม FM-WI-06-04-001-R00 (A4 แนวตั้ง)
// ใช้สี/ฟอนต์ตายตัวแทน design token เพราะเป็นเอกสารควบคุมที่ต้องพิมพ์ออกมาเหมือนฟอร์มกระดาษเดิม

export const BALANCE_CONTROL_REPORT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
body { font-family: ${A4_PRINT_FONT_FAMILY}; margin: 0; color: #000; }
.bcr, .bcr * { font-family: ${A4_PRINT_FONT_FAMILY}; box-sizing: border-box; }
.bcr { color: #000; background: #fff; font-size: 13pt; line-height: 1.15; }
.bcr h1, .bcr h2, .bcr .bcr-strong { font-weight: ${A4_PRINT_HEADING_FONT_WEIGHT}; }
.bcr .bcr-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 44px; }
.bcr .bcr-head img { position: absolute; left: 0; top: 0; height: 40px; width: auto; }
.bcr .bcr-head h1 { margin: 0; font-size: 18pt; }
.bcr .bcr-info { display: grid; grid-template-columns: auto 1fr auto 1.4fr auto 1fr; column-gap: 6px; row-gap: 2px; margin: 6px 0 8px; font-weight: ${A4_PRINT_HEADING_FONT_WEIGHT}; font-size: 13pt; align-items: end; }
.bcr .bcr-fill { border-bottom: 1px solid #000; text-align: center; min-height: 1.2em; padding: 0 4px; }
.bcr table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.bcr .bcr-table { border: 2px solid #000; }
.bcr .bcr-table th, .bcr .bcr-table td { border: 1px solid #000; text-align: center; vertical-align: middle; padding: 0 3px; font-size: 11.5pt; line-height: 1.05; height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bcr .bcr-table th { font-weight: 400; }
.bcr .bcr-table thead tr:first-child th { border-top: 2px solid #000; }
.bcr .bcr-note { display: flex; gap: 24px; margin: 6px 0 4px 16px; font-size: 12pt; }
.bcr .bcr-chart { margin-top: 4px; }
.bcr .bcr-chart h2 { margin: 0 0 2px; text-align: center; font-size: 13pt; }
.bcr .bcr-empty { border: 1px dashed #000; padding: 32px 0; text-align: center; font-size: 12pt; }
.bcr .bcr-sign { display: flex; justify-content: space-between; gap: 24px; margin-top: 14px; font-size: 13pt; }
.bcr .bcr-sign span { display: inline-block; border-bottom: 1px solid #000; min-width: 220px; }
.bcr .bcr-sign .bcr-date { min-width: 160px; }
.bcr .bcr-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 12px; font-size: 11pt; }
.bcr .bcr-printed { font-size: 9pt; color: #333; }
`;

export interface BalanceControlReportProps {
  scale: BalanceScale;
  config: BalanceControlConfig;
  limits: ControlLimits | null;
  series: MonthlyPoint<DailyCheckRecord>[];
  domain: [number, number] | null;
  digits: number;
  month: string;
  printedBy: string;
  printedAt: string;
}

const resultMark = (record: DailyCheckRecord | null) => {
  const status = record?.status100 ?? record?.status;
  if (status === "pass") return "✓";
  if (status === "fail") return "X";
  return "";
};

const weightText = (record: DailyCheckRecord | null, index: number, decimals: number) => {
  const raw = record?.weights100?.[index];
  if (raw === undefined || raw === null || raw === "") return "";
  const value = Number(raw);
  return Number.isFinite(value) ? formatControlNumber(value, decimals) : String(raw);
};

export default function BalanceControlReport({
  scale,
  config,
  limits,
  series,
  domain,
  digits,
  month,
  printedBy,
  printedAt,
}: BalanceControlReportProps) {
  const printedDate = printedAt ? `${fmtDate(printedAt.slice(0, 10))} ${fmtTime(printedAt)}` : "";

  return (
    <section className="bcr bg-white text-black" style={{ width: "720px" }} data-month={month}>
      <header className="bcr-head">
        <img src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" />
        <h1>{BALANCE_FORM_TITLE}</h1>
      </header>

      <div className="bcr-info">
        <span>รหัสเครื่องมือ :</span>
        <span className="bcr-fill">{scale.code}</span>
        <span>ยี่ห้อ :</span>
        <span className="bcr-fill">{config.brand}</span>
        <span>รุ่น :</span>
        <span className="bcr-fill">{config.model || scale.model}</span>
        <span>รหัสตุ้มน้ำหนัก :</span>
        <span className="bcr-fill">{config.weightCode}</span>
        <span style={{ gridColumn: "span 2" }}>น้ำหนักตุ้ม Daily check :</span>
        <span className="bcr-fill">{config.nominal}</span>
        <span>g</span>
      </div>

      <table className="bcr-table">
        <colgroup>
          <col style={{ width: "15%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "16%" }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>ว/ด/ป</th>
            <th colSpan={3}>ครั้งที่</th>
            <th rowSpan={2}>Mean</th>
            <th rowSpan={2}>Result *</th>
            <th rowSpan={2}>หมายเหตุ</th>
            <th rowSpan={2}>ผู้บันทึก</th>
          </tr>
          <tr>
            <th>1</th>
            <th>2</th>
            <th>3</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => {
            const record = point.record;
            return (
              <tr key={point.date}>
                <td>{fmtDate(point.date)}</td>
                <td>{weightText(record, 0, scale.decimals)}</td>
                <td>{weightText(record, 1, scale.decimals)}</td>
                <td>{weightText(record, 2, scale.decimals)}</td>
                <td>{record ? formatControlNumber(record.avg100, scale.decimals) : ""}</td>
                <td>{resultMark(record)}</td>
                <td />
                <td>{record?.recorder ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="bcr-note">
        <span className="bcr-strong">หมายเหตุ :</span>
        <span>* Result :</span>
        <span>
          ✓ = <span className="bcr-strong">ผ่าน</span>
        </span>
        <span>
          X = <span className="bcr-strong">ไม่ผ่าน</span>
        </span>
      </div>

      <div className="bcr-chart">
        <h2>{BALANCE_CHART_TITLE}</h2>
        {limits && domain ? (
          <>
            <BalanceControlChart
              fixed
              width={700}
              height={240}
              series={series}
              limits={limits}
              domain={domain}
              digits={digits}
            />
            <BalanceControlLegend fixed className="justify-center" />
          </>
        ) : (
          <div className="bcr-empty">ยังไม่ได้ตั้งค่า Control (Mean/STD) จึงยังไม่มีกราฟ</div>
        )}
      </div>

      <div className="bcr-sign">
        <div>
          ผู้ตรวจสอบ : <span>&nbsp;</span>
        </div>
        <div>
          วันที่ : <span className="bcr-date">&nbsp;</span>
        </div>
      </div>

      <footer className="bcr-foot">
        <span>{BALANCE_FORM_CODE}</span>
        <span className="bcr-printed">
          {printedBy ? `พิมพ์โดย ${printedBy} ` : ""}
          {printedDate}
        </span>
        <span>P1/1</span>
      </footer>
    </section>
  );
}
