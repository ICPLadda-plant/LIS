import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/context/NotificationContext";
import { API_ERROR_EVENT } from "@/lib/api";
import { normalizeRoles } from "@/lib/roles";

const WINDOW_MS = 10 * 60 * 1000;

const titleFor = (status: number) => {
  if (status === 0) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
  if (status === 503) return "บริการไม่พร้อมใช้งาน (503)";
  if (status === 502) return "เชื่อมต่อบริการปลายทางไม่ได้ (502)";
  if (status === 504) return "บริการปลายทางตอบช้าเกินกำหนด (504)";
  return `เซิร์ฟเวอร์ตอบข้อผิดพลาด (${status})`;
};

/**
 * แจ้งเตือนระบบสำหรับ admin จากฝั่งเบราว์เซอร์ — ครอบกรณีที่ server บันทึกเองไม่ได้ (server ล่ม / proxy ตอบ 5xx)
 * 401/403/5xx ที่ server ตอบเองถูกบันทึกเป็นแจ้งเตือนจาก server/lib/systemAlerts.js อยู่แล้ว
 * รวมเหตุการณ์ซ้ำเป็นรายการเดียวต่อ 10 นาที
 */
const AdminSystemWatcher = () => {
  const { user } = useAuth();
  const { push } = useNotifications();
  const isAdmin = normalizeRoles(user).includes("admin");

  useEffect(() => {
    if (!isAdmin) return;
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ status: number; path: string }>).detail;
      if (!detail) return;
      if (detail.status !== 0 && detail.status < 502) return;
      const bucket = Math.floor(Date.now() / WINDOW_MS);
      push({
        id: `system-local:${detail.status}:${bucket}`,
        title: titleFor(detail.status),
        message: detail.path ? `เรียก ${detail.path} ไม่สำเร็จ` : undefined,
        level: "error",
        persistent: true,
        group: "system",
      });
    };
    window.addEventListener(API_ERROR_EVENT, onError);
    return () => window.removeEventListener(API_ERROR_EVENT, onError);
  }, [isAdmin, push]);

  return null;
};

export default AdminSystemWatcher;
