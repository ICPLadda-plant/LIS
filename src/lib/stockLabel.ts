import QRCode from "qrcode";
import type { StockUnitItem } from "@/types/stock";
import { formatDate } from "@/lib/dateTime";

const STOCK_PUBLIC_VIEW_QR_BASE_URL = "https://app-plant.icpladda.com/LIS/stock/view";

export function stockDeductionQrUrl(qrId: string): string {
  const url = new URL(STOCK_PUBLIC_VIEW_QR_BASE_URL);
  url.searchParams.set("qrId", qrId);
  return url.toString();
}

/** สร้าง HTML ลาเบลขวด พร้อม QR (data URL) — ส่งตรงเข้า api.printDocument
 *  QR encode URL หน้าเบิก stock เพื่อให้สแกนจากกล้อง/แอปใดก็เปิดหน้าเบิกได้ทันที;
 *  in-app scanner parseScannedQrId ยังรองรับ qrId เปล่าและ URL เดิมอยู่ */
export async function buildStockLabelHtml(unit: StockUnitItem): Promise<string> {
  const qr = await QRCode.toDataURL(stockDeductionQrUrl(unit.qrId), {
    margin: 3,
    width: 512,
    errorCorrectionLevel: "M",
  });
  const exp = formatDate(unit.exp);
  const purity = formatPurityLabel(unit);
  const labelRun = formatStandardLabelMarker(unit);
  return `
<div style="font-family:Verdana,'Segoe UI',Arial,'Kanit',Tahoma,sans-serif;width:65mm;height:25mm;box-sizing:border-box;color:#000;background:#fff;overflow:hidden;display:grid;grid-template-columns:21mm 1fr;gap:1mm;align-items:center;padding:1mm;">
  <div style="width:21mm;height:23mm;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6mm;overflow:hidden;">
    <img src="${qr}" alt="qr" style="width:20mm;height:20mm;display:block;flex:0 0 auto;" />
    ${labelRun ? `<div style="font-size:5.2pt;font-weight:600;line-height:1;white-space:nowrap;text-align:center;">${escapeHtml(labelRun)}</div>` : ""}
  </div>
  <div style="height:23mm;box-sizing:border-box;border:0.35mm solid #000;display:grid;grid-template-rows:4.5mm 3.8mm 3.8mm 3.8mm 3.8mm 3.3mm;font-size:6.4pt;line-height:1;min-width:0;">
    <div style="display:flex;align-items:center;justify-content:center;border-bottom:0.25mm solid #000;font-size:7.2pt;font-weight:500;letter-spacing:.01em;white-space:nowrap;">REFERENCE STANDARD</div>
    ${labelRow("Name", unit.itemName || "")}
    ${labelRow("% Purity", purity)}
    ${labelRow("Batch/Lot", unit.lotNo || "")}
    ${labelRow("Exp date", exp)}
    <div style="display:flex;align-items:center;justify-content:center;border-top:0.25mm solid #000;font-size:5.7pt;font-weight:500;white-space:nowrap;">LB-TE-CH-002-001-R00 (07/02/67)</div>
  </div>
</div>`.trim();
}

