import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useNotifications } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import { DAILY_CHECK_SCALE_TOTAL } from "@/lib/dailyCheckProgress";
import { getDailyCheckPeriod, getDailyCheckPeriodLabel } from "@/lib/dailyCheckPeriod";
import { normalizeRoles } from "@/lib/roles";
import { isLabRole } from "@/lib/petitionVisibility";

const STORAGE_PREFIX = "lis.dailyCheck.reminderShown.";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * เช็คทุกนาที — ถ้าอยู่ในรอบเช้า/บ่าย และยังบันทึก Daily Check ไม่ครบ
 * push notification ครั้งเดียวต่อรอบ (กันซ้ำด้วย localStorage) — เฉพาะ role ตระกูล Lab
 * (PWA ส่งจาก server/lib/notificationScheduler.js)
 */
const DailyCheckReminderWatcher = () => {
  const { user } = useAuth();
  const { push, dismiss, notifications } = useNotifications();
  const isLabUser = normalizeRoles(user).some(isLabRole);

  const { data: summary } = useQuery({
    queryKey: ["daily-checks", "today-summary"],
    queryFn: api.getDailyCheckTodaySummary,
    refetchInterval: 60_000,
    enabled: !!user && isLabUser,
  });

  useEffect(() => {
    if (!user || !isLabUser) return;
    if (!summary) return;

    const tick = () => {
      const now = new Date();
      const date = todayStr();
      const period = getDailyCheckPeriod(now);
      if (!period) return;

      const periodLabel = getDailyCheckPeriodLabel(period);
      const flagKey = `${STORAGE_PREFIX}${date}.${period}`;
      const notificationId = `daily-check-reminder-${period}`;
      const scaleRecords = summary.scaleRecords ?? [];
      const done = scaleRecords.length > 0
        ? new Set(
            scaleRecords
              .filter((record) => (record.period ?? (record.checkedAt ? getDailyCheckPeriod(record.checkedAt) : null)) === period)
              .map((record) => record.scaleId)
              .filter(Boolean),
          ).size
        : (summary.scaleIds?.length ?? 0);

      // รอบนี้บันทึกครบแล้ว → ปลดแจ้งเตือน (ถ้ามี)
      if (done >= DAILY_CHECK_SCALE_TOTAL) {
        if (notifications.some(n => n.id === notificationId)) {
          dismiss(notificationId);
        }
        return;
      }
      // เคยแจ้งรอบนี้แล้ว และผู้ใช้ลบทิ้งไปแล้ว → ไม่ rerun
      if (localStorage.getItem(flagKey) === "1") return;

      const exists = notifications.some(n => n.id === notificationId);
      if (exists) return;

      push({
        id: notificationId,
        title: `ถึงเวลา Daily Check รอบ${periodLabel}`,
        message: `กรุณาบันทึกผล Calibrate เครื่องชั่งประจำวัน รอบ${periodLabel} (${done}/${DAILY_CHECK_SCALE_TOTAL} แล้ว)`,
        level: "warning",
        link: "/daily-check",
        persistent: true,
      });

      localStorage.setItem(flagKey, "1");
    };

    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [user, isLabUser, summary, notifications, push, dismiss]);

  return null;
};

export default DailyCheckReminderWatcher;
