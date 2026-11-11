import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BalanceRoomPage from "../BalanceRoomPage";

const state = vi.hoisted(() => ({
  user: { name: "Dev Administrator", id: "dev", email: "dev@example.com" },
  period: "morning" as "morning" | null,
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
  getCurrentDailyCheckPeriod: () => state.period,
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
    state.period = "morning";
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

  it("allows calibration outside the morning and afternoon periods", async () => {
    state.period = null;
    renderPage();

    expect(screen.queryByText("นอกเวลาบันทึก")).not.toBeInTheDocument();
    expect(screen.getByText(/บันทึกได้ทุกเวลา/)).toBeInTheDocument();

    const [first100, first10] = screen.getAllByPlaceholderText("ครั้งที่ 1");
    const [second100, second10] = screen.getAllByPlaceholderText("ครั้งที่ 2");
    const [third100, third10] = screen.getAllByPlaceholderText("ครั้งที่ 3");
    [first100, second100, third100].forEach(input => fireEvent.change(input, { target: { value: "100.01" } }));
    [first10, second10, third10].forEach(input => fireEvent.change(input, { target: { value: "10.01" } }));

    const [saveButton] = screen.getAllByRole("button", { name: /บันทึกผล Calibrate/ });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(apiMock.createDailyCheck).toHaveBeenCalledTimes(1));
    expect(apiMock.createDailyCheck.mock.calls[0][0]).toMatchObject({
      scaleId: "scale-1",
      scaleName: "LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง",
    });
  });
});
