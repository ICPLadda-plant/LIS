import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/context/NotificationContext";
import { usePetitionList } from "@/hooks/usePetition";
import { normalizeRoles } from "@/lib/roles";
import {
  claimUrgentReminderHour,
  nextHourAt,
  pendingUrgentReminders,
  reminderHourKey,
  urgentReminderSidesForRoles,
  urgentReminderStorageKey,
} from "@/lib/urgentReminder";
import { playUrgentReminderSound } from "@/components/lis/PetitionFlowWatcher";

const SIDE_LABEL = { qc: "QC", lab: "Lab" } as const;

/**
 * ปักแจ้งเตือนงานด่วน (priority = 1) ไว้บนสุดของกระดิ่ง และเล่นเสียงทุกต้นชั่วโมง
 * จนกว่าฝั่ง QC/Lab ของผู้ใช้จะบันทึกผล — ทำงานเฉพาะตอนเปิดเว็บอยู่
 */
const UrgentPetitionReminder = () => {
  const { user } = useAuth();
  const { syncPinned } = useNotifications();
  const roles = useMemo(() => normalizeRoles(user), [user]);
  const sides = useMemo(() => urgentReminderSidesForRoles(roles), [roles]);
  const enabled = !!user && sides.length > 0;
  const { data } = usePetitionList({ urgent: true, limit: 100 }, { enabled });
  const [hourKey, setHourKey] = useState(() => reminderHourKey(Date.now()));

  useEffect(() => {
    const timer = window.setTimeout(() => setHourKey(reminderHourKey(Date.now())), nextHourAt(Date.now()) - Date.now() + 500);
    const onVisible = () => {
      if (document.visibilityState === "visible") setHourKey(reminderHourKey(Date.now()));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hourKey]);

  const reminders = useMemo(
    () => (enabled ? pendingUrgentReminders(data?.items ?? [], sides) : []),
    [data?.items, enabled, sides],
  );

  useEffect(() => {
    if (!enabled) {
      syncPinned([]);
      return;
    }
    const shouldRing = claimUrgentReminderHour(
      window.localStorage,
      urgentReminderStorageKey(user?.employeeId ?? user?.email),
      hourKey,
      reminders.length > 0,
    );
    syncPinned(
      reminders.map((item) => ({
        id: item.id,
        title: `งานด่วน ${item.petitionNo}`,
        message: `รอบันทึกผล ${SIDE_LABEL[item.side]} — จะเตือนทุกต้นชั่วโมงจนกว่าจะบันทึกผล`,
        level: "error" as const,
        link: item.link,
      })),
      { markUnread: shouldRing },
    );
    if (shouldRing) playUrgentReminderSound();
  }, [enabled, hourKey, reminders, syncPinned, user?.email, user?.employeeId]);

  return null;
};

export default UrgentPetitionReminder;
