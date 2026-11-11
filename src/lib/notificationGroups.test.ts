import { describe, expect, it } from "vitest";
import type { AppNotification } from "@/context/NotificationContext";
import { dayLabel, groupNotificationsByDay, shortNotificationTime, sortNotifications } from "./notificationGroups";

const now = new Date(2026, 10, 11, 15, 0).getTime();
const item = (id: string, createdAt: number, extra: Partial<AppNotification> = {}): AppNotification => ({
  id, title: id, level: "info", createdAt, read: false, ...extra,
});

describe("notificationGroups", () => {
  it("groups by day with urgent pinned items first", () => {
    const list = sortNotifications([
      item("old", new Date(2026, 10, 3, 9, 0).getTime()),
      item("today", new Date(2026, 10, 11, 8, 0).getTime()),
      item("urgent", new Date(2026, 10, 1).getTime(), { pinned: true }),
      item("yesterday", new Date(2026, 10, 10, 23, 30).getTime()),
      item("today-late", new Date(2026, 10, 11, 14, 0).getTime()),
    ]);

    const sections = groupNotificationsByDay(list, now);

    expect(sections.map(s => s.label)).toEqual(["งานด่วน", "วันนี้", "เมื่อวาน", "3 พ.ย."]);
    expect(sections[1].items.map(i => i.id)).toEqual(["today-late", "today"]);
  });

  it("shows the Buddhist year only for past years", () => {
    expect(dayLabel(new Date(2025, 11, 31).getTime(), now)).toBe("31 ธ.ค. 2568");
  });

  it("uses relative time for today and clock time for other days", () => {
    expect(shortNotificationTime(now - 5 * 60_000, now)).toBe("5 นาที");
    expect(shortNotificationTime(now - 3 * 3_600_000, now)).toBe("3 ชั่วโมง");
    expect(shortNotificationTime(new Date(2026, 10, 10, 9, 5).getTime(), now)).toBe("09:05");
  });
});
