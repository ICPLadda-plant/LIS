const CACHE_VERSION = "lis-pwa-v5";
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

// request ที่ใช้เช็คสถานะระบบ ต้องวิ่งไป server ทุกครั้งและห้ามเก็บลง cache
const NETWORK_ONLY_PARAMS = ["lisBuildCheck", "lisHealthCheck", "lisRecover"];
const RECOVERY_RETRY_MS = 5000;

function isCacheableRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.includes("/api") || url.pathname.includes("/uploads")) return false;
  if (NETWORK_ONLY_PARAMS.some((param) => url.searchParams.has(param))) return false;
  return true;
}

// เปิดหน้าแอป (ไม่ใช่ไฟล์อย่าง .pdf/.png) — ถ้าได้ error ให้แสดงหน้ารอระบบกลับมาแทน
function isAppPageNavigation(url) {
  const lastSegment = url.pathname.split("/").pop() || "";
  return !lastSegment.includes(".") || lastSegment.endsWith(".html");
}

function recoveryReason(status) {
  if (!status) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
  if (status === 530) return "เซิร์ฟเวอร์ไม่ตอบสนอง (Cloudflare 1033 / 530)";
  return "เซิร์ฟเวอร์ตอบกลับรหัส " + status;
}

// หน้ารอระบบกลับมา: เช็คหน้าเดิมและ API ทุก 5 วินาที เมื่อตอบปกติทั้งคู่จะโหลดหน้าเดิมใหม่เอง
// ใช้กับเครื่องที่เปิดค้างไว้ (เช่น LIS Scanner) ซึ่งไม่มีคนกด refresh ให้
function recoveryResponse(status) {
  const healthUrl = new URL("api/health", self.registration.scope).pathname;
  const html = '<!doctype html><html lang="th"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>LIS กำลังรอระบบกลับมา</title>'
    + '<style>'
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'font-family:system-ui,-apple-system,"Segoe UI","Noto Sans Thai",sans-serif;background:#f8fafc;color:#0f172a}'
    + '.card{max-width:28rem;margin:1rem;padding:1.5rem;border:1px solid #e2e8f0;border-radius:.5rem;background:#fff;'
    + 'box-shadow:0 1px 2px rgba(15,23,42,.06);text-align:center}'
    + 'h1{font-size:1rem;font-weight:600;margin:0 0 .5rem}'
    + 'p{font-size:.875rem;color:#64748b;margin:.25rem 0}'
    + 'button{margin-top:1rem;padding:.5rem 1rem;border:0;border-radius:.375rem;background:#2563eb;color:#fff;'
    + 'font:inherit;font-size:.875rem;font-weight:500;cursor:pointer}'
    + '</style></head><body><main class="card">'
    + '<h1>ระบบ LIS ไม่พร้อมใช้งานชั่วคราว</h1>'
    + '<p>' + recoveryReason(status) + '</p>'
    + '<p id="lis-recover-status">หน้านี้จะโหลดใหม่เองเมื่อระบบกลับมา</p>'
    + '<button type="button" id="lis-recover-now">ลองใหม่ตอนนี้</button>'
    + '</main><script>'
    + '(function(){'
    + 'var retryMs=' + RECOVERY_RETRY_MS + ';var healthUrl=' + JSON.stringify(healthUrl) + ';'
    + 'var statusEl=document.getElementById("lis-recover-status");var checking=false;'
    + 'function bust(u){var x=new URL(u,location.href);x.searchParams.set("lisRecover",String(Date.now()));return x.pathname+x.search;}'
    + 'function ok(u){return fetch(bust(u),{cache:"no-store"}).then(function(r){return r.ok;}).catch(function(){return false;});}'
    + 'function check(){if(checking)return;checking=true;statusEl.textContent="กำลังตรวจสอบการเชื่อมต่อ...";'
    + 'Promise.all([ok(location.href),ok(healthUrl)]).then(function(r){'
    + 'if(r[0]&&r[1]){statusEl.textContent="ระบบกลับมาแล้ว กำลังโหลดหน้าใหม่...";location.reload();return;}'
    + 'statusEl.textContent="ยังเชื่อมต่อไม่ได้ จะลองใหม่ทุก "+(retryMs/1000)+" วินาที";checking=false;});}'
    + 'document.getElementById("lis-recover-now").addEventListener("click",check);'
    + 'window.addEventListener("online",check);setInterval(check,retryMs);'
    + '})();'
    + '</script></body></html>';
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
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
    const url = new URL(request.url);
    event.respondWith(
      fetch(request)
        .then((response) => {
          // redirect (เช่น login) และหน้าที่ตอบปกติ ปล่อยผ่าน; error ทุกรหัสของหน้าแอปให้แสดงหน้ารอ
          if (response.ok || response.type === "opaqueredirect" || response.status < 400) return response;
          return isAppPageNavigation(url) ? recoveryResponse(response.status) : response;
        })
        // เดิม fallback ไป index.html ใน cache ซึ่งเป็น template ของ dev → หน้าขาวที่ไม่ refresh เอง
        .catch(() => (isAppPageNavigation(url) ? recoveryResponse(0) : Response.error())),
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

// แจ้งเตือน PWA (Web Push) — payload มาจาก server/lib/webPush.js: { title, body, tag, url }
// url เป็น path สัมพัทธ์กับ scope (เช่น "petition/<id>") เพื่อให้ใช้ได้ทั้ง local และ /LIS/
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "LIS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "./pwa-icon-192.png?v=2",
      badge: "./pwa-icon-192.png?v=2",
      data: { url: new URL(data.url || "", self.registration.scope).href },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) {
        return existing.focus().then((client) => (client && "navigate" in client ? client.navigate(target) : client));
      }
      return self.clients.openWindow(target);
    }),
  );
});

