import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPwaInstallState, isDesktopDevice, isStandalonePwa } from "@/lib/pwa";
import { requiresPwaInstall } from "@/lib/pwaInstallPolicy";
import {
  enablePushOnThisDevice,
  getPushDeviceStatus,
  isPushPromptSnoozed,
  PushPermissionDeniedError,
  readPushOptOut,
  snoozePushPrompt,
} from "@/lib/pwaPush";

// รอให้หน้าแรกโหลดเสร็จ (StartupLoadingGate ค้างอย่างน้อย 1.5 วินาที) ก่อนถาม
export const PUSH_PROMPT_DELAY_MS = 2_500;

// หน้าจอประจำจุดและหน้าที่ไม่ต้อง login ไม่ถาม
const SKIP_PATHS = ["/login", "/logout", "/scanner", "/queue/lab", "/queue/qc", "/stock/view"];

/**
 * หลังเปิด LIS และ login แล้ว ถ้าเครื่องนี้ยังไม่ได้รับแจ้งเตือน ให้ถามว่าจะเปิดรับไหม
 * เครื่องที่เคยอนุญาตแจ้งเตือนไว้แล้วจะสมัครให้เองโดยไม่ถาม (เช่น server ลบเครื่องทิ้งหรือเปลี่ยน key)
 */
const PushEnablePrompt = () => {
  const { user, isProductionSession = false } = useAuth();
  const { pathname } = useLocation();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const checkedFor = useRef<string | null>(null);

  const userKey = user?.email ?? "";
  const approved = !user?.approvalStatus || user.approvalStatus === "approved";
  const installGateShown =
    import.meta.env.PROD &&
    requiresPwaInstall({
      user,
      isProductionSession,
      pathname,
      isStandalone: isStandalonePwa(),
      isAppInstalled: getPwaInstallState().installedOnDevice,
      isDesktop: isDesktopDevice(),
    });
  const ready = Boolean(userKey) && approved && !installGateShown && !SKIP_PATHS.includes(pathname);

  useEffect(() => {
    if (!ready || checkedFor.current === userKey || readPushOptOut()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      checkedFor.current = userKey;
      try {
        const status = await getPushDeviceStatus();
        if (cancelled || status.kind !== "can-enable") return;
        if (Notification.permission === "granted") {
          await enablePushOnThisDevice(status.publicKey);
          return;
        }
        if (!isPushPromptSnoozed()) setPublicKey(status.publicKey);
      } catch (error) {
        console.error("[push] check this device failed", error);
      }
    }, PUSH_PROMPT_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, userKey]);

  const later = () => {
    snoozePushPrompt();
    setPublicKey(null);
  };

  const enable = async () => {
    if (!publicKey) return;
    setEnabling(true);
    try {
      await enablePushOnThisDevice(publicKey);
      toast.success("เปิดรับแจ้งเตือนบนเครื่องนี้แล้ว");
      setPublicKey(null);
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) {
        snoozePushPrompt();
        setPublicKey(null);
        toast.error("เบราว์เซอร์ยังไม่อนุญาตการแจ้งเตือน เปิดได้ภายหลังที่ตั้งค่าโปรไฟล์");
      } else {
        toast.error(error instanceof Error && error.message ? error.message : "เปิดรับแจ้งเตือนไม่สำเร็จ");
      }
    } finally {
      setEnabling(false);
    }
  };

  return (
    <Dialog open={Boolean(publicKey) && ready} onOpenChange={(open) => (!open && !enabling ? later() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <BellRing className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <DialogTitle>เปิดรับการแจ้งเตือนบนเครื่องนี้ไหม</DialogTitle>
          <DialogDescription>
            เมื่อมีคำขอใหม่หรืองานที่ต้องทำ LIS จะแจ้งเตือนที่มุมจอ แม้ย่อหรือปิดหน้าต่าง LIS อยู่
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={later} disabled={enabling}>
            ไว้ทีหลัง
          </Button>
          <Button type="button" onClick={() => void enable()} disabled={enabling}>
            {enabling ? "กำลังเปิด..." : "เปิดรับแจ้งเตือน"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PushEnablePrompt;
