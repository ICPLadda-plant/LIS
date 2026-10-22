import { describe, expect, it } from "vitest";
import type { Petition } from "@/types/petition.types";
import { isUrgentPetition, prioritizeUrgentPetitions } from "@/lib/urgentPetition";
import {
  claimUrgentReminderHour,
  nextHourAt,
  pendingUrgentReminders,
  reminderHourKey,
  urgentReminderSidesForRoles,
} from "@/lib/urgentReminder";

const petition = (over: Partial<Petition> & { priority?: unknown }): Petition =>
  ({ _id: "p1", petitionNo: "P-1", status: "inProgress", items: [], routeTargets: ["qc", "lab"], ...over }) as unknown as Petition;

const memoryStorage = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};

describe("isUrgentPetition", () => {
  it("รับทั้งตัวเลขและข้อความ 1", () => {
    expect(isUrgentPetition({ priority: 1 })).toBe(true);
    expect(isUrgentPetition({ priority: "1" })).toBe(true);
    expect(isUrgentPetition({ priority: 0 })).toBe(false);
    expect(isUrgentPetition({ priority: "" })).toBe(false);
    expect(isUrgentPetition({})).toBe(false);
    expect(isUrgentPetition({ priority: "normal" })).toBe(false);
  });

  it("ดันงานด่วนขึ้นบนโดยคงลำดับเดิม", () => {
    const list = [{ id: "a" }, { id: "b", priority: 1 }, { id: "c" }, { id: "d", priority: "1" }];
    expect(prioritizeUrgentPetitions(list).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("urgent reminder", () => {
  it("แยกฝั่งตาม role และไม่เตือน admin", () => {
    expect(urgentReminderSidesForRoles(["admin"])).toEqual([]);
    expect(urgentReminderSidesForRoles(["qc-staff"])).toEqual(["qc"]);
    expect(urgentReminderSidesForRoles(["lab-head", "qc-head"])).toEqual(["qc", "lab"]);
  });

  it("หยุดเตือนเฉพาะฝั่งที่บันทึกผลแล้ว และไม่เตือนงานปฏิเสธ/งานปกติ", () => {
    const list = [
      petition({ _id: "u1", priority: 1, qcCompletedAt: "2026-10-22T03:00:00Z" }),
      petition({ _id: "u2", priority: "1" }),
      petition({ _id: "r", priority: 1, status: "rejected" }),
      petition({ _id: "n", priority: 0 }),
    ];
    expect(pendingUrgentReminders(list, ["qc", "lab"]).map((x) => x.id)).toEqual([
      "urgent:u1:lab",
      "urgent:u2:qc",
      "urgent:u2:lab",
    ]);
    expect(pendingUrgentReminders(list, ["qc"]).map((x) => x.id)).toEqual(["urgent:u2:qc"]);
  });

  it("เสียงดังครั้งเดียวต่อชั่วโมง และไม่ดังครั้งแรกที่เจอ", () => {
    const storage = memoryStorage();
    const t10 = new Date(2026, 9, 22, 10, 0, 1).getTime();
    const t1030 = new Date(2026, 9, 22, 10, 30).getTime();
    const t11 = new Date(2026, 9, 22, 11, 0, 1).getTime();
    expect(claimUrgentReminderHour(storage, "k", reminderHourKey(t10 - 3600_000), true)).toBe(false);
    expect(claimUrgentReminderHour(storage, "k", reminderHourKey(t10), true)).toBe(true);
    expect(claimUrgentReminderHour(storage, "k", reminderHourKey(t1030), true)).toBe(false);
    expect(claimUrgentReminderHour(storage, "k", reminderHourKey(t11), false)).toBe(false);
    expect(nextHourAt(t1030)).toBe(new Date(2026, 9, 22, 11, 0).getTime());
  });
});
