import type { PushSubscriptionPayload } from "@/lib/api";
import { getPwaAssetUrl, isStandalonePwa, normalizePwaBaseUrl, PWA_SERVICE_WORKER_VERSION } from "@/lib/pwa";

type PushSupport = "supported" | "unsupported" | "needs-install";

export function isIosDevice(nav: Navigator = navigator) {
  const ua = nav.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ รายงานตัวเองเป็น Mac แต่มีจอสัมผัส
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** iOS รับ push ได้เฉพาะตอนเปิดจากไอคอนบนหน้าจอโฮม */
export function getPushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  if (isIosDevice() && !isStandalonePwa()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "supported";
}

export function describeDevice(nav: Navigator = navigator) {
  const ua = nav.userAgent || "";
  const os = isIosDevice(nav)
    ? "iPhone / iPad"
    : /Android/i.test(ua)
      ? "Android"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "อุปกรณ์อื่น";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return browser ? `${os} · ${browser}` : os;
}

// dev server ไม่ register service worker เอง (ดู registerPwaServiceWorker) จึง register ตอนผู้ใช้เปิดรับ
async function getRegistration() {
  const scope = normalizePwaBaseUrl();
  const existing = await navigator.serviceWorker.getRegistration(scope);
  if (existing) return existing;
  await navigator.serviceWorker.register(getPwaAssetUrl(`sw.js?v=${PWA_SERVICE_WORKER_VERSION}`), {
    scope,
    updateViaCache: "none",
  });
  return navigator.serviceWorker.ready;
}

export async function getCurrentPushSubscription() {
  if (getPushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration(normalizePwaBaseUrl());
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function urlBase64ToUint8Array(base64: string) {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function toSubscriptionPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}

export class PushPermissionDeniedError extends Error {}

export async function subscribeThisDevice(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionDeniedError("ไม่ได้รับอนุญาตให้แจ้งเตือน");
  const registration = await getRegistration();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}
