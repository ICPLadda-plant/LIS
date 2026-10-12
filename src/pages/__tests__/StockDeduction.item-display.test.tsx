import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { ConfirmProvider } from "@/context/ConfirmDialog";
import StockDeduction from "../StockDeduction";

const apiMock = vi.hoisted(() => ({
  getStockTransactions: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  user: { email: "analyst@icpladda.com", name: "Analyst" } as {
    email: string;
    name: string;
    role?: string;
    roles?: string[];
  },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: authMock.user }),
}));

vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/lis/PageHeader", () => ({
  default: ({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) => (
    <header>
      {title}
      {description}
          {actions}
    </header>
  ),
}));

vi.mock("@/components/lis/stock/StockRequisitionButton", () => ({
  default: ({ initialQrId }: { initialQrId?: string | null }) => <div data-testid="stock-requisition">{initialQrId || ""}</div>,
}));

vi.mock("@/components/lis/StockQrScanner", () => ({
  default: ({ open, showManualEntry = true, onScanned }: { open: boolean; showManualEntry?: boolean; onScanned: (qrId: string) => void }) => (
    open ? (
      <div>
        {showManualEntry ? <div>หรือวางลิงก์/qrId เอง</div> : null}
        <button type="button" onClick={() => onScanned("https://app-plant.icpladda.com/LIS/stock/view?qrId=u_scan")}>mock scan</button>
      </div>
    ) : null
  ),
}));

vi.mock("@/hooks/useAccessibleTabs", () => ({
  useAccessibleTabs: () => ({
    tabs: [
      { key: "in-use", label: "กำลังใช้งานอยู่" },
      { key: "history", label: "ประวัติการตัด stock" },
    ],
    isVisible: () => true,
    visibleKeys: ["in-use", "history"],
    defaultKey: "in-use",
  }),
}));

vi.mock("@/components/lis/stock/StandardsInUseTable", () => ({
  default: () => <div>in-use-table</div>,
}));

