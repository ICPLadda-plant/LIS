export type PrintDocType = "sample-label" | "coa" | "service-request" | "stock-label" | "daily-check-report" | "goods-receipt";
export type PaperSize = "A4" | "label-100x50" | "label-65x25";
export type PrinterKind = "a4" | "sticker";
export type PrintOutputMode = "server" | "local";

export const PAPER_SIZES: PaperSize[] = ["A4", "label-100x50", "label-65x25"];

export const A4_PRINT_FONT_FAMILY = "'Angsana New', 'Cordia New', 'Sarabun', 'TH SarabunPSK', serif";
export const A4_PRINT_FONT_SIZE = "16pt";
export const A4_PRINT_HEADING_FONT_WEIGHT = "700";

export interface PrinterConfig {
  id: string;
  kind: PrinterKind;
  label: string;
  cupsPrinterUrl: string;
  isDefault: boolean;
  assignments?: PrinterAssignment[];
}

export interface PrinterAssignment {
  department: string;
  docTypes: PrintDocType[];
  paperSize: PaperSize;
}

export interface PrinterConfigInput {
  kind: PrinterKind;
  label?: string;
  cupsPrinterUrl: string;
  assignments?: PrinterAssignment[];
}

// Legacy per-document config shape kept temporarily so screens can keep using
// the old contract while the UI migrates to the printer registry.
export interface PrintConfig {
  slug: PrintDocType;
  printerName: string;
  cupsPrinterUrl: string;
  copies: number;
  paperSize: PaperSize;
}

export interface PrintConfigInput {
  printerName?: string;
  cupsPrinterUrl?: string;
  copies?: number;
  paperSize?: PaperSize;
}

export interface PrinterKindMeta {
  kind: PrinterKind;
  label: string;
  hint: string;
}

export const PRINTER_KINDS: PrinterKindMeta[] = [
  { kind: "a4", label: "A4", hint: "COA / ใบคำขอ / รายงาน Daily Check" },
  { kind: "sticker", label: "Sticker (ฉลาก)", hint: "ป้ายนำส่งตัวอย่าง / ฉลากขวด Stock" },
];

// เอกสารแต่ละชนิดพิมพ์ไปเครื่องชนิดไหน — mirror ของ server/lib/printerRouting.js
const DOC_TYPE_KIND: Record<PrintDocType, PrinterKind> = {
  "sample-label": "sticker",
  "stock-label": "sticker",
  "coa": "a4",
  "service-request": "a4",
  "daily-check-report": "a4",
  "goods-receipt": "a4",
};

export function docTypeToKind(docType: PrintDocType): PrinterKind {
  return DOC_TYPE_KIND[docType];
}

const PRINT_OUTPUT_MODE_STORAGE_PREFIX = "lis.print.outputMode.";

function storageKeyForKind(kind: PrinterKind): string {
  return `${PRINT_OUTPUT_MODE_STORAGE_PREFIX}${kind}`;
}

function normalizePrintOutputMode(value: unknown): PrintOutputMode {
  return value === "local" ? "local" : "server";
}

export function getPrintOutputMode(kind: PrinterKind): PrintOutputMode {
  if (typeof window === "undefined") return "server";
  try {
    return normalizePrintOutputMode(window.localStorage.getItem(storageKeyForKind(kind)));
  } catch {
    return "server";
  }
}

export function getPrintOutputModeForDocType(docType: PrintDocType): PrintOutputMode {
  return getPrintOutputMode(docTypeToKind(docType));
}

export function setPrintOutputMode(kind: PrinterKind, mode: PrintOutputMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyForKind(kind), normalizePrintOutputMode(mode));
  } catch {
    // localStorage can be unavailable in private/locked-down browser contexts.
  }
}

export function getPrintFontFamilyForDocType(docType: PrintDocType): string | undefined {
  return docTypeToKind(docType) === "a4" ? A4_PRINT_FONT_FAMILY : undefined;
}

