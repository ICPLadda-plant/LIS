import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { notificationStorageKey, sanitizePersistedNotifications } from "./notificationStorage";

export type NotificationLevel = "info" | "warning" | "success" | "error";

export interface AppNotification {
  id: string;
  title: string;
  message?: string;
  level: NotificationLevel;
  link?: string;          // path เปิดเมื่อกด
  createdAt: number;
  read: boolean;
  /**
   * เมื่อ persistent = true จะอยู่ใน localStorage ข้ามรีเฟรชจนกว่าจะ dismiss
   * (เช่น แจ้งเตือน 8:00 ของ daily check)
   */
  persistent?: boolean;
  /** จัดกลุ่มเพื่อจำกัดจำนวนที่เก็บลง localStorage แยกกัน (เช่น "petition") */
  group?: string;
  /** ปักไว้บนสุด (งานด่วน) — "ลบ" จะปิดชั่วคราวถึงต้นชั่วโมงถัดไป และ "ล้าง" ไม่ลบรายการนี้ */
  pinned?: boolean;
  /** ซ่อนรายการ pinned จนถึงเวลานี้ (ms) */
  snoozedUntil?: number;
}

export type PinnedNotificationInput = Omit<AppNotification, "createdAt" | "read" | "pinned" | "snoozedUntil">;

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  push: (n: Omit<AppNotification, "createdAt" | "read"> & { createdAt?: number; read?: boolean }) => void;
  dismiss: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  /** แทนที่รายการ pinned ทั้งหมด; markUnread = รอบเตือนใหม่ ให้กลับมาเป็นยังไม่อ่านและยกเลิกการปิดชั่วคราว */
  syncPinned: (items: PinnedNotificationInput[], options?: { markUnread?: boolean }) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider");
  return ctx;
};

const loadPersisted = (storageKey: string): AppNotification[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sanitizePersistedNotifications(parsed) : [];
  } catch {
    return [];
  }
};

const persist = (storageKey: string, list: AppNotification[]) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(sanitizePersistedNotifications(list)));
  } catch {
    // ignore quota errors
  }
};

const nextHourMs = (now: number) => {
  const date = new Date(now);
  date.setMinutes(0, 0, 0);
  return date.getTime() + 60 * 60 * 1000;
};

const loadSnoozes = (key: string): Record<string, number> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const storageKey = notificationStorageKey(user);
  const [state, setState] = useState(() => ({
    storageKey,
    notifications: loadPersisted(storageKey),
  }));
  const notifications = state.notifications;
  const snoozeKey = `${storageKey}:urgent-snooze`;
  const [pinned, setPinned] = useState<AppNotification[]>([]);
  const [, setClock] = useState(0);

  // รายการ pinned ที่ถูกปิดชั่วคราวต้องกลับมาเองตอนครบเวลา แม้ไม่มีการ sync ใหม่
  useEffect(() => {
    const now = Date.now();
    const next = pinned.map(n => n.snoozedUntil ?? 0).filter(t => t > now).sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = window.setTimeout(() => setClock(c => c + 1), next - now + 50);
    return () => window.clearTimeout(timer);
  }, [pinned]);

  const syncPinned: NotificationContextType["syncPinned"] = useCallback((items, options) => {
    const snoozes = loadSnoozes(snoozeKey);
    if (options?.markUnread) {
      try { localStorage.removeItem(snoozeKey); } catch { /* ignore */ }
    }
    setPinned(prev => {
      if (prev.length === 0 && items.length === 0) return prev;
      const byId = new Map(prev.map(n => [n.id, n]));
      return items.map(item => {
        const existing = byId.get(item.id);
        return {
          ...item,
          pinned: true,
          createdAt: existing?.createdAt ?? Date.now(),
          read: options?.markUnread ? false : existing?.read ?? false,
          snoozedUntil: options?.markUnread ? undefined : existing?.snoozedUntil ?? snoozes[item.id],
        };
      });
    });
  }, [snoozeKey]);

  useEffect(() => {
    setState(prev => prev.storageKey === storageKey ? prev : { storageKey, notifications: loadPersisted(storageKey) });
  }, [storageKey]);

  useEffect(() => {
    if (state.storageKey !== storageKey) return;
    persist(storageKey, state.notifications);
  }, [state, storageKey]);

  const push: NotificationContextType["push"] = useCallback((n) => {
    setState(prevState => {
      const prev = prevState.storageKey === storageKey ? prevState.notifications : loadPersisted(storageKey);
      // ห้ามซ้ำตาม id — ถ้ามีอยู่แล้วให้คงของเดิม (ไม่ override read state)
      if (prev.some(p => p.id === n.id)) return { storageKey, notifications: prev };
      const next: AppNotification = {
        createdAt: n.createdAt ?? Date.now(),
        read: n.read ?? false,
        ...n,
      };
      return { storageKey, notifications: [next, ...prev] };
    });
  }, [storageKey]);

  const dismiss = useCallback((id: string) => {
    if (id.startsWith("urgent:")) {
      const until = nextHourMs(Date.now());
      try {
        localStorage.setItem(snoozeKey, JSON.stringify({ ...loadSnoozes(snoozeKey), [id]: until }));
      } catch { /* ignore */ }
      setPinned(prev => prev.map(n => n.id === id ? { ...n, snoozedUntil: until, read: true } : n));
      return;
    }
    setState(prev => ({ ...prev, notifications: prev.notifications.filter(n => n.id !== id) }));
  }, [snoozeKey]);

  const markRead = useCallback((id: string) => {
    setPinned(prev => prev.some(n => n.id === id) ? prev.map(n => n.id === id ? { ...n, read: true } : n) : prev);
    setState(prev => ({ ...prev, notifications: prev.notifications.map(n => n.id === id ? { ...n, read: true } : n) }));
  }, []);

  const markAllRead = useCallback(() => {
    setPinned(prev => prev.map(n => ({ ...n, read: true })));
    setState(prev => ({ ...prev, notifications: prev.notifications.map(n => ({ ...n, read: true })) }));
  }, []);

  // "ล้าง" ลบเฉพาะรายการทั่วไป — งานด่วนที่ปักไว้หายเองเมื่อบันทึกผลแล้วเท่านั้น
  const clearAll = useCallback(() => setState(prev => ({ ...prev, notifications: [] })), []);

  const now = Date.now();
  const visiblePinned = pinned.filter(n => !n.snoozedUntil || n.snoozedUntil <= now);
  const pinnedIds = new Set(visiblePinned.map(n => n.id));
  const merged = [...visiblePinned, ...notifications.filter(n => !pinnedIds.has(n.id))];
  const unreadCount = merged.filter(n => !n.read).length;

  const value: NotificationContextType = {
    notifications: merged,
    unreadCount,
    push,
    dismiss,
    markRead,
    markAllRead,
    clearAll,
    syncPinned,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
