import { useCallback, useEffect, useState } from "react";
import { Bell, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, type PushDevicesState } from "@/lib/api";
import {
  describeDevice,
  getCurrentPushSubscription,
  getPushSupport,
  PushPermissionDeniedError,
  subscribeThisDevice,
  toSubscriptionPayload,
} from "@/lib/pwaPush";

type Busy = "toggle" | "test" | "pause" | null;

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

const PwaPushSettings = () => {
  const [support] = useState(getPushSupport);
  const [state, setState] = useState<PushDevicesState | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [permissionDenied, setPermissionDenied] = useState(
    () => typeof Notification !== "undefined" && Notification.permission === "denied",
  );

  const load = useCallback(async () => {
    try {
      const subscription = await getCurrentPushSubscription().catch(() => null);
      const next = await api.getPushDevices(subscription?.endpoint);
      // เครื่องนี้มี subscription ค้างในเบราว์เซอร์แต่ server ไม่มีแล้ว ให้ถือว่ายังไม่ได้เปิด
      setEndpoint(next.devices.some((device) => device.current) ? subscription?.endpoint ?? null : null);
      setState(next);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enabledHere = Boolean(endpoint);
  const devices = state?.devices ?? [];
  const canToggle = support === "supported" && Boolean(state?.configured) && !loadError;

  const toggleThisDevice = async (checked: boolean) => {
    setBusy("toggle");
    try {
      if (checked) {
        if (!state?.publicKey) throw new Error("เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน PWA");
        const subscription = await subscribeThisDevice(state.publicKey);
        const next = await api.subscribePush(toSubscriptionPayload(subscription), describeDevice());
        setEndpoint(subscription.endpoint);
        setState(next);
        setPermissionDenied(false);
        toast.success("เปิดรับแจ้งเตือนบนเครื่องนี้แล้ว");
      } else {
        const subscription = await getCurrentPushSubscription();
        const currentEndpoint = endpoint ?? subscription?.endpoint ?? "";
        await subscription?.unsubscribe().catch(() => false);
        const next = await api.unsubscribePush(currentEndpoint);
        setEndpoint(null);
        setState(next);
        toast.success("ปิดรับแจ้งเตือนบนเครื่องนี้แล้ว");
      }
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) setPermissionDenied(true);
      toast.error(errorMessage(error, "เปลี่ยนการแจ้งเตือนไม่สำเร็จ"));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy("test");
    try {
      const result = await api.sendTestPush();
      if (result.sent > 0) {
        toast.success(`ส่งทดสอบไป ${result.sent} เครื่องแล้ว`);
      } else {
        toast.error("ส่งทดสอบไม่ถึงเครื่องใดเลย ลองปิดแล้วเปิดรับแจ้งเตือนใหม่");
      }
      if (result.removed > 0 || result.failed > 0) await load();
    } catch (error) {
      toast.error(errorMessage(error, "ส่งทดสอบไม่สำเร็จ"));
    } finally {
      setBusy(null);
    }
  };

  const togglePause = async () => {
    setBusy("pause");
    try {
      const next = await api.setPushPaused(!state?.paused, endpoint ?? undefined);
      setState(next);
      toast.success(next.paused ? "พักการแจ้งเตือนทุกเครื่องแล้ว" : "เปิดการแจ้งเตือนทุกเครื่องแล้ว");
    } catch (error) {
      toast.error(errorMessage(error, "เปลี่ยนการแจ้งเตือนไม่สำเร็จ"));
    } finally {
      setBusy(null);
    }
  };

  let hint: string | null = null;
  if (support === "needs-install") hint = "บน iPhone / iPad ให้กดแชร์ แล้วเลือก \"เพิ่มไปยังหน้าจอโฮม\" จากนั้นเปิด LIS จากไอคอนนั้นก่อน";
  else if (support === "unsupported") hint = "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน PWA";
  else if (loadError) hint = "โหลดข้อมูลการแจ้งเตือนไม่สำเร็จ";
  else if (state && !state.configured) hint = "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน PWA";
  else if (permissionDenied && !enabledHere) hint = "เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้ ให้เปิดสิทธิ์ในการตั้งค่าเว็บไซต์ก่อน";

  return (
    <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <MonitorSmartphone className="h-5 w-5 text-primary" aria-hidden="true" />
        <div>
          <h3 className="text-base font-semibold text-foreground">แจ้งเตือนบนเบราว์เซอร์</h3>
          <p className="text-sm text-muted-foreground">เตือนแม้ปิดเบราว์เซอร์อยู่ เมื่อมีตัวอย่างมาถึงหรือมีงาน Lab ใหม่</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
        <label htmlFor="profile-pwa-push" className="flex min-w-0 items-start gap-2">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">รับแจ้งเตือนบนเครื่องนี้</span>
            <span className="block text-xs text-muted-foreground">{describeDevice()}</span>
          </span>
        </label>
        <Switch
          id="profile-pwa-push"
          aria-label="รับแจ้งเตือนบนเครื่องนี้"
          checked={enabledHere}
          disabled={!canToggle || busy !== null}
          onCheckedChange={(checked) => void toggleThisDevice(checked)}
        />
      </div>

      {hint ? <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{hint}</p> : null}

      <div className="mt-3 border-t pt-3">
        <p className="text-sm font-medium text-foreground">เครื่องที่เปิดไว้ ({devices.length})</p>
        {devices.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {devices.map((device) => (
              <li key={device.id}>
                • {device.label}
                {device.current ? " (เครื่องนี้)" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">ยังไม่มีเครื่องที่เปิดรับแจ้งเตือน</p>
        )}
        {state?.paused && devices.length > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">พักการแจ้งเตือนงานไว้ทุกเครื่อง (ยังส่งทดสอบได้)</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={devices.length === 0 || busy !== null || !state?.configured}
            onClick={() => void sendTest()}
          >
            <Bell />
            ส่งทดสอบ
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={devices.length === 0 || busy !== null}
            onClick={() => void togglePause()}
          >
            {state?.paused ? "เปิดการแจ้งเตือนทุกเครื่อง" : "พักการแจ้งเตือนทุกเครื่อง"}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default PwaPushSettings;