function renderPage(initialEntries = ["/stock-deduction"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <StockDeduction />
        </ConfirmProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function openCameraScanner() {
  fireEvent.click(screen.getByRole("button", { name: /สแกน QR ข้างขวด/ }));
}

function currentMonthParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function bangkokDayWindowForCurrentMonth(day: number) {
  const { year, month } = currentMonthParts();
  const offsetMs = 7 * 60 * 60 * 1000;
  return {
    createdFrom: new Date(Date.UTC(year, month - 1, day) - offsetMs).toISOString(),
    createdTo: new Date(Date.UTC(year, month - 1, day + 1) - offsetMs).toISOString(),
  };
}

function currentMonthDayButton(day: number) {
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date());
  const button = screen.getAllByRole("gridcell").find((element) => (
    element.getAttribute("aria-label")?.includes(`${monthName} ${day}`)
    || (element.textContent?.trim() === String(day) && !String(element.className).includes("day-outside"))
  ));
  if (!button) throw new Error(`Date button not found for ${monthName} ${day}`);
  return button;
}

describe("StockDeduction item display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    authMock.user = { email: "analyst@icpladda.com", name: "Analyst" };
    apiMock.getStockTransactions.mockResolvedValue([
      {
        _id: "tx-1",
        itemType: "standard",
        itemId: "std-1",
        itemCode: "STD-001",
        itemName: "ABAMECTIN",
        action: "deduct",
        volumeDelta: -45,
        unit: "mg",
        createdAt: "2026-07-10T01:00:00.000Z",
      },
    ]);
  });

  it("preserves server search ranking and request filters", async () => {
    const choices = [
      { itemCode: "OTHER", itemName: "67 name" },
      { itemCode: "X67", itemName: "Contains" },
      { itemCode: "67B", itemName: "Prefix" },
      { itemCode: "67", itemName: "Exact" },
    ];
    const transactions = choices.map((choice) => ({
      _id: choice.itemCode, itemId: choice.itemCode, itemType: "standard", action: "deduct",
      volumeDelta: -1, unit: "mg", createdAt: "2026-07-10T01:00:00.000Z", ...choice,
    }));
    apiMock.getStockTransactions.mockImplementation(async (params) => params.search
      ? [transactions[3], transactions[2], transactions[1], transactions[0]]
      : transactions);
    renderPage();
    const searchInput = await screen.findByLabelText("ค้นหาชื่อสารหรือคนเบิก");
    fireEvent.change(searchInput, { target: { value: "67" } });

    await waitFor(() => expect(screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[2].textContent)).toEqual([
      "Exact", "Prefix", "Contains", "67 name",
    ]));
    expect(apiMock.getStockTransactions).toHaveBeenLastCalledWith({
      action: "deduct", itemType: undefined, search: "67", limit: 200,
    });

    fireEvent.change(searchInput, { target: { value: "" } });
    await waitFor(() => expect(screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[2].textContent)).toEqual(
      choices.map((choice) => choice.itemName),
    ));
  });

  it("keeps server ranking in daily summaries while search is active", async () => {
    const transactions = [
      { itemCode: "67", itemName: "Z exact" },
      { itemCode: "670", itemName: "A prefix" },
    ].map((choice) => ({
      _id: choice.itemCode, itemId: choice.itemCode, itemType: "standard", action: "deduct",
      volumeDelta: -1, unit: "mg", createdAt: "2026-07-10T01:00:00.000Z", ...choice,
    }));
    apiMock.getStockTransactions.mockResolvedValue(transactions);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "เลือกวันที่ดูยอดเบิก" }));
    await screen.findByRole("grid");
    fireEvent.click(currentMonthDayButton(8));
    const summary = await screen.findByLabelText("สรุปยอดเบิกตามวันที่");
    const summaryNames = () => within(summary).getAllByText(/^(A prefix|Z exact)$/).map((item) => item.textContent);
    await waitFor(() => expect(summaryNames()).toEqual(["A prefix", "Z exact"]));
    fireEvent.change(screen.getByLabelText("ค้นหาชื่อสารหรือคนเบิก"), { target: { value: "67" } });
    await waitFor(() => expect(summaryNames()).toEqual(["Z exact", "A prefix"]));
    fireEvent.change(screen.getByLabelText("ค้นหาชื่อสารหรือคนเบิก"), { target: { value: "" } });
    await waitFor(() => expect(summaryNames()).toEqual(["A prefix", "Z exact"]));
  });

  it("puts scanned bottle QR into the deduction flow", async () => {
    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    await waitFor(() => expect(screen.getByTestId("stock-requisition")).toHaveTextContent("u_scan"));
  });

  it("hides manual stock link fallback in the stock deduction scanner", () => {
    renderPage();

    openCameraScanner();

    expect(screen.queryByText("หรือวางลิงก์/qrId เอง")).not.toBeInTheDocument();
  });

  it("shows only deduction history without the in-use tab", async () => {
    renderPage();

    expect(screen.queryByRole("tab", { name: "กำลังใช้งานอยู่" })).not.toBeInTheDocument();
    expect(screen.queryByText("in-use-table")).not.toBeInTheDocument();
    expect(await screen.findByText("ABAMECTIN")).toBeInTheDocument();
  });

  it("hides notification column and sends a unified search filter", async () => {
    renderPage();

    await screen.findByText("ABAMECTIN");
    expect(screen.queryByRole("columnheader", { name: "การแจ้ง" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("กรองคนเบิก")).not.toBeInTheDocument();

    apiMock.getStockTransactions.mockClear();
    fireEvent.change(screen.getByLabelText("ค้นหาชื่อสารหรือคนเบิก"), { target: { value: "somchai" } });

    await waitFor(() => expect(apiMock.getStockTransactions).toHaveBeenLastCalledWith(expect.objectContaining({
      search: "somchai",
    })));
    expect(apiMock.getStockTransactions.mock.lastCall?.[0].user).toBeUndefined();
  });

  it("loads the selected calendar date and summarizes how much stock went out", async () => {
    apiMock.getStockTransactions.mockImplementation((params?: { createdFrom?: string }) => Promise.resolve(
      params?.createdFrom
        ? [
          {
            _id: "tx-day-1",
            itemType: "standard",
            itemId: "std-1",
            itemCode: "STD-001",
            itemName: "ABAMECTIN",
            action: "deduct",
            volumeDelta: -45,
            unit: "mg",
            createdAt: "2026-07-10T01:00:00.000Z",
          },
          {
            _id: "tx-day-2",
            itemType: "standard",
            itemId: "std-1",
            itemCode: "STD-001",
            itemName: "ABAMECTIN",
            action: "deduct",
            volumeDelta: -15,
            unit: "mg",
            createdAt: "2026-07-10T02:00:00.000Z",
          },
        ]
        : [],
    ));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "เลือกวันที่ดูยอดเบิก" }));
    await screen.findByRole("grid");
    fireEvent.click(currentMonthDayButton(8));

    await waitFor(() => expect(apiMock.getStockTransactions).toHaveBeenCalledWith({
      action: "deduct",
      itemType: undefined,
      ...bangkokDayWindowForCurrentMonth(8),
      limit: 1000,
    }));
    const summary = await screen.findByLabelText("สรุปยอดเบิกตามวันที่");
    expect(within(summary).getByText("ABAMECTIN")).toBeInTheDocument();
    expect(within(summary).getByText("60 mg")).toBeInTheDocument();
    expect(within(summary).getByText("2 ครั้ง")).toBeInTheDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the substance name in the item column without showing the stock code", async () => {
    renderPage();

    expect(await screen.findByText("ABAMECTIN")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("STD-001")).not.toBeInTheDocument());
  });

  it("opens deduction details from a clicked row without the retired resolution action", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("ABAMECTIN"));

    expect(await screen.findByRole("heading", { name: "รายละเอียดการเบิก" })).toBeInTheDocument();
    expect(screen.getAllByText("ABAMECTIN").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "แจ้งหมด/ปัญหา" })).not.toBeInTheDocument();
  });

  it("shows edit and delete actions only on today's own deductions", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    apiMock.getStockTransactions.mockResolvedValue([
      {
        _id: "tx-own-today",
        itemType: "standard",
        itemId: "std-1",
        itemCode: "STD-001",
        itemName: "OWN TODAY",
        action: "deduct",
        volumeDelta: -45,
        unit: "mg",
        userEmail: "Analyst@ICPLadda.com",
        createdAt: now.toISOString(),
      },
      {
        _id: "tx-other-today",
        itemType: "standard",
        itemId: "std-2",
        itemCode: "STD-002",
        itemName: "OTHER TODAY",
        action: "deduct",
        volumeDelta: -10,
        unit: "mg",
        userEmail: "other@icpladda.com",
        createdAt: now.toISOString(),
      },
      {
        _id: "tx-own-yesterday",
        itemType: "standard",
        itemId: "std-3",
        itemCode: "STD-003",
        itemName: "OWN YESTERDAY",
        action: "deduct",
        volumeDelta: -5,
        unit: "mg",
        userEmail: "analyst@icpladda.com",
        createdAt: yesterday.toISOString(),
      },
    ]);

    renderPage();

    const ownTodayRow = (await screen.findByText("OWN TODAY")).closest("tr");
    const otherTodayRow = (await screen.findByText("OTHER TODAY")).closest("tr");
    const ownYesterdayRow = (await screen.findByText("OWN YESTERDAY")).closest("tr");

    expect(ownTodayRow).not.toBeNull();
    expect(otherTodayRow).not.toBeNull();
    expect(ownYesterdayRow).not.toBeNull();

    expect(within(ownTodayRow!).getByRole("button", { name: "แก้ไขการเบิก OWN TODAY" })).toBeInTheDocument();
    expect(within(ownTodayRow!).getByRole("button", { name: "ลบการเบิก OWN TODAY" })).toBeInTheDocument();
    expect(within(otherTodayRow!).queryByRole("button", { name: /การเบิก OTHER TODAY/ })).not.toBeInTheDocument();
    expect(within(ownYesterdayRow!).queryByRole("button", { name: /การเบิก OWN YESTERDAY/ })).not.toBeInTheDocument();
  });

  it("shows edit and delete actions for lab inventory on anyone's deduction within seven days", async () => {
    authMock.user = { email: "stock@icpladda.com", name: "Stock", roles: ["lab-inventory"] };
    const now = new Date();
    const withinSevenDays = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const olderThanSevenDays = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    apiMock.getStockTransactions.mockResolvedValue([
      {
        _id: "tx-other-recent",
        itemType: "standard",
        itemId: "std-1",
        itemName: "OTHER RECENT",
        action: "deduct",
        volumeDelta: -12,
        unit: "mg",
        userEmail: "other@icpladda.com",
        createdAt: withinSevenDays.toISOString(),
      },
      {
        _id: "tx-other-old",
        itemType: "standard",
        itemId: "std-2",
        itemName: "OTHER OLD",
        action: "deduct",
        volumeDelta: -12,
        unit: "mg",
        userEmail: "other@icpladda.com",
        createdAt: olderThanSevenDays.toISOString(),
      },
    ]);

    renderPage();

    const recentRow = (await screen.findByText("OTHER RECENT")).closest("tr");
    const oldRow = (await screen.findByText("OTHER OLD")).closest("tr");

    expect(recentRow).not.toBeNull();
    expect(oldRow).not.toBeNull();
    expect(within(recentRow!).getByRole("button", { name: "แก้ไขการเบิก OTHER RECENT" })).toBeInTheDocument();
    expect(within(recentRow!).getByRole("button", { name: "ลบการเบิก OTHER RECENT" })).toBeInTheDocument();
    expect(within(oldRow!).queryByRole("button", { name: /การเบิก OTHER OLD/ })).not.toBeInTheDocument();
  });
});
