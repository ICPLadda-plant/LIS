import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import SampleLabelPrintTemplate from "@/components/petition/SampleLabelPrintTemplate";
import AdditionalSamplePrintTemplate from "@/components/petition/AdditionalSamplePrintTemplate";
import GoodsReceiptPrintTemplate, { GOODS_RECEIPT_CSS } from "@/components/warehouse/GoodsReceiptPrintTemplate";
import LabCalculationForm, { LAB_CALCULATION_CSS } from "@/components/petition/LabCalculationForm";
import ChemAnalysisReportTemplate, { CHEM_ANALYSIS_REPORT_CSS } from "@/components/petition/ChemAnalysisReportTemplate";
import LabResultReportTemplate, { LAB_REPORT_CSS } from "@/components/petition/LabResultReportTemplate";
import CoaReportTemplate, { COA_REPORT_CSS } from "@/components/coa/CoaReportTemplate";
import BalanceControlReport, { BALANCE_CONTROL_REPORT_CSS } from "@/components/lis/BalanceControlReport";
import EquipmentCheckReport, { EQUIPMENT_REPORT_CSS } from "@/components/lis/EquipmentCheckReport";
import { BALANCE_SCALES } from "@/lib/balanceControlChart";
import { buildStockLabelHtml } from "@/lib/stockLabel";
import { preparationWorksheet } from "@/lib/validationPreparationWorksheet";
import type { LabReportPage } from "@/lib/labReport";
import type { ChemReportSheet } from "@/lib/chemAnalysisReport";
import type { CoaReportPage } from "@/lib/coaReport";
import type { AdditionalSampleRequest, Petition } from "@/types/petition.types";
import type { GoodsReceipt } from "@/types/goodsReceipt.types";
import type { StockUnitItem } from "@/types/stock";

// ฟอร์มระบบนอกจากใบคำร้อง → render component พิมพ์จริงด้วยข้อมูลว่าง ให้แม่แบบเริ่มจากหน้าตาฟอร์มจริง
// ยังไม่ผูกช่องข้อมูล: แก้/บันทึกเป็นแม่แบบได้ แต่หน้าพิมพ์จริงยังใช้ฟอร์มเดิมของระบบ

const NOW = new Date().toISOString();
const item = (sampleName: string, batchNo = "") =>
  ({ seq: 1, sampleName, commonName: "", batchNo, sampleQuantity: 1, labelQuantities: [], parameters: [] });
const petitionOf = (items: unknown[]) =>
  ({ _id: "sample", petitionNo: "", dept: "production", status: "draft", items, submittedBy: { name: "" }, createdAt: NOW, additionalSampleRequests: [] }) as unknown as Petition;
const labPage: LabReportPage = {
  reportNo: "", reportDate: "", customer: { name: "", company: "", department: "", email: "", phone: "" },
  sample: { name: "", batchNo: "", productionDate: "", submissionNo: "", manufacturer: "", sampleNo: "", receivedDate: "", testedDate: "", reportedDate: "", condition: "" },
  rows: [{ testItem: "", result: "", criteria: "", method: "" }], analystName: "", labHeadName: "", remark: "",
};
const chemSheet: ChemReportSheet = {
  customer: { recipientName: "", department: "", sampleName: "", sampleCount: "", submissionNo: "", sentDate: "", sentTime: "", importDate: "", batchNo: "", testRound: "", importedFrom: "" },
  lab: { sampleNo: "", reportDate: "", samples: [], criteria: "", analystName: "", labHeadName: "" },
  qc: { passBatches: "", failBatches: "", remark: "", qcHeadName: "", usableBatches: "", unusableBatches: "", managerName: "", managerDate: "" },
};
const coaPage = { template: "standard", coaNo: "", revision: 0, issueDate: "", petitionNo: "", customer: {}, samples: [], remark: "", approvedBy: "", approvedAt: "" } as unknown as CoaReportPage;
const receipt: GoodsReceipt = { receiptNo: "", inspectionNo: "", petitionId: "", receipt: {}, inspection: {} };
const additionalRequest = { _id: "r1", qrCode: "SAMPLE", side: "qc", reason: "", items: [], requestedAt: NOW, requestedBy: { name: "" }, status: "requested" } as AdditionalSampleRequest;

