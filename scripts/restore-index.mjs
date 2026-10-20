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
