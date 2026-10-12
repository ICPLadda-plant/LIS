import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/context/ConfirmDialog";
import ReceiveCart from "./ReceiveCart";

const apiMock = vi.hoisted(() => ({
  getStandards: vi.fn(),
  getSolvents: vi.fn(),
  getGlassware: vi.fn(),
  getStandardLabelCodeDefaults: vi.fn(),
  registerStockBarcode: vi.fn(),
  receiveStockUnits: vi.fn(),
  receiveSolvent: vi.fn(),
  receiveGlassware: vi.fn(),
}));
const stockRawLabelPreviewDialogMock = vi.hoisted(() => vi.fn(() => null));
const buildSolventLabelHtmlMock = vi.hoisted(() => vi.fn(async () => "<solvent-label />"));
const stockQrScannerMock = vi.hoisted(() => vi.fn(({
  open,
  scanMode,
  onScanned,
}: {
  open: boolean;
  scanMode?: string;
  onScanned: (value: string) => void;
}) => (open ? (
  <div role="dialog" aria-label="camera barcode scanner">
    <span>{scanMode}</span>
    <button type="button" onClick={() => onScanned("654694")}>mock camera barcode</button>
  </div>
) : null)));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/stockLabel", () => ({
  buildStockLabelHtml: vi.fn(async () => "<label />"),
  buildSolventLabelHtml: buildSolventLabelHtmlMock,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/lis/StockRawLabelPreviewDialog", () => ({ default: stockRawLabelPreviewDialogMock }));
vi.mock("@/components/lis/StockQrScanner", () => ({ default: stockQrScannerMock }));
function renderCart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <ReceiveCart />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

function mockStockLists() {
  apiMock.getStandards.mockResolvedValue([
    { _id: "std1", code: "STD-001", name: "ABAMECTIN", unit: "ml", volume: 0, threshold: 0, frequency: { value: 1, unit: "day" } },
  ]);
  apiMock.getSolvents.mockResolvedValue([]);
  apiMock.getGlassware.mockResolvedValue([]);
}

async function scanReceiveBarcode(value: string) {
  const barcodeInput = await screen.findByRole("textbox", { name: /Barcode/ });
  fireEvent.change(barcodeInput, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
}

async function openReceiveRowEditor(itemName: string) {
  const openedAddDialog = screen.queryByRole("dialog", { name: "กรอกรายละเอียดรับเข้า" });
  if (openedAddDialog) return openedAddDialog;

  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`แก้ไข ${itemName}`) }));
  return screen.findByRole("dialog", { name: "แก้ไขรายการรับเข้า" });
}

async function closeReceiveRowEditor(dialog: HTMLElement) {
  const codeInput = within(dialog).queryByLabelText("Code");
  if (codeInput) await waitFor(() => expect(codeInput).toHaveValue("6901"));
  fireEvent.click(within(dialog).getByRole("button", { name: "เสร็จ" }));
}

