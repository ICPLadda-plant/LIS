import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PrintPreviewDialog from "./PrintPreviewDialog";

const apiMock = vi.hoisted(() => ({
  getPrinterConfigs: vi.fn(),
}));
const printDocumentMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { department: "QC" } }) }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/print", () => ({ printDocument: printDocumentMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderDialog(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.getPrinterConfigs.mockReset();
  printDocumentMock.mockReset();
});

describe("PrintPreviewDialog auto print", () => {
  it("renders document actions in the preview header", async () => {
    apiMock.getPrinterConfigs.mockResolvedValue([]);

    renderDialog(
      <PrintPreviewDialog
        open
        onOpenChange={vi.fn()}
        docType="coa"
        previewOnly
        headerActions={<button type="button">อนุมัติ</button>}
      >
        <div>coa html</div>
      </PrintPreviewDialog>,
    );

    expect(await screen.findByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
  });

  it("defaults to server and auto prints when a matching server printer exists", async () => {
    apiMock.getPrinterConfigs.mockResolvedValue([
      {
        id: "printer-1",
        kind: "sticker",
        label: "Sticker",
        cupsPrinterUrl: "ipp://printer/sticker",
        isDefault: true,
        assignments: [{ department: "QC", docTypes: ["stock-label"], paperSize: "label-65x25" }],
      },
    ]);
    printDocumentMock.mockResolvedValue({ printer: "Sticker", copies: 1 });

    renderDialog(
      <PrintPreviewDialog
        open
        onOpenChange={vi.fn()}
        docType="stock-label"
        autoPrint
        autoPrintKey="receive-job-1"
      >
        <div>stock label html</div>
      </PrintPreviewDialog>,
    );

    expect(await screen.findByRole("button", { name: "เครื่องนี้" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Server/CUPS" })).toBeInTheDocument();
    await waitFor(() => expect(printDocumentMock).toHaveBeenCalledWith(
      "stock-label",
      expect.any(HTMLDivElement),
      expect.objectContaining({
        outputMode: "server",
        printerConfigId: "printer-1",
        paperSize: "label-65x25",
      }),
    ));
  });

  it("falls back to this machine by default when no matching server printer exists", async () => {
    apiMock.getPrinterConfigs.mockResolvedValue([]);
    printDocumentMock.mockResolvedValue({ printer: "เครื่องนี้", copies: 1 });

    renderDialog(
      <PrintPreviewDialog open onOpenChange={vi.fn()} docType="coa" autoPrint autoPrintKey="coa-1">
        <div>coa html</div>
      </PrintPreviewDialog>,
    );

    expect(await screen.findByRole("button", { name: "เครื่องนี้" })).toBeInTheDocument();
    await waitFor(() => expect(printDocumentMock).toHaveBeenCalledWith(
      "coa",
      expect.any(HTMLDivElement),
      expect.objectContaining({ outputMode: "local", printerConfigId: undefined }),
    ));
  });

  it("prints to the logged-in department server printer after choosing Server/CUPS", async () => {
    apiMock.getPrinterConfigs.mockResolvedValue([
      {
        id: "printer-1",
        kind: "sticker",
        label: "Sticker",
        cupsPrinterUrl: "ipp://printer/sticker",
        isDefault: false,
        assignments: [{ department: "QC", docTypes: ["stock-label"], paperSize: "label-65x25" }],
      },
      {
        id: "printer-2",
        kind: "sticker",
        label: "Other Dept",
        cupsPrinterUrl: "ipp://printer/other",
        isDefault: false,
        assignments: [{ department: "ผลิต", docTypes: ["stock-label"], paperSize: "label-100x50" }],
      },
    ]);
    printDocumentMock.mockResolvedValue({ printer: "Sticker", copies: 1 });

    renderDialog(
      <PrintPreviewDialog open onOpenChange={vi.fn()} docType="stock-label">
        <div>stock label html</div>
      </PrintPreviewDialog>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Server/CUPS" }));
    fireEvent.click(screen.getByRole("button", { name: "พิมพ์ผ่าน Server" }));

    await waitFor(() => expect(printDocumentMock).toHaveBeenCalledTimes(1));
    expect(printDocumentMock).toHaveBeenCalledWith(
      "stock-label",
      expect.any(HTMLDivElement),
      expect.objectContaining({
        outputMode: "server",
        printerConfigId: "printer-1",
        paperSize: "label-65x25",
      }),
    );
  });

  it("prints locally after choosing this machine", async () => {
    apiMock.getPrinterConfigs.mockResolvedValue([]);
    printDocumentMock.mockResolvedValue({ printer: "เครื่องนี้", copies: 1 });

    renderDialog(
      <PrintPreviewDialog open onOpenChange={vi.fn()} docType="coa">
        <div>coa html</div>
      </PrintPreviewDialog>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "เครื่องนี้" }));
    fireEvent.click(screen.getByRole("button", { name: "พิมพ์จากเครื่องนี้" }));

    await waitFor(() => expect(printDocumentMock).toHaveBeenCalledWith(
      "coa",
      expect.any(HTMLDivElement),
      expect.objectContaining({ outputMode: "local", printerConfigId: undefined }),
    ));
  });
});