export function getPrintFontSizeForDocType(docType: PrintDocType): string | undefined {
  return docTypeToKind(docType) === "a4" ? A4_PRINT_FONT_SIZE : undefined;
}

export function getPrintHeadingFontWeightForDocType(docType: PrintDocType): string | undefined {
  return docTypeToKind(docType) === "a4" ? A4_PRINT_HEADING_FONT_WEIGHT : undefined;
}

export interface PrintDocTypeMeta {
  slug: PrintDocType;
  label: string;
  defaultPaper: PaperSize;
}

export const PRINT_DOC_TYPES: PrintDocTypeMeta[] = [
  { slug: "sample-label",    label: "ป้ายนำส่งตัวอย่าง", defaultPaper: "label-100x50" },
  { slug: "coa",             label: "ใบรายงานผล (COA)",            defaultPaper: "A4" },
  { slug: "service-request", label: "ใบคำขอ (Petition)",            defaultPaper: "A4" },
  { slug: "stock-label",     label: "ฉลากขวด Stock", defaultPaper: "label-65x25" },
  { slug: "daily-check-report", label: "รายงานเช็กเครื่องมือ (Daily Check)", defaultPaper: "A4" },
  { slug: "goods-receipt", label: "ใบรับสินค้า/ใบตรวจสอบวัตถุดิบ (RM)", defaultPaper: "A4" },
];

export function getPrintDocType(slug: PrintDocType): PrintDocTypeMeta | undefined {
  return PRINT_DOC_TYPES.find((d) => d.slug === slug);
}

// เครื่องที่ระบบใช้พิมพ์ของ kind นั้น — ตัวที่ตั้ง default ไว้ ไม่งั้นตัวแรก
export function defaultPrinterFor(
  configs: PrinterConfig[] | undefined | null,
  kind: PrinterKind,
): PrinterConfig | undefined {
  const ofKind = (configs ?? []).filter((c) => c.kind === kind);
  return ofKind.find((c) => c.isDefault);
}

export function normalizeDepartment(value: unknown): string {
  // "ผลิต 03" กับ "ผลิต 3" คือแผนกเดียวกัน — ข้อมูลพนักงานใช้เลข 0 นำหน้า แต่การผูกเครื่องพิมพ์ไม่ใช้
  const raw = String(value ?? "").trim().replace(/\s+/g, " ").replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ""));
  if (!raw || raw === "all" || raw === "ทุกแผนก") return "";
  return raw;
}

export function pickPrinterAssignment(
  configs: PrinterConfig[] | undefined | null,
  docType: PrintDocType,
  department?: string,
): { printer: PrinterConfig; assignment: PrinterAssignment; paperSize: PaperSize } | undefined {
  const kind = docTypeToKind(docType);
  const normalizedDepartment = normalizeDepartment(department);
  const candidates = (configs ?? [])
    .filter((printer) => printer.kind === kind)
    .flatMap((printer) =>
      (printer.assignments ?? [])
        .filter((assignment) => assignment.docTypes.includes(docType))
        .map((assignment) => ({
          printer,
          assignment: {
            ...assignment,
            department: normalizeDepartment(assignment.department),
            paperSize: assignment.paperSize ?? getPrintDocType(docType)?.defaultPaper ?? "A4",
          },
        })),
    )
    .filter(({ assignment }) => assignment.department === normalizedDepartment || assignment.department === "");

  const exact = candidates.filter(({ assignment }) => assignment.department === normalizedDepartment);
  const usable = exact.length > 0 ? exact : candidates.filter(({ assignment }) => assignment.department === "");
  const picked = usable[0];
  if (!picked) return undefined;
  return { ...picked, paperSize: picked.assignment.paperSize };
}

function uniquePrinters(routes: { printer: PrinterConfig }[]): PrinterConfig[] {
  const seen = new Set<string>();
  const printers: PrinterConfig[] = [];
  for (const route of routes) {
    if (seen.has(route.printer.id)) continue;
    seen.add(route.printer.id);
    printers.push(route.printer);
  }
  return printers;
}

