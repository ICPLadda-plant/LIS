import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/context/ConfirmDialog";
import ReceiveCart from "./ReceiveCart";

const apiMock = vi.hoisted(() => ({
  getStandards: vi.fn(),
  getSolvents: vi.fn(),
  getGlassware: vi.fn(),
  getStandardLabelCodeDefaults: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("@/components/lis/StockQrScanner", () => ({
  default: () => null,
}));

vi.mock("@/components/lis/StockRawLabelPreviewDialog", () => ({
  default: () => null,
}));

function renderReceiveCart() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <ReceiveCart />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("ReceiveCart Thai copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("lis.stock.receive-cart-draft");
    apiMock.getStandardLabelCodeDefaults.mockResolvedValue({ prefix: "01", buddhistYear: 69, nextBottleNo: 1, codes: ["016901", "016902"] });
    apiMock.getStandards.mockResolvedValue([]);
    apiMock.getSolvents.mockResolvedValue([]);
    apiMock.getGlassware.mockResolvedValue([]);
  });

  it("renders the simplified receive flow copy", () => {
    renderReceiveCart();

    expect(screen.getByRole("heading", { name: "รับเข้า Stock" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เพิ่มแถว/ })).not.toBeInTheDocument();
    expect(screen.getByText("เพิ่มรายการรับเข้า")).toBeInTheDocument();
    expect(screen.getByLabelText("ค้นหา / สแกน Barcode")).toHaveAttribute(
      "placeholder",
      "สแกน Barcode หรือพิมพ์ชื่อ/code แล้วกด Enter",
    );
    expect(screen.getByText("สามารถสแกน Barcode ต่อเนื่องได้เลย")).toBeInTheDocument();
    expect(screen.getByText("รายการที่จะรับเข้า")).toBeInTheDocument();
    expect(screen.getByText("0 รายการ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับเข้าทั้งหมด (0 รายการ)" })).toBeDisabled();
  });

  it("opens a detail popup after adding a scanned stock item", async () => {
    apiMock.getStandards.mockResolvedValue([
      { _id: "std1", code: "STD-001", name: "ABAMECTIN", barcodes: [], primary: {}, supplier: {}, working: {} },
    ]);
    renderReceiveCart();

    fireEvent.change(await screen.findByLabelText("ค้นหา / สแกน Barcode"), { target: { value: "STD-001" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    const detailDialog = await screen.findByRole("dialog", { name: "กรอกรายละเอียดรับเข้า" });
    expect(detailDialog).toBeInTheDocument();
    expect(within(detailDialog).getByLabelText("ปริมาณ (mg)")).toBeInTheDocument();
    fireEvent.click(within(detailDialog).getByRole("button", { name: "เสร็จ" }));
    expect(await screen.findByRole("cell", { name: "ABAMECTIN" })).toBeInTheDocument();
    expect(screen.getByText("1 รายการ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /แก้ไข ABAMECTIN/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ลบ ABAMECTIN/ })).toBeInTheDocument();
  });

  it("keeps the standard Code editable in the receive row", async () => {
    apiMock.getStandards.mockResolvedValue([
      { _id: "std1", code: "STD-001", name: "ABAMECTIN", barcodes: [], primary: {}, supplier: {}, working: {} },
    ]);
    renderReceiveCart();

    fireEvent.change(await screen.findByLabelText("ค้นหา / สแกน Barcode"), { target: { value: "STD-001" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    const detailDialog = await screen.findByRole("dialog", { name: "กรอกรายละเอียดรับเข้า" });
    await waitFor(() => expect(within(detailDialog).getByLabelText("Code")).toHaveValue("6901"));
    fireEvent.click(within(detailDialog).getByRole("button", { name: "เสร็จ" }));

    expect(screen.getByRole("columnheader", { name: "Code" })).toBeInTheDocument();
    const codeInput = await screen.findByLabelText("Code ABAMECTIN");
    expect(codeInput).toHaveValue("6901");
    fireEvent.change(codeInput, { target: { value: "6902" } });
    expect(codeInput).toHaveValue("6902");
  });

  it("shows standard and solvent receive amounts in the row", async () => {
    apiMock.getStandards.mockResolvedValue([
      { _id: "std1", code: "STD-001", name: "ABAMECTIN", barcodes: [], primary: {}, supplier: {}, working: {} },
    ]);
    apiMock.getSolvents.mockResolvedValue([
      { _id: "sol1", name: "Methanol", barcodes: [], sizeLiter: 2.5, price: 1200 },
    ]);
    renderReceiveCart();

    const searchInput = await screen.findByLabelText("ค้นหา / สแกน Barcode");
    fireEvent.change(searchInput, { target: { value: "STD-001" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "กรอกรายละเอียดรับเข้า" })).getByRole("button", { name: "เสร็จ" }));

    fireEvent.change(searchInput, { target: { value: "Methanol" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "กรอกรายละเอียดรับเข้า" })).getByRole("button", { name: "เสร็จ" }));

    expect(screen.getByRole("columnheader", { name: "ปริมาณ" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "100 mg" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2.5 L" })).toBeInTheDocument();
  });

  it("opens grouped stock choices from the barcode search input", async () => {
    apiMock.getStandards.mockResolvedValue([
      { _id: "std1", code: "STD-001", name: "ABAMECTIN", barcodes: [], primary: {}, supplier: {}, working: {} },
      { _id: "std2", code: "STD-002", name: "2,4-D Acid", barcodes: [], primary: {}, supplier: {}, working: {} },
    ]);
    apiMock.getSolvents.mockResolvedValue([
      { _id: "sol1", name: "Methanol", barcodes: [] },
    ]);
    apiMock.getGlassware.mockResolvedValue([
      { _id: "glass1", name: "Beaker", barcodes: [] },
    ]);

    renderReceiveCart();

    fireEvent.focus(await screen.findByLabelText("ค้นหา / สแกน Barcode"));

    expect(await screen.findByRole("button", { name: /Standard\s+2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สารเคมี\s+1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เครื่องแก้ว\s+1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /ABAMECTIN/ })).not.toBeInTheDocument();
  });

  it("filters search choices and adds a clicked item", async () => {
    apiMock.getStandards.mockResolvedValue([
      { _id: "std1", code: "STD-001", name: "ABAMECTIN", barcodes: [], primary: {}, supplier: {}, working: {} },
      { _id: "std2", code: "STD-002", name: "2,4-D Acid", barcodes: [], primary: {}, supplier: {}, working: {} },
    ]);

    renderReceiveCart();

    const searchInput = await screen.findByLabelText("ค้นหา / สแกน Barcode");
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "2" } });
    fireEvent.click(await screen.findByRole("option", { name: /STD-002 2,4-D Acid/ }));

    const detailDialog = await screen.findByRole("dialog", { name: "กรอกรายละเอียดรับเข้า" });
    expect(detailDialog).toBeInTheDocument();
    fireEvent.click(within(detailDialog).getByRole("button", { name: "เสร็จ" }));
    expect(await screen.findByRole("cell", { name: "2,4-D Acid" })).toBeInTheDocument();
    expect(searchInput).toHaveValue("");
    expect(screen.queryByRole("option", { name: /STD-002 2,4-D Acid/ })).not.toBeInTheDocument();
  });

  it("ranks code and barcode matches before names, preserving ties and empty-query order", async () => {
    const choices = [
      { code: "OTHER", name: "67 name only" },
      { code: "XX67", name: "Late contains" },
      { code: "X67", name: "Early contains" },
      { code: "67B", name: "First prefix" },
      { code: "67A", name: "Second prefix" },
      { code: "67", name: "Exact code" },
      { code: "ALIAS", name: "Exact barcode", barcodes: ["67"] },
      { code: "UNRELATED", name: "No match" },
    ];
    apiMock.getStandards.mockResolvedValue(choices.map((choice) => ({
      _id: choice.code, barcodes: [], primary: {}, supplier: {}, working: {}, ...choice,
    })));
    apiMock.getSolvents.mockResolvedValue([{ _id: "chemical", name: "Chemical alias", barcodes: ["67"] }]);
    renderReceiveCart();

    const searchInput = await screen.findByLabelText("ค้นหา / สแกน Barcode");
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "67" } });

    await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "67 Exact code", "ALIAS Exact barcode", "Chemical alias", "67B First prefix", "67A Second prefix",
      "X67 Early contains", "XX67 Late contains", "OTHER 67 name only",
    ]));

    fireEvent.change(searchInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Standard\s+8/ }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      choices.map((choice) => `${choice.code} ${choice.name}`),
    );
  });

  it("ranks barcode-registration choices without widening their label-only filter", async () => {
    apiMock.getStandards.mockResolvedValue([
      { _id: "name", code: "OTHER", name: "67 name", primary: {}, supplier: {}, working: {} },
      { _id: "prefix", code: "670", name: "Prefix", primary: {}, supplier: {}, working: {} },
      { _id: "exact", code: "67", name: "Exact", primary: {}, supplier: {}, working: {} },
      { _id: "barcode", code: "BARCODE", name: "Alias only", barcodes: ["67"], primary: {}, supplier: {}, working: {} },
    ]);
    apiMock.getSolvents.mockResolvedValue([{ _id: "chemical", name: "67", barcodes: [] }]);
    renderReceiveCart();
    const scanInput = await screen.findByLabelText("ค้นหา / สแกน Barcode");
    fireEvent.change(scanInput, { target: { value: "NEW-BARCODE" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox"));
    const searchInput = await screen.findByPlaceholderText("ค้นหา code หรือชื่อ");
    fireEvent.change(searchInput, { target: { value: "67" } });
    await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "67 Exact", "67", "670 Prefix", "OTHER 67 name",
    ]));
    expect(screen.queryByRole("option", { name: /Alias only/ })).not.toBeInTheDocument();
  });

  it("does not contain known Thai mojibake sequences", () => {
    const source = readFileSync(resolve("src/components/lis/stock/ReceiveCart.tsx"), "utf8");

    expect(source).not.toMatch(/เธ|เน[€-]|โ€”|ยท/);
  });
});
