import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/context/ConfirmDialog";
import StandardRequisitionDialog from "./StandardRequisitionDialog";
import type { StockStandardItem, StockUnitItem } from "@/types/stock";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  getMethods: vi.fn(),
  getStandards: vi.fn(),
  getStockUnits: vi.fn(),
  deductStockUnitMg: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "owner@icpladda.com", name: "สมชาย" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const standard: StockStandardItem = {
  _id: "std1",
  code: "STD-001",
  name: "ABAMECTIN",
  primary: { qty: 1, sizeMg: 250, exp: "2571-05-28", ordered: 0, usesPerBottle: null, pricePerUnit: 0, totalPrice: 0 },
  supplier: { qty: 0, sizeMg: null, exp: "" },
  working: { qty: 0, sizeMg: null, exp: "" },
  usagePerUseMg: null,
  frequency: "",
  storageTemp: "",
  status: "active",
  expiryStatus: "valid",
};

const unit: StockUnitItem = {
  _id: "unit1",
  qrId: "qr-1",
  itemCode: "STD-001",
  itemName: "ABAMECTIN",
  kind: "sealed",
  type: "primary",
  lotNo: "LOT-1",
  labelCode: "026602",
  exp: "2028-05-28T00:00:00.000Z",
  volume: { initial: 250, remaining: 250, unit: "mg" },
  status: "active",
  receivedDate: "2026-01-01T00:00:00.000Z",
};

function renderDialog(machinePrefix: "GC" | "HPLC", standards = [standard], units = [unit]) {
  apiMock.getStandards.mockResolvedValue(standards);
  apiMock.getStockUnits.mockResolvedValue(units);
  apiMock.getMethods.mockResolvedValue([
    {
      _id: "method1",
      code: machinePrefix,
      label: machinePrefix,
      requiresMachine: true,
      machinePrefix,
      defaultTimes: 1,
      order: 1,
      active: true,
      builtIn: false,
    },
  ]);
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/master-items") return { data: { data: [{ item_no: "ITEM-1", common_name: "ABAMECTIN" }] } };
    if (path === "/simple-methods") return { data: { data: [{ itemNo: "ITEM-1", methods: [[machinePrefix]] }] } };
    return { data: { data: [] } };
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <StandardRequisitionDialog initialQrId="qr-1" onClose={vi.fn()} onSaved={vi.fn()} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("StandardRequisitionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["676902", "ุึุตจ/", "๖๗๖๙๐๒"])("ranks bottle identifiers before name matches for %s", async (query) => {
    const choices = [
      { ...standard, _id: "name", code: "OTHER", name: "676902 name" },
      { ...standard, _id: "prefix", code: "PREFIX", name: "Prefix bottle" },
      { ...standard, _id: "exact", code: "EXACT", name: "Exact bottle" },
    ];
    const bottles = choices.map((choice, index) => ({
      ...unit, _id: choice._id, qrId: `qr-${choice._id}`, itemCode: choice.code,
      itemName: choice.name, labelCode: ["111", "6769021", "676902"][index],
    }));
    renderDialog("HPLC", choices, bottles);

    fireEvent.click(await screen.findByRole("combobox"));
    const searchInput = await screen.findByPlaceholderText("ค้นหาชื่อ/code/เลขขวด");
    fireEvent.change(searchInput, { target: { value: query } });
    await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent?.split("1 ขวด")[0])).toEqual([
      "Exact bottle", "Prefix bottle", "676902 name",
    ]));

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent?.split("1 ขวด")[0])).toEqual([
      "676902 name", "Prefix bottle", "Exact bottle",
    ]);
  });

  it.each([
    ["GC", 3],
    ["HPLC", 1],
  ] as const)("locks weight count for %s until Custom is selected", async (machinePrefix, expectedCount) => {
    renderDialog(machinePrefix);

    const dialog = await screen.findByRole("dialog", { name: "เบิก Standard" });
    await within(dialog).findByText("เลขขวด 026602");
    await waitFor(() => expect(within(dialog).getAllByRole("spinbutton")[0]).toHaveDisplayValue(String(expectedCount)));

    const countInput = within(dialog).getAllByRole("spinbutton")[0];
    expect(countInput).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Custom" }));

    const customCountInput = within(dialog).getAllByRole("spinbutton")[0];
    expect(customCountInput).not.toBeDisabled();
    fireEvent.change(customCountInput, { target: { value: "4" } });

    await waitFor(() => expect(within(dialog).getAllByRole("spinbutton")).toHaveLength(5));
  });
});
