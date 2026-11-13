export const PWA_ACTIVE_ACCOUNT_STORAGE_KEY = "lis.pwa.activeAccountId";

// Bump with CACHE_VERSION in public/sw.js. The query gives the worker a new URL,
// so browsers skip any CDN copy of an older sw.js still cached under the old URL.
export const PWA_SERVICE_WORKER_VERSION = "6";

type StandaloneNavigator = Navigator & { standalone?: boolean };

// Chromium-only event; not in lib.dom yet.
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaInstallState = {
  // เบราว์เซอร์พร้อมเปิดหน้าต่างติดตั้งให้ทันทีเมื่อกดปุ่ม
  canPrompt: boolean;
  // ติดตั้งสำเร็จในแท็บนี้ (appinstalled)
  installed: boolean;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installState: PwaInstallState = { canPrompt: false, installed: false };
const installStateListeners = new Set<() => void>();
let installCaptureStarted = false;

function setInstallState(next: Partial<PwaInstallState>) {
  installState = { ...installState, ...next };
  installStateListeners.forEach((listener) => listener());
}

/**
 * beforeinstallprompt fires once, early in page load — before React mounts the
 * install gate — so it must be captured at startup and replayed on demand.
 */
export function startPwaInstallPromptCapture(target: Window | undefined = typeof window === "undefined" ? undefined : window) {
  if (!target || installCaptureStarted) return;
  installCaptureStarted = true;
  target.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    setInstallState({ canPrompt: true });
  });
  target.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    setInstallState({ canPrompt: false, installed: true });
  });
}

export function getPwaInstallState() {
  return installState;
}

export function subscribePwaInstallState(listener: () => void) {
  installStateListeners.add(listener);
  return () => {
    installStateListeners.delete(listener);
  };
}

export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredInstallPrompt;
  if (!event) return "unavailable";
  // A prompt event can only be used once.
  deferredInstallPrompt = null;
  setInstallState({ canPrompt: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

type DesktopNavigator = Navigator & { userAgentData?: { mobile?: boolean } };

/** คอมตั้งโต๊ะ/โน้ตบุ๊ก — ไม่นับมือถือ แท็บเล็ต และกล่อง Android TV */
export function isDesktopDevice(nav: DesktopNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator) {
  if (!nav) return false;
  if (nav.userAgentData?.mobile === true) return false;
  const ua = nav.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobi|Tablet/i.test(ua)) return false;
  // iPadOS reports itself as a Mac; a touch-capable "Mac" is an iPad.
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return false;
  return true;
}

export type PwaInstallBrowser = "edge" | "chrome" | "other";

export function detectPwaInstallBrowser(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): PwaInstallBrowser {
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Chrome\//.test(userAgent) && !/OPR\/|SamsungBrowser/.test(userAgent)) return "chrome";
  return "other";
}

type RegisterPwaServiceWorkerOptions = {
  enabled?: boolean;
  baseUrl?: string;
  serviceWorker?: ServiceWorkerContainer | null;
};

export function normalizePwaBaseUrl(baseUrl: string = import.meta.env.BASE_URL || "/") {
  if (!baseUrl || baseUrl === "./") return "/";
  const withLeadingSlash = baseUrl.startsWith("/") || /^https?:\/\//.test(baseUrl)
    ? baseUrl
    : `/${baseUrl}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function getPwaAssetUrl(assetPath: string, baseUrl: string = import.meta.env.BASE_URL || "/") {
  const normalizedBase = normalizePwaBaseUrl(baseUrl);
  const normalizedAsset = assetPath.replace(/^\/+/, "");
  return `${normalizedBase}${normalizedAsset}`;
}

export function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  const displayModeStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const displayModeFullscreen = window.matchMedia?.("(display-mode: fullscreen)").matches ?? false;
  const iosStandalone = (window.navigator as StandaloneNavigator).standalone === true;
  return displayModeStandalone || displayModeFullscreen || iosStandalone;
}

/**
 * ตอนกดติดตั้ง Chrome/Edge จะย้ายแท็บเดิมไปเป็นหน้าต่างแอปโดยไม่โหลดหน้าใหม่
 * display mode จึงเปลี่ยนกลางทาง — ต้องฟัง change ไม่ใช่อ่านครั้งเดียวตอนโหลด
 */
export function subscribeStandalonePwa(listener: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const queries = ["(display-mode: standalone)", "(display-mode: fullscreen)"].map((query) => window.matchMedia(query));
  queries.forEach((query) => {
    if (query.addEventListener) query.addEventListener("change", listener);
    else query.addListener?.(listener);
  });
  return () => {
    queries.forEach((query) => {
      if (query.removeEventListener) query.removeEventListener("change", listener);
      else query.removeListener?.(listener);
    });
  };
}

export async function registerPwaServiceWorker(options: RegisterPwaServiceWorkerOptions = {}) {
  const {
    enabled = import.meta.env.PROD,
    baseUrl = import.meta.env.BASE_URL || "/",
    serviceWorker = typeof navigator === "undefined" ? null : navigator.serviceWorker,
  } = options;

  if (!enabled || !serviceWorker) return;

  try {
    await serviceWorker.register(getPwaAssetUrl(`sw.js?v=${PWA_SERVICE_WORKER_VERSION}`, baseUrl), {
      scope: normalizePwaBaseUrl(baseUrl),
      updateViaCache: "none",
    });
  } catch (error) {
    console.error("[pwa] service worker registration failed", error);
  }
}
