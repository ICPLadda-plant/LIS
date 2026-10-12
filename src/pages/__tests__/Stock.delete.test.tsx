import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import StockPage from "../Stock";

const apiMock = vi.hoisted(() => ({
  getStandards: vi.fn(),
  getSixMonthMedicineStock: vi.fn(),
  getStockUnits: vi.fn(),
  deleteStandard: vi.fn(),
  getSolvents: vi.fn(),
  getGlassware: vi.fn(),
  getStockTransactions: vi.fn(),
}));
const tabsMock = vi.hoisted(() => ({
  defaultKey: "standard",
}));
const authMock = vi.hoisted(() => ({
  user: {
    email: "tester@example.com",
    name: "Tester",
    role: "admin",
    roles: ["admin"],
  },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/lis/PageHeader", () => ({
  default: ({ title }: { title: React.ReactNode }) => <header>{title}</header>,
}));

vi.mock("@/components/lis/StockQrScanner", () => ({
  default: () => null,
}));

vi.mock("@/components/lis/stock/StandardDetailDrawer", () => ({
  default: () => <div data-testid="standard-detail-drawer" />,
}));

vi.mock("@/components/lis/stock/StandardUnitsPanel", () => ({
  default: () => null,
}));

vi.mock("@/components/lis/stock/ReceiveBottlesDialog", () => ({
  default: () => null,
}));

vi.mock("@/components/lis/stock/ReceiveCart", () => ({
  default: () => null,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: authMock.user,
  }),
}));

