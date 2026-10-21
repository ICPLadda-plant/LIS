const CACHE_VERSION = "lis-pwa-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.png?v=2",
  "./pwa-icon-180.png?v=2",
  "./pwa-icon-192.png?v=2",
  "./pwa-icon-512.png?v=2",
  "./pwa-maskable-192.png?v=2",
  "./pwa-maskable-512.png?v=2",
];

function isCacheableRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.includes("/api") || url.pathname.includes("/uploads")) return false;
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isCacheableRequest(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match("./").then((cached) => cached || caches.match("./index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
