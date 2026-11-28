import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BalanceRoomPage from "../BalanceRoomPage";
import { currentMonthStr, monthRange } from "@/lib/balanceControlChart";
import { todayStr } from "@/lib/chemicalRequisition";

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
  updateBalanceWeightCode: vi.fn(),
  getDailyCheckHolidays: vi.fn().mockResolvedValue([]),
  setDailyCheckHoliday: vi.fn(),
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
    apiMock.getDailyCheckHolidays.mockResolvedValue([]);
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
    expect(screen.getByText("LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง").closest("button")).toHaveClass("bg-sky-50/70");
    expect(screen.getByText("LD-006 - เครื่องชั่งดิจิตอล 4 ตำแหน่ง").closest("button")).toHaveClass("bg-violet-50/70");
    expect(screen.queryByText("เครื่องชั่ง 1")).not.toBeInTheDocument();
  });

  it("shows today's saved status even when it was recorded in another period", async () => {
    apiMock.getDailyChecks.mockResolvedValue([{
      _id: "daily-afternoon",
      scaleId: "scale-1",
      scaleName: "LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง",
      date: new Date().toISOString().slice(0, 10),
      weights100: [500, 500, 500],
      weights10: [10, 10, 10],
      avg100: 500,
      avg10: 10,
      status100: "pass",
      status10: "pass",
      status: "pass",
      tolerance: 0.05,
      recorder: "Dev Administrator",
      period: "afternoon",
      checkedAt: new Date().toISOString(),
    }]);

    renderPage();

    expect(await screen.findByText("ตรวจแล้ว 1/5")).toBeInTheDocument();
    expect(screen.getByText("ผ่าน 1/5")).toBeInTheDocument();
    expect(screen.getAllByText("ผ่าน").length).toBeGreaterThan(0);
    expect(screen.getByText("ผ่านวันนี้")).toBeInTheDocument();
  });

  it("allows calibration outside the morning and afternoon periods", async () => {
    state.period = null;
    renderPage();

    expect(screen.queryByText("นอกเวลาบันทึก")).not.toBeInTheDocument();
    expect(screen.getByText(/บันทึกได้ทุกเวลา/)).toBeInTheDocument();
    // เลือกวันที่ย้อนหลังจากปฏิทิน (วันที่ 12 ของเดือนปัจจุบัน)
    fireEvent.click(screen.getByRole("button", { name: /วันที่บันทึก|\d+ [ก-๙.]+ \d{4}/ }));
    fireEvent.click(await screen.findByRole("gridcell", { name: "12" }));

    const [first10, first500] = screen.getAllByPlaceholderText("ครั้งที่ 1");
    const [second10, second500] = screen.getAllByPlaceholderText("ครั้งที่ 2");
    const [third10, third500] = screen.getAllByPlaceholderText("ครั้งที่ 3");
    [first500, second500, third500].forEach(input => fireEvent.change(input, { target: { value: "500.01" } }));
    [first10, second10, third10].forEach(input => fireEvent.change(input, { target: { value: "10.01" } }));

    const [saveButton] = screen.getAllByRole("button", { name: /บันทึกผล Calibrate/ });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(apiMock.createDailyCheck).toHaveBeenCalledTimes(1));
    expect(apiMock.createDailyCheck.mock.calls[0][0]).toMatchObject({
      scaleId: "scale-1",
      scaleName: "LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง",
      date: `${currentMonthStr()}-12`,
      avg100: 500.01,
      status100: "pass",
    });
  });

  it("shows a camera button beside every weight value", () => {
    renderPage();
    expect(screen.getAllByRole("button", { name: /ถ่ายรูปอ่านค่าน้ำหนัก/ })).toHaveLength(6);
  });

  it("accepts digits only and blocks saving on invalid input", () => {
    renderPage();
    const input = screen.getAllByPlaceholderText("ครั้งที่ 1")[0];
    // ตัวอักษรและเครื่องหมายถูกตัดทิ้ง เหลือเฉพาะตัวเลข
    fireEvent.change(input, { target: { value: "-9a.0e9" } });
    expect(input).toHaveValue("9.09");
    // กรอกไม่ครบ 6 ค่า → กดบันทึกแล้วไม่ยิง API
    fireEvent.click(screen.getByRole("button", { name: /บันทึกผล Calibrate/ }));
    expect(apiMock.createDailyCheck).not.toHaveBeenCalled();
  });

  it.each(["LD-021", "LD-047"])("limits %s 100 g readings to four decimals", (code) => {
    renderPage();
    fireEvent.click(screen.getByText(new RegExp(`^${code} -`)).closest("button")!);
    const input = screen.getAllByPlaceholderText("ครั้งที่ 1")[1];
    fireEvent.change(input, { target: { value: "99.99999" } });
    expect(input).toHaveValue("99.9999");
  });

  it("fills the selected weight with the value read from a photo", async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "ถ่ายรูปอ่านค่าน้ำหนัก 500 กรัม ครั้งที่ 1" }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [new File(["image"], "balance.jpg", { type: "image/jpeg" })] } });

    await waitFor(() => expect(readBalanceDisplayValueFromImageMock).toHaveBeenCalled());
    expect(screen.getAllByPlaceholderText("ครั้งที่ 1")[1]).toHaveValue("100.01");
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
        updatedDate: "2026-10-26",
      },
    ]);
    renderPage();

    // LD-005 ละเอียด 2 ตำแหน่ง — ค่า Control แสดงตามนั้น ส่วน STD แสดง 3 ตำแหน่งนัยสำคัญ
    expect((await screen.findAllByText("10.00")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.00400").length).toBeGreaterThan(0);
    // UWL = Mean + 2SD, LCL = Mean − 3SD (ไม่ใช่ค่า LCL ที่ผิดในชีต Excel)
    expect(screen.getAllByText("10.01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9.99").length).toBeGreaterThan(0);
    expect(screen.queryByText("ยังไม่ได้ตั้งค่าค่า Control ของเครื่องนี้")).not.toBeInTheDocument();
  });

  it("edits the weight code bound to each weight size", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      { scaleId: "scale-1", brand: "", model: "", weightCode: "W-10", nominal: 10, mean: 10, sd: 0.01, updatedDate: "2026-11-17" },
      { scaleId: "scale-1", brand: "", model: "", weightCode: "W-500", nominal: 500, mean: 500, sd: 0.01, updatedDate: "2026-11-17" },
    ]);
    apiMock.updateBalanceWeightCode.mockResolvedValue({ nominal: 10, weightCode: "W-11" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /รหัสตุ้มน้ำหนัก/ }));
    expect(await screen.findByRole("heading", { name: /ข้อมูลตุ้มน้ำหนักที่ใช้/ })).toBeInTheDocument();
    expect(screen.getByLabelText("รหัสตุ้ม 10 g")).toHaveValue("W-10");
    expect(screen.getByLabelText("รหัสตุ้ม 500 g")).toHaveValue("W-500");

    fireEvent.change(screen.getByLabelText("รหัสตุ้ม 10 g"), { target: { value: "W-11" } });
    fireEvent.click(screen.getAllByRole("button", { name: "บันทึก" })[0]);
    await waitFor(() => expect(apiMock.updateBalanceWeightCode).toHaveBeenCalledWith(10, "W-11"));

    fireEvent.change(screen.getByLabelText("เพิ่มขนาดตุ้ม (g)"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มขนาดตุ้ม" }));
    await waitFor(() => expect(apiMock.updateBalanceWeightCode).toHaveBeenCalledWith(250, ""));
  });

  it("compares the current LD-005 10 g average with the control lines", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 10, mean: 10, sd: 0.001, updatedDate: "" },
    ]);
    renderPage();
    await screen.findAllByText("10.00");

    ["ครั้งที่ 1", "ครั้งที่ 2", "ครั้งที่ 3"].forEach((placeholder) => {
      const [weight10, weight500] = screen.getAllByPlaceholderText(placeholder);
      fireEvent.change(weight10, { target: { value: "10.00" } });
      fireEvent.change(weight500, { target: { value: "500.00" } });
    });
    const [first10] = screen.getAllByPlaceholderText("ครั้งที่ 1");
    const [second10] = screen.getAllByPlaceholderText("ครั้งที่ 2");
    const [third10] = screen.getAllByPlaceholderText("ครั้งที่ 3");
    [first10, second10, third10].forEach(input => fireEvent.change(input, { target: { value: "10.01" } }));

    expect(screen.getByText("เกิน 3SD (นอกเกณฑ์)")).toBeInTheDocument();
  });

  it("asks for control values when the scale has no config", async () => {
    renderPage();
    expect(await screen.findByText("ยังไม่มีข้อมูลหรือค่า Control สำหรับตุ้ม 500 g")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีข้อมูลหรือค่า Control สำหรับตุ้ม 10 g")).toBeInTheDocument();
  });

  it("calculates control values from 20 entered readings", async () => {
    apiMock.updateBalanceControlConfig.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "ตั้งค่า 10 g" }));

    const baselineValues = Array.from({ length: 20 }, (_, index) => 10 + index / 100);
    baselineValues.forEach((value, index) => {
      fireEvent.change(screen.getByLabelText(`ค่าบันทึกที่ ${index + 1}`), { target: { value: String(value) } });
    });
    fireEvent.blur(screen.getByLabelText("ค่าบันทึกที่ 1"));
    expect(screen.getByLabelText("ค่าบันทึกที่ 1")).toHaveValue("10.00");
    expect(screen.getByLabelText("น้ำหนักตุ้ม Daily check (g)")).toHaveValue("10.00");
    expect(screen.queryByLabelText("MPE (g)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกค่า Control" }));

    await waitFor(() => expect(apiMock.updateBalanceControlConfig).toHaveBeenCalledTimes(1));
    const [, input] = apiMock.updateBalanceControlConfig.mock.calls[0];
    expect(input.baselineValues).toEqual(baselineValues);
    expect(input.mean).toBeCloseTo(10.095);
    expect(input.sd).toBeGreaterThan(0);
  });

  it("clears only baseline values and updates the control date", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([{
      scaleId: "scale-1",
      brand: "Sartorius",
      model: "CPA225D",
      weightCode: "",
      nominal: 10,
      mean: 10,
      sd: 0.001,
      baselineValues: Array(20).fill(10),
      updatedDate: "2026-11-18",
    }]);
    renderPage();
    await screen.findByText("Sartorius");
    fireEvent.click(screen.getByRole("button", { name: "แก้ไขค่า Control" }));

    fireEvent.click(await screen.findByRole("button", { name: "ล้างค่าทั้งหมด" }));

    Array.from({ length: 20 }, (_, index) =>
      expect(screen.getByLabelText(`ค่าบันทึกที่ ${index + 1}`)).toHaveValue(""),
    );
    expect(screen.getByLabelText("น้ำหนักตุ้ม Daily check (g)")).toHaveValue("10.00");
    expect(screen.getByLabelText("วันที่ปรับปรุงค่า Control")).toHaveValue(todayStr());
    expect(screen.getByLabelText("ยี่ห้อ")).toHaveValue("Sartorius");
    expect(screen.getByLabelText("รุ่น")).toHaveValue("CPA225D");
    ["Mean (g)", "STD (g)"].forEach((label) => expect(screen.getByLabelText(label)).toHaveValue("—"));
    localStorage.removeItem("balance-control-draft:scale-1:10");
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
    expect(screen.getByRole("button", { name: "แสดงบันทึกตุ้ม 10 g" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "แสดงบันทึกตุ้ม 500 g" }));
    expect(screen.getByRole("button", { name: "แสดงบันทึกตุ้ม 500 g" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("cell", { name: "500.00" })).toHaveLength(4);
  });

  it("shows LD-021 100 g history with four decimals", async () => {
    apiMock.getDailyChecks.mockImplementation((params?: { scaleId?: string; from?: string }) =>
      Promise.resolve(params?.scaleId === "scale-3" && params.from ? [{
        _id: "daily-ld021",
        scaleId: "scale-3",
        scaleName: "LD-021 - เครื่องชั่งดิจิตอล 5 ตำแหน่ง",
        date: `${currentMonthStr()}-12`,
        weights100: [99.99994, 99.99994, 99.99994],
        weights10: [10, 10, 10],
        avg100: 99.99994,
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
    fireEvent.click(screen.getByText(/^LD-021 -/).closest("button")!);

    expect(await screen.findAllByRole("cell", { name: "99.9999" })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Print/ }));
    const preview = await screen.findByTestId("print-preview");
    expect(within(preview).getAllByRole("cell", { name: "99.9999" })).toHaveLength(4);
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
    expect(within(preview).getAllByRole("table")).toHaveLength(4);
    expect(within(preview).getByText("P1/2")).toBeInTheDocument();
    expect(within(preview).getByText("P2/2")).toBeInTheDocument();
    // รายงานใช้ วว/ดด/พ.ศ.
    expect(within(preview).getAllByText(/^01\/\d{2}\/2569$/).length).toBeGreaterThan(0);
    expect(within(preview).getAllByText(/^16\/\d{2}\/2569$/).length).toBeGreaterThan(0);
  });

  it("shows edit controls and warns when control values are three months old", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 10, mean: 10, sd: 0.01, updatedDate: "2026-08-17" },
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 500, mean: 500, sd: 0.01, updatedDate: "2026-08-17" },
    ]);
    renderPage();
    expect((await screen.findByText(/ครบ 3 เดือนแล้ว/)).closest('[role="alert"]')).toHaveClass("bg-destructive");
    expect(screen.getAllByText("อัปเดตล่าสุด: 17 ส.ค. 2569 · ครบกำหนด: พฤศจิกายน 2569")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /แก้ไขค่า Control/ })).toHaveLength(2);
  });

  it("warns on an individual value but only blocks saving when the mean exceeds control limits", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 10, mean: 10, sd: 0.01, updatedDate: "2026-11-17" },
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 500, mean: 500, sd: 0.01, updatedDate: "2026-11-17" },
    ]);
    renderPage();
    await screen.findAllByText("10.00");

    for (const placeholder of ["ครั้งที่ 1", "ครั้งที่ 2", "ครั้งที่ 3"]) {
      const [weight10, weight500] = screen.getAllByPlaceholderText(placeholder);
      fireEvent.change(weight10, { target: { value: "10.00" } });
      await waitFor(() => expect(weight10).toHaveValue("10.00"));
      fireEvent.change(weight500, { target: { value: "500.00" } });
      await waitFor(() => expect(weight500).toHaveValue("500.00"));
    }

    const [first10] = screen.getAllByPlaceholderText("ครั้งที่ 1");
    fireEvent.change(first10, { target: { value: "10.05" } });
    await waitFor(() => expect(first10).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getAllByText(/ระบบจะตัดสินจากค่าเฉลี่ย/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /บันทึกผล Calibrate/ })).toBeEnabled();

    fireEvent.change(first10, { target: { value: "10.10" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /บันทึกผล Calibrate/ })).toBeDisabled());

    fireEvent.change(first10, { target: { value: "10.00" } });
    await waitFor(() => expect(first10).toHaveAttribute("aria-invalid", "false"));
  });

  it("prints the holiday reason as one wide grey cell", async () => {
    const month = currentMonthStr();
    const [year, monthNumber] = month.split("-").map(Number);
    const day = new Date(year, monthNumber - 1, 1).getDay() === 0 ? 2 : 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    apiMock.getDailyCheckHolidays.mockResolvedValue([{ date, note: "หยุดชดเชยปีใหม่" }]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Print/ }));
    const preview = await screen.findByTestId("print-preview");
    const noteCell = await within(preview).findAllByText("หยุดชดเชยปีใหม่");
    expect(noteCell[0]).toHaveAttribute("colspan", "7");
    expect(noteCell[0].closest("tr")).toHaveClass("bcr-off");
  });

  it("greys out Sundays and marked holidays in the print report", async () => {
    const month = currentMonthStr();
    const [year, monthNumber] = month.split("-").map(Number);
    const dayOf = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
    const beDate = (day: number) => `${String(day).padStart(2, "0")}/${String(monthNumber).padStart(2, "0")}/${year + 543}`;
    const sunday = [1, 2, 3, 4, 5, 6, 7].find((day) => new Date(year, monthNumber - 1, day).getDay() === 0)!;
    const workday = sunday === 1 ? 2 : 1;
    const holiday = sunday + 10;
    apiMock.getDailyCheckHolidays.mockResolvedValue([{ date: dayOf(holiday) }]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Print/ }));
    const preview = await screen.findByTestId("print-preview");
    await waitFor(() => expect(within(preview).getAllByText(beDate(holiday))[0].closest("tr")).toHaveClass("bcr-off"));
    expect(within(preview).getAllByText(beDate(sunday))[0].closest("tr")).toHaveClass("bcr-off");
    expect(within(preview).getAllByText(beDate(workday))[0].closest("tr")).not.toHaveClass("bcr-off");
  });
});
