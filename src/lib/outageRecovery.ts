import { getPwaAssetUrl, normalizePwaBaseUrl } from "./pwa";

// หน้าที่เปิดค้างบนเครื่องประจำจุด (kiosk) ไม่มีคนกด refresh ให้ เมื่อเว็บหรือ API ล่ม
// (Cloudflare 1033/530, 502, 503, 404, 401 ฯลฯ) แล้วกลับมา ต้อง reload หน้าเองให้ได้
// สถานะใหม่ หน้าอื่นที่มีฟอร์มกรอกค้างไว้ไม่ reload เพื่อไม่ให้ข้อมูลที่ยังไม่บันทึกหาย
export const KIOSK_RECOVERY_PATHS = ["/scanner", "/queue/lab", "/queue/qc"];

type OutageRecoveryWatcherOptions = {
  enabled?: boolean;
  baseUrl?: string;
  intervalMs?: number;
  timeoutMs?: number;
  /** จำนวนครั้งที่เช็คล้มติดกันก่อนถือว่าระบบล่มจริง กัน reload จาก request หลุดครั้งเดียว */
  failureThreshold?: number;
  fetcher?: typeof fetch;
  reload?: () => void;
  getPathname?: () => string;
};

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_FAILURE_THRESHOLD = 2;

function appPathname(pathname: string, baseUrl: string) {
  const base = normalizePwaBaseUrl(baseUrl).replace(/\/+$/, "");
  if (base && (pathname === base || pathname.startsWith(base + "/"))) {
    return pathname.slice(base.length) || "/";
  }
  return pathname || "/";
}

export function isKioskRecoveryPath(pathname: string, baseUrl: string = import.meta.env.BASE_URL || "/") {
  const path = appPathname(pathname, baseUrl).replace(/\/+$/, "") || "/";
  return KIOSK_RECOVERY_PATHS.includes(path);
}

function withCacheBuster(url: string) {
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("lisHealthCheck", String(Date.now()));
  return parsed.pathname + parsed.search;
}

export function startOutageRecoveryWatcher(options: OutageRecoveryWatcherOptions = {}) {
  const {
    enabled = import.meta.env.PROD,
    baseUrl = import.meta.env.BASE_URL || "/",
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    fetcher = typeof fetch === "undefined" ? undefined : fetch.bind(globalThis),
    reload = () => window.location.reload(),
    getPathname = () => window.location.pathname,
  } = options;

  if (!enabled || !fetcher || typeof window === "undefined") return () => {};

  // เช็คทั้งไฟล์หน้าเว็บ (static) และ API เพราะ production เสิร์ฟสองส่วนนี้แยกกัน
  const checkUrls = [getPwaAssetUrl("app.html", baseUrl), getPwaAssetUrl("api/health", baseUrl)];

  let consecutiveFailures = 0;
  let checking = false;
  let stopped = false;

  const isReachable = async (url: string) => {
    const controller = typeof AbortController === "undefined" ? undefined : new AbortController();
    const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetcher(withCacheBuster(url), {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: controller?.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  };

  const check = async () => {
    if (checking || stopped) return;
    if (!isKioskRecoveryPath(getPathname(), baseUrl)) {
      consecutiveFailures = 0;
      return;
    }
    checking = true;
    try {
      const results = await Promise.all(checkUrls.map(isReachable));
      if (stopped) return;
      if (results.every(Boolean)) {
        if (consecutiveFailures >= failureThreshold) {
          stopped = true;
          reload();
        }
        consecutiveFailures = 0;
      } else {
        consecutiveFailures += 1;
      }
    } finally {
      checking = false;
    }
  };

  const intervalId = window.setInterval(check, intervalMs);
  return () => {
    stopped = true;
    window.clearInterval(intervalId);
  };
}