describe("ReceiveCart receive flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("lis.stock.receive-cart-draft");
    apiMock.getStandardLabelCodeDefaults.mockResolvedValue({ prefix: "01", buddhistYear: 69, nextBottleNo: 1, codes: ["016901", "016902"] });
    apiMock.registerStockBarcode.mockResolvedValue({ barcode: "654694", category: "standard", itemId: "std1" });
    buildSolventLabelHtmlMock.mockClear();
  });

  it("opens a registration popup for a newly scanned receive barcode", async () => {
    mockStockLists();
    renderCart();

    await scanReceiveBarcode("654694");

    expect(await screen.findByRole("dialog", { name: /Barcode/ })).toBeInTheDocument();
    expect(screen.getByText("654694")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\(0/, hidden: true })).toBeDisabled();
  });

  it("opens the camera scanner and routes camera barcode scans into registration", async () => {
    mockStockLists();
    renderCart();

    fireEvent.click(await screen.findByRole("button", { name: /กล้อง|camera/i }));

    await waitFor(() => expect(stockQrScannerMock.mock.calls.some(([props]) => (
      props.open === true && props.scanMode === "barcode"
    ))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "mock camera barcode" }));

    expect(await screen.findByRole("dialog", { name: /Barcode/ })).toBeInTheDocument();
    expect(screen.getByText("654694")).toBeInTheDocument();
  });

  it("registers a new receive barcode before receiving the selected stock item", async () => {
    mockStockLists();
    apiMock.receiveStockUnits.mockResolvedValue([
      { _id: "unit1", qrId: "u1", itemCode: "STD-001", itemName: "ABAMECTIN", volume: { initial: 100, remaining: 100, unit: "ml" } },
    ]);

    renderCart();

    await scanReceiveBarcode("654694");
    const dialog = await screen.findByRole("dialog", { name: /Barcode/ });
    fireEvent.click(within(dialog).getByRole("combobox"));
    const standardChoices = await screen.findAllByText("Standard");
    fireEvent.click(standardChoices[standardChoices.length - 1]);
    fireEvent.click(await screen.findByText("STD-001 ABAMECTIN"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Barcode/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Barcode/ })).not.toBeInTheDocument());

    const editor = await openReceiveRowEditor("ABAMECTIN");
    fireEvent.click(within(editor).getByRole("button", { name: "primary" }));
    fireEvent.change(within(editor).getByPlaceholderText("required"), { target: { value: "LOT-1" } });
    fireEvent.change(within(editor).getByPlaceholderText("เช่น 99.5"), { target: { value: "99.5" } });
    fireEvent.change(within(editor).getByLabelText("EXP (ทุกขวด)"), { target: { value: "2027-12-31" } });
    await closeReceiveRowEditor(editor);
    fireEvent.click(screen.getByRole("button", { name: /\(1/ }));

    await waitFor(() => expect(apiMock.registerStockBarcode).toHaveBeenCalled());
    expect(apiMock.registerStockBarcode).toHaveBeenCalledWith({ barcode: "654694", category: "standard", itemId: "std1" });
    expect(apiMock.receiveStockUnits).toHaveBeenCalled();
  });

  it("does not offer photo upload or send photo URLs from the bulk receive cart", async () => {
    mockStockLists();
    apiMock.receiveStockUnits.mockResolvedValue([
      { _id: "unit1", qrId: "u1", itemCode: "STD-001", itemName: "ABAMECTIN", volume: { initial: 100, remaining: 100, unit: "ml" } },
    ]);

    renderCart();

    await scanReceiveBarcode("STD-001");
    const editor = await openReceiveRowEditor("ABAMECTIN");
    fireEvent.click(within(editor).getByRole("button", { name: "primary" }));
    fireEvent.change(within(editor).getByPlaceholderText("required"), { target: { value: "LOT-1" } });
    fireEvent.change(within(editor).getByPlaceholderText("เช่น 99.5"), { target: { value: "99.5" } });
    fireEvent.change(within(editor).getByLabelText("EXP (ทุกขวด)"), { target: { value: "2027-12-31" } });
    expect(within(editor).queryByText(/รูปขวด/)).not.toBeInTheDocument();
    await closeReceiveRowEditor(editor);
    fireEvent.click(screen.getByRole("button", { name: /\(1/ }));

    await waitFor(() => expect(apiMock.receiveStockUnits).toHaveBeenCalled());
    expect(apiMock.receiveStockUnits).toHaveBeenCalledWith(
      "std1",
      expect.objectContaining({
        type: "primary",
        unit: "mg",
        purity: "99.5",
        bottles: [
          {
            exp: "2027-12-31",
            labelCode: "016901",
          },
        ],
      }),
    );
    const payload = apiMock.receiveStockUnits.mock.calls[0][1];
    expect(payload.bottles[0]).not.toHaveProperty("photoUrls");
  });

  it("builds one chemical bottle label per received solvent bottle", async () => {
    apiMock.getStandards.mockResolvedValue([]);
    apiMock.getSolvents.mockResolvedValue([
      { _id: "sol1", name: "Methanol", barcodes: [], sizeLiter: 2.5, qty: 0, price: 0, note: "" },
    ]);
    apiMock.getGlassware.mockResolvedValue([]);
    apiMock.receiveSolvent.mockResolvedValue({
      _id: "sol1",
      name: "Methanol",
      qty: 2,
      receivedUnits: [
        {
          _id: "unit-sol-1",
          qrId: "u_sol_1",
          itemType: "solvent",
          itemId: "sol1",
          itemCode: "sol1",
          itemName: "Methanol",
          kind: "sealed",
          lotNo: "B-001",
          lotBottleNo: 1,
          exp: "2027-01-01T00:00:00.000Z",
          receivedDate: "2026-08-19T00:00:00.000Z",
          volume: { initial: 2500, remaining: 2500, unit: "ml" },
          status: "active",
        },
        {
          _id: "unit-sol-2",
          qrId: "u_sol_2",
          itemType: "solvent",
          itemId: "sol1",
          itemCode: "sol1",
          itemName: "Methanol",
          kind: "sealed",
          lotNo: "B-001",
          lotBottleNo: 2,
          exp: "2027-01-01T00:00:00.000Z",
          receivedDate: "2026-08-19T00:00:00.000Z",
          volume: { initial: 2500, remaining: 2500, unit: "ml" },
          status: "active",
        },
      ],
    });

    renderCart();

    await scanReceiveBarcode("Methanol");
    const editor = await openReceiveRowEditor("Methanol");
    expect(within(editor).queryByText(/รูปขวด/)).not.toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText("จำนวน (ขวด)"), { target: { value: "2" } });
    fireEvent.change(within(editor).getByLabelText("ขนาด/ขวด (ลิตร)"), { target: { value: "2.5" } });
    fireEvent.change(within(editor).getByLabelText("ราคา (บาท)"), { target: { value: "1200" } });
    fireEvent.change(within(editor).getByPlaceholderText("required"), { target: { value: "B-001" } });
    fireEvent.change(within(editor).getByLabelText("EXP"), { target: { value: "2027-01-01" } });
    await closeReceiveRowEditor(editor);
    fireEvent.click(screen.getByRole("button", { name: /\(1/ }));

    await waitFor(() => expect(apiMock.receiveSolvent).toHaveBeenCalledWith(
      "sol1",
      expect.objectContaining({
        qty: 2,
        lotNo: "B-001",
        exp: "2027-01-01",
        sizeLiter: 2.5,
        price: 1200,
      }),
    ));
    await waitFor(() => expect(buildSolventLabelHtmlMock).toHaveBeenCalledTimes(2));
    const solventPayload = apiMock.receiveSolvent.mock.calls[0][1];
    expect(solventPayload).not.toHaveProperty("photoUrls");
    expect(buildSolventLabelHtmlMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: "Methanol",
      idForQr: "u_sol_1",
      lotNo: "B-001",
      exp: "2027-01-01T00:00:00.000Z",
      bottleNo: 1,
      receivedDate: "2026-08-19T00:00:00.000Z",
    }));
    expect(buildSolventLabelHtmlMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idForQr: "u_sol_2",
      bottleNo: 2,
    }));
  });
  it("auto-prints labels after receiving from the cart", async () => {
    mockStockLists();
    apiMock.receiveStockUnits.mockResolvedValue([
      { _id: "unit1", qrId: "u1", itemCode: "STD-001", itemName: "ABAMECTIN", volume: { initial: 100, remaining: 100, unit: "ml" } },
    ]);

    renderCart();

    await scanReceiveBarcode("STD-001");
    const editor = await openReceiveRowEditor("ABAMECTIN");
    fireEvent.click(within(editor).getByRole("button", { name: "primary" }));
    fireEvent.change(within(editor).getByPlaceholderText("required"), { target: { value: "LOT-1" } });
    fireEvent.change(within(editor).getByPlaceholderText("เช่น 99.5"), { target: { value: "99.5" } });
    fireEvent.change(within(editor).getByLabelText("EXP (ทุกขวด)"), { target: { value: "2027-12-31" } });
    await closeReceiveRowEditor(editor);
    fireEvent.click(screen.getByRole("button", { name: /\(1/ }));

    await waitFor(() => {
      const latestProps = stockRawLabelPreviewDialogMock.mock.calls.at(-1)?.[0];
      expect(latestProps).toMatchObject({ open: true, labels: ["<label />"], autoPrint: true });
    });
  });
});
