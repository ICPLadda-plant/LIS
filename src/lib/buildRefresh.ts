import { getPwaAssetUrl } from "./pwa";

type BuildRefreshWatcherOptions = {
  enabled?: boolean;
  baseUrl?: string;
  intervalMs?: number;
  documentRef?: Document;
  fetcher?: typeof fetch;
  reload?: () => void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
};

const BUILD_ASSET_PATTERN = /\b(?:src|href)=(['"])(.*?)\1/gi;
const DEFAULT_INTERVAL_MS = 5_000;
// กัน reload วนไม่จบ เช่นกรณี server ยังส่งหน้าเก่ากลับมา ให้ reload ได้ไม่เกิน 1 ครั้งต่อช่วงเวลานี้
export const BUILD_RELOAD_COOLDOWN_MS = 30_000;
export const BUILD_RELOAD_STORAGE_KEY = "lis.buildRefresh.lastReloadAt";

function defaultStorage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function normalizeAssetUrl(rawUrl: string, entryUrl: string) {
  try {
    const url = new URL(rawUrl, entryUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
}

function isBuildAsset(path: string) {
  return /(?:^|\/)assets\//.test(path);
}

export function extractBuildSignature(html: string, entryUrl = getPwaAssetUrl("app.html")) {
  const assets: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = BUILD_ASSET_PATTERN.exec(html)) !== null) {
    const assetPath = normalizeAssetUrl(match[2], entryUrl);
    if (isBuildAsset(assetPath)) assets.push(assetPath);
  }

  return assets.join("\n");
}

function toAssetSet(signature: string) {
  return new Set(signature.split("\n").filter(Boolean));
}

function readCurrentBuildSignature(documentRef: Document) {
  const entryUrl = documentRef.baseURI || getPwaAssetUrl("app.html");
  return Array.from(documentRef.querySelectorAll<HTMLLinkElement | HTMLScriptElement>("link[href],script[src]"))
    .map((element) => element.getAttribute("href") || element.getAttribute("src") || "")
    .map((assetUrl) => normalizeAssetUrl(assetUrl, entryUrl))
    .filter(isBuildAsset)
    .join("\n");
}

function buildEntryCheckUrl(baseUrl: string) {
  const url = new URL(getPwaAssetUrl("app.html", baseUrl), window.location.origin);
  url.searchParams.set("lisBuildCheck", String(Date.now()));
  return `${url.pathname}${url.search}`;
}

export function startBuildRefreshWatcher(options: BuildRefreshWatcherOptions = {}) {
  const {
    enabled = import.meta.env.PROD,
    baseUrl = import.meta.env.BASE_URL || "/",
    intervalMs = DEFAULT_INTERVAL_MS,
    documentRef = typeof document === "undefined" ? undefined : document,
    fetcher = typeof fetch === "undefined" ? undefined : fetch.bind(globalThis),
    reload = () => window.location.reload(),
    storage = defaultStorage(),
    now = () => Date.now(),
  } = options;

  if (!enabled || !documentRef || !fetcher || typeof window === "undefined") return () => {};

  let stopped = false;

  const reloadOnce = () => {
    if (stopped) return false;
    try {
      const lastReloadAt = Number(storage?.getItem(BUILD_RELOAD_STORAGE_KEY) || 0);
      if (lastReloadAt && now() - lastReloadAt < BUILD_RELOAD_COOLDOWN_MS) return false;
      storage?.setItem(BUILD_RELOAD_STORAGE_KEY, String(now()));
    } catch {
      // sessionStorage ใช้ไม่ได้ (เช่นโหมดส่วนตัว) ยังให้ reload ตามปกติ
    }
    stopped = true;
    reload();
    return true;
  };

  // หน้าเปิดค้างจาก build เก่าแล้วเปิดเมนูที่ยังไม่เคยโหลด ไฟล์ของ build เก่าถูกลบไปแล้ว
  // ให้โหลดหน้าใหม่เพื่อรับ build ล่าสุดแทนการค้างหน้า error
  const handlePreloadError = (event: Event) => {
    if (reloadOnce()) event.preventDefault();
  };
  window.addEventListener("vite:preloadError", handlePreloadError);

  const currentSignature = readCurrentBuildSignature(documentRef);
  if (!currentSignature) {
    return () => {
      stopped = true;
      window.removeEventListener("vite:preloadError", handlePreloadError);
    };
  }
  const currentAssets = toAssetSet(currentSignature);

  let checking = false;

  const checkForNewBuild = async () => {
    if (checking || stopped) return;
    checking = true;
    try {
      const entryUrl = buildEntryCheckUrl(baseUrl);
      const response = await fetcher(entryUrl, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!response.ok) return;

      const latestSignature = extractBuildSignature(await response.text(), new URL(entryUrl, window.location.origin).toString());
      const latestAssets = toAssetSet(latestSignature);
      if (latestAssets.size > 0 && [...latestAssets].some((asset) => !currentAssets.has(asset))) {
        reloadOnce();
      }
    } catch (error) {
      console.error("[build-refresh] latest build check failed", error);
    } finally {
      checking = false;
    }
  };

  const intervalId = window.setInterval(checkForNewBuild, intervalMs);

  // PWA ที่ย่อหน้าต่างหรือเครื่องพักหน้าจอ timer จะถูกหน่วงหรือหยุด จึงเช็คทันทีเมื่อกลับมาใช้งาน
  const checkWhenVisible = () => {
    if (documentRef.visibilityState === "hidden") return;
    void checkForNewBuild();
  };
  documentRef.addEventListener("visibilitychange", checkWhenVisible);
  window.addEventListener("focus", checkWhenVisible);
  window.addEventListener("online", checkWhenVisible);
  window.addEventListener("pageshow", checkWhenVisible);

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    window.removeEventListener("vite:preloadError", handlePreloadError);
    documentRef.removeEventListener("visibilitychange", checkWhenVisible);
    window.removeEventListener("focus", checkWhenVisible);
    window.removeEventListener("online", checkWhenVisible);
    window.removeEventListener("pageshow", checkWhenVisible);
  };
}