type Capture = { render?: () => ReactElement; css?: string; pick?: string; html?: () => Promise<string> };
const CAPTURES: Record<string, Capture> = {
  "F-LAB-01-12": { render: () => <SampleLabelPrintTemplate petition={petitionOf([item("ตัวอย่าง")])} /> },
  "F-LAB-01-10": { render: () => <SampleLabelPrintTemplate petition={petitionOf([item("ตัวอย่าง อย.", "GMP")])} /> },
  "ใบนำส่งตัวอย่างเพิ่ม": {
    render: () => <AdditionalSamplePrintTemplate petition={{ ...petitionOf([]), additionalSampleRequests: [additionalRequest] } as Petition} request={additionalRequest} />,
  },
  "F-WAR-03-01": { render: () => <GoodsReceiptPrintTemplate doc={receipt} />, css: GOODS_RECEIPT_CSS, pick: ".gr-page1" },
  "F-WAR-03-02": { render: () => <GoodsReceiptPrintTemplate doc={receipt} />, css: GOODS_RECEIPT_CSS, pick: ".gr-page2" },
  "FM-QP-07-08-002": { render: () => <LabCalculationForm page={labPage} />, css: LAB_CALCULATION_CSS },
  "F-CHM-01-01": { render: () => <ChemAnalysisReportTemplate sheets={[chemSheet]} />, css: CHEM_ANALYSIS_REPORT_CSS },
  "F-CHM-01-03": { render: () => <LabResultReportTemplate pages={[labPage]} />, css: LAB_REPORT_CSS },
  COA: { render: () => <CoaReportTemplate pages={[coaPage]} />, css: COA_REPORT_CSS },
  "FM-WI-06-04-001": {
    render: () => {
      const scale = BALANCE_SCALES[0];
      return <BalanceControlReport scale={scale} config={{ scaleId: scale.id, brand: "", model: scale.model, weightCode: "", nominal: 100, mean: null, sd: null, updatedDate: "" }}
        limits={null} series={[]} domain={null} digits={scale.decimals} month={NOW.slice(0, 7)} printedBy="" printedAt={NOW} />;
    },
    css: BALANCE_CONTROL_REPORT_CSS,
  },
  "บันทึกการเช็กเครื่องมือประจำวัน": {
    render: () => <EquipmentCheckReport rows={[]} filters={{ date: NOW.slice(0, 10), room: "", instrument: "", status: "" }} printedBy="" printedAt={NOW} />,
    css: EQUIPMENT_REPORT_CSS,
  },
  "ใบเตรียมสาร / รายงาน Validation": { html: async () => preparationWorksheet({ analyte: "", method: "" }, [], null, []) },
  "ป้ายสาร Standard / สารเคมี": { html: () => buildStockLabelHtml({ qrId: "SAMPLE", itemName: "", lotNo: "" } as unknown as StockUnitItem) },
};

export const hasOtherFormCapture = (key: string) => key in CAPTURES;

/** HTML หน้าตาฟอร์มจริงของระบบ (ข้อมูลว่าง) สำหรับเริ่มแม่แบบ */
export async function captureOtherForm(key: string): Promise<string> {
  const cfg = CAPTURES[key];
  if (!cfg) throw new Error("ไม่พบฟอร์มนี้ในระบบ");
  if (cfg.html) {
    const doc = new DOMParser().parseFromString(await cfg.html(), "text/html");
    const css = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
    doc.body.querySelectorAll("style, script").forEach((s) => s.remove());
    return (css ? "<style>" + css + "</style>" : "") + doc.body.innerHTML;
  }
  const host = document.createElement("div");
  // ต้องอยู่ใน layout จริง เพื่อให้ FitToBox วัดขนาดได้
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:297mm;pointer-events:none;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(cfg.render!()));
    await new Promise((r) => setTimeout(r, 50)); // รอ effect (QR / ย่อให้พอดีกรอบ)
    // ทำงานกับสำเนา — ห้ามแก้ DOM ที่ React ถืออยู่ (unmount จะพัง)
    const copy = host.cloneNode(true) as HTMLElement;
    const inline = Array.from(copy.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
    copy.querySelectorAll("style, script").forEach((s) => s.remove());
    const picked = cfg.pick ? copy.querySelector<HTMLElement>(cfg.pick) : null;
    const html = picked ? picked.outerHTML : copy.innerHTML;
    if (!html.trim()) throw new Error("render ฟอร์มระบบไม่สำเร็จ");
    const css = [cfg.css ?? "", inline].filter(Boolean).join("\n");
    return (css ? "<style>" + css + "</style>" : "") + html;
  } finally {
    root.unmount();
    host.remove();
  }
}