vi.mock("@/hooks/useAccessibleTabs", () => ({
  useAccessibleTabs: () => ({
    defaultKey: tabsMock.defaultKey,
    tabs: [
      { key: "standard", label: "Standards" },
      { key: "solvent", label: "Solvents" },
      { key: "glassware", label: "Glassware" },
    ],
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderStock(defaultKey = "standard") {
  tabsMock.defaultKey = defaultKey;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StockPage />
    </QueryClientProvider>,
  );
}

function makeStandardAlertItem(index: number) {
  const padded = index.toString().padStart(3, "0");
  return {
    _id: `std-${index}`,
    code: `STD-${padded}`,
    name: `Standard ${padded}`,
    primary: { qty: 0, ordered: 0, sizeMg: null, exp: "", usesPerBottle: null, pricePerUnit: 0, totalPrice: 0 },
    supplier: { qty: 0, sizeMg: null, exp: "" },
    working: { qty: 0, sizeMg: null, exp: "" },
    usagePerUseMg: null,
    frequency: "",
    storageTemp: "",
    status: "",
    expiryStatus: "",
  };
}

describe("StockPage delete actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabsMock.defaultKey = "standard";
    authMock.user = {
      email: "tester@example.com",
      name: "Tester",
      role: "admin",
      roles: ["admin"],
    };
    apiMock.getStandards.mockResolvedValue([
      {
        _id: "std-1",
        code: "STD-001",
        name: "Pesticide Standard",
        primary: { qty: 0, ordered: 0, sizeMg: null, exp: "", usesPerBottle: null, pricePerUnit: 0, totalPrice: 0 },
        supplier: { qty: 0, sizeMg: null, exp: "" },
        working: { qty: 0, sizeMg: null, exp: "" },
        usagePerUseMg: null,
        frequency: "",
        storageTemp: "",
        status: "",
        expiryStatus: "",
      },
    ]);
    apiMock.getStockUnits.mockResolvedValue([
      {
        _id: "unit-1",
        qrId: "u1",
        itemCode: "STD-001",
        itemName: "Pesticide Standard",
        status: "active",
        exp: "2027-01-01",
        volume: { initial: 100, remaining: 100, unit: "mg" },
      },
    ]);
    apiMock.deleteStandard.mockResolvedValue({ success: true });
    apiMock.getSolvents.mockResolvedValue([
      {
        _id: "solvent-1",
        name: "Methanol",
        sizeLiter: 2.5,
        qty: 3,
        price: 1200,
        note: "HPLC grade",
      },
    ]);
    apiMock.getGlassware.mockResolvedValue([
      {
        _id: "glass-1",
        name: "Volumetric flask",
        qty: 12,
        pricePerPiece: 450,
        note: "Class A",
      },
    ]);
    apiMock.getStockTransactions.mockResolvedValue([]);
    apiMock.getSixMonthMedicineStock.mockResolvedValue({
      serverTime: "2026-09-04T00:00:00.000Z",
      referenceMonth: "2026-09",
      items: [
        {
          companySource: "ICPL",
          itemNo: "F-TEST-001",
          locationCode: "NORMAL",
          binCode: "DEFAULT",
          lotNo: "FG260301-001",
          registeringDate: "2026-03-31T00:00:00.000Z",
          unit: "KG",
          stockQty: 10,
          stockQtyBase: 10,
          ageMonths: 7,
        },
        {
          companySource: "ICPL",
          itemNo: "R-TEST-002",
          locationCode: "NORMAL",
          binCode: "DEFAULT",
          lotNo: "RM260201-002",
          registeringDate: "2026-02-28T00:00:00.000Z",
          unit: "KG",
          stockQty: 5,
          stockQtyBase: 5,
          ageMonths: 7,
        },
      ],
    });
  });

  it("does not show the six-month medicine tab on the stock page", async () => {
    renderStock();

    expect(await screen.findByRole("cell", { name: "Pesticide Standard" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "List ยา 6 เดือน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "แจ้งเตือนส่งตรวจคุณภาพ" })).not.toBeInTheDocument();
    expect(apiMock.getSixMonthMedicineStock).not.toHaveBeenCalled();
  });

  it("confirms and deletes a standard through the MongoDB-backed API", async () => {
    renderStock();

    expect(await screen.findByRole("cell", { name: "Pesticide Standard" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ลบ Standard Pesticide Standard" }));
    expect(screen.queryByTestId("standard-detail-drawer")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "ลบ" }));

    await waitFor(() => expect(apiMock.deleteStandard).toHaveBeenCalledWith("std-1"));
  });

  it("keeps standards visible even when no bottle stock remains", async () => {
    apiMock.getStockUnits.mockResolvedValue([]);

    renderStock();

    expect(await screen.findByRole("cell", { name: "Pesticide Standard" })).toBeInTheDocument();
    expect(screen.queryByText("ไม่มีข้อมูล")).not.toBeInTheDocument();
  });

  it("does not show the floating stock QR scan button", async () => {
    renderStock();

    expect(await screen.findByRole("cell", { name: "Pesticide Standard" })).toBeInTheDocument();
    expect(screen.queryByTitle("สแกน QR ขวด")).not.toBeInTheDocument();
  });

  it("opens a popup with every standard alert from the alert card", async () => {
    apiMock.getStandards.mockResolvedValue(Array.from({ length: 9 }, (_, index) => makeStandardAlertItem(index + 1)));
    apiMock.getStockUnits.mockResolvedValue([]);

    renderStock();

    expect(await screen.findByText("แจ้งเตือน Standard (9 รายการ)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ดูทั้งหมด" }));

    const dialog = await screen.findByRole("dialog", { name: "แจ้งเตือน Standard ทั้งหมด" });
    expect(within(dialog).getByText("Standard 009")).toBeInTheDocument();
    expect(within(dialog).getByText("STD-009")).toBeInTheDocument();
  });

  it("keeps solvent items visible even when quantity is zero", async () => {
    apiMock.getSolvents.mockResolvedValue([
      {
        _id: "solvent-1",
        name: "Methanol",
        sizeLiter: 2.5,
        qty: 0,
        price: 1200,
        note: "HPLC grade",
      },
    ]);

    renderStock("solvent");

    expect(await screen.findByRole("cell", { name: "Methanol" })).toBeInTheDocument();
    expect(screen.queryByText("ไม่มีข้อมูล")).not.toBeInTheDocument();
  });

  it("keeps glassware items visible even when quantity is zero", async () => {
    apiMock.getGlassware.mockResolvedValue([
      {
        _id: "glass-1",
        name: "Volumetric flask",
        qty: 0,
        pricePerPiece: 450,
        note: "Class A",
      },
    ]);

    renderStock("glassware");

    expect(await screen.findByRole("cell", { name: "Volumetric flask" })).toBeInTheDocument();
    expect(screen.queryByText("ไม่มีข้อมูล")).not.toBeInTheDocument();
    expect(screen.getByText("เครื่องแก้วหมด (1 รายการ)")).toBeInTheDocument();
  });
  it.each([
    { defaultKey: "standard", cellName: "Pesticide Standard", deleteName: /Standard Pesticide Standard/ },
    { defaultKey: "solvent", cellName: "Methanol", deleteName: /Methanol/ },
    { defaultKey: "glassware", cellName: "Volumetric flask", deleteName: /Volumetric flask/ },
  ])("hides the $defaultKey delete button for Lab Inventory without admin", async ({ defaultKey, cellName, deleteName }) => {
    authMock.user = {
      email: "tester@example.com",
      name: "Tester",
      role: "lab-inventory",
      roles: ["lab-inventory", "lab-analyze"],
    };
    renderStock(defaultKey);

    expect(await screen.findByRole("cell", { name: cellName })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: deleteName })).not.toBeInTheDocument();
  });

  it("does not show the solvent receive action button", async () => {
    renderStock("solvent");

    const row = (await screen.findByRole("cell", { name: "Methanol" })).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getAllByRole("button")).toHaveLength(2);
    expect(within(row as HTMLTableRowElement).getByRole("button", { name: /ลบสารเคมี Methanol/ })).toBeInTheDocument();
  });

  it("does not allow editing the solvent bottle quantity from the item dialog", async () => {
    renderStock("solvent");

    const row = (await screen.findByRole("cell", { name: "Methanol" })).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLTableRowElement).getAllByRole("button")[0]);

    const dialog = await screen.findByRole("dialog", { name: "แก้ไขสารเคมี" });
    expect(within(dialog).getByLabelText(/ชื่อรายการ/)).toHaveValue("Methanol");
    expect(within(dialog).getByLabelText("ขนาด (ลิตร)")).toHaveValue(2.5);
    expect(within(dialog).getByLabelText("ราคา (บาท)")).toHaveValue(1200);
    expect(within(dialog).queryByLabelText("จำนวนคงเหลือ (ขวด)")).not.toBeInTheDocument();
  });
  it("keeps delete visible for admin even with Lab Inventory assigned", async () => {
    authMock.user = {
      email: "tester@example.com",
      name: "Tester",
      role: "admin",
      roles: ["admin", "lab-inventory"],
    };
    renderStock();

    expect(await screen.findByRole("cell", { name: "Pesticide Standard" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Standard Pesticide Standard/ })).toBeInTheDocument();
  });

  it("opens the detail drawer when clicking a standard row", async () => {
    renderStock();

    fireEvent.click(await screen.findByRole("cell", { name: "Pesticide Standard" }));

    expect(await screen.findByTestId("standard-detail-drawer")).toBeInTheDocument();
  });

  it("opens the detail drawer when double-clicking a standard row", async () => {
    renderStock();

    fireEvent.doubleClick(await screen.findByRole("cell", { name: "Pesticide Standard" }));

    expect(await screen.findByTestId("standard-detail-drawer")).toBeInTheDocument();
  });

  it("opens solvent details when clicking or double-clicking a solvent row", async () => {
    renderStock("solvent");

    fireEvent.click(await screen.findByRole("cell", { name: "Methanol" }));

    const dialog = await screen.findByRole("dialog", { name: "Methanol" });
    expect(within(dialog).getByRole("heading", { name: "Methanol" })).toBeInTheDocument();
    expect(within(dialog).getByText("HPLC grade")).toBeInTheDocument();
  });

  it("does not show the solvent receive button in the detail drawer", async () => {
    renderStock("solvent");

    fireEvent.click(await screen.findByRole("cell", { name: "Methanol" }));
    const detailDialog = await screen.findByRole("dialog", { name: "Methanol" });

    expect(within(detailDialog).queryByRole("button", { name: /Receive/ })).not.toBeInTheDocument();
    expect(within(detailDialog).getByRole("button", { name: /Edit/ })).toBeInTheDocument();
  });

  it("opens solvent details when double-clicking a solvent row", async () => {
    renderStock("solvent");

    fireEvent.doubleClick(await screen.findByRole("cell", { name: "Methanol" }));

    const dialog = await screen.findByRole("dialog", { name: "Methanol" });
    expect(within(dialog).getByRole("heading", { name: "Methanol" })).toBeInTheDocument();
    expect(within(dialog).getByText("HPLC grade")).toBeInTheDocument();
  });

  it("opens glassware details when clicking a glassware row", async () => {
    renderStock("glassware");

    fireEvent.click(await screen.findByRole("cell", { name: "Volumetric flask" }));

    const dialog = await screen.findByRole("dialog", { name: "Volumetric flask" });
    expect(within(dialog).getByRole("heading", { name: "Volumetric flask" })).toBeInTheDocument();
    expect(within(dialog).getByText("Class A")).toBeInTheDocument();
  });

  it("opens glassware details when double-clicking a glassware row", async () => {
    renderStock("glassware");

    fireEvent.doubleClick(await screen.findByRole("cell", { name: "Volumetric flask" }));

    const dialog = await screen.findByRole("dialog", { name: "Volumetric flask" });
    expect(within(dialog).getByRole("heading", { name: "Volumetric flask" })).toBeInTheDocument();
    expect(within(dialog).getByText("Class A")).toBeInTheDocument();
  });
});
