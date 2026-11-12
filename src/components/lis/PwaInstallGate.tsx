import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Download, MonitorCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  detectPwaInstallBrowser,
  getPwaInstallState,
  isDesktopDevice,
  isStandalonePwa,
  promptPwaInstall,
  subscribeStandalonePwa,
  subscribePwaInstallState,
  type PwaInstallBrowser,
} from "@/lib/pwa";
import { requiresPwaInstall } from "@/lib/pwaInstallPolicy";

// dev ไม่มี service worker จึงติดตั้งจริงไม่ได้ — เปิดดูหน้านี้ได้ด้วย localStorage flag
const DEV_PREVIEW_KEY = "lis.pwaInstallGate.preview";

function gateEnabled() {
  if (import.meta.env.PROD) return true;
  try {
    return localStorage.getItem(DEV_PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{children}</code>
);

const MANUAL_INSTALL: Record<Exclude<PwaInstallBrowser, "other">, ReactNode> = {
  edge: <>กดเมนู <Code>...</Code> มุมขวาบน → <Code>Apps</Code> → <Code>Install this site as an app</Code></>,
  chrome: <>กดไอคอนติดตั้งท้ายช่อง URL หรือเมนู <Code>⋮</Code> → <Code>Cast, save, and share</Code> → <Code>Install page as app</Code></>,
};

const AUTO_START: Record<Exclude<PwaInstallBrowser, "other">, ReactNode> = {
  edge: <>พิมพ์ <Code>edge://apps</Code> ในช่อง URL → เลือก LIS → <Code>Details</Code> → เปิด <Code>Start automatically on device login</Code></>,
  chrome: <>พิมพ์ <Code>chrome://apps</Code> ในช่อง URL → คลิกขวาที่ LIS → เลือก <Code>Launch at startup</Code></>,
};

const BACKGROUND: Record<Exclude<PwaInstallBrowser, "other">, ReactNode> = {
  edge: <>พิมพ์ <Code>edge://settings/system</Code> → เปิด <Code>Continue running background extensions and apps when Microsoft Edge is closed</Code></>,
  chrome: <>พิมพ์ <Code>chrome://settings/system</Code> → เปิด <Code>Continue running background apps when Google Chrome is closed</Code></>,
};

const Step = ({ index, title, children }: { index: number; title: string; children: ReactNode }) => (
  <li className="flex gap-3">
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
      {index}
    </span>
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  </li>
);

/**
 * ผู้ใช้ฝ่าย Lab/QC ที่เปิด LIS จากแท็บเบราว์เซอร์บนคอม ต้องติดตั้งเป็นแอปก่อนใช้งาน
 * เพื่อให้รับแจ้งเตือนได้แม้ปิดหน้าต่าง และตั้งให้เปิดเองเมื่อเปิดคอมได้
 * เกณฑ์ว่าใครโดนบังคับอยู่ใน requiresPwaInstall
 */
const PwaInstallGate = () => {
  const { user, isProductionSession = false, logout } = useAuth();
  const { pathname } = useLocation();
  const install = useSyncExternalStore(subscribePwaInstallState, getPwaInstallState);
  // อ่านสด — หลังติดตั้ง แท็บนี้กลายเป็นหน้าต่างแอปทันที ต้องปิด gate โดยไม่ต้อง refresh
  const isStandalone = useSyncExternalStore(subscribeStandalonePwa, isStandalonePwa);
  const [isDesktop] = useState(() => isDesktopDevice());
  const [browser] = useState(() => detectPwaInstallBrowser());
  const [prompting, setPrompting] = useState(false);

  const required =
    gateEnabled() &&
    requiresPwaInstall({
      user,
      isProductionSession,
      pathname,
      isStandalone,
      isAppInstalled: install.installedOnDevice,
      isDesktop,
    });
  if (!required) return null;

  const handleInstall = async () => {
    setPrompting(true);
    try {
      const outcome = await promptPwaInstall();
      if (outcome === "dismissed") toast.info("ยังไม่ได้ติดตั้ง กดปุ่มติดตั้งอีกครั้งเมื่อพร้อม");
    } finally {
      setPrompting(false);
    }
  };

  const supported = browser !== "other";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-background/90 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-gate-title"
        className="w-full max-w-xl space-y-5 rounded-lg border bg-card p-6 text-card-foreground shadow-lg"
      >
        <div className="space-y-1">
          <h2 id="pwa-install-gate-title" className="text-lg font-semibold">
            {install.installed ? "ติดตั้ง LIS เรียบร้อยแล้ว" : "ติดตั้งแอป LIS ก่อนใช้งาน"}
          </h2>
          <p className="text-sm text-muted-foreground">
            ฝ่าย Lab และ QC ต้องใช้ LIS ผ่านแอปที่ติดตั้งในเครื่อง เพื่อให้รับแจ้งเตือนได้แม้ปิดหน้าต่าง
            และเปิดเองเมื่อเปิดคอม
          </p>
        </div>

        {!supported ? (
          <p role="alert" className="text-sm text-destructive">
            เบราว์เซอร์นี้ติดตั้ง LIS ไม่ได้ กรุณาเปิด LIS ด้วย Microsoft Edge หรือ Google Chrome
          </p>
        ) : (
          <ol className="space-y-4">
            <Step index={1} title="ติดตั้งแอป LIS">
              {install.installed ? (
                <p>ติดตั้งแล้ว แอป LIS จะเปิดเป็นหน้าต่างแยก และมีไอคอนใน Start menu กับ Desktop</p>
              ) : install.canPrompt ? (
                <div className="space-y-2 pt-1">
                  <Button onClick={() => void handleInstall()} disabled={prompting}>
                    <Download className="h-4 w-4" />
                    ติดตั้ง LIS
                  </Button>
                  <p>กดปุ่มแล้วเลือก Install ในหน้าต่างที่เด้งขึ้นมา</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p>{MANUAL_INSTALL[browser]}</p>
                  <p>
                    ถ้าเคยติดตั้งแล้ว ให้เปิด LIS จากไอคอนบน Desktop หรือ Start menu หรือกด{" "}
                    <Code>Open in app</Code> ท้ายช่อง URL
                  </p>
                </div>
              )}
            </Step>
            <Step index={2} title="ตั้งให้เปิดเองเมื่อเปิดคอม">
              {AUTO_START[browser]}
            </Step>
            <Step index={3} title="ให้รับแจ้งเตือนได้แม้ปิดหน้าต่าง">
              {BACKGROUND[browser]}
            </Step>
            <Step index={4} title="ใช้งานจากแอป">
              ปิดแท็บนี้ แล้วเปิด LIS จากไอคอนแอป เมื่อเปิดจากแอปหน้านี้จะไม่แสดงอีก
            </Step>
          </ol>
        )}

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MonitorCheck className="h-4 w-4" />
            {user?.email}
          </p>
          <Button variant="ghost" onClick={logout}>
            ออกจากระบบ
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PwaInstallGate;
