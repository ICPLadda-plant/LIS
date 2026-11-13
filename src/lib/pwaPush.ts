import { api, type PushDevicesState, type PushSubscriptionPayload } from "@/lib/api";
import { getPwaAssetUrl, isStandalonePwa, normalizePwaBaseUrl, PWA_SERVICE_WORKER_VERSION } from "@/lib/pwa";
import { readSeeAll } from "@/lib/petitionAudience";

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

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false;
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((value, index) => value === b[index]);
}

export async function subscribeThisDevice(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionDeniedError("ไม่ได้รับอนุญาตให้แจ้งเตือน");
  const registration = await getRegistration();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  const existing = await registration.pushManager.getSubscription();
  // subscription ที่สมัครไว้กับ key เก่า (เซิร์ฟเวอร์เปลี่ยน VAPID key) ส่งไม่ถึง ต้องสมัครใหม่
  if (existing && sameKey(existing.options?.applicationServerKey, applicationServerKey)) return existing;
  await existing?.unsubscribe().catch(() => false);
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
}

// ผู้ใช้ปิดรับบนเครื่องนี้เอง (สวิตช์ในตั้งค่าโปรไฟล์) — ห้ามสมัครให้อัตโนมัติหรือถามซ้ำ
const OPT_OUT_KEY = "lis.push.optOut";
// กด "ไว้ทีหลัง" ในหน้าต่างถาม — ถามใหม่เมื่อครบเวลานี้
const SNOOZE_KEY = "lis.push.promptSnoozedUntil";
export const PUSH_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000;

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // localStorage ใช้ไม่ได้ ไม่กระทบการแจ้งเตือน
  }
}

export const readPushOptOut = () => readStorage(OPT_OUT_KEY) === "1";
export const writePushOptOut = (optOut: boolean) => writeStorage(OPT_OUT_KEY, optOut ? "1" : null);
export const isPushPromptSnoozed = (now = Date.now()) => Number(readStorage(SNOOZE_KEY) || 0) > now;
export const snoozePushPrompt = (now = Date.now()) => writeStorage(SNOOZE_KEY, String(now + PUSH_PROMPT_SNOOZE_MS));

/** สมัครรับแจ้งเตือนบนเครื่องนี้และบันทึกเครื่องลง server (ขอสิทธิ์จากเบราว์เซอร์ถ้ายังไม่เคยให้) */
export async function enablePushOnThisDevice(publicKey: string) {
  const subscription = await subscribeThisDevice(publicKey);
  const state = await api.subscribePush(toSubscriptionPayload(subscription), describeDevice(), readSeeAll());
  writePushOptOut(false);
  writeStorage(SNOOZE_KEY, null);
  return { subscription, state };
}

export type PushDeviceStatus =
  | { kind: "enabled" }
  | { kind: "can-enable"; publicKey: string }
  | { kind: "unavailable" };

/** สถานะการแจ้งเตือนของเครื่องนี้ เทียบกับรายการเครื่องที่ server รู้จัก */
export async function getPushDeviceStatus(): Promise<PushDeviceStatus> {
  if (getPushSupport() !== "supported" || Notification.permission === "denied") return { kind: "unavailable" };
  const current = await getCurrentPushSubscription().catch(() => null);
  const state: PushDevicesState = await api.getPushDevices(current?.endpoint);
  if (!state.configured || !state.publicKey) return { kind: "unavailable" };
  if (current && state.devices.some((device) => device.current)) return { kind: "enabled" };
  return { kind: "can-enable", publicKey: state.publicKey };
}
