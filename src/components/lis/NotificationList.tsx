import { useMemo, useState } from "react";
import { AlertTriangle, BellOff, CheckCircle2, Info, Pin, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppNotification, NotificationLevel } from "@/context/NotificationContext";
import { groupNotificationsByDay, shortNotificationTime, sortNotifications } from "@/lib/notificationGroups";

type NotificationFilter = "all" | "unread";

const levelIcon: Record<NotificationLevel, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "bg-primary/10 text-primary" },
  warning: { icon: AlertTriangle, className: "bg-amber-100 text-amber-700" },
  success: { icon: CheckCircle2, className: "bg-green-100 text-green-700" },
  error: { icon: XCircle, className: "bg-red-100 text-red-700" },
};

interface NotificationListProps {
  notifications: AppNotification[];
  onOpen: (notification: AppNotification) => void;
  onDismiss: (id: string) => void;
  /** จำนวนที่แสดงก่อนกด "ดูเพิ่มเติม" — ไม่ส่ง = แสดงทั้งหมด */
  pageSize?: number;
  /** แสดงลิงก์ "ดูทั้งหมด" ไปหน้าเต็ม */
  onSeeAll?: () => void;
  /** class ของกล่องรายการ เช่น จำกัดความสูงใน popover */
  listClassName?: string;
}

const NotificationList = ({ notifications, onOpen, onDismiss, pageSize, onSeeAll, listClassName }: NotificationListProps) => {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [visibleCount, setVisibleCount] = useState(pageSize ?? Infinity);

  const filtered = useMemo(() => {
    const sorted = sortNotifications(notifications);
    return filter === "unread" ? sorted.filter(n => !n.read) : sorted;
  }, [notifications, filter]);

  const visible = filtered.slice(0, visibleCount);
  const sections = groupNotificationsByDay(visible);
  const hiddenCount = filtered.length - visible.length;

  const changeFilter = (next: NotificationFilter) => {
    setFilter(next);
    setVisibleCount(pageSize ?? Infinity);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="กรองการแจ้งเตือน">
          {([
            ["all", "ทั้งหมด"],
            ["unread", "ยังไม่ได้อ่าน"],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 rounded-full px-3 text-sm",
                filter === value ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-foreground",
              )}
              onClick={() => changeFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {onSeeAll && (
          <Button type="button" variant="link" size="sm" className="h-8 px-1 text-sm" onClick={onSeeAll}>
            ดูทั้งหมด
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 pb-8 pt-4 text-center text-sm text-muted-foreground">
          <BellOff className="h-6 w-6" aria-hidden />
          {filter === "unread" && notifications.length > 0 ? "อ่านครบทุกรายการแล้ว" : "ยังไม่มีการแจ้งเตือน"}
        </div>
      ) : (
        <div data-testid="notification-scroll-list" className={cn("overflow-y-auto overscroll-contain pb-2", listClassName)}>
          {sections.map(section => (
            <section key={section.key} aria-label={section.label}>
              <h3 className="px-3 pb-1 pt-2 text-sm font-semibold text-foreground">{section.label}</h3>
              <ul className="space-y-0.5 px-1.5">
                {section.items.map(n => {
                  const { icon: LevelIcon, className: iconClass } = n.pinned
                    ? { icon: Pin, className: "bg-red-100 text-red-700" }
                    : levelIcon[n.level];
                  return (
                    <li key={n.id} className="group relative">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-start gap-3 rounded-md px-1.5 py-2 pr-8 text-left transition-colors hover:bg-accent",
                          !n.read && "bg-primary/5",
                        )}
                        onClick={() => onOpen(n)}
                      >
                        <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", iconClass)}>
                          <LevelIcon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-sm", n.read ? "text-muted-foreground" : "font-semibold text-foreground")}>
                            {n.title}
                          </span>
                          {n.message && (
                            <span className={cn("mt-0.5 line-clamp-2 block text-sm", n.read ? "text-muted-foreground" : "text-foreground")}>
                              {n.message}
                            </span>
                          )}
                          <span className={cn("mt-0.5 block text-xs", n.read ? "text-muted-foreground" : "font-medium text-primary")}>
                            {n.pinned ? "เตือนทุกต้นชั่วโมง" : shortNotificationTime(n.createdAt)}
                          </span>
                        </span>
                        {!n.read && (
                          <span className="mt-3 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="ยังไม่ได้อ่าน" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="absolute right-1.5 top-2 rounded px-1 text-xs text-muted-foreground opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
                        onClick={() => onDismiss(n.id)}
                      >
                        {n.pinned ? "ปิดชั่วคราว" : "ลบ"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {hiddenCount > 0 && (
            <div className="px-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => setVisibleCount(count => count + (pageSize ?? hiddenCount))}
              >
                ดูเพิ่มเติม ({hiddenCount})
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationList;
