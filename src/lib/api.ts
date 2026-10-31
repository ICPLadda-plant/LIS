import type { SampleItem } from "@/components/lis/SampleColumn";
import type { ApprovalInfo, PhysicalResult, RealtimeDensity } from "@/context/SampleContext";
import type {
  StockStandardItem,
  StockSolventItem,
  StockGlasswareItem,
  StockTransactionItem,
  StockTier,
  StockItemType,
  StockUnitItem,
  StockPublicScanItem,
  DeductionResolutionReason,
  StandardsInUseResponse,
  SixMonthMedicineStockResponse,
} from "@/types/stock";
import type { EnvRoomConfig, EnvRoomConfigInput } from "@/lib/dailyCheckEnv";
import type { DailyCheckPeriod } from "@/lib/dailyCheckPeriod";
import type { StandardLabelCodeDefaults } from "@/lib/standardLabelCode";
import {
  defaultPrinterFor,
  docTypeToKind,
  getPrintDocType,
  type PrintConfig,
  type PrintConfigInput,
  type PrintDocType,
  type PaperSize,
  type PrinterConfig,
  type PrinterConfigInput,
} from "@/lib/printConfig";
import type { DocumentNumberConfig, DocumentNumberConfigInput, DocNumberType } from "@/lib/documentNumberConfig";
import type { LineGroup, LineGroupInput, LineHealth } from "@/lib/lineConfig";
import type { DashboardId, StoredLayout, DashboardLayout } from "@/lib/dashboardLayout";
import type { MethodDoc, MethodInput } from './methodRegistry';
import type { ChemicalRequisition } from "@/lib/chemicalRequisition";
import type { GoodsReceipt, GoodsReceiptInput } from "@/types/goodsReceipt.types";
import type { CoaDocument, CoaErpAutofill, CoaFormSelection, CoaLabAiLookup, CoaSourceResult, EligibleCoaPetition, ManualCoaInput } from "@/types/coa.types";
import type { PetitionAuditEvent, PetitionStatus } from "@/types/petition.types";
import type {
  ApiKeyItem,
  ApiKeyInput,
  ApiKeyMeta,
  ApiPolicyMode,
  ApiRequestLogItem,
  CreatedApiKey,
} from "@/lib/apiKeys";

type StockUserPayload = { _user?: { email?: string; name?: string } };
type ApiError = Error & { response?: { data: unknown }; field?: string; status?: number };
type StockBarcodeRegistration = {
  barcode: string;
  category: StockItemType;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  barcodes?: string[];
};
export interface StockTransactionParams {
  itemType?: string;
  itemId?: string;
  qrId?: string;
  action?: string;
  search?: string;
  user?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  skip?: number;
}

export interface PetitionFlowNotification {
  id: string;
  petitionId?: string;
  petitionNo: string;
  event?: PetitionAuditEvent;
  fromStatus?: PetitionStatus;
  toStatus?: PetitionStatus;
  title: string;
  message?: string;
  level: "info" | "warning" | "success" | "error";
  link: string;
  createdAt: string;
  playSound?: boolean;
  sound?: "sampleArrival" | "labAssigned";
}

export type UserFavorites = { email: string; paths: string[] };
export type UserSignatureResponse = { signatureUrl: string | null };
export type PushDevice = { id: string; label: string; current: boolean; createdAt?: string };
export type PushDevicesState = { configured: boolean; publicKey: string | null; paused: boolean; devices: PushDevice[] };
export type PushSubscriptionPayload = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushTestResult = { sent: number; failed: number; removed: number; total: number };

// Development: BASE_URL = "/" → "/api"
// Production:  BASE_URL = "/LIS/" → "/LIS/api"
function normalizeBaseUrl(value: string | undefined) {
  const base = (value || "").trim().replace(/\/+$/, "");
  return base || "";
}

const APP_API_BASE = `${normalizeBaseUrl(import.meta.env.BASE_URL)}/api`;
const API_BASES = Array.from(
  new Set(
    [
      normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
      APP_API_BASE,
      "/api",
      "/LIS/api",
    ].filter(Boolean),
  ),
);

// อีเมลผู้ใช้ที่ล็อกอินอยู่ — ส่งไปกับทุก request เป็น header X-LIS-User เพื่อให้
// backend ตรวจสิทธิ์ admin ของ route /api-keys ได้ (AuthContext เป็นคนตั้งค่า)
// ⚠️ ไม่ใช่ security จริง (ปลอมได้) เฟส 2 จะเปลี่ยนไปใช้ Azure AD token
// Dev mode synthesizes the user after the access matrix loads. Seed the
// identity first so that the matrix request itself is not rejected by the
// backend's X-LIS-User guard before AuthContext's effect can run.
let currentUserEmail = import.meta.env.DEV ? "admin.dev@icpladda.com" : "";
const DEV_EMAIL_SUFFIX = ".dev@icpladda.com";

export function setApiUserEmail(email?: string | null) {
  currentUserEmail = email ? String(email) : "";
}

function devDepartmentHeader() {
  if (!currentUserEmail.toLowerCase().endsWith(DEV_EMAIL_SUFFIX)) return "";
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("dev_department")?.trim() || "";
}

function identityHeaders(): Record<string, string> {
  const headers: Record<string, string> = currentUserEmail ? { "X-LIS-User": currentUserEmail } : {};
  const devDepartment = devDepartmentHeader();
  if (devDepartment) headers["X-LIS-Department"] = encodeURIComponent(devDepartment);
  return headers;
}

async function fetchApi(path: string, options?: RequestInit): Promise<unknown> {
  let lastError: Error | null = null;

  for (let i = 0; i < API_BASES.length; i += 1) {
    const base = API_BASES[i];
    const res = await fetch(`${base}${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...identityHeaders(), ...options?.headers },
    });
    const contentType = res.headers.get("content-type") || "";

    if (res.ok) {
      if (contentType.includes("application/json")) {
        return res.json();
      }
      lastError = new Error(`API returned non-JSON response from ${base}${path}`);
      continue;
    }

    if (res.status === 404 && i < API_BASES.length - 1) {
      continue;
    }

    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message =
      typeof body === "object" && body
        ? String(
            (body as { message?: unknown }).message ||
              (body as { error?: { message?: unknown } }).error?.message ||
              (body as { error?: unknown }).error ||
              "API Error",
          )
        : "API Error";
    const err = new Error(message) as ApiError;
    err.status = res.status;
    err.response = { data: body };
    const field =
      typeof body === "object" && body
        ? (body as { field?: unknown }).field
        : undefined;
    if (typeof field === "string") err.field = field;
    throw err;
  }

  throw lastError ?? new Error("API Error");
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchApi(path, options) as Promise<T>;
}

type PrintResult = { printer: string; copies: number };

function toLegacyPrintConfig(
  docType: PrintDocType,
  printers: PrinterConfig[] | undefined | null,
): PrintConfig {
  const chosen = defaultPrinterFor(printers, docTypeToKind(docType));
  return {
    slug: docType,
    printerName: chosen?.label ?? "",
    cupsPrinterUrl: chosen?.cupsPrinterUrl ?? "",
    copies: 1,
    paperSize: getPrintDocType(docType)?.defaultPaper ?? "A4",
  };
}

// Generic axios-style methods for pages that use api.get/api.patch pattern
async function axiosStyleRequest<T>(path: string, options?: RequestInit): Promise<{ data: { data: T } }> {
  const data = await fetchApi(path, options);
  return { data: { data: data as T } };
}

// Fetch a binary file (e.g. export to xlsx/pdf). Tries each API base; on a JSON
// response treats it as an error body (server reports failures as JSON).
async function fetchBlob(path: string, options?: RequestInit): Promise<Blob> {
  let lastError: Error | null = null;
  for (let i = 0; i < API_BASES.length; i += 1) {
    const base = API_BASES[i];
    const res = await fetch(`${base}${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...identityHeaders(), ...options?.headers },
    });
    const contentType = res.headers.get("content-type") || "";
    if (res.ok && !contentType.includes("application/json")) {
      return res.blob();
    }
    if (res.status === 404 && i < API_BASES.length - 1) continue;
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = (body && typeof body === "object")
      ? String((body as { error?: unknown; message?: unknown }).error
          || (body as { message?: unknown }).message
          || "Export failed")
      : "Export failed";
    if (res.ok) { lastError = new Error(message); continue; }
    throw new Error(message);
  }
  throw lastError ?? new Error("Export failed");
}

