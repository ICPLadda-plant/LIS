import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { resolve } from "path";
import { devIndexHtml } from "./restore-index.mjs";

const root = resolve(".");
const dist = resolve(root, "dist");
// เก็บไฟล์ assets ของ build ก่อนหน้าไว้ช่วงหนึ่ง หน้าที่ยังเปิดค้างจาก build เก่าจะเปิดเมนูอื่นต่อได้
// จนกว่าตัวเช็ค build จะโหลดหน้าใหม่ให้ ไฟล์ที่เก่ากว่านี้จะถูกลบทิ้ง
const KEEP_PREVIOUS_ASSETS_MS = 7 * 24 * 60 * 60 * 1000;

if (!existsSync(dist)) {
  throw new Error("dist directory does not exist. Run vite build first.");
}

// Stage and validate the complete build before touching the live files. The
// live root is only changed after every new file is ready, and is restored if
// any rename fails, so a failed deploy keeps the previous build serving.
const staging = mkdtempSync(resolve(root, ".deploy-staging-"));
const backup = mkdtempSync(resolve(root, ".deploy-backup-"));
const movedTargets = [];

try {
  cpSync(dist, staging, { recursive: true, force: true });

  const stagedIndex = resolve(staging, "index.html");
  const stagedApp = resolve(staging, "app.html");
  if (!existsSync(stagedIndex) || statSync(stagedIndex).size === 0) {
    throw new Error("Built index.html is missing or empty.");
  }
  renameSync(stagedIndex, stagedApp);

  const stagedEntries = readdirSync(staging);
  if (!stagedEntries.includes("assets") || !statSync(resolve(staging, "assets")).isDirectory()) {
    throw new Error("Built assets directory is missing.");
  }

  const liveAssets = resolve(root, "assets");
  if (existsSync(liveAssets) && statSync(liveAssets).isDirectory()) {
    const stagedAssets = resolve(staging, "assets");
    const keepAfter = Date.now() - KEEP_PREVIOUS_ASSETS_MS;
    for (const file of readdirSync(liveAssets)) {
      const source = resolve(liveAssets, file);
      const target = resolve(stagedAssets, file);
      const info = statSync(source);
      if (!info.isFile() || existsSync(target) || info.mtimeMs < keepAfter) continue;
      copyFileSync(source, target);
    }
  }

  // app.html ต้องขึ้นเป็นไฟล์สุดท้าย ถ้าขึ้นก่อน assets เบราว์เซอร์จะขอไฟล์ JS ใหม่ที่ยังไม่มี
  // แล้วได้หน้า HTML กลับมาแทน ทำให้ PWA ค้างจอขาว
  const orderedEntries = [...stagedEntries.filter((entry) => entry !== "app.html"), "app.html"];
  for (const entry of orderedEntries) {
    const target = resolve(root, entry);
    const stagedTarget = resolve(staging, entry);
    const backupTarget = resolve(backup, entry);
    if (existsSync(target)) renameSync(target, backupTarget);
    movedTargets.push({ target, backupTarget });
    renameSync(stagedTarget, target);
  }

  // index.html is always the Vite development template; production is app.html.
  writeFileSync(resolve(root, "index.html"), devIndexHtml, "utf8");
  rmSync(backup, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
  console.log("Built files deployed atomically: production entry → app.html, index.html kept as dev template.");
} catch (error) {
  for (const { target, backupTarget } of movedTargets.reverse()) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (existsSync(backupTarget)) renameSync(backupTarget, target);
  }
  rmSync(staging, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
  throw error;
}