export function eligiblePrintersForDocument(
  configs: PrinterConfig[] | undefined | null,
  docType: PrintDocType,
  department?: string,
  options?: { includeAnyDepartment?: boolean },
): PrinterConfig[] {
  const kind = docTypeToKind(docType);
  const normalizedDepartment = normalizeDepartment(department);
  const printers = (configs ?? []).filter((printer) => printer.kind === kind);
  const assignmentRoutes = printers.flatMap((printer) =>
    (printer.assignments ?? [])
      .filter((assignment) => assignment.docTypes.includes(docType))
      .map((assignment) => ({
        printer,
        department: normalizeDepartment(assignment.department),
      })),
  );

  if (options?.includeAnyDepartment) {
    const assigned = uniquePrinters(assignmentRoutes.map(({ printer }) => ({ printer })));
    return assigned.length > 0 ? assigned : printers.filter((printer) => (printer.assignments ?? []).length === 0);
  }

  const exact = assignmentRoutes.filter((route) => route.department === normalizedDepartment);
  if (exact.length > 0) return uniquePrinters(exact.map(({ printer }) => ({ printer })));

  const fallback = assignmentRoutes.filter((route) => route.department === "");
  if (fallback.length > 0) return uniquePrinters(fallback.map(({ printer }) => ({ printer })));

  return printers.filter((printer) => (printer.assignments ?? []).length === 0);
}

export function paperSizeForPrinterDocument(
  printer: PrinterConfig | undefined,
  docType: PrintDocType,
  department?: string,
  options?: { includeAnyDepartment?: boolean },
): PaperSize | undefined {
  if (!printer) return undefined;
  const normalizedDepartment = normalizeDepartment(department);
  const assignments = (printer.assignments ?? []).filter((assignment) => assignment.docTypes.includes(docType));
  if (options?.includeAnyDepartment) return assignments[0]?.paperSize;
  const exact = assignments.find((assignment) => normalizeDepartment(assignment.department) === normalizedDepartment);
  if (exact) return exact.paperSize;
  return assignments.find((assignment) => normalizeDepartment(assignment.department) === "")?.paperSize;
}

export function isPrinterConfigured(config?: PrintConfig | null): boolean {
  if (!config) return false;
  return Boolean(config.cupsPrinterUrl?.trim() || config.printerName?.trim());
}

const URL_PROTOCOLS = ["http:", "https:", "ipp:", "ipps:"];
const HOST_WITH_OPTIONAL_PORT = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

function hasUrlProtocol(raw: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw);
}

// mirror ของ validatePrinterInput ใน server/lib/printerRouting.js
export function validatePrinterUrl(url: string): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return "ต้องระบุ Printer IP / URL";
  let u: URL;
  try {
    const normalized = hasUrlProtocol(raw) ? raw : `ipp://${raw}`;
    if (!hasUrlProtocol(raw) && !HOST_WITH_OPTIONAL_PORT.test(raw)) {
      return "Printer IP / URL ไม่ถูกต้อง";
    }
    u = new URL(normalized);
  } catch {
    return "Printer IP / URL ไม่ถูกต้อง";
  }
  if (!URL_PROTOCOLS.includes(u.protocol)) {
    return "Printer IP / URL ต้องเป็น IP เครื่องปริ้น, http, https, ipp หรือ ipps";
  }
  return null;
}

export function validatePrintConfig(input: PrintConfigInput): string | null {
  const printerName = (input.printerName ?? "").trim();
  const cupsPrinterUrl = (input.cupsPrinterUrl ?? "").trim();
  if (!printerName && !cupsPrinterUrl) {
    return "ต้องระบุ Printer IP / URL";
  }
  if (!cupsPrinterUrl) return null;
  return validatePrinterUrl(cupsPrinterUrl);
}
