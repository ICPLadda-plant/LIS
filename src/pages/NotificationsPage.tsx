import { useNavigate } from "react-router-dom";
import { Check, Trash2 } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import NotificationList from "@/components/lis/NotificationList";
import PageHeader from "@/components/lis/PageHeader";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/context/NotificationContext";

const NotificationsPage = () => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead, dismiss, clearAll } = useNotifications();

  return (
    <AppLayout title="การแจ้งเตือน">
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader
          title="การแจ้งเตือน"
          description={unreadCount > 0 ? `ยังไม่ได้อ่าน ${unreadCount} รายการ` : "อ่านครบทุกรายการแล้ว"}
          actions={(
            <>
              {unreadCount > 0 && (
                <Button variant="outline" size="sm" onClick={markAllRead}>
                  <Check className="h-4 w-4" /> อ่านทั้งหมด
                </Button>
              )}
              {notifications.some(n => !n.pinned) && (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={clearAll}>
                  <Trash2 className="h-4 w-4" /> ล้าง
                </Button>
              )}
            </>
          )}
        />
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <NotificationList
            notifications={notifications}
            onOpen={(n) => {
              markRead(n.id);
              if (n.link) navigate(n.link);
            }}
            onDismiss={dismiss}
          />
        </div>
      </div>
    </AppLayout>
  );
};

export default NotificationsPage;
