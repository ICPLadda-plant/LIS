import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { ConfirmProvider } from "@/context/ConfirmDialog";
import StockDeduction from "../StockDeduction";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  getMethods: vi.fn(),
  getSolvents: vi.fn(),
  getStandards: vi.fn(),
  getStockTransactions: vi.fn(),
  getStockUnit: vi.fn(),
  getStockUnits: vi.fn(),
  getPendingStockDeductions: vi.fn(),
  deductStockUnitMg: vi.fn(),
  createChemicalRequisition: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const readStockLabelCodeFromImageMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/aiApi", () => ({ readStockLabelCodeFromImage: readStockLabelCodeFromImageMock }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "qa@example.com", name: "QA Tester" } }),
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

vi.mock("@/components/lis/StockQrScanner", () => ({
  default: ({ open, onDecoded, onScanned, onCaptureImage }: {
    open: boolean;
    onDecoded?: (result: { raw: string; value: string; scanMode: "qr" }) => void;
    onScanned: (qrId: string) => void;
    onCaptureImage?: (imageDataUrl: string) => void | Promise<void>;
  }) => (
    open ? (
      <div>
        <button
          type="button"
          onClick={() => {
            onDecoded?.({ raw: "https://app-plant.icpladda.com/LIS/stock/view?qrId=u_scan", value: "u_scan", scanMode: "qr" });
            onScanned("u_scan");
          }}
        >
          mock scan
        </button>
        {onCaptureImage ? (
          <button type="button" onClick={() => onCaptureImage("data:image/jpeg;base64,ocr-frame")}>mock OCR capture</button>
        ) : null}
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
    defaultKey: "in-use",
  }),
}));

vi.mock("@/components/lis/stock/StandardsInUseTable", () => ({
  default: () => <div>in-use-table</div>,
}));

