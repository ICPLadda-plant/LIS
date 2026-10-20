export const PWA_ACTIVE_ACCOUNT_STORAGE_KEY = "lis.pwa.activeAccountId";

// Bump with CACHE_VERSION in public/sw.js. The query gives the worker a new URL,
// so browsers skip any CDN copy of an older sw.js still cached under the old URL.
export const PWA_SERVICE_WORKER_VERSION = "3";

type StandaloneNavigator = Navigator & { standalone?: boolean };

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
