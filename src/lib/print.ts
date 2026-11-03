import { api } from "@/lib/api";
import {
  getPrintFontFamilyForDocType,
  getPrintFontSizeForDocType,
  getPrintHeadingFontWeightForDocType,
  getPrintOutputModeForDocType,
  getPrintDocType,
  type PaperSize,
  type PrintDocType,
  type PrintOutputMode,
} from "@/lib/printConfig";

export function serializeForPrint(el: HTMLElement | null, css?: string): string {
  if (!el) throw new Error("ไม่พบเนื้อหาสำหรับพิมพ์");
  const body = el.outerHTML;
  return css ? `<style>${css}</style>${body}` : body;
}

export function collectDocumentCss(): string {
  let css = "";
  if (typeof document === "undefined") return css;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      css += rule.cssText + "\n";
    }
  }
  return css;
}

function printBaseCss(docType: PrintDocType): string {
  const fontFamily = getPrintFontFamilyForDocType(docType);
  const fontSize = getPrintFontSizeForDocType(docType);
  const headingWeight = getPrintHeadingFontWeightForDocType(docType);
  if (!fontFamily) return "";
  return [
    `html, body { font-family: ${fontFamily}; font-size: ${fontSize}; }`,
    `h1, h2, h3, h4, h5, h6, th, .print-heading { font-weight: ${headingWeight}; }`,
  ].join("\n");
}

function documentHtml(docType: PrintDocType, el: HTMLElement | null, css?: string): string {
  const combinedCss = [collectDocumentCss(), printBaseCss(docType), css].filter(Boolean).join("\n");
  return serializeForPrint(el, combinedCss || undefined);
}

export interface PrintResult {
  printer: string;
  copies: number;
}

type ServerPrintOptions = {
  copies?: number;
  outputMode?: PrintOutputMode;
  printerConfigId?: string;
  department?: string;
  paperSize?: PaperSize;
};

export function localPrintPageCss(docType: PrintDocType, paperSize?: PaperSize): string {
  const resolvedPaperSize = paperSize ?? getPrintDocType(docType)?.defaultPaper ?? "A4";
  if (resolvedPaperSize === "label-100x50") {
    return "@page { size: 100mm 50mm; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }";
  }
  if (resolvedPaperSize === "label-65x25") {
    return "@page { size: 65mm 25mm; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }";
  }
  return "@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }";
}

function localPrintDocument(title: string, html: string, docType: PrintDocType, paperSize?: PaperSize): string {
  return `<!DOCTYPE html>
<html lang="th">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${localPrintPageCss(docType, paperSize)}</style>
  </head>
  <body>${html}</body>
</html>`;
}

function openLocalPrintWindow(title: string, html: string, docType: PrintDocType, paperSize?: PaperSize): void {
  const iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.setAttribute("aria-hidden", "true");

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 500);
  };

  iframe.onload = () => {
    const printWindow = iframe.contentWindow;
    if (!printWindow) {
      cleanup();
      throw new Error("เปิด print dialog ของเครื่องนี้ไม่สำเร็จ");
    }
    printWindow.onafterprint = cleanup;
    printWindow.focus();
    // รอให้ฟอนต์เอกสาร (เช่น Angsana New ที่ส่งจาก server) โหลดเสร็จก่อนเปิด print dialog
    const fontsReady = printWindow.document.fonts?.ready ?? Promise.resolve();
    const fontTimeout = new Promise((resolve) => window.setTimeout(resolve, 3000));
    void Promise.race([fontsReady, fontTimeout]).then(() => {
      window.setTimeout(() => {
        printWindow.print();
        window.setTimeout(cleanup, 60_000);
      }, 50);
    });
  };

  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    cleanup();
    throw new Error("เตรียมเอกสารสำหรับพิมพ์จากเครื่องนี้ไม่สำเร็จ");
  }
  doc.open();
  doc.write(localPrintDocument(title, html, docType, paperSize));
  doc.close();
}

export async function printDocument(
  docType: PrintDocType,
  el: HTMLElement | null,
  opts?: { css?: string } & ServerPrintOptions,
): Promise<PrintResult> {
  const html = documentHtml(docType, el, opts?.css);
  if ((opts?.outputMode ?? getPrintOutputModeForDocType(docType)) === "local") {
    openLocalPrintWindow(docType, html, docType, opts?.paperSize);
    return { printer: "เครื่องนี้", copies: opts?.copies ?? 1 };
  }
  return api.printDocument({
    docType,
    html,
    copies: opts?.copies,
    printerConfigId: opts?.printerConfigId,
    department: opts?.department,
    paperSize: opts?.paperSize,
  });
}

export async function printRawHtmlDocument(
  docType: PrintDocType,
  html: string,
  opts?: ServerPrintOptions,
): Promise<PrintResult> {
  if ((opts?.outputMode ?? getPrintOutputModeForDocType(docType)) === "local") {
    openLocalPrintWindow(docType, html, docType, opts?.paperSize);
    return { printer: "เครื่องนี้", copies: opts?.copies ?? 1 };
  }
  return api.printDocument({
    docType,
    html,
    copies: opts?.copies,
    printerConfigId: opts?.printerConfigId,
    department: opts?.department,
    paperSize: opts?.paperSize,
  });
}

export async function openPrintPdf(
  docType: PrintDocType,
  el: HTMLElement | null,
  opts?: { css?: string; fileName?: string },
): Promise<void> {
  const html = documentHtml(docType, el, opts?.css);
  const blob = await api.downloadPrintPdf({ docType, html });
  const url = URL.createObjectURL(blob);
  if (opts?.fileName) {
    const link = document.createElement("a");
    link.href = url;
    link.download = opts.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } else {
    const opened = window.open(url, "_blank", "noopener");
    if (!opened) {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${docType}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
