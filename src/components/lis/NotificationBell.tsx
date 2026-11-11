import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import { normalizeRoles } from "@/lib/roles";
import { readSeeAll, writeSeeAll, SEE_ALL_EVENT } from "@/lib/petitionAudience";
import { api } from "@/lib/api";
import NotificationList from "@/components/lis/NotificationList";

/** จำนวนแจ้งเตือนที่แสดงใน popover ต่อครั้ง — กด "ดูเพิ่มเติม" เพื่อโหลดเพิ่มทีละชุด */
export const NOTIFICATION_POPOVER_PAGE_SIZE = 10;

interface NotificationBellProps {
  className?: string;
  iconClassName?: string;
}

const NotificationBell = ({ className, iconClassName }: NotificationBellProps) => {
  const navigate = useNavigate();
  const { notifications, unreadCount, unseenCount, markRead, markAllRead, markAllSeen, dismiss, clearAll } = useNotifications();
  const { user } = useAuth();
  const isAdmin = normalizeRoles(user).includes("admin");
  const [seeAll, setSeeAll] = useState(() => readSeeAll());
  const [open, setOpen] = useState(false);

  // สองอินสแตนซ์ของ bell (มือถือ + desktop) mount พร้อมกันเสมอ (แค่ CSS ซ่อน) — ต้อง
  // ฟัง SEE_ALL_EVENT เพื่อ sync สถานะสวิตช์ข้ามกันเมื่ออีกฝั่งกดสลับ
  useEffect(() => {
    const onSeeAllChange = () => setSeeAll(readSeeAll());
    window.addEventListener(SEE_ALL_EVENT, onSeeAllChange);
    return () => window.removeEventListener(SEE_ALL_EVENT, onSeeAllChange);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="การแจ้งเตือน"
          onClick={() => {
            // เปิดกระดิ่ง = เห็นแล้ว (ตัวเลขหาย) แต่รายการยังคงเป็น "ยังไม่ได้อ่าน" จนกว่าจะกดดู
            if (unseenCount > 0) markAllSeen();
          }}
          className={cn(
            "relative inline-flex items-center justify-center h-10 w-10 rounded-md hover:bg-accent transition-colors",
            className,
          )}
        >
          <Bell className={cn("h-5 w-5 text-foreground", iconClassName)} />
          {unseenCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
              {unseenCount > 9 ? "9+" : unseenCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between px-3 pt-3">
          <div className="text-base font-semibold">การแจ้งเตือน</div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={markAllRead}>
                <Check className="w-3 h-3 mr-1" /> อ่านทั้งหมด
              </Button>
            )}
            {notifications.some(n => !n.pinned) && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={clearAll}>
                <Trash2 className="w-3 h-3 mr-1" /> ล้าง
              </Button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="mx-3 mt-2 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
            <label htmlFor="notify-see-all" className="text-xs text-muted-foreground">
              ดูแจ้งเตือนทั้งระบบ (ทุก role)
            </label>
            <Switch
              id="notify-see-all"
              checked={seeAll}
              onCheckedChange={(value) => {
                setSeeAll(value);
                writeSeeAll(value);
                // ให้ PWA ได้รับทุก role ตามสวิตช์นี้ด้วย — เครื่องที่ยังไม่เปิดรับ push จะไม่มีผล
                api.setPushSeeAll(value).catch(() => undefined);
              }}
            />
          </div>
        )}

        <NotificationList
          notifications={notifications}
          pageSize={NOTIFICATION_POPOVER_PAGE_SIZE}
          listClassName="max-h-[calc(100vh-14rem)] md:max-h-[480px]"
          onSeeAll={() => {
            setOpen(false);
            navigate("/notifications");
          }}
          onOpen={(n) => {
            markRead(n.id);
            if (n.link) {
              setOpen(false);
              navigate(n.link);
            }
          }}
          onDismiss={dismiss}
        />
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