/** สติกเกอร์สารเคมี — รูปแบบฟอร์มติดขวดตาม F-CHM */
export async function buildSolventLabelHtml(payload: {
  name: string;
  idForQr?: string;
  lotNo?: string;
  receivedDate?: string | null;
  openedDate?: string | null;
  exp?: string | null;
  bottleNo?: string | number | null;
  sizeLabel?: string;
}): Promise<string> {
  const qrId = payload.idForQr?.trim();
  const qr = qrId ? await QRCode.toDataURL(stockDeductionQrUrl(qrId), {
    margin: 3,
    width: 512,
    errorCorrectionLevel: "M",
  }) : "";
  const receivedDate = formatThaiDateOrDash(payload.receivedDate);
  const openedDate = formatThaiDateOrBlank(payload.openedDate);
  const exp = formatThaiDateOrDash(payload.exp);
  const rows = `
  <div style="display:flex;align-items:center;justify-content:center;border-bottom:0.25mm solid #000;font-size:7pt;">สารเคมี</div>
  ${solventLabelRow("ชื่อสามัญ", payload.name || "")}
  ${solventLabelRow("แบชนัมเบอร์", payload.lotNo || "-")}
  ${solventLabelRow("วัน เดือน ปี ที่รับ", receivedDate)}
  ${solventLabelRow("วัน เดือน ปี ที่เปิดใช้", openedDate)}
  ${solventLabelRow("วัน เดือน ปี ที่หมดอายุ", exp)}
  ${solventLabelRow("ขวดที่", payload.bottleNo == null || payload.bottleNo === "" ? "-" : String(payload.bottleNo))}
  <div style="display:flex;align-items:center;padding:0 .8mm;border-top:0.25mm solid #000;font-size:4.8pt;background:#eee;white-space:nowrap;">F-CHM-01-03 Rev 00 : 12/09/67</div>`;

  if (!qr) {
    return `
<div style="font-family:'TH Sarabun New','Kanit',Tahoma,Arial,sans-serif;width:65mm;height:25mm;box-sizing:border-box;color:#000;background:#fff;overflow:hidden;border:0.25mm solid #000;display:grid;grid-template-rows:3.7mm repeat(6,3.05mm) 2.9mm;font-size:5.9pt;line-height:1;">${rows}
</div>`.trim();
  }

  return `
  <div style="font-family:'TH Sarabun New','Kanit',Tahoma,Arial,sans-serif;width:65mm;height:25mm;box-sizing:border-box;color:#000;background:#fff;overflow:hidden;display:grid;grid-template-columns:18mm 1fr;gap:1mm;align-items:center;padding:1mm;">
    <div style="width:18mm;height:23mm;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6mm;overflow:hidden;">
      <img src="${qr}" alt="qr" style="width:17mm;height:17mm;display:block;flex:0 0 auto;" />
  </div>
  <div style="height:23mm;box-sizing:border-box;border:0.25mm solid #000;display:grid;grid-template-rows:3.4mm repeat(6,2.85mm) 2.5mm;font-size:5.15pt;line-height:1;min-width:0;">${rows}
  </div>
</div>`.trim();
}
function formatThaiDateOrDash(value?: string | null): string {
  return formatDate(value);
}

function formatThaiDateOrBlank(value?: string | null): string {
  return formatDate(value, "");
}
function solventLabelRow(label: string, value: string): string {
  return `<div style="display:flex;align-items:end;padding:0 .8mm;min-width:0;"><span style="white-space:nowrap;">${escapeHtml(label)}</span><span style="flex:1;border-bottom:0.2mm solid #000;margin-left:.6mm;min-width:0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(value)}</span></div>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function labelRow(label: string, value: string): string {
  return `<div style="display:grid;grid-template-columns:14mm 1fr;border-bottom:0.25mm solid #000;min-width:0;"><div style="display:flex;align-items:center;border-right:0.25mm solid #000;padding:0 1mm;font-size:6.4pt;white-space:nowrap;">${escapeHtml(label)}</div><div style="display:flex;align-items:center;justify-content:center;padding:0 .8mm;font-size:6.2pt;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(value)}</div></div>`;
}

function formatStandardLabelRun(sequence: number | null | undefined, year: number | null | undefined): string {
  if (!Number.isInteger(sequence) || !Number.isInteger(year) || !sequence || sequence < 1 || !year || year < 2000) return "";
  return `${String(sequence).padStart(2, "0")}/${year}`;
}

function formatStandardLabelMarker(unit: StockUnitItem): string {
  const labelCode = unit.labelCode?.trim();
  if (labelCode) return labelCode;
  return formatStandardLabelRun(unit.labelRunNo, unit.labelRunYear);
}

function formatPurityLabel(unit: StockUnitItem): string {
  const source = unit as StockUnitItem & {
    purity?: string | number | null;
    percentPurity?: string | number | null;
    purityPercent?: string | number | null;
  };
  const value = source.purity ?? source.percentPurity ?? source.purityPercent;
  if (value === undefined || value === null || value === "") return "";
  const text = String(value).trim();
  return text.endsWith("%") ? text : `${text}%`;
}