function stockUnit(overrides: Record<string, unknown> = {}) {
  return {
    _id: "unit-1",
    qrId: "u_scan",
    itemCode: "1",
    itemName: "2,4-D Acid",
    kind: "sealed",
    type: "primary",
    lotNo: "123",
    exp: "2099-08-30T00:00:00.000Z",
    volume: { initial: 100, remaining: 100, unit: "mg" },
    status: "active",
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderPage(initialEntry = "/stock-deduction") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <LocationProbe />
          <StockDeduction />
        </ConfirmProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function openCameraScanner() {
  fireEvent.click(screen.getByRole("button", { name: /สแกน QR ข้างขวด/ }));
}

function scanWithHardwareKeyboard(raw: string) {
  for (const key of raw) {
    fireEvent.keyDown(window, { key });
  }
  fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
}

describe("StockDeduction scan form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getStockTransactions.mockResolvedValue([]);
    apiMock.getSolvents.mockResolvedValue([]);
    apiMock.getStandards.mockResolvedValue([
      { _id: "std-1", code: "1", name: "2,4-D Acid" },
    ]);
    apiMock.getStockUnit.mockResolvedValue(stockUnit());
    apiMock.getStockUnits.mockResolvedValue([stockUnit()]);
    apiMock.getPendingStockDeductions.mockResolvedValue([]);
    apiMock.createChemicalRequisition.mockResolvedValue({});
    readStockLabelCodeFromImageMock.mockResolvedValue({ labelCode: "", candidates: [], rawText: "" });
    apiMock.getMethods.mockResolvedValue([
      { code: "GC-001", requiresMachine: true, machinePrefix: "GC" },
    ]);
    apiMock.get.mockImplementation((path: string) => {
      if (path === "/master-items") return Promise.resolve({ data: { data: [{ itemNo: "A1", commonName: "2,4-D Acid" }] } });
      if (path === "/simple-methods") return Promise.resolve({ data: { data: [{ itemNo: "A1", methods: [["GC-001"]] }] } });
      return Promise.resolve({ data: { data: [] } });
    });
  });

  it("keeps the standard deduction form open after scanning a bottle QR", async () => {
    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(screen.queryByText("ค่าที่ scanner อ่านได้ล่าสุด")).not.toBeInTheDocument();
    expect(await screen.findByText("2,4-D Acid (1)")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /GC\s*\(3\)/ })).toBeInTheDocument();
    expect(screen.getByText(/Lot 123 · เหลือ 100 mg/)).toBeInTheDocument();
  });

  it("keeps the scanned standard bottle selected after the unit list refreshes", async () => {
    let resolveUnits: (units: ReturnType<typeof stockUnit>[]) => void = () => undefined;
    const unitsPromise = new Promise<ReturnType<typeof stockUnit>[]>((resolve) => {
      resolveUnits = resolve;
    });
    const scannedUnit = stockUnit({
      qrId: "u_scan",
      type: "working",
      lotNo: "SCAN",
      labelCode: "026602",
      exp: "2030-01-01T00:00:00.000Z",
    });
    const refreshedUnit = stockUnit({
      _id: "unit-refreshed",
      qrId: "u_refreshed",
      type: "working",
      lotNo: "REFRESH",
      labelCode: "999999",
      exp: "2031-01-01T00:00:00.000Z",
    });
    apiMock.getStockUnit.mockResolvedValue(scannedUnit);
    apiMock.getStockUnits.mockReturnValue(unitsPromise);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /เลขขวด 026602/ })).toBeChecked();

    resolveUnits([refreshedUnit]);

    expect(await screen.findByText("เลขขวด 999999")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /เลขขวด 026602/ })).toBeChecked();
  });

  it("does not show previous pending deduction close-out fields in the standard form", async () => {
    apiMock.getPendingStockDeductions.mockResolvedValue([
      {
        _id: "tx-pending-standard",
        itemType: "standard",
        itemId: "std-1",
        itemCode: "1",
        itemName: "2,4-D Acid",
        createdAt: "2026-08-21T10:00:00.000Z",
      },
    ]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(screen.queryByText("มีรายการเบิกก่อนหน้ายังไม่ได้แจ้งหมด/ปัญหา")).not.toBeInTheDocument();
    expect(apiMock.getPendingStockDeductions).not.toHaveBeenCalled();
  });

  it("opens the chemical form when scanning a solvent bottle QR", async () => {
    const solventUnit = stockUnit({
      _id: "unit-solvent-1",
      qrId: "u_scan",
      itemType: "solvent",
      itemId: "sol1",
      itemCode: "sol1",
      itemName: "Methanol",
      lotNo: "B-001",
      volume: { initial: 2500, remaining: 2500, unit: "ml" },
      status: "active",
    });
    apiMock.getStockUnit.mockResolvedValue(solventUnit);
    apiMock.getSolvents.mockResolvedValue([{ _id: "sol1", name: "Methanol", qty: 2 }]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    expect(await screen.findByRole("heading", { name: "เบิกสารเคมี" })).toBeInTheDocument();
    expect(await screen.findByText("Methanol (คงเหลือ 2)")).toBeInTheDocument();
  });

  it("allows chemical requisition without closing a previous pending deduction", async () => {
    const solventUnit = stockUnit({
      _id: "unit-solvent-1",
      qrId: "u_scan",
      itemType: "solvent",
      itemId: "sol1",
      itemCode: "sol1",
      itemName: "Methanol",
      lotNo: "B-001",
      volume: { initial: 2500, remaining: 2500, unit: "ml" },
      status: "active",
    });
    apiMock.getStockUnit.mockResolvedValue(solventUnit);
    apiMock.getSolvents.mockResolvedValue([{ _id: "sol1", name: "Methanol", qty: 2 }]);
    apiMock.getPendingStockDeductions.mockResolvedValue([
      {
        _id: "tx-pending",
        itemType: "solvent",
        itemId: "sol1",
        itemName: "Methanol",
        createdAt: "2026-08-21T10:00:00.000Z",
      },
    ]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    expect(await screen.findByRole("heading", { name: "เบิกสารเคมี" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GC 7890A" }));

    expect(screen.queryByText("มีรายการเบิกก่อนหน้ายังไม่ได้แจ้งหมด/ปัญหา")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^เบิก$/ })).toBeEnabled();
    expect(apiMock.getPendingStockDeductions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^เบิก$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() => expect(apiMock.createChemicalRequisition).toHaveBeenCalledWith(expect.objectContaining({
      instrumentId: "LD-003",
      solventId: "sol1",
      solventUnitQrId: "u_scan",
      qty: 1,
    })));
  });

  it("opens scanner results without writing qrId into the URL", async () => {
    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/stock-deduction");
    expect(screen.getByTestId("location")).not.toHaveTextContent("qrId=");
    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
  });

  it("still opens the standard form from a direct qrId URL", async () => {
    renderPage("/stock-deduction?qrId=u_scan");

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(await screen.findByText("2,4-D Acid (1)")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/stock-deduction");
    expect(screen.getByTestId("location")).not.toHaveTextContent("qrId=");
  });

  it("shows an expiry popup instead of opening the form for an expired scanned bottle", async () => {
    const expiredUnit = stockUnit({ exp: "2026-08-20T00:00:00.000Z" });
    apiMock.getStockUnit.mockResolvedValue(expiredUnit);
    apiMock.getStockUnits.mockResolvedValue([expiredUnit]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("ขวดนี้หมดอายุแล้วเมื่อ 20/08/2026"));
    expect(screen.queryByRole("heading", { name: "เบิก Standard" })).not.toBeInTheDocument();
  });

  it("shows an expiry popup when the scanned bottle already has an expired deduction resolution", async () => {
    apiMock.getStockTransactions.mockImplementation((params?: { qrId?: string }) => {
      if (params?.qrId === "u_scan") {
        return Promise.resolve([
          {
            _id: "tx-expired",
            itemType: "standard",
            itemId: "std-1",
            action: "deduct",
            qrId: "u_scan",
            createdAt: "2026-08-18T10:00:00.000Z",
            deductionResolution: { reason: "expired", resolvedAt: "2026-08-19T00:00:00.000Z" },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("ขวดนี้หมดอายุแล้วเมื่อ 19/08/2026"));
    expect(screen.queryByRole("heading", { name: "เบิก Standard" })).not.toBeInTheDocument();
  });

  it("shows an empty popup instead of opening the form for an empty scanned bottle", async () => {
    const emptyUnit = stockUnit({
      status: "empty",
      volume: { initial: 100, remaining: 0, unit: "mg" },
      updatedAt: "2026-08-21T10:00:00.000Z",
    });
    apiMock.getStockUnit.mockResolvedValue(emptyUnit);
    apiMock.getStockUnits.mockResolvedValue([emptyUnit]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("ขวดนี้หมดแล้วเมื่อ 21/08/2026"));
    expect(screen.queryByRole("heading", { name: "เบิก Standard" })).not.toBeInTheDocument();
  });

  it("shows an ineffective popup instead of opening the form for a discarded scanned bottle", async () => {
    const ineffectiveUnit = stockUnit({ status: "discarded", discardReason: "ไม่มีประสิทธิภาพ" });
    apiMock.getStockUnit.mockResolvedValue(ineffectiveUnit);
    apiMock.getStockUnits.mockResolvedValue([ineffectiveUnit]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("ขวดนี้ไม่มีประสิทธิภาพแล้วไม่ควรใช้งาน"));
    expect(screen.queryByRole("heading", { name: "เบิก Standard" })).not.toBeInTheDocument();
  });

  it("opens the standard deduction form again when scanning the same bottle QR", async () => {
    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));
    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("heading", { name: "เบิก Standard" })).not.toBeInTheDocument();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock scan" }));

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
  });

  it("opens the camera scanner directly without a source chooser", () => {
    renderPage();

    openCameraScanner();

    expect(screen.queryByRole("heading", { name: "เลือกวิธีสแกน QR ข้างขวด" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เปิดกล้อง" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ใช้เครื่อง scanner" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "mock scan" })).toBeInTheDocument();
  });

  it("opens the standard deduction form from hardware scanner keyboard input without pressing scan first", async () => {
    renderPage();

    scanWithHardwareKeyboard("https://app-plant.icpladda.com/LIS/stock-deduction?qrId=u_scan");

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(screen.queryByText("ค่าที่ scanner อ่านได้ล่าสุด")).not.toBeInTheDocument();
  });

  it("opens the standard deduction form from an OCR label code captured by camera", async () => {
    const ocrUnit = stockUnit({ qrId: "u_ocr", labelCode: "1016801" });
    readStockLabelCodeFromImageMock.mockResolvedValue({ labelCode: "1016801", candidates: ["1016801"], rawText: "1016801" });
    apiMock.getStockUnit.mockImplementation((qrId: string) => Promise.resolve(qrId === "u_ocr" ? ocrUnit : stockUnit()));
    apiMock.getStockUnits.mockResolvedValue([ocrUnit]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock OCR capture" }));

    await waitFor(() => expect(readStockLabelCodeFromImageMock).toHaveBeenCalledWith("data:image/jpeg;base64,ocr-frame"));
    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(screen.queryByText("ค่าที่ scanner อ่านได้ล่าสุด")).not.toBeInTheDocument();
  });

  it("searches OCR label codes directly with the same source used by the picker", async () => {
    const labelledUnit = stockUnit({ qrId: "u_labelled", labelCode: "026601" });
    readStockLabelCodeFromImageMock.mockResolvedValue({ labelCode: "026601", candidates: ["026601"], rawText: "026601" });
    apiMock.getStockUnit.mockImplementation((qrId: string) => Promise.resolve(qrId === "u_labelled" ? labelledUnit : stockUnit()));
    apiMock.getStockUnits.mockImplementation((params?: { labelCode?: string }) => Promise.resolve(params?.labelCode === "026601" ? [labelledUnit] : []));

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock OCR capture" }));

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(apiMock.getStockUnits).toHaveBeenCalledWith({ labelCode: "026601" });
  });

  it("matches OCR against the same displayed Code used by the standard picker", async () => {
    const displayCodeUnit = stockUnit({
      qrId: "u_display_code",
      itemCode: "2",
      itemName: "2,4-D dimethyl ammonium",
      labelCode: "",
      labelRunNo: 1,
      labelRunYear: 2023,
    });
    readStockLabelCodeFromImageMock.mockResolvedValue({ labelCode: "026601", candidates: ["026601"], rawText: "026601" });
    apiMock.getStandards.mockResolvedValue([{ _id: "std-2", code: "2", name: "2,4-D dimethyl ammonium" }]);
    apiMock.getStockUnit.mockImplementation((qrId: string) => Promise.resolve(qrId === "u_display_code" ? displayCodeUnit : stockUnit()));
    apiMock.getStockUnits.mockResolvedValue([displayCodeUnit]);

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock OCR capture" }));

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /เลขขวด 026601/ })).toBeChecked();
  });

  it("falls back to the standard picker list when direct OCR Code lookup returns no units", async () => {
    const displayCodeUnit = stockUnit({
      qrId: "u_picker_fallback",
      itemCode: "2",
      itemName: "2,4-D dimethyl ammonium",
      labelCode: "",
      labelRunNo: 1,
      labelRunYear: 2023,
    });
    readStockLabelCodeFromImageMock.mockResolvedValue({ labelCode: "026601", candidates: ["026601"], rawText: "026601" });
    apiMock.getStandards.mockResolvedValue([{ _id: "std-2", code: "2", name: "2,4-D dimethyl ammonium" }]);
    apiMock.getStockUnit.mockImplementation((qrId: string) => Promise.resolve(qrId === "u_picker_fallback" ? displayCodeUnit : stockUnit()));
    apiMock.getStockUnits.mockImplementation((params?: { labelCode?: string }) => {
      if (params?.labelCode === "026601") return Promise.resolve([]);
      if (!params) return Promise.resolve([displayCodeUnit]);
      return Promise.resolve([]);
    });

    renderPage();

    openCameraScanner();
    fireEvent.click(screen.getByRole("button", { name: "mock OCR capture" }));

    expect(await screen.findByRole("heading", { name: "เบิก Standard" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /เลขขวด 026601/ })).toBeChecked();
  });
});
