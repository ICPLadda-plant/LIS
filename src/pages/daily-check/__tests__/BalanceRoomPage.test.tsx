import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BalanceRoomPage from "../BalanceRoomPage";
import { currentMonthStr, monthRange } from "@/lib/balanceControlChart";

const state = vi.hoisted(() => ({
  user: { name: "Dev Administrator", id: "dev", email: "dev@example.com" },
  period: "morning" as "morning" | null,
}));
const readBalanceDisplayValueFromImageMock = vi.hoisted(() => vi.fn());

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
  readBalanceDisplayValueFromImage: readBalanceDisplayValueFromImageMock,
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
    readBalanceDisplayValueFromImageMock.mockResolvedValue({ value: "100.012" });
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

    const [first500, first10] = screen.getAllByPlaceholderText("ครั้งที่ 1");
    const [second500, second10] = screen.getAllByPlaceholderText("ครั้งที่ 2");
    const [third500, third10] = screen.getAllByPlaceholderText("ครั้งที่ 3");
    [first500, second500, third500].forEach(input => fireEvent.change(input, { target: { value: "500.01" } }));
    [first10, second10, third10].forEach(input => fireEvent.change(input, { target: { value: "10.01" } }));

    const [saveButton] = screen.getAllByRole("button", { name: /บันทึกผล Calibrate/ });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(apiMock.createDailyCheck).toHaveBeenCalledTimes(1));
    expect(apiMock.createDailyCheck.mock.calls[0][0]).toMatchObject({
      scaleId: "scale-1",
      scaleName: "LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง",
      avg100: 500.01,
      status100: "pass",
    });
  });

  it("shows a camera button beside every weight value", () => {
    renderPage();
    expect(screen.getAllByRole("button", { name: /ถ่ายรูปอ่านค่าน้ำหนัก/ })).toHaveLength(6);
  });

  it("fills the selected weight with the value read from a photo", async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "ถ่ายรูปอ่านค่าน้ำหนัก 500 กรัม ครั้งที่ 1" }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [new File(["image"], "balance.jpg", { type: "image/jpeg" })] } });

    await waitFor(() => expect(readBalanceDisplayValueFromImageMock).toHaveBeenCalled());
    expect(screen.getAllByPlaceholderText("ครั้งที่ 1")[0]).toHaveValue(100.012);
  });

  it("shows the control values and limits from the saved config", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      {
        scaleId: "scale-1",
        brand: "Mettler Toledo",
        model: "MS3002S",
        weightCode: "W-100",
        nominal: 10,
        mean: 10,
        sd: 0.004,
        mpe: 0.5,
        updatedDate: "2026-10-26",
      },
    ]);
    renderPage();

    expect(await screen.findByText("10.0000")).toBeInTheDocument();
    expect(screen.getByText("0.00400")).toBeInTheDocument();
    // UWL = Mean + 2SD, LCL = Mean − 3SD (ไม่ใช่ค่า LCL ที่ผิดในชีต Excel)
    expect(screen.getByText("10.0080")).toBeInTheDocument();
    expect(screen.getByText("9.9880")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่ได้ตั้งค่าค่า Control ของเครื่องนี้")).not.toBeInTheDocument();
  });

  it("compares the current LD-005 10 g average with the control lines", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 10, mean: 10, sd: 0.001, mpe: 0.5, updatedDate: "" },
    ]);
    renderPage();
    await screen.findByText("10.0000");

    const [, first10] = screen.getAllByPlaceholderText("ครั้งที่ 1");
    const [, second10] = screen.getAllByPlaceholderText("ครั้งที่ 2");
    const [, third10] = screen.getAllByPlaceholderText("ครั้งที่ 3");
    [first10, second10, third10].forEach(input => fireEvent.change(input, { target: { value: "10.004" } }));

    expect(screen.getByText("เกิน 3SD (นอกเกณฑ์)")).toBeInTheDocument();
  });

  it("asks for control values when the scale has no config", async () => {
    renderPage();
    expect(await screen.findByText("ยังไม่มีข้อมูลหรือค่า Control สำหรับตุ้ม 500 g")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีข้อมูลหรือค่า Control สำหรับตุ้ม 10 g")).toBeInTheDocument();
  });

  it("shows recorded values before control limits are configured", async () => {
    apiMock.getDailyChecks.mockImplementation((params?: { from?: string }) =>
      Promise.resolve(params?.from ? [{
        _id: "daily-1",
        scaleId: "scale-1",
        scaleName: "LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง",
        date: `${currentMonthStr()}-12`,
        weights100: [500, 500, 500],
        weights10: [10, 10, 10],
        avg100: 500,
        avg10: 10,
        status100: "pass",
        status10: "pass",
        status: "pass",
        tolerance: 0.05,
        recorder: "Dev Administrator",
        checkedAt: `${currentMonthStr()}-12T08:00:00.000Z`,
      }] : []),
    );

    renderPage();

    expect(await screen.findAllByText(/กราฟมีข้อมูลแล้ว แต่ยังไม่มีเส้น Mean/)).toHaveLength(2);
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
    const preview = await screen.findByTestId("print-preview");
    expect(within(preview).getAllByRole("table")).toHaveLength(2);
    expect(within(preview).getByText(/01\/.*\/2026/)).toBeInTheDocument();
    expect(within(preview).getByText(/16\/.*\/2026/)).toBeInTheDocument();
  });
});
