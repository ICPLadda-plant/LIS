import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BalanceRoomPage from "../BalanceRoomPage";
import { currentMonthStr, monthRange } from "@/lib/balanceControlChart";

const state = vi.hoisted(() => ({
  user: { name: "Dev Administrator", id: "dev", email: "dev@example.com" },
  period: "morning" as "morning" | null,
}));

const apiMock = vi.hoisted(() => ({
  getDailyChecks: vi.fn().mockResolvedValue([]),
  createDailyCheck: vi.fn(),
  getBalanceControlConfigs: vi.fn().mockResolvedValue([]),
  updateBalanceControlConfig: vi.fn(),
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

vi.mock("@/components/lis/PrintPreviewDialog", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="print-preview">{children}</div>,
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
    apiMock.getBalanceControlConfigs.mockResolvedValue([]);
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

  it("shows the control values and limits from the saved config", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      {
        scaleId: "scale-1",
        brand: "Mettler Toledo",
        model: "MS3002S",
        weightCode: "W-100",
        nominal: 100,
        mean: 99.99972,
        sd: 0.0000476,
        mpe: 0.5,
        updatedDate: "2026-10-26",
      },
    ]);
    renderPage();

    expect(await screen.findByText("99.999720")).toBeInTheDocument();
    expect(screen.getByText("0.0000476")).toBeInTheDocument();
    // UWL = Mean + 2SD, LCL = Mean − 3SD (ไม่ใช่ค่า LCL ที่ผิดในชีต Excel)
    expect(screen.getByText("99.999815")).toBeInTheDocument();
    expect(screen.getByText("99.999577")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่ได้ตั้งค่าค่า Control ของเครื่องนี้")).not.toBeInTheDocument();
  });

  it("compares the current 100 g average with the control lines", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 100, mean: 100, sd: 0.001, mpe: 0.5, updatedDate: "" },
    ]);
    renderPage();
    await screen.findByText("100.0000");

    const [first100] = screen.getAllByPlaceholderText("ครั้งที่ 1");
    const [second100] = screen.getAllByPlaceholderText("ครั้งที่ 2");
    const [third100] = screen.getAllByPlaceholderText("ครั้งที่ 3");
    [first100, second100, third100].forEach(input => fireEvent.change(input, { target: { value: "100.004" } }));

    expect(screen.getByText("เกิน 3SD (นอกเกณฑ์)")).toBeInTheDocument();
  });

  it("asks for control values when the scale has no config", async () => {
    renderPage();
    expect(await screen.findByText("ยังไม่ได้ตั้งค่าค่า Control ของเครื่องนี้")).toBeInTheDocument();
  });

  it("loads the selected scale records for the current month", async () => {
    renderPage();
    const range = monthRange(currentMonthStr());
    await waitFor(() =>
      expect(apiMock.getDailyChecks).toHaveBeenCalledWith(
        expect.objectContaining({ from: range?.from, to: range?.to, scaleId: "scale-1" }),
      ),
    );
  });

  it("opens the print report for the selected scale", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Print/ }));
    expect(await screen.findByTestId("print-preview")).toBeInTheDocument();
  });
});