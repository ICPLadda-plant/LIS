import type { StockUnitItem } from "@/types/stock";
import { withThaiKedmaneeFallbacks } from "./keyboardLayout";

interface HardwareStockScanOptions {
  minLength?: number;
  maxDurationMs?: number;
}

const DEFAULT_HARDWARE_SCAN_MIN_LENGTH = 6;
const DEFAULT_HARDWARE_SCAN_MAX_DURATION_MS = 1200;

function isLikelyHardwareStockScanCandidate(text: string) {
  if (/^https?:\/\//i.test(text)) {
    return /\/stock\/(?:view|scan)\b|\/stock-deduction\b|[?&](?:qrId|id|solventId)=/i.test(text);
  }
  if (text.startsWith("{") && /"(?:qrId|id|solventId)"/i.test(text)) return true;
  return /^u_[a-z0-9_-]{4,}$/i.test(text);
}

export function isLikelyHardwareStockScan(raw: string, elapsedMs: number, options: HardwareStockScanOptions = {}) {
  const minLength = options.minLength ?? DEFAULT_HARDWARE_SCAN_MIN_LENGTH;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_HARDWARE_SCAN_MAX_DURATION_MS;
  if (elapsedMs > maxDurationMs) return false;

  return withThaiKedmaneeFallbacks(raw)
    .map((value) => value.trim())
    .filter((value) => value.length >= minLength)
    .some(isLikelyHardwareStockScanCandidate);
}

function normalizeScannedQrIdValue(value: string) {
  const text = value.trim();
  const unitQrId = text.match(/\bu_[A-Za-z0-9_-]{4,}/)?.[0];
  return unitQrId ?? text;
}

/** ดึง qrId จากผลสแกน — รองรับ id เปล่า / URL .../stock/scan/<id> / JSON {qrId} */
function parseStructuredQrId(text: string): string | null {
  if (!text) return "";
  try {
    const payload = JSON.parse(text) as { qrId?: unknown; id?: unknown };
    const v = payload.qrId ?? payload.id;
    if (v) return normalizeScannedQrIdValue(String(v));
  } catch {
    /* not JSON */
  }
  try {
    const url = new URL(text);
    let fromQuery = url.searchParams.get("qrId") ?? url.searchParams.get("id") ?? url.searchParams.get("solventId");
    if (!fromQuery) {
      for (const [key, value] of url.searchParams.entries()) {
        const normalizedKey = key.toLocaleLowerCase("en-US");
        if (["qrid", "id", "solventid"].includes(normalizedKey)) {
          fromQuery = value;
          break;
        }
      }
    }
    if (fromQuery) return normalizeScannedQrIdValue(fromQuery);
    const parts = url.pathname.split("/").filter(Boolean);
    const stockSegmentIndex = parts.findIndex((part) => part.toLocaleLowerCase("en-US") === "stock");
    const stockRoute = stockSegmentIndex >= 0 ? parts[stockSegmentIndex + 1]?.toLocaleLowerCase("en-US") : "";
    const pathQrId = stockRoute && ["scan", "view"].includes(stockRoute) ? parts[stockSegmentIndex + 2] : "";
    return normalizeScannedQrIdValue(decodeURIComponent(pathQrId || parts[parts.length - 1] || text));
  } catch {
    return null;
  }
}

export function parseScannedQrId(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "";

  for (const candidate of withThaiKedmaneeFallbacks(text).map((value) => value.trim()).filter(Boolean)) {
    const parsed = parseStructuredQrId(candidate);
    if (parsed != null) return parsed;
  }

  const plainId = withThaiKedmaneeFallbacks(text)
    .map((value) => value.trim())
    .find((value) => /^[A-Za-z0-9_-]+$/.test(value));
  return plainId ?? text;
}

export type UnitDerivedStatus = "active" | "empty" | "discarded" | "expired";

export function unitDerivedStatus(
  u: { status: string; exp?: string | null; volume?: { remaining?: number | null } | null },
  now: Date = new Date(),
): UnitDerivedStatus {
  if (u.status === "discarded") return "discarded";
  const remaining = u.volume?.remaining;
  // เศษทศนิยมเล็กมาก (เช่น 1e-12 mg) ถือว่าหมด
  if (u.status === "empty" || (remaining != null && Number(remaining) <= 1e-6)) return "empty";
  if (u.exp && new Date(u.exp).getTime() < now.getTime()) return "expired";
  return "active";
}

/** ขวดที่ยังไม่ทิ้ง เรียงตามวันรับเข้า (flat) */
export function visibleBottles(units: StockUnitItem[], now: Date = new Date()): StockUnitItem[] {
  const timeOf = (u: StockUnitItem) => new Date(u.receivedDate || u.createdAt || 0).getTime();
  return units
    .filter((u) => {
      const status = unitDerivedStatus(u, now);
      return status !== "discarded" && status !== "empty";
    })
    .sort((a, b) => timeOf(a) - timeOf(b));
}