export const api = {
  get: <T>(path: string) => axiosStyleRequest<T>(path),
  post: <T>(path: string, body?: unknown) =>
    axiosStyleRequest<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    axiosStyleRequest<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    axiosStyleRequest<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => axiosStyleRequest<T>(path, { method: "DELETE" }),
  // Export Master Item rows to a downloadable file (xlsx or pdf)
  exportMasterItems: (format: "xlsx" | "pdf", rows: unknown[], title?: string) =>
    fetchBlob("/master-items/export", {
      method: "POST",
      body: JSON.stringify({ format, rows, title }),
    }),
  // Auth
  login: (email: string, password: string) =>
    request<{ email: string; name: string; role: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  ssoLogin: (token: string) =>
    request<{
      id?: string;
      email: string;
      name?: string;
      role?: string;
      permissions?: string[];
      department?: string;
      position?: string;
      signatureUrl?: string;
      status?: "active" | "inactive";
    }>("/auth/sso", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  // Samples
  saveMySignature: (signatureDataUrl: string) =>
    request<UserSignatureResponse>("/profile/signature", { method: "PUT", body: JSON.stringify({ signatureDataUrl }) }),

  // แจ้งเตือน PWA (Web Push) — server/routes/push.js
  getPushDevices: (endpoint?: string) =>
    request<PushDevicesState>(`/push/devices${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`),
  subscribePush: (subscription: PushSubscriptionPayload, deviceLabel: string) =>
    request<PushDevicesState>("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription, deviceLabel }) }),
  unsubscribePush: (endpoint: string) =>
    request<PushDevicesState>("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  setPushPaused: (paused: boolean, endpoint?: string) =>
    request<PushDevicesState>("/push/pause", { method: "POST", body: JSON.stringify({ paused, endpoint }) }),
  sendTestPush: () => request<PushTestResult>("/push/test", { method: "POST", body: "{}" }),

  getSamples: () => request<SampleItem[]>("/samples"),
  createSample: (data: Partial<SampleItem>) =>
    request<SampleItem>("/samples", { method: "POST", body: JSON.stringify(data) }),
  updateSample: (id: string, data: Partial<SampleItem>) =>
    request<SampleItem>(`/samples/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSample: (id: string) =>
    request(`/samples/${id}`, { method: "DELETE" }),

  // Physical Results
  getPhysicalResults: () => request<Record<string, PhysicalResult>>("/physical-results"),
  upsertPhysicalResult: (data: Partial<PhysicalResult> & { sampleId: string }) =>
    request<PhysicalResult>("/physical-results", { method: "POST", body: JSON.stringify(data) }),

  // Approvals
  getApprovals: () => request<Record<string, ApprovalInfo>>("/approvals"),
  approveLab: (sampleId: string) =>
    request(`/approvals/${sampleId}/lab`, { method: "POST" }),
  approveQC: (sampleId: string, status: "approved" | "rejected" | "pending", note?: string) =>
    request(`/approvals/${sampleId}/qc`, { method: "POST", body: JSON.stringify({ status, note }) }),

  // Densities
  getDensities: () => request<RealtimeDensity[]>("/densities"),
  pushDensity: (data: RealtimeDensity) =>
    request<RealtimeDensity>("/densities", { method: "POST", body: JSON.stringify(data) }),
  deleteDensity: (sampleId: string) =>
    request<{ success: boolean }>(`/densities/${encodeURIComponent(sampleId)}`, { method: 'DELETE' }),

  // Result Density (DMA 501 — reads from Result-Density collection)
  getResultDensities: (params?: { page?: number; limit?: number; search?: string; product?: string; date?: string; status?: string }) => {
    const p = new URLSearchParams();
    if (params?.page) p.set('page', String(params.page));
    if (params?.limit) p.set('limit', String(params.limit));
    if (params?.search) p.set('search', params.search);
    if (params?.product) p.set('product', params.product);
    if (params?.date) p.set('date', params.date);
    if (params?.status) p.set('status', params.status);
    const qs = p.toString() ? `?${p.toString()}` : '';
    return request<{ docs: Record<string, unknown>[]; total: number; page: number; limit: number }>(`/result-densities${qs}`);
  },
  getResultDensityProducts: () => request<string[]>('/result-densities/products'),
  // DMA 501 readings whose displayed Batch column matches `batch`.
  getResultDensitiesByBatch: (batch: string) =>
    request<{ batch: string; docs: Record<string, unknown>[] }>(
      `/result-densities/by-batch/${encodeURIComponent(batch)}`,
    ),
  getRequestValues: (payload: { collectionName: string; collectionMatchField?: string; batchField?: string; sampleField?: string; valueField: string; refs: { value?: string; batch?: string; sample?: string }[] }) =>
    request<{ values: Record<string, unknown> }>('/request-values', { method: 'POST', body: JSON.stringify(payload) }),
  getRequestValueCollections: () => request<string[]>('/request-values/collections'),
  getRequestValueFields: (collectionName: string) => request<string[]>(`/request-values/fields?collectionName=${encodeURIComponent(collectionName)}`),
  getPetitionValueFields: () => request<string[]>('/request-values/petition-fields'),
  // Fire the n8n webhook that makes the plant push fresh DMA 501 readings into
  // Result-Density. Returns once n8n has accepted the trigger (async on their side).
  triggerDensitySync: () =>
    request<{ triggered: boolean }>('/result-densities/sync', { method: 'POST' }),

  // Instrument readings (pull values live from lab instruments) ----------------
  // Config CRUD (managed in Settings)
  getInstrumentSources: () => request<InstrumentSource[]>("/instrument-readings/sources"),
  createInstrumentSource: (data: Partial<InstrumentSource>) =>
    request<InstrumentSource>("/instrument-readings/sources", { method: "POST", body: JSON.stringify(data) }),
  updateInstrumentSource: (id: string, data: Partial<InstrumentSource>) =>
    request<InstrumentSource>(`/instrument-readings/sources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteInstrumentSource: (id: string) =>
    request<{ success: true }>(`/instrument-readings/sources/${id}`, { method: "DELETE" }),
  // Live pull: fetch the latest reading for a configured param key.
  fetchInstrumentReading: (key: string) =>
    request<InstrumentReading>(`/instrument-readings/${encodeURIComponent(key)}/latest`),

  // Stock — Standards
  getStandards: () => request<StockStandardItem[]>("/stock/standards"),
  createStandard: (data: Partial<StockStandardItem> & StockUserPayload) =>
    request<StockStandardItem>("/stock/standards", { method: "POST", body: JSON.stringify(data) }),
  updateStandard: (id: string, data: Partial<StockStandardItem> & StockUserPayload) =>
    request<StockStandardItem>(`/stock/standards/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteStandard: (id: string) =>
    request<{ success: true }>(`/stock/standards/${id}`, { method: "DELETE" }),
  deductStandard: (id: string, body: { tier: StockTier; qty: number; sampleId?: string; note?: string } & StockUserPayload) =>
    request<StockStandardItem>(`/stock/standards/${id}/deduct`, { method: "POST", body: JSON.stringify(body) }),
  receiveStandard: (id: string, body: { tier: StockTier; qty: number; note?: string } & StockUserPayload) =>
    request<StockStandardItem>(`/stock/standards/${id}/receive`, { method: "POST", body: JSON.stringify(body) }),
  registerStockBarcode: (body: Pick<StockBarcodeRegistration, "barcode" | "category" | "itemId"> & StockUserPayload) =>
    request<StockBarcodeRegistration>("/stock/barcodes/register", { method: "POST", body: JSON.stringify(body) }),

  // Stock — Solvents
  getSolvents: () => request<StockSolventItem[]>("/stock/solvents"),
  createSolvent: (data: Partial<StockSolventItem> & StockUserPayload) =>
    request<StockSolventItem>("/stock/solvents", { method: "POST", body: JSON.stringify(data) }),
  updateSolvent: (id: string, data: Partial<StockSolventItem> & StockUserPayload) =>
    request<StockSolventItem>(`/stock/solvents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSolvent: (id: string) =>
    request<{ success: true }>(`/stock/solvents/${id}`, { method: "DELETE" }),
  deductSolvent: (id: string, body: { qty: number; sampleId?: string; note?: string } & StockUserPayload) =>
    request<StockSolventItem>(`/stock/solvents/${id}/deduct`, { method: "POST", body: JSON.stringify(body) }),
  receiveSolvent: (id: string, body: { qty: number; lotNo: string; exp: string; sizeLiter: number; price: number; note?: string } & StockUserPayload) =>
    request<StockSolventItem & { receivedUnits?: StockUnitItem[] }>(`/stock/solvents/${id}/receive`, { method: "POST", body: JSON.stringify(body) }),

  // Chemical requisition — เบิกสารเคมี (solvent) → เครื่อง (daily-check/analysis)
  getChemicalRequisitions: (params: { room: string; date?: string }) => {
    const qs =
      "?" +
      new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString();
    return request<{ data: ChemicalRequisition[] }>(`/chemical-requisitions${qs}`).then((r) => r.data);
  },
  createChemicalRequisition: (body: {
    roomSlug: string;
    date: string;
    instrumentId: string;
    instrumentName: string;
    solventId: string;
    solventUnitQrId?: string;
    qty: number;
    note?: string;
    requestedBy: { email: string; name: string };
  }) =>
    request<{ requisition: ChemicalRequisition; solvent: StockSolventItem }>(
      "/chemical-requisitions",
      { method: "POST", body: JSON.stringify(body) },
    ),
  deleteChemicalRequisition: (id: string) =>
    request<{ ok: true }>(`/chemical-requisitions/${id}`, { method: "DELETE" }),

  // Stock — Glassware
  getGlassware: () => request<StockGlasswareItem[]>("/stock/glassware"),
  createGlassware: (data: Partial<StockGlasswareItem> & StockUserPayload) =>
    request<StockGlasswareItem>("/stock/glassware", { method: "POST", body: JSON.stringify(data) }),
  updateGlassware: (id: string, data: Partial<StockGlasswareItem> & StockUserPayload) =>
    request<StockGlasswareItem>(`/stock/glassware/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteGlassware: (id: string) =>
    request<{ success: true }>(`/stock/glassware/${id}`, { method: "DELETE" }),
  deductGlassware: (id: string, body: { qty: number; sampleId?: string; note?: string } & StockUserPayload) =>
    request<StockGlasswareItem>(`/stock/glassware/${id}/deduct`, { method: "POST", body: JSON.stringify(body) }),
  receiveGlassware: (id: string, body: { qty: number; note?: string } & StockUserPayload) =>
    request<StockGlasswareItem>(`/stock/glassware/${id}/receive`, { method: "POST", body: JSON.stringify(body) }),

  // Stock — Transactions (audit log)
  getStockTransactions: (params?: StockTransactionParams) => {
    const qs = params
      ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()
      : "";
    return request<StockTransactionItem[]>(`/stock/transactions${qs}`);
  },
  exportStockStandardHistory: (params: { itemId: string; startDate: string; endDate: string; format?: "xlsx" | "pdf" }) => {
    const qs = new URLSearchParams(
      Object.entries({ format: "xlsx", ...params }).map(([key, value]) => [key, String(value)]),
    ).toString();
    return fetchBlob(`/stock/exports/standard?${qs}`);
  },
  exportStockSolventHistory: (params: { solventId: string; date: string }) => {
    const qs = new URLSearchParams(params).toString();
    return fetchBlob(`/stock/exports/solvent?${qs}`);
  },
  getPendingStockDeductions: (params: {
    itemType: "standard" | "solvent";
    itemId?: string;
    itemCode?: string;
    instrumentId?: string;
    instrumentGroup?: "gc" | "hplc";
    excludeQrId?: string;
  }) => {
    const qs = "?" + new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<StockTransactionItem[]>(`/stock/transactions/pending-deduction${qs}`);
  },
  resolveStockDeduction: (
    id: string,
    body: { reason: DeductionResolutionReason; note?: string } & StockUserPayload,
  ) =>
    request<StockTransactionItem>(`/stock/transactions/${encodeURIComponent(id)}/resolve-deduction`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateStockDeduction: (
    id: string,
    body: { amount?: number; weights?: number[]; note?: string } & StockUserPayload,
  ) =>
    request<StockTransactionItem>(`/stock/transactions/${encodeURIComponent(id)}/deduction`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteStockDeduction: (id: string, body?: StockUserPayload) =>
    request<{ ok: true }>(`/stock/transactions/${encodeURIComponent(id)}/deduction`, {
      method: "DELETE",
      body: JSON.stringify(body ?? {}),
    }),
  getStandardsInUse: () => request<StandardsInUseResponse>("/stock/standards/in-use"),
  getSixMonthMedicineStock: () => request<SixMonthMedicineStockResponse>("/stock/medicine-six-months"),

  // Stock — Units (per-bottle)
  getStockUnits: (params?: { itemCode?: string; itemType?: string; itemId?: string; status?: string; kind?: string; labelCode?: string }) => {
    const q = new URLSearchParams();
    if (params?.itemCode) q.set("itemCode", params.itemCode);
    if (params?.itemType) q.set("itemType", params.itemType);
    if (params?.itemId) q.set("itemId", params.itemId);
    if (params?.status) q.set("status", params.status);
    if (params?.kind) q.set("kind", params.kind);
    if (params?.labelCode) q.set("labelCode", params.labelCode);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return request<StockUnitItem[]>(`/stock/units${qs}`);
  },
  getStockUnit: (qrId: string) =>
    request<StockUnitItem>(`/stock/units/${encodeURIComponent(qrId)}`),
  getPublicStockItem: (qrId: string) =>
    request<StockPublicScanItem>(`/stock/public/${encodeURIComponent(qrId)}`),
  deductStockUnitMg: (
    qrId: string,
    body: { weights?: number[]; mg?: number; instrumentGroup?: "gc" | "hplc"; instrumentId?: string; instrumentName?: string; sampleId?: string; petitionNo?: string; note?: string } & StockUserPayload,
  ) =>
    request<StockUnitItem>(`/stock/units/${encodeURIComponent(qrId)}/deduct-mg`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getStandardLabelCodeDefaults: (standardId: string, count = 1) =>
    request<StandardLabelCodeDefaults>(`/stock/standards/${standardId}/label-codes/defaults?count=${encodeURIComponent(String(count))}`),
  receiveStockUnits: (
    standardId: string,
    body: { lotNo?: string; purity: string; sizeMl: number; unit?: "ml" | "mg" | "g"; type: "primary" | "supplier" | "working"; bottles: { exp?: string; labelCode?: string }[]; note?: string } & StockUserPayload,
  ) =>
    request<StockUnitItem[]>(`/stock/standards/${standardId}/units/receive`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  discardStockUnit: (qrId: string, body: { reason?: string; outcome?: "empty" | "discard" } & StockUserPayload) =>
    request<{ status: string; qrId: string }>(`/stock/units/${encodeURIComponent(qrId)}/discard`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateStockUnit: (
    qrId: string,
    body: { lotNo?: string; exp?: string | null; type?: "primary" | "supplier" | "working" | ""; labelCode?: string; photoUrls?: string[]; volume?: { initial?: number; remaining?: number; unit?: string } },
  ) =>
    request<StockUnitItem>(`/stock/units/${encodeURIComponent(qrId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // Machines (รายการเครื่อง)
  getMachines: () => request<MachineItem[]>("/machines"),
  createMachine: (data: Partial<MachineItem>) =>
    request<MachineItem>("/machines", { method: "POST", body: JSON.stringify(data) }),
  updateMachine: (id: string, data: Partial<MachineItem>) =>
    request<MachineItem>(`/machines/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMachine: (id: string) =>
    request<{ success: true }>(`/machines/${id}`, { method: "DELETE" }),
  seedMachines: () =>
    request<{ inserted: number; matched: number; total: number }>("/machines/seed", { method: "POST" }),

  // Virtual Lab
  getVirtualLabRooms: () =>
    request<{ data: VirtualLabRoom[] }>("/virtual-lab/rooms").then((r) => r.data),
  createVirtualLabRoom: (name: string) =>
    request<{ data: VirtualLabRoom }>("/virtual-lab/rooms", {
      method: "POST",
      body: JSON.stringify({ name }),
    }).then((r) => r.data),
  addVirtualLabInstrument: (roomId: string, machineId: string) =>
    request<{ data: VirtualLabRoom }>(`/virtual-lab/rooms/${roomId}/instruments`, {
      method: "POST",
      body: JSON.stringify({ machineId }),
    }).then((r) => r.data),
  updateVirtualLabInstrument: (
    roomId: string,
    instrumentId: string,
    data: Partial<Pick<VirtualLabInstrument, "x" | "y" | "status" | "note">> & { actor?: string },
  ) =>
    request<{ data: VirtualLabRoom }>(`/virtual-lab/rooms/${roomId}/instruments/${instrumentId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }).then((r) => r.data),
  deleteVirtualLabInstrument: (roomId: string, instrumentId: string) =>
    request<{ data: VirtualLabRoom }>(`/virtual-lab/rooms/${roomId}/instruments/${instrumentId}`, {
      method: "DELETE",
    }).then((r) => r.data),
  getVirtualLabLogs: (roomId: string) =>
    request<{ data: VirtualLabLog[] }>(`/virtual-lab/rooms/${roomId}/logs`).then((r) => r.data),

  // Daily Check (Calibrate เครื่องชั่งประจำวัน)
  getStandardTimes: (params?: { page?: number; limit?: number; search?: string; instrument?: string; machineType?: string; hasData?: boolean }) => {
    const qs = params
      ? "?" + new URLSearchParams(
          Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    return request<{ items: StandardTimeItem[]; total: number; page: number; limit: number }>(`/standard-times${qs}`);
  },
  getStandardTimeSummary: () =>
    request<{ byInstrument: StandardTimeSummary[] }>("/standard-times/summary"),
  updateStandardTime: (id: string, data: Partial<StandardTimeItem>) =>
    request<StandardTimeItem>(`/standard-times/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getDailyChecks: (params?: {
    date?: string;          // YYYY-MM-DD หรือ "all"
    from?: string;
    to?: string;
    scaleId?: string;
    status?: "pass" | "fail";
    period?: DailyCheckPeriod;
  }) => {
    const qs = params
      ? "?" + new URLSearchParams(
          Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    return request<{ data: DailyCheckRecord[] }>(`/daily-checks${qs}`).then(r => r.data);
  },
  createDailyCheck: (data: CreateDailyCheckPayload) =>
    request<{ data: DailyCheckRecord }>("/daily-checks", {
      method: "POST",
      body: JSON.stringify(data),
    }).then(r => r.data),
  getDailyCheckTodaySummary: () =>
    request<{ data: DailyCheckTodaySummary }>("/daily-checks/summary/today").then(r => r.data),

  // แจ้งเตือน petition flow สำหรับกระดิ่ง — server กรอง audience ให้แล้ว
  getPetitionNotifications: (params: {
    since: string;
    audiences: string[];
    roles?: string[];
    employeeId?: string;
    all?: boolean;
    limit?: number;
  }) => {
    const qs = new URLSearchParams({ since: params.since });
    if (params.audiences.length) qs.set("audiences", params.audiences.join(","));
    if (params.roles?.length) qs.set("roles", params.roles.join(","));
    if (params.employeeId) qs.set("employeeId", params.employeeId);
    if (params.all) qs.set("all", "1");
    if (params.limit) qs.set("limit", String(params.limit));
    return request<{ items: PetitionFlowNotification[]; serverTime: string }>(
      `/petitions/notifications?${qs.toString()}`,
    );
  },

  // Env Check (อุณหภูมิ/ความชื้น ประจำวัน)
  getEnvChecks: (params?: {
    date?: string;          // YYYY-MM-DD หรือ "all"
    from?: string;
    to?: string;
    room?: string;
    status?: "pass" | "fail";
    period?: DailyCheckPeriod;
  }) => {
    const qs = params
      ? "?" + new URLSearchParams(
          Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    return request<{ data: EnvCheckRecord[] }>(`/env-checks${qs}`).then(r => r.data);
  },
  createEnvCheck: (data: CreateEnvCheckPayload) =>
    request<{ data: EnvCheckRecord }>("/env-checks", {
      method: "POST",
      body: JSON.stringify(data),
    }).then(r => r.data),
  getEnvCheckTodaySummary: () =>
    request<{ data: EnvCheckTodaySummary }>("/env-checks/summary/today").then(r => r.data),

  // Equipment Check (เช็กการทำงานเครื่องมือประจำวัน — ห้องเตรียมตัวอย่าง ฯลฯ)
  getEquipmentChecks: (params: {
    room: string;
    date?: string;          // YYYY-MM-DD หรือ "all"
    from?: string;
    to?: string;
    instrumentId?: string;
    status?: "normal" | "abnormal";
    period?: DailyCheckPeriod;
  }) => {
    const qs = "?" + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<{ data: EquipmentCheckRecord[] }>(`/equipment-checks${qs}`).then(r => r.data);
  },
  createEquipmentCheck: (data: CreateEquipmentCheckPayload) =>
    request<{ data: EquipmentCheckRecord }>("/equipment-checks", {
      method: "POST",
      body: JSON.stringify(data),
    }).then(r => r.data),

  // ประวัติค่าอุณหภูมิ/ความชื้นจาก Node-RED (เรียงใหม่สุดก่อน; [] เมื่อยังไม่มี)
  // ใช้ดึง "ค่าล่าสุดต่อ board" มา pre-fill — การ capture สดทำผ่าน trigger flow ภายหลัง
  getLiveTempHum: () => request<LiveTempHum[]>("/temphum"),

  // ── Env room config (board ↔ room mapping + thresholds) ──
  getEnvRoomConfigs: () =>
    request<{ data: EnvRoomConfig[] }>("/env-room-config").then((r) => r.data),
  updateEnvRoomConfig: (slug: EnvRoomConfig["slug"], input: EnvRoomConfigInput) =>
    request<{ data: EnvRoomConfig }>(`/env-room-config/${slug}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }).then((r) => r.data),

  // ── Document number config (petition / sampleReceipt / labRequest formats) ──
  getDocumentNumberConfigs: () =>
    request<{ data: DocumentNumberConfig[] }>("/document-number-config").then((r) => r.data),
  updateDocumentNumberConfig: (docType: DocNumberType, input: DocumentNumberConfigInput) =>
    request<{ data: DocumentNumberConfig }>(`/document-number-config/${docType}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }).then((r) => r.data),

  // ── Dashboard layout config (per-role section/KPI layout for Lab & QC) ──
  getDashboardLayouts: (dashboard: DashboardId) =>
    request<{ data: StoredLayout[] }>(`/dashboard-layout?dashboard=${dashboard}`).then((r) => r.data),
  updateDashboardLayout: (dashboard: DashboardId, roleId: string, input: DashboardLayout) =>
    request<{ data: StoredLayout }>(`/dashboard-layout/${dashboard}/${encodeURIComponent(roleId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }).then((r) => r.data),

  // ── รายการโปรดบน sidebar (ผูกกับ user ด้วย email) ──
  getUserFavorites: (email: string) =>
    request<{ data: UserFavorites }>(
      `/user-favorites?email=${encodeURIComponent(email)}`,
    ).then((r) => r.data),
  saveUserFavorites: (email: string, paths: string[]) =>
    request<{ data: UserFavorites }>("/user-favorites", {
      method: "PUT",
      body: JSON.stringify({ email, paths }),
    }).then((r) => r.data),

  // ── LINE integration (group registry + test push) ──
  getLineHealth: () => request<LineHealth>("/line/health"),
  getLineGroups: () =>
    request<{ data: LineGroup[] }>("/line/groups").then((r) => r.data),
  createLineGroup: (input: LineGroupInput) =>
    request<{ data: LineGroup }>("/line/groups", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.data),
  deleteLineGroup: (groupId: string) =>
    request<{ deleted: number }>(`/line/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" }),
  testLinePush: (audience: string, message?: string) =>
    request<{ sent: number }>("/line/test", {
      method: "POST",
      body: JSON.stringify({ audience, message }),
    }),

  // Print
  getPrinterConfigs: () =>
    request<{ data: PrinterConfig[] }>("/print/printers-config").then((r) => r.data),
  getPrintConfigs: () =>
    request<{ data: PrinterConfig[] }>("/print/printers-config").then((r) =>
      (["sample-label", "coa", "service-request", "stock-label", "daily-check-report", "goods-receipt"] as PrintDocType[]).map((docType) =>
        toLegacyPrintConfig(docType, r.data),
      ),
    ),
  getPrinters: () => Promise.resolve([] as string[]),
  createPrinterConfig: (input: PrinterConfigInput) =>
    request<{ data: PrinterConfig }>("/print/printers-config", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.data),
  updatePrinterConfig: (id: string, input: Partial<PrinterConfigInput>) =>
    request<{ data: PrinterConfig }>(`/print/printers-config/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }).then((r) => r.data),
  setDefaultPrinterConfig: (id: string) =>
    request<{ data: PrinterConfig }>(`/print/printers-config/${id}/default`, {
      method: "PUT",
    }).then((r) => r.data),
  deletePrinterConfig: (id: string) =>
    request<{ ok: boolean }>(`/print/printers-config/${id}`, { method: "DELETE" }),
  updatePrintConfig: async (slug: PrintConfig["slug"], input: PrintConfigInput) => {
    const kind = docTypeToKind(slug);
    const configs = await request<{ data: PrinterConfig[] }>("/print/printers-config").then((r) => r.data);
    const current = defaultPrinterFor(configs, kind);
    const body = {
      label: input.printerName?.trim() || current?.label || "",
      cupsPrinterUrl: input.cupsPrinterUrl?.trim() || current?.cupsPrinterUrl || "",
    };
    const updated = current
      ? await request<{ data: PrinterConfig }>(`/print/printers-config/${current.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }).then((r) => r.data)
      : await request<{ data: PrinterConfig }>("/print/printers-config", {
          method: "POST",
          body: JSON.stringify({ kind, ...body }),
        }).then((r) => r.data);
    return toLegacyPrintConfig(slug, [updated]);
  },
  printDocument: (payload: { docType: PrintDocType; html: string; copies?: number; printerConfigId?: string; department?: string; paperSize?: PaperSize }) =>
    request<{ ok: boolean; printer: string; copies: number }>("/print", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((r) => ({ printer: r.printer, copies: r.copies } as PrintResult)),
  testPrinterConfig: (id: string) =>
    request<{ ok: boolean; printer: string; copies: number }>(`/print/printers-config/${id}/test`, {
      method: "POST",
    }).then((r) => ({ printer: r.printer, copies: r.copies } as PrintResult)),
  downloadPrintPdf: (payload: { docType: PrintDocType; html: string }) =>
    fetchBlob("/print/pdf", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // API keys (แท็บ API Key ในหน้าตั้งค่าระบบ — admin เท่านั้น)
  getApiKeys: () => request<{ data: ApiKeyItem[] }>("/api-keys").then((r) => r.data),
  getApiKeyMeta: () => request<{ data: ApiKeyMeta }>("/api-keys/meta").then((r) => r.data),
  createApiKey: (input: ApiKeyInput) =>
    request<{ data: CreatedApiKey }>("/api-keys", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.data),
  updateApiKey: (id: string, input: Partial<ApiKeyInput>) =>
    request<{ data: ApiKeyItem }>(`/api-keys/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.data),
  revokeApiKey: (id: string) =>
    request<{ data: ApiKeyItem }>(`/api-keys/${id}/revoke`, { method: "POST" }).then((r) => r.data),
  deleteApiKey: (id: string) => request<{ ok: boolean }>(`/api-keys/${id}`, { method: "DELETE" }),
  setApiPolicyMode: (policyId: string, mode: ApiPolicyMode) =>
    request<{ data: { policyId: string; mode: ApiPolicyMode } }>(`/api-keys/policy/${policyId}`, {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }).then((r) => r.data),
  getApiKeyLogs: (params?: { keyId?: string; outcome?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.keyId) qs.set("keyId", params.keyId);
    if (params?.outcome) qs.set("outcome", params.outcome);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ data: ApiRequestLogItem[] }>(`/api-keys/logs${suffix}`).then((r) => r.data);
  },

  // Parameters (พารามิเตอร์การตรวจสอบของสารแต่ละชนิด)
  getParameters: () => request<ParameterItem[]>("/parameters"),
  createParameter: (data: Partial<ParameterItem>) =>
    request<ParameterItem>("/parameters", { method: "POST", body: JSON.stringify(data) }),
  updateParameter: (id: string, data: Partial<ParameterItem>) =>
    request<ParameterItem>(`/parameters/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteParameter: (id: string) =>
    request<{ success: true }>(`/parameters/${id}`, { method: "DELETE" }),
  bulkCreateParameters: (items: Partial<ParameterItem>[]) =>
    request<ParameterItem[]>("/parameters/bulk", { method: "POST", body: JSON.stringify(items) }),

  // QC Test Results
  getQCResults: (petitionId: string) =>
    request<import("@/types/petition.types").QCTestResult[]>(`/qc-results/${petitionId}`),
  // ผลแบบย่อของหลายคำร้อง เฉพาะ parameter ที่ระบุ (หน้า /petition อ่านค่า ถพ.)
  getQCResultsByPetitions: (petitionIds: string[], parameterIds: string[]) => {
    if (petitionIds.length === 0 || parameterIds.length === 0) {
      return Promise.resolve([] as import("@/types/petition.types").QCTestResult[]);
    }
    const qs = new URLSearchParams({ petitionIds: petitionIds.join(","), parameterIds: parameterIds.join(",") }).toString();
    return request<import("@/types/petition.types").QCTestResult[]>(`/qc-results/by-petitions?${qs}`);
  },
  saveQCResult: (data: import("@/types/petition.types").SaveQCResultPayload) =>
    request<import("@/types/petition.types").QCTestResult>("/qc-results", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  saveQCEntries: (data: {
    sampleRoundId?: string;
    petitionId: string; petitionNo?: string; itemSeq: number; sampleId?: string;
    sampleName?: string; commonName?: string; parameterId: string; parameterName?: string;
    entries: Record<string, unknown>[]; enteredBy: { name: string; email: string };
    overrideReason?: string;
  }) =>
    request<import("@/types/petition.types").QCTestResult>("/qc-results/entries", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  // หมายเหตุต่อ parameter ต่อตัวอย่าง (QC และ Lab) — เก็บที่ QCTestResult.remark
  saveQCResultRemark: (data: {
    petitionId: string; petitionNo?: string; itemSeq: number; sampleId?: string;
    sampleName?: string; commonName?: string; parameterId: string; parameterName?: string;
    remark: string; enteredBy: { name: string; email: string };
  }) =>
    request<import("@/types/petition.types").QCTestResult | null>("/qc-results/remark", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  // QC ยืนยันค่า ถพ. + อุณหภูมิ ของตัวอย่างกลุ่มน้ำ → ปล่อยงานไป Lab
  confirmSpecificGravity: (petitionId: string, itemSeq: number) =>
    request<import("@/types/petition.types").Petition>("/qc-results/sg-confirm", {
      method: "POST",
      body: JSON.stringify({ petitionId, itemSeq }),
    }),
  getQCProgress: (petitionIds: string[]) => {
    if (petitionIds.length === 0) return Promise.resolve({} as QCProgressMap);
    const qs = new URLSearchParams({ petitionIds: petitionIds.join(",") }).toString();
    return request<QCProgressMap>(`/qc-results/progress?${qs}`);
  },
  getAbnormalFlags: (petitionIds: string[], opts?: { includeRestricted?: boolean }) => {
    if (petitionIds.length === 0) return Promise.resolve({} as Record<string, boolean>);
    const p = new URLSearchParams({ petitionIds: petitionIds.join(",") });
    if (opts?.includeRestricted) p.set("includeRestricted", "1");
    const qs = p.toString();
    return request<Record<string, boolean>>(`/qc-results/abnormal-flags?${qs}`);
  },
  getLastBatchValues: (commonName: string, parameterId: string, excludePetitionId: string) => {
    const qs = new URLSearchParams({ commonName, parameterId, excludePetitionId }).toString();
    return request<{ petitionNo?: string; enteredAt?: string; values?: Record<string, unknown> }>(`/qc-results/last-values?${qs}`);
  },
  getReturnedFlags: (petitionIds: string[]) => {
    if (petitionIds.length === 0) return Promise.resolve({} as Record<string, boolean>);
    const qs = new URLSearchParams({ petitionIds: petitionIds.join(",") }).toString();
    return request<Record<string, boolean>>(`/petitions/returned-flags?${qs}`);
  },
  // Manual phase advance (admin override) for 2-phase petitions
  advancePetitionPhase: (petitionId: string, actor?: string) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}/advance-phase`, {
      method: "PATCH",
      body: JSON.stringify({ actor }),
    }),
  // One track (Lab or QC) records "บันทึกผล". Backend flips the petition to
  // success only when every required track is done; otherwise it stays inProgress.
  completePetitionTrack: (
    petitionId: string,
    side: "lab" | "qc",
    actor: string,
    redoExplanation?: string,
  ) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}/complete`, {
      method: "POST",
      body: JSON.stringify({ side, actor, redoExplanation }),
    }),
  labApprovePetition: (petitionId: string, actor: string) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}/lab-approve`, {
      method: "POST",
      body: JSON.stringify({ actor }),
    }),
  labRejectPetition: (petitionId: string, actor: string, note: string) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}/lab-reject`, {
      method: "POST",
      body: JSON.stringify({ actor, note }),
    }),
  approvePetition: (
    petitionId: string,
    actor: string,
    conclusion: "pass" | "accepted-oos" = "pass",
    conclusionNote?: string,
  ) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved", actor, conclusion, conclusionNote }),
    }),
  rejectPetition: (
    petitionId: string,
    actor: string,
    revisionNote: string,
    target: "requester" | "lab" | "qc" | "both" = "requester",
  ) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "rejected", actor, revisionNote, target }),
    }),
  // อนุมัติ/ไม่อนุมัติรายรายการ (ต่อ batch × common name) จากหน้า /qc-approval
  // ครบทุกรายการทุกฝั่ง → server ออก Final Result ให้เอง; batch ที่อนุมัติครบแจ้ง Production ทันที
  decideApprovalItems: (
    petitionId: string,
    body: {
      side: "qc" | "lab";
      decision: "approve" | "reject";
      items: { seq: number; abnormal?: boolean }[];
      note?: string;
    },
  ) =>
    request<import("@/types/petition.types").Petition>(`/approvals/petitions/${petitionId}/items`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Dev-only: raw-set petition.status via the gated backend dev endpoint
  // (bypasses business guards; companion fields are NOT touched).
  devSetPetitionStatus: (
    petitionId: string,
    status: import("@/types/petition.types").PetitionStatus,
    actor: string,
  ) =>
    request<import("@/types/petition.types").Petition>(`/dev/petition-status/${petitionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, actor }),
    }),
  getPetition: (petitionId: string) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}`),
  requestPetitionRecheck: (petitionId: string, reason: string) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}/lab-recheck`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  labResultAction: (
    petitionId: string,
    action: "edit-start" | "edit-save" | "edit-cancel" | "clear",
    reason?: string,
  ) =>
    request<import("@/types/petition.types").Petition>(`/petitions/${petitionId}/lab-result-action`, {
      method: "POST",
      body: JSON.stringify({ action, reason }),
    }),
  findRejectedByBatch: (batchNo: string, employeeId: string) => {
    const qs = new URLSearchParams({ batchNo, employeeId }).toString();
    return request<import("@/types/petition.types").Petition[]>(`/petitions/rejected-by-batch?${qs}`);
  },
  batchExists: async (batchNo: string) => {
    try {
      return await request<{ exists: boolean }>(`/petitions/batch-exists?${new URLSearchParams({ batchNo }).toString()}`);
    } catch (error) {
      // Older deployments do not have the advisory duplicate-check route yet.
      // Keep request creation available; the server still validates the submitted payload.
      if ((error as ApiError).status === 404) return { exists: false };
      throw error;
    }
  },

  // Methods (admin-managed method registry)
  getMethods: () => request<MethodDoc[]>("/methods"),
  createMethod: (data: MethodInput) =>
    request<MethodDoc>("/methods", { method: "POST", body: JSON.stringify(data) }),
  updateMethod: (id: string, data: MethodInput) =>
    request<MethodDoc>(`/methods/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMethod: (id: string) =>
    request<{ ok: true }>(`/methods/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // COA Center
  getCoaDocuments: (params?: { status?: string; petitionNo?: string; coaNo?: string; needsApproval?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.petitionNo) q.set("petitionNo", params.petitionNo);
    if (params?.coaNo) q.set("coaNo", params.coaNo);
    if (params?.needsApproval) q.set("needsApproval", "1");
    return request<{ items: CoaDocument[] }>(`/coa-documents${q.toString() ? `?${q}` : ""}`);
  },
  getEligibleCoaPetitions: () => request<{ items: EligibleCoaPetition[] }>("/coa-documents/eligible-petitions"),
  createErpManualCoaDocument: (body: ManualCoaInput) =>
    request<CoaDocument>("/coa-documents/erp-manual", { method: "POST", body: JSON.stringify(body) }),
  getErpCoaAutofill: (externalRequestId: string) =>
    request<CoaErpAutofill>(`/coa-documents/erp-autofill/${encodeURIComponent(externalRequestId)}`),
  getCoaLabAiByBatch: (params: { batchNo: string; commonName: string; sampleName?: string }) => {
    const query = new URLSearchParams({ batchNo: params.batchNo, commonName: params.commonName });
    if (params.sampleName) query.set("sampleName", params.sampleName);
    return request<CoaLabAiLookup>(`/coa-documents/lab-ai-lookup?${query.toString()}`);
  },
  getCoaSourceData: (petitionId: string, itemSeqs: number[]) =>
    request<{ results: CoaSourceResult[]; customerSnapshot?: CoaDocument["customerSnapshot"]; sampleSnapshots?: CoaDocument["sampleSnapshots"] }>("/coa-documents/source-data/" + encodeURIComponent(petitionId) + "?itemSeqs=" + encodeURIComponent(itemSeqs.join(","))),
  createCoaDocument: (body: {
    petitionId: string;
    selectedItemSeqs: number[];
    formSelections?: CoaFormSelection[];
    remark?: string;
    _user?: unknown;
  }) =>
    request<CoaDocument>("/coa-documents", { method: "POST", body: JSON.stringify(body) }),
  createManualCoaDocument: (body: {
    petitionId?: string;
    selectedItemSeqs: number[];
    customerSnapshot?: CoaDocument["customerSnapshot"];
    sampleSnapshots: CoaDocument["sampleSnapshots"];
    resultSnapshots: CoaDocument["resultSnapshots"];
    remark?: string;
    externalCoaRequest?: Pick<NonNullable<CoaDocument["externalCoaRequest"]>, "saleOrderNo" | "line" | "itemNo">;
    _user?: unknown;
  }) => request<CoaDocument>("/coa-documents/manual", { method: "POST", body: JSON.stringify(body) }),
  getCoaDocument: (id: string) => request<CoaDocument>(`/coa-documents/${id}`),
  updateCoaDocument: (id: string, body: { selectedItemSeqs?: number[]; remark?: string; _user?: unknown } & Partial<Pick<ManualCoaInput, "sample" | "results">>) =>
    request<CoaDocument>(`/coa-documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  submitCoaDocument: (id: string, body: { _user?: unknown }) =>
    request<CoaDocument>(`/coa-documents/${id}/submit`, { method: "POST", body: JSON.stringify(body) }),
  approveCoaDocument: (id: string, body: { _user?: unknown }) =>
    request<CoaDocument>(`/coa-documents/${id}/approve`, { method: "POST", body: JSON.stringify(body) }),
  rejectCoaDocument: (id: string, body: { reason: string; _user?: unknown }) =>
    request<CoaDocument>(`/coa-documents/${id}/reject`, { method: "POST", body: JSON.stringify(body) }),
  reviseCoaDocument: (id: string, body: { _user?: unknown }) =>
    request<CoaDocument>(`/coa-documents/${id}/revise`, { method: "POST", body: JSON.stringify(body) }),
  cancelCoaDocument: (id: string, body: { reason: string; _user?: unknown }) =>
    request<CoaDocument>(`/coa-documents/${id}/cancel`, { method: "POST", body: JSON.stringify(body) }),
  recordCoaPrintEvent: (id: string, body: { event: string; copies: number; outputMode: string; _user?: unknown }) =>
    request<CoaDocument>(`/coa-documents/${id}/print-event`, { method: "POST", body: JSON.stringify(body) }),

  // Goods receipts (ฟอร์ม F-WAR-03-01,02 ของแผนก RM)
  getGoodsReceiptsByPetition: (petitionId: string) =>
    request<{ items: GoodsReceipt[] }>(`/goods-receipts?petitionId=${encodeURIComponent(petitionId)}`)
      .then((r) => r.items),
  createGoodsReceipt: (input: GoodsReceiptInput) =>
    request<GoodsReceipt>("/goods-receipts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export type QCProgressEntry = {
  itemSeq: number;
  parameterId: string;
  filledLabels: string[];
};

export type QCProgressMap = Record<string, QCProgressEntry[]>;

export type DailyCheckRecord = {
  _id?: string;
  scaleId: string;
  scaleName: string;
  model?: string;
  weights100: [string, string, string] | string[];
  weights10: [string, string, string] | string[];
  avg100: number;
  avg10: number;
  status100: "pass" | "fail";
  status10: "pass" | "fail";
  status: "pass" | "fail";
  tolerance?: number;
  recorder: string;
  recorderId?: string;
  recorderEmail?: string;
  date: string;       // YYYY-MM-DD
  period?: DailyCheckPeriod | null;
  checkedAt: string;  // ISO
  createdAt?: string;
  updatedAt?: string;
};

export type CreateDailyCheckPayload = {
  scaleId: string;
  scaleName: string;
  model?: string;
  weights100: string[];
  weights10: string[];
  avg100: number;
  avg10: number;
  status100: "pass" | "fail";
  status10: "pass" | "fail";
  tolerance?: number;
  recorder: string;
  recorderId?: string;
  recorderEmail?: string;
};

export type DailyCheckTodaySummary = {
  date: string;
  count: number;
  scaleIds: string[];
  scaleRecords?: Array<{
    scaleId: string;
    checkedAt?: string;
    period?: DailyCheckPeriod | null;
  }>;
  allPass: boolean;
};

export type EquipmentReading = { key: string; label: string; value: number; unit: string };

export type EquipmentCheckRecord = {
  _id?: string;
  roomSlug: string;
  instrumentId: string;
  instrumentName: string;
  brand?: string;
  status: "normal" | "abnormal";
  readings: EquipmentReading[];
  note?: string;
  recorder: string;
  recorderId?: string;
  recorderEmail?: string;
  date: string;       // YYYY-MM-DD
  period?: DailyCheckPeriod | null;
  checkedAt: string;  // ISO
  createdAt?: string;
  updatedAt?: string;
};

export type CreateEquipmentCheckPayload = {
  roomSlug: string;
  instrumentId: string;
  instrumentName: string;
  brand?: string;
  status: "normal" | "abnormal";
  readings?: EquipmentReading[];
  note?: string;
  recorder: string;
  recorderId?: string;
  recorderEmail?: string;
};

export type EnvCheckRecord = {
  _id?: string;
  room: "balance" | "sample-prep" | "analysis";
  roomName: string;
  temperature: number;
  humidity: number;
  tempMin: number;
  tempMax: number;
  humidityMax: number;
  tempStatus: "pass" | "fail";
  humidityStatus: "pass" | "fail";
  status: "pass" | "fail";
  note?: string;
  recorder: string;
  recorderId?: string;
  recorderEmail?: string;
  date: string;       // YYYY-MM-DD
  period?: DailyCheckPeriod | null;
  checkedAt: string;  // ISO
  createdAt?: string;
  updatedAt?: string;
};

export type CreateEnvCheckPayload = {
  room: "balance" | "sample-prep" | "analysis";
  roomName: string;
  temperature: number;
  humidity: number;
  tempMin: number;
  tempMax: number;
  humidityMax: number;
  note?: string;
  recorder: string;
  recorderId?: string;
  recorderEmail?: string;
};

export type EnvCheckTodaySummary = {
  date: string;
  count: number;
  rooms: string[];
  roomRecords?: Array<{
    room: string;
    checkedAt?: string;
    period?: DailyCheckPeriod | null;
  }>;
  allPass: boolean;
};

export type LiveTempHum = {
  board: string;
  temp?: number;
  hum?: number;
  receivedAt?: string; // ISO
};

// Config mapping a result param key → a lab instrument's API endpoint.
export type InstrumentSource = {
  _id?: string;
  key: string;            // ties to a result field key e.g. "density"
  label?: string;
  instrumentName?: string;
  fetchUrl?: string;
  method?: string;
  authHeader?: string;
  responsePath?: string;  // dotted path to the value in the JSON reply
  readingAtPath?: string; // optional dotted path to the device timestamp
  unit?: string;
  decimals?: number | null;
  timeoutMs?: number;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

// Result of a live pull. ok:false carries a Thai error for display.
export type InstrumentReading = {
  ok: boolean;
  key: string;
  value?: number;
  unit?: string;
  instrument?: string;
  readingAt?: string; // ISO
  raw?: unknown;
  error?: string;
};

// Provenance stored alongside a pulled field value (as a sibling key).
export type ValueProvenance = {
  source: "instrument" | "instrument-edited";
  instrument?: string;
  rawValue?: number;
  fetchedAt?: string;
  fetchedBy?: string;
};

export type MachineItem = {
  _id?: string;
  code: string;
  type?: string;
  registerNo?: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNo?: string;
  manualDoc?: string;
  installDate?: string;
  startDate?: string;
  location?: string;
  status?: "active" | "inactive" | "retired";
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type VirtualLabStatus = "idle" | "running" | "error" | "maintenance" | "offline";

export type VirtualLabInstrument = {
  _id: string;
  machine: MachineItem;
  x: number;
  y: number;
  status: VirtualLabStatus;
  note?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type VirtualLabRoom = {
  _id: string;
  name: string;
  instruments: VirtualLabInstrument[];
  createdAt?: string;
  updatedAt?: string;
};

export type VirtualLabLog = {
  _id: string;
  room: string;
  virtualInstrumentId: string;
  machine: MachineItem;
  oldStatus?: string;
  newStatus: VirtualLabStatus;
  note?: string;
  actor?: string;
  createdAt?: string;
};

type ApiErrorBody = {
  error?: unknown;
  message?: unknown;
};

function apiErrorMessage(body: ApiErrorBody, fallback: string): string {
  const nestedMessage =
    body.error && typeof body.error === "object" && "message" in body.error
      ? (body.error as { message?: unknown }).message
      : undefined;
  return String(body.message || nestedMessage || body.error || fallback);
}

export type StandardTimeItem = {
  _id: string;
  instrument: string;
  machineType?: string;
  analysisName: string;
  columnDimension?: string;
  mobilePhaseTopUpMin?: number | null;
  samplePrepPerBatchMin?: number | null;
  standardPrepMin?: number | null;
  instrumentSetupMin?: number | null;
  standardCycleMin?: number | null;
  totalInjectionsPerBatch?: number | null;
  machineRunTotalMin?: number | null;
  dataProcessingMin?: number | null;
  recordResultMin?: number | null;
  reportingMin?: number | null;
  standardTimeMin?: number | null;
  standardTimeText?: string;
  hasData?: boolean;
  note?: string;
};

export type StandardTimeSummary = {
  _id: string;
  total: number;
  withData: number;
  avgStandardTimeMin?: number | null;
};

export type ParameterValueFieldType = "text" | "number" | "float" | "enum" | "photo" | "file" | "timer" | "reference";

export type StandardOperator =
  | "lt"
  | "lte"
  | "eq"
  | "gte"
  | "gt"
  | "between"
  | "tolerance";

export type SubstanceStandard = {
  substance: string;      // เก็บแบบ extractSubstanceName เช่น "ABAMECTIN"
  operator: StandardOperator;
  value: number | null;
  itemNo?: string;
  packSize?: string;
  masterItemName?: string;
  masterCommonName?: string;
  masterRaw?: Record<string, unknown>;
  productTypes?: ("water" | "sand" | "powder")[];
  regulatoryTypes?: ("GMP" | "BIO" | "LS")[];
  categories?: ("RM" | "FG")[];
  value2?: number | null; // ใช้กับ between / tolerance
};

export type LabelToleranceStandard = {
  substance: string;        // เก็บแบบ extractSubstanceName เช่น "ABAMECTIN"
  autoPct: number | null;   // ± ชั้นใน (ผ่านเอง) % ของค่าฉลาก, > 0
  headPct: number | null;   // ± ชั้นนอก (หัวหน้าอนุมัติ), ถ้าใส่ต้อง ≥ autoPct; null = ไม่มีช่วง review
};

export type StandardConditionOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "between";
export type LabelToleranceRule = LabelToleranceStandard & {
  mode?: "percent" | "abs" | "range";
  autoMode?: "none" | "percent" | "abs" | "range";
  headMode?: "none" | "percent" | "abs" | "range";
  labelPercent?: number | null;
  itemNo?: string;
  packSize?: string;
  masterItemName?: string;
  masterCommonName?: string;
  masterRaw?: Record<string, unknown>;
  productTypes?: ("water" | "sand" | "powder")[];
  // autoMode = "percent" => autoPct เป็น % ที่เว้นจากขอบช่วงเกณฑ์กรมเข้าด้านใน
  // headMode = "percent" => headPct เป็น % ของค่ากลางจาก %ฉลาก
  // mode "abs" — ± รอบค่ากลาง (%ฉลาก) เป็นค่าจริงในหน่วยของ field แทน % relative
  autoAbs?: number | null;   // ± ชั้นใน (ผ่านเอง), > 0
  headAbs?: number | null;   // ± ชั้นนอก (หัวหน้าอนุมัติ), ถ้าใส่ต้อง ≥ autoAbs; null = ไม่มีช่วง review
  passLow?: number | null;
  passHigh?: number | null;
  failLow?: number | null;
  failHigh?: number | null;
};

export type StandardCondition = {
  sourceParameterId?: string | null;  // null/ว่าง = field พี่น้องใน parameter เดียวกัน
  sourceFieldLabel: string;
  op: StandardConditionOp;
  value: string | number;
  value2?: number | null;             // ใช้กับ between
};

export type StandardRule = {
  label?: string;                     // ป้ายชื่อกฎ เช่น "ก้อนใหญ่"
  conditions: StandardCondition[];    // AND กันทุกตัว; ว่าง = เข้าเสมอ (default row)
  operator: StandardOperator;
  value: number | null;
  value2?: number | null;
  outputText?: string;                 // ข้อความผลลัพธ์ (โหมด output); ว่าง = fallback ไป label
  outputKind?: "normal" | "abnormal";  // default 'normal'
};

export type TimerUnit = "minute" | "hour" | "day" | "month";

export type ParameterFieldPhase = "both" | "before" | "after";

export type OptionOutputKind = "normal" | "abnormal" | "text";
export type OptionOutput = { kind: OptionOutputKind; text?: string };

export type ParameterValueField = {
  label: string;
  type: ParameterValueFieldType;
  requestValueSource?: {
    mode: "manual" | "collection" | "link" | "reference";
    collectionName?: string | null;
    collectionMatchField?: string | null;
    petitionMatchField?: string | null;
    valueField?: string | null;
    refParameterId?: string | null;
    refFieldLabel?: string | null;
  };
  unit?: string;
  standardValue?: number | null;
  standardOperator?: StandardOperator;
  standardValue2?: number | null;
  // Per-substance standards (number/float only). เมื่อ substanceMode = true
  // ค่าเดี่ยว standardOperator/standardValue ถูก ignore.
  substanceMode?: boolean;
  substanceStandards?: SubstanceStandard[];
  // Conditional standards (number/float). เมื่อ conditionalMode = true
  // standardOperator/standardValue และ substance* ถูก ignore.
  conditionalMode?: boolean;
  conditionalStandards?: StandardRule[];
  // ชนิดผลของกฎ conditional: 'standard' (เกณฑ์ตัวเลข เดิม) | 'output' (ข้อความ+สถานะ). default 'standard'
  conditionalResult?: "standard" | "output";
  // Label-% tolerance mode (number/float). center = %ฉลากที่แกะจากชื่อสารอัตโนมัติ.
  labelToleranceMode?: boolean;
  labelToleranceStandards?: LabelToleranceRule[];
  // Field-level repeat — value stored as an array. text/number/float/enum only.
  multiple?: boolean;
  // โชว์ค่า field เดียวกันจากผลตรวจครั้งก่อนของ common name เดียวกัน (display-only)
  showLastBatch?: boolean;
  options?: string[];
  requireNoteOn?: string[];
  expectedValues?: string[];
  // Per-option result classification (enum). Presence = new model; absence = legacy expectedValues.
  // { kind:'normal' } → pass; { kind:'abnormal' } → flagged; { kind:'text', text } → neutral, shows `text`.
  optionOutputs?: Record<string, OptionOutput>;
  timerDurationSec?: number | null;
  timerUnit?: TimerUnit;
  required?: boolean;
  maxPhotos?: number;
  maxFiles?: number;
  allowedFileTypes?: string[];
  // 2-phase fields
  phase?: ParameterFieldPhase; // default 'both'
  triggersPhase2?: boolean;
  // For type='reference' — pulls value from another parameter's saved field
  // on the SAME petition + itemSeq.
  refParameterId?: string | null;
  refFieldLabel?: string | null;
  refPhase?: 1 | 2 | null;
  // Per-option filter: keyed by option string.
  // ถ้า key ไม่มี = option แสดงให้ทุก item (default).
  // ถ้ามี key แต่ทุกมิติเป็น array ว่าง = แสดงเสมอ.
  // หากตั้งค่าอย่างน้อย 1 มิติ — OR ข้ามมิติ เฉพาะ option filter.
  optionFilters?: Record<string, {
    itemNos?: string[];        // exact match กับ item.itemNo / รหัสสินค้า
    itemNames?: string[];      // exact match กับ item.sampleName
    fullCommonNames?: string[];// exact match กับ item.commonName แบบเต็ม
    commonNames?: string[];    // 'EW' | 'WP' | 'ULV' ... (uppercase)
    productTypes?: string[];   // 'water' | 'sand' | 'powder' | 'liquid' | 'solid'
    categories?: string[];     // 'RM' | 'FG' จากคลังตาม prefix รหัสสินค้า F/R
    subCategories?: string[];  // prefix code เช่น 'F', 'FC', 'RO' (uppercase)
    itemGroups?: string[];     // group ID ที่ option นี้จำกัดให้แสดง
  }>;
};

export type ParameterScope = "lab" | "qc";

export type ParameterApplyRule = {
  itemNos?: string[];
  itemNames?: string[];
  fullCommonNames?: string[];
  commonNames?: string[];
  productTypes?: string[];
  categories?: string[];
  subCategories?: string[];
  itemGroups?: string[];
};

export type ParameterItem = {
  _id?: string;
  name: string;
  scope?: ParameterScope;
  shareWithLab?: boolean;
  status?: "active" | "inactive";
  applyAll?: boolean;
  commonNames?: string[];
  itemNos?: string[];
  itemNames?: string[];
  fullCommonNames?: string[];
  productTypes?: string[];
  // 'RM' | 'FG' — ประตูแบบ AND เทียบกับคลังจาก prefix รหัสสินค้า F/R
  categories?: string[];
  // prefix code ของรหัสสินค้า เช่น 'RO' — จับแบบ "ขึ้นต้นด้วย" (RO ครอบ ROPH/ROLS)
  subCategories?: string[];
  itemGroups?: string[];
  applyRules?: ParameterApplyRule[];
  excludeCommonNames?: string[];
  excludeItemNos?: string[];
  excludeItemNames?: string[];
  excludeFullCommonNames?: string[];
  excludeProductTypes?: string[];
  excludeCategories?: string[];
  excludeSubCategories?: string[];
  excludeItemGroups?: string[];
  valueFields?: ParameterValueField[];
  sortOrder?: number;
  note?: string;
  // 2-phase testing toggle — when true, this parameter triggers retesting other matched parameters.
  hasPhases?: boolean;
  // Parameter-level repeat — whole field set repeats into QCTestResult.entries.
  multiEntry?: boolean;
  // Source used for the ค่า ถ.พ. column on service-request forms.
  specificGravitySource?: {
    mode: "link" | "reference" | "collection" | "manual";
    linkUrl?: string | null;
    valuePath?: string | null;
    refParameterId?: string | null;
    refFieldLabel?: string | null;
    collectionName?: string | null;
    valueField?: string | null;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type ItemGroupItem = {
  _id: string;
  name: string;
  description?: string;
  commonNames: string[];
  tradeNames: string[];
  includeItemNos: string[];
  excludeItemNos: string[];
  status: "active" | "inactive";
  sortOrder?: number;
};

// These functions use bare fetch (not fetchApi) because FormData upload
// must not have Content-Type forced to application/json.
export async function uploadQcPhoto(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('photo', file);
  const res = await fetch(`${APP_API_BASE}/uploads/qc-photo`, {
    method: 'POST',
    credentials: 'include',
    headers: identityHeaders(),
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as ApiErrorBody;
    throw new Error(apiErrorMessage(body, 'Upload failed'));
  }
  return res.json();
}

export async function deleteQcPhoto(url: string): Promise<void> {
  const res = await fetch(`${APP_API_BASE}/uploads/qc-photo`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as ApiErrorBody;
    throw new Error(apiErrorMessage(body, 'Delete failed'));
  }
}

export async function uploadParamFile(file: File): Promise<{ url: string; name: string; size: number }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${APP_API_BASE}/uploads/param-file`, {
    method: 'POST',
    credentials: 'include',
    headers: identityHeaders(),
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as ApiErrorBody;
    throw new Error(apiErrorMessage(body, res.statusText));
  }
  return res.json();
}

export async function deleteParamFile(url: string): Promise<void> {
  const res = await fetch(`${APP_API_BASE}/uploads/param-file`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as ApiErrorBody;
    throw new Error(apiErrorMessage(body, res.statusText));
  }
}
