import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationProvider, useNotifications } from "@/context/NotificationContext";
import NotificationBell from "../NotificationBell";

let authUser = { employeeId: "E001", email: "admin@example.com", name: "Admin", roles: ["admin"] };

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: authUser,
    logout: vi.fn(),
  }),
}));

function SeededNotificationBell({ count = 2 }: { count?: number }) {
  const { push } = useNotifications();

  useEffect(() => {
    for (let index = 1; index <= count; index += 1) {
      push({ id: `unread-${index}`, title: `แจ้งเตือนที่ ${index}`, level: index === 1 ? "info" : "warning" });
    }
  }, [count, push]);

  return <NotificationBell />;
}

function renderBell(count?: number) {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <SeededNotificationBell count={count} />
      </NotificationProvider>
    </MemoryRouter>,
  );
}

describe("NotificationBell open behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    authUser = { employeeId: "E001", email: "admin@example.com", name: "Admin", roles: ["admin"] };
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("hides the badge when the bell is clicked but keeps items unread until opened", async () => {
    renderBell();

    expect(await screen.findByText("2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));

    await waitFor(() => {
      expect(screen.queryByText("2")).not.toBeInTheDocument();
    });
    expect(screen.getAllByLabelText("ยังไม่ได้อ่าน")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "ยังไม่ได้อ่าน" }));
    fireEvent.click(screen.getByText("แจ้งเตือนที่ 1"));

    await waitFor(() => {
      expect(screen.queryByText("แจ้งเตือนที่ 1")).not.toBeInTheDocument();
    });
    expect(screen.getByText("แจ้งเตือนที่ 2")).toBeInTheDocument();
  });

  it("loads persisted notifications only for the current employee", async () => {
    localStorage.setItem(
      "lis.notifications.v1",
      JSON.stringify([
        {
          id: "other-user",
          title: "แจ้งเตือนของคนอื่น",
          level: "info",
          createdAt: 1,
          read: false,
          persistent: true,
        },
      ]),
    );

    render(
      <MemoryRouter>
        <NotificationProvider>
          <NotificationBell />
        </NotificationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));

    expect(screen.queryByText("แจ้งเตือนของคนอื่น")).not.toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีการแจ้งเตือน")).toBeInTheDocument();
  });

  it("shows the latest 10 first and loads more on demand", async () => {
    renderBell(12);

    expect(await screen.findByText("9+")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));

    const list = screen.getByTestId("notification-scroll-list");
    expect(list).toHaveClass("overflow-y-auto");
    expect(screen.getByText("แจ้งเตือนที่ 12")).toBeInTheDocument();
    expect(screen.getByText("แจ้งเตือนที่ 3")).toBeInTheDocument();
    expect(screen.queryByText("แจ้งเตือนที่ 2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ดูเพิ่มเติม (2)" }));

    expect(screen.getByText("แจ้งเตือนที่ 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ดูเพิ่มเติม/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดูทั้งหมด" })).toBeInTheDocument();
  });
});
