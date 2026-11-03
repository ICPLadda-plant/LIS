import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BalanceRoomPage from "../BalanceRoomPage";

const state = vi.hoisted(() => ({
  user: { name: "Dev Administrator", id: "dev", email: "dev@example.com" },
}));

const apiMock = vi.hoisted(() => ({
  getDailyChecks: vi.fn().mockResolvedValue([]),
  createDailyCheck: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/aiApi", () => ({
  getDailyCheckTrend: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/dailyCheckPeriod", () => ({
  getCurrentDailyCheckPeriod: () => "morning",
  getDailyCheckPeriod: () => "morning",
  getDailyCheckPeriodLabel: (period: string | null | undefined) => (period === "morning" ? "เช้า" : "นอกเวลา"),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: state.user }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BalanceRoomPage />
    </QueryClientProvider>,
  );

describe("BalanceRoomPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getDailyChecks.mockResolvedValue([]);
  });

  it("does not show an inline records tab", () => {
    renderPage();
    expect(screen.queryByRole("tab", { name: /รายการบันทึก/ })).not.toBeInTheDocument();
    expect(screen.getByText("LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง")).toBeInTheDocument();
  });

  it("shows the five balance names by equipment code", () => {
    renderPage();
    [
      "LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง",
      "LD-006 - เครื่องชั่งดิจิตอล 4 ตำแหน่ง",
      "LD-021 - เครื่องชั่งดิจิตอล 5 ตำแหน่ง",
      "LD-047 - เครื่องชั่งดิจิตอล 5 ตำแหน่ง",
      "LD-048 - เครื่องชั่งดิจิตอล 5 ตำแหน่ง",
    ].forEach(name => expect(screen.getByText(name)).toBeInTheDocument());
    expect(screen.queryByText("เครื่องชั่ง 1")).not.toBeInTheDocument();
  });
});
