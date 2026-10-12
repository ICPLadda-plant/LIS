import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useNotifications, type NotificationLevel } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import { normalizeRoles } from "@/lib/roles";
import { readSeeAll, writeSeeAll, SEE_ALL_EVENT } from "@/lib/petitionAudience";
import { formatDateTime } from "@/lib/dateTime";

const levelColor: Record<NotificationLevel, string> = {
  info: "bg-blue-500",
  warning: "bg-amber-500",
  success: "bg-green-500",
  error: "bg-red-500",
};

const formatTime = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "เมื่อสักครู่";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ชั่วโมงที่แล้ว`;
  return formatDateTime(ts);
};

interface NotificationBellProps {
  className?: string;
  iconClassName?: string;
}

const NotificationBell = ({ className, iconClassName }: NotificationBellProps) => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead, dismiss, clearAll } = useNotifications();
  const { user } = useAuth();
  const isAdmin = normalizeRoles(user).includes("admin");
  const [seeAll, setSeeAll] = useState(() => readSeeAll());

  // สองอินสแตนซ์ของ bell (มือถือ + desktop) mount พร้อมกันเสมอ (แค่ CSS ซ่อน) — ต้อง
  // ฟัง SEE_ALL_EVENT เพื่อ sync สถานะสวิตช์ข้ามกันเมื่ออีกฝั่งกดสลับ
  useEffect(() => {
    const onSeeAllChange = () => setSeeAll(readSeeAll());
    window.addEventListener(SEE_ALL_EVENT, onSeeAllChange);
    return () => window.removeEventListener(SEE_ALL_EVENT, onSeeAllChange);
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="การแจ้งเตือน"
          onClick={() => {
            if (unreadCount > 0) markAllRead();
          }}
          className={cn(
            "relative inline-flex items-center justify-center h-10 w-10 rounded-md hover:bg-accent transition-colors",
            className,
          )}
        >
          <Bell className={cn("h-5 w-5 text-foreground", iconClassName)} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-semibold">การแจ้งเตือน</div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={markAllRead}>
                <Check className="w-3 h-3 mr-1" /> อ่านทั้งหมด
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={clearAll}>
                <Trash2 className="w-3 h-3 mr-1" /> ล้าง
              </Button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
            <label htmlFor="notify-see-all" className="text-xs text-muted-foreground">
              ดูแจ้งเตือนทั้งระบบ (ไม่จำกัดแผนก)
            </label>
            <Switch
              id="notify-see-all"
              checked={seeAll}
              onCheckedChange={(value) => { setSeeAll(value); writeSeeAll(value); }}
            />
          </div>
        )}

        {notifications.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            ยังไม่มีการแจ้งเตือน
          </div>
        ) : (
          <div
            data-testid="notification-scroll-list"
            className="max-h-[calc(100vh-12rem)] overflow-y-auto overscroll-contain md:max-h-[400px]"
          >
            <ul className="divide-y">
              {notifications.map(n => (
                <li
                  key={n.id}
                  className={cn(
                    "p-3 flex gap-2.5 cursor-pointer hover:bg-accent/50 transition-colors",
                    !n.read && "bg-accent/30",
                  )}
                  onClick={() => {
                    markRead(n.id);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", levelColor[n.level])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                      {!n.read && <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
                    </div>
                    {n.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-muted-foreground">{formatTime(n.createdAt)}</span>
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                      >
                        ลบ
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
