import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import { A4_PRINT_FONT_FAMILY, A4_PRINT_FONT_SIZE, A4_PRINT_HEADING_FONT_WEIGHT } from "@/lib/printConfig";
import { fmtDate, fmtTime } from "@/lib/dailyCheckFormat";
import {
  CONTROL_STATUS_LABEL,
  balanceScaleTypeLabel,
  classifyPoint,
  countByStatus,
  formatControlNumber,
  formatSd,
  formatThaiMonth,
  monthlyStats,
  type BalanceControlConfig,
  type BalanceScale,
  type ControlLimits,
  type MonthlyPoint,
} from "@/lib/balanceControlChart";
import type { DailyCheckRecord } from "@/lib/api";
import BalanceControlChart, { BalanceControlLegend } from "@/components/lis/BalanceControlChart";

// รายงาน Quality Control Chart ของเครื่องชั่ง 1 เครื่อง / 1 เดือน — A4 แนวนอน
export const BALANCE_CONTROL_REPORT_CSS = `
@page { size: A4 landscape; margin: 12mm; }
body{font-family:${A4_PRINT_FONT_FAMILY};margin:0;color:#000;font-size:${A4_PRINT_FONT_SIZE};}
.bcr,.bcr *{font-family:${A4_PRINT_FONT_FAMILY};}
.bcr{font-size:14pt;}
.bcr table{border-collapse:collapse;width:100%;}
.bcr th,.bcr td{border:1px solid #000;padding:2px 6px;vertical-align:middle;}
.bcr thead th{background:#f3f4f6;}
.bcr thead th,.bcr h1,.bcr h2,.bcr h3,.bcr .print-heading{font-weight:${A4_PRINT_HEADING_FONT_WEIGHT}!important;}
.bcr .sig-line{border-bottom:1px dotted #000;display:inline-block;min-width:200px;}
.bcr .avoid-break{break-inside:avoid;page-break-inside:avoid;}
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
  printedAt: string; // ISO
}

const cell = "border border-black px-2 py-0.5";
const headCell = `${cell} bg-gray-100 font-semibold text-center`;

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
  const values = series.map((point) => point.value);
  const recorded = series.filter((point) => point.record);
  const counts = countByStatus(values, limits);
  const stats = monthlyStats(values);
  const printedAtLabel = `${fmtDate(printedAt.slice(0, 10))} ${fmtTime(printedAt)}`;
  const fmt = (value: number | null | undefined) => formatControlNumber(value, digits);

  const infoRows: Array<[string, string]> = [
    ["รหัสเครื่องมือ", scale.code],
    ["ชื่อเครื่องมือ", balanceScaleTypeLabel(scale)],
    ["ยี่ห้อ", config.brand || "—"],
    ["รุ่น", config.model || "—"],
    ["รหัสตุ้มน้ำหนัก", config.weightCode || "—"],
    ["น้ำหนักตุ้ม Daily check", `${config.nominal} g`],
    ["ประจำเดือน", formatThaiMonth(month)],
    ["ปรับปรุงค่า Control", config.updatedDate ? fmtDate(config.updatedDate) : "—"],
  ];

  const controlRows: Array<[string, string]> = [
    ["Mean", fmt(limits?.mean)],
    ["STD", formatSd(limits?.sd)],
    ["2SD", formatSd(limits ? limits.sd * 2 : null)],
    ["3SD", formatSd(limits ? limits.sd * 3 : null)],
    ["UWL (+2SD)", fmt(limits?.uwl)],
    ["LWL (−2SD)", fmt(limits?.lwl)],
    ["UCL (+3SD)", fmt(limits?.ucl)],
    ["LCL (−3SD)", fmt(limits?.lcl)],
    ["MPE", config.mpe == null ? "—" : `±${config.mpe} g`],
  ];

  return (
    <div className="bcr bg-white text-black p-6" style={{ width: "1040px", fontFamily: A4_PRINT_FONT_FAMILY }}>
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <img src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" className="h-12" />
        <div>
          <div className="print-heading text-[17px] font-bold">Quality Control Chart For Balance Daily Check</div>
          <div className="text-[13px]">แบบบันทึกการตรวจสอบเครื่องชั่งประจำวัน — ห้องปฏิบัติการ บริษัท ไอ ซี พี ลัดดา จำกัด</div>
        </div>
      </div>

      {/* Info + control values */}
      <div className="mb-3 grid grid-cols-2 gap-4">
        <table>
          <tbody>
            {infoRows.map(([label, value]) => (
              <tr key={label}>
                <td className={`${cell} w-[45%] bg-gray-100`}>{label}</td>
                <td className={cell}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <tbody>
            {controlRows.map(([label, value]) => (
              <tr key={label}>
                <td className={`${cell} w-[45%] bg-gray-100`}>{label}</td>
                <td className={`${cell} tabular-nums`}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      <div className="avoid-break mb-3 border border-black p-2">
        <div className="print-heading mb-1 text-center font-bold">Quality Control Chart — {scale.code} ({formatThaiMonth(month)})</div>
        {limits && domain ? (
          <>
            <BalanceControlChart series={series} limits={limits} domain={domain} digits={digits} fixed />
            <BalanceControlLegend fixed className="mt-1" />
          </>
        ) : (
          <div className="py-10 text-center">ยังไม่ได้ตั้งค่าค่า Control ของเครื่องนี้ จึงยังวาดเส้นควบคุมไม่ได้</div>
        )}
      </div>

      {/* Table */}
      <table>
        <thead>
          <tr>
            <th className={headCell}>ซ้ำที่</th>
            <th className={headCell}>วันที่</th>
            <th className={headCell}>ค่าที่ได้ (g)</th>
            <th className={headCell}>Mean</th>
            <th className={headCell}>UWL</th>
            <th className={headCell}>LWL</th>
            <th className={headCell}>UCL</th>
            <th className={headCell}>LCL</th>
            <th className={headCell}>ผลเทียบเส้น Control</th>
            <th className={headCell}>ผู้บันทึก</th>
          </tr>
        </thead>
        <tbody>
          {recorded.length === 0 ? (
            <tr>
              <td className={`${cell} text-center`} colSpan={10}>
                ไม่มีข้อมูลการตรวจสอบในเดือนนี้
              </td>
            </tr>
          ) : (
            recorded.map((point, index) => {
              const status = classifyPoint(point.value, limits);
              return (
                <tr key={point.date}>
                  <td className={`${cell} text-center`}>{index + 1}</td>
                  <td className={`${cell} text-center whitespace-nowrap`}>{fmtDate(point.date)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt(point.value)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt(limits?.mean)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt(limits?.uwl)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt(limits?.lwl)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt(limits?.ucl)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmt(limits?.lcl)}</td>
                  <td className={`${cell} text-center whitespace-nowrap`}>{status ? CONTROL_STATUS_LABEL[status] : "—"}</td>
                  <td className={`${cell} whitespace-nowrap`}>{point.record?.recorder || "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Summary */}
      <div className="avoid-break mt-2 text-[13px]">
        <div>
          บันทึกทั้งหมด {stats.n} วัน — อยู่ในเกณฑ์ {counts.in} วัน · เกิน 2SD {counts.warning} วัน · เกิน 3SD {counts.out} วัน
        </div>
        <div>
          ค่าเฉลี่ยจริงของเดือน {fmt(stats.mean)} g · STD จริงของเดือน {formatSd(stats.sd)} g
        </div>
      </div>

      {/* Signatures + print meta */}
      <div className="avoid-break mt-8 flex justify-between text-[13px]">
        <div className="text-center">
          <div>
            ผู้บันทึก <span className="sig-line inline-block min-w-[200px] border-b border-dotted border-black"></span>
          </div>
          <div className="mt-6">
            ผู้ตรวจสอบ <span className="sig-line inline-block min-w-[200px] border-b border-dotted border-black"></span>
          </div>
        </div>
        <div className="self-end text-right text-[12px] text-gray-600">
          <div>พิมพ์เมื่อ: {printedAtLabel}</div>
          <div>ผู้พิมพ์: {printedBy || "—"}</div>
        </div>
      </div>
    </div>
  );
}
