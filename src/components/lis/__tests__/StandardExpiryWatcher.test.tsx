// Regression for Important-2 (final whole-branch review, 2026-08-03 stock-in-use-tab):
// the watcher used to keep `notifications` in its effect deps, so dismissing one of its
// notifications from the bell (X button / "ลบทั้งหมด") made the effect re-run against the
// same poll data, recompute the same push, and re-add it — the notification could never
// actually be dismissed while the row was still overdue. Fixed with an internal ref that
// tracks "already pushed" ids independent of the context's live notification list.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StandardExpiryWatcher from "../StandardExpiryWatcher";

const apiMock = vi.hoisted(() => ({
  getStandardsInUse: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "owner@icpladda.com", name: "สมชาย" } }),
}));

const pushMock = vi.fn();
const dismissMock = vi.fn();
vi.mock("@/context/NotificationContext", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    push: pushMock,
    dismiss: dismissMock,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

const NOW = "2026-08-03T00:00:00.000Z";
// เวลาของ poll รอบถัดไป — จำลองว่า server ส่ง serverTime ใหม่เสมอทุกรอบ (ของจริงคือ
// `new Date().toISOString()` สดทุกครั้ง) แถวเดิมยังหมดอายุเหมือนเดิมทั้งคู่
const NOW_NEXT_POLL = "2026-08-03T00:01:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

const expiredItem = (over: Record<string, unknown> = {}) => ({
  _id: "tx1",
  itemCode: "STD-001",
  itemName: "ATRAZINE",
  qrId: "u_abc",
  weights: [10],
  totalMg: 10,
  instrumentGroup: "gc",
  note: "",
  withdrawnAt: "2026-08-01T00:00:00.000Z",
  frequency: "1/1 week",
  dueAt: new Date(Date.parse(NOW) - DAY).toISOString(),
  userEmail: "owner@icpladda.com",
  userName: "สมชาย",
  ...over,
});

function renderWatcher(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <StandardExpiryWatcher />
    </QueryClientProvider>,
  );
}

describe("StandardExpiryWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("แถวยังหมดอายุเหมือนเดิมข้ามรอบ poll — id ที่ถูก dismiss ผ่านกระดิ่งแล้วต้องไม่ถูก push กลับมาอีก", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiMock.getStandardsInUse.mockResolvedValue({ serverTime: NOW, items: [expiredItem()] });

    renderWatcher(client);

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const pushedId = pushMock.mock.calls[0][0].id;
    expect(pushedId).toBe("std-inuse:tx1:expired");

    // จำลองผู้ใช้กด X บนกระดิ่ง (หรือ "ลบทั้งหมด") — เรียก dismiss ตรงจาก context, ไม่ผ่าน watcher
    dismissMock(pushedId);

    // จำลอง poll รอบถัดไป (serverTime ใหม่ เหมือน server จริงที่ตอบสดทุกครั้ง) — แถวเดิมยังหมดอายุเหมือนเดิม
    // ครอบด้วย act() แบบ async + await microtask ให้ effect ที่ตามมาจาก re-render นี้ flush จบก่อนตรวจผล
    // (react-query แจ้ง subscriber ผ่าน microtask — sync act() เพียวๆ ไม่รอ microtask ให้)
    await act(async () => {
      client.setQueryData(["stock", "in-use"], { serverTime: NOW_NEXT_POLL, items: [expiredItem()] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // จุดยืนยันหลัก: ไม่ push id เดิมซ้ำ แม้ effect จะรันใหม่จาก poll รอบสอง
    expect(pushMock).toHaveBeenCalledTimes(1);
    // dismiss มีแค่ครั้งที่เราจำลองไว้เอง — reconcile ของ watcher ไม่ได้เรียกซ้ำเพราะแถวยัง live อยู่จริง
    expect(dismissMock).toHaveBeenCalledTimes(1);
  });

  it("แถวหลุดจาก payload (resolve สำเร็จที่ server) → dismiss ถูกเรียกด้วย id เดิมแม้ผู้ใช้ไม่เคย dismiss เอง", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiMock.getStandardsInUse.mockResolvedValue({ serverTime: NOW, items: [expiredItem()] });

    renderWatcher(client);

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const pushedId = pushMock.mock.calls[0][0].id;

    // จำลอง poll รอบถัดไป — แถวหลุดจาก endpoint แล้ว (deductionResolution ถูกเซ็ตที่ server)
    await act(async () => {
      client.setQueryData(["stock", "in-use"], { serverTime: NOW_NEXT_POLL, items: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(dismissMock).toHaveBeenCalledWith(pushedId);
  });
});
