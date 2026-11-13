import { writeFileSync } from "fs";
import { fileURLToPath } from "url";

// The Vite dev template. root/index.html must ALWAYS be this version so the dev
// server (npm run dev) can resolve /src/main.tsx. Production is served from
// app.html instead (see scripts/deploy-dist-to-root.mjs + .htaccess), so this
// file never needs to hold the built/hashed-asset markup.
export const devIndexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script>
      // ไฟล์ JS/CSS ของ build โหลดไม่ได้ (เช่นได้หน้า HTML จาก cache ที่เสีย) ล้าง cache ของแอปแล้วโหลดใหม่ ไม่เกิน 1 ครั้งต่อ 30 วินาที
      (function () {
        var key = "lis.assetRecoveryAt";
        window.addEventListener("error", function (event) {
          var target = event.target;
          if (!target || (target.tagName !== "SCRIPT" && target.tagName !== "LINK")) return;
          var url = target.src || target.href || "";
          if (url.indexOf("/assets/") === -1) return;
          try {
            var last = Number(sessionStorage.getItem(key) || 0);
            if (Date.now() - last < 30000) return;
            sessionStorage.setItem(key, String(Date.now()));
          } catch (error) {}
          var reload = function () { location.reload(); };
          if (!window.caches || !caches.keys) return reload();
          caches.keys().then(function (names) {
            return Promise.all(names.filter(function (name) { return name.indexOf("lis-pwa") === 0; }).map(function (name) { return caches.delete(name); }));
          }).then(reload, reload);
        }, true);
      })();
    </script>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ICPLadda - LIS</title>
    <meta name="description" content="LIS - Lab Information System">
    <meta name="author" content="ICP Ladda" />
    <meta name="theme-color" content="#1f6fb2" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="LIS" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" sizes="180x180" href="/pwa-icon-180.png?v=2" />
    <link rel="icon" type="image/png" href="/favicon.png?v=2">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

export const devAuthHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Authenticating...</title>
  </head>
  <body>
    Completing sign-in...
  </body>
</html>
`;

// When run directly (node scripts/restore-index.mjs) restore both dev templates.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync("index.html", devIndexHtml, "utf8");
  writeFileSync("auth.html", devAuthHtml, "utf8");
  console.log("✅ index.html and auth.html restored");
}
