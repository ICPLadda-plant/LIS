import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoaDocument, CoaSourceResult } from "@/types/coa.types";
import CoaCreateDialog from "./CoaCreateDialog";

const mocks = vi.hoisted(() => ({ eligible: vi.fn(), source: vi.fn(), createManual: vi.fn(), created: vi.fn(), openChange: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { getEligibleCoaPetitions: mocks.eligible, getCoaSourceData: mocks.source, createManualCoaDocument: mocks.createManual } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "QC Staff", email: "qc@example.com", role: "qc-staff", roles: ["qc-staff"] } }) }));

const request = {
  _id: "request-1", petitionId: "p1", selectedItemSeqs: [1], status: "requested", revision: 0,
  sampleSnapshots: [{ itemSeq: 1, commonName: "Glyphosate 48% SL" }], resultSnapshots: [],
} as CoaDocument;
const erpRequest = {
  _id: "external-coa-request-SO1-10000", petitionId: "external-coa-request-SO1-10000", selectedItemSeqs: [10000], status: "requested", revision: 0,
  petitionNoSnapshot: "SO1", customerSnapshot: { name: "Customer ERP" },
  sampleSnapshots: [{ itemSeq: 10000, sampleName: "Trade ERP", commonName: "Glyphosate 48% SL" }], resultSnapshots: [],
  externalCoaRequest: { saleOrderNo: "SO1", line: 10000, itemNo: "FC-1", appearance: "เม็ดยาสีแดง" },
} as CoaDocument;
const resultOptions: CoaSourceResult[] = [
  { itemSeq: 1, kind: "ai", key: "ai", label: "%AI / ชุดที่ 1", result: "48.1%" },
  { itemSeq: 1, kind: "appearance", key: "physical", label: "กายภาพ / ชุดที่ 1", result: "ของเหลวใส", suggestedEnglish: "Clear liquid" },
  { itemSeq: 1, kind: "density", key: "density", label: "Density / ชุดที่ 1", result: "1.120" },
  { itemSeq: 1, kind: "result", key: "ph", label: "pH / ชุดที่ 1", testItem: "pH", result: "7.0" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eligible.mockResolvedValue({ items: [{ _id: "p1", petitionNo: "P-1", items: [{ seq: 1, sampleName: "Trade A", commonName: "Glyphosate 48% SL", batchNo: "B-1", productionDate: "2026-09-01" }] }] });
  mocks.source.mockResolvedValue({ results: resultOptions, customerSnapshot: { name: "Requester", company: "ICP" } });
  mocks.createManual.mockResolvedValue({ ...request, _id: "coa-1", status: "draft" });
});

function renderDialog(currentRequest: CoaDocument = request) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<CoaCreateDialog open request={currentRequest} onCreated={mocks.created} onOpenChange={mocks.openChange} />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe("CoaCreateDialog", () => {
  it("prefills fixed COA fields from Lab and saves edited values", async () => {
    renderDialog();
    expect(await screen.findByLabelText("% AI *")).toHaveValue("48.10%");
    expect(screen.getByLabelText("เกณฑ์ความคลาดเคลื่อน")).toHaveValue("48% ± 2.40");
    expect(screen.getByLabelText("Appearance")).toHaveValue("Clear liquid");
    expect(screen.getByLabelText("Density at 30°C (g/cm³)")).toHaveValue("1.120");
    expect(screen.getByLabelText("Batch *")).toHaveValue("B-1");
    expect(screen.getByLabelText("MANUFACTURING DATE *")).toHaveValue("2026-09-01");
    expect(screen.queryByLabelText("รายการทดสอบ *")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เพิ่มผล" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Batch *"), { target: { value: "B-2" } });
    fireEvent.change(screen.getByLabelText("% AI *"), { target: { value: "48.3" } });
    fireEvent.change(screen.getByLabelText("Date of analysis"), { target: { value: "2026-09-05" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างร่าง COA" }));
    await waitFor(() => expect(mocks.created).toHaveBeenCalledWith(expect.objectContaining({ _id: "coa-1" })));
    expect(mocks.createManual).toHaveBeenCalledWith(expect.objectContaining({
      petitionId: "p1",
      selectedItemSeqs: [1],
      customerSnapshot: { name: "Requester", company: "ICP" },
      sampleSnapshots: [expect.objectContaining({ itemSeq: 1, sampleName: "Trade A", batchNo: "B-2", productionDate: "2026-09-01" })],
      resultSnapshots: [
        { itemSeq: 1, testItem: "Appearance", result: "Conform", criteria: "Clear liquid" },
        { itemSeq: 1, testItem: "%AI content", result: "48.30%", criteria: "48% ± 2.40", unit: "%" },
        { itemSeq: 1, testItem: "Density at 30°C (g/cm³)", result: "1.120", unit: "g/cm³" },
        { itemSeq: 1, testItem: "Date of analysis", result: "2026-09-05" },
      ],
      externalCoaRequest: undefined,
    }));
    expect(mocks.openChange).toHaveBeenCalledWith(false);
  });

  it("keeps the form when saving fails and blocks create without %AI", async () => {
    mocks.createManual.mockRejectedValueOnce(new Error("บันทึกไม่สำเร็จ"));
    renderDialog();
    fireEvent.change(await screen.findByLabelText("% AI *"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "สร้างร่าง COA" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("% AI *"), { target: { value: "47.9" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างร่าง COA" }));
    expect(await screen.findByText("บันทึกไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByLabelText("% AI *")).toHaveValue("47.9");
    expect(mocks.openChange).not.toHaveBeenCalled();
  });

  it("leaves fields empty for manual entry when the Lab has no values and retries a failed load", async () => {
    mocks.source.mockRejectedValueOnce(new Error("โหลดผลไม่สำเร็จ"));
    mocks.source.mockResolvedValue({ results: [] });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "โหลดผลอีกครั้ง" }));
    expect(await screen.findByText(/ไม่พบค่าพารามิเตอร์จากผล Lab/)).toBeInTheDocument();
    expect(screen.getByLabelText("% AI *")).toHaveValue("");
    expect(screen.getByLabelText("เกณฑ์ความคลาดเคลื่อน")).toHaveValue("48% ± 2.40");
    expect(screen.getByRole("button", { name: "สร้างร่าง COA" })).toBeDisabled();
  });

  it("matches an ERP request to a petition by common name and keeps ERP names", async () => {
    mocks.eligible.mockResolvedValueOnce({ items: [{ _id: "p1", petitionNo: "P-1", items: [{ seq: 1, sampleName: "Trade A", commonName: "glyphosate 48% sl", batchNo: "B-1", productionDate: "2026-09-01" }] }] });
    renderDialog(erpRequest);
    expect(await screen.findByText(/จับคู่กับคำร้อง P-1/)).toBeInTheDocument();
    expect(await screen.findByLabelText("ชื่อการค้า *")).toHaveValue("Trade ERP");
    expect(await screen.findByDisplayValue("48.10%")).toBeInTheDocument();
    expect(screen.getByLabelText("Appearance")).toHaveValue("เม็ดยาสีแดง");
    fireEvent.click(screen.getByRole("button", { name: "สร้างร่าง COA" }));
    await waitFor(() => expect(mocks.createManual).toHaveBeenCalled());
    expect(mocks.createManual).toHaveBeenCalledWith(expect.objectContaining({
      petitionId: "p1",
      customerSnapshot: { name: "Customer ERP", company: "ICP" },
      externalCoaRequest: { saleOrderNo: "SO1", line: 10000, itemNo: "FC-1" },
      sampleSnapshots: [expect.objectContaining({ sampleName: "Trade ERP", batchNo: "B-1" })],
    }));
  });

  it("lets an unmatched ERP request be filled manually", async () => {
    mocks.eligible.mockResolvedValueOnce({ items: [] });
    mocks.createManual.mockResolvedValueOnce({ ...erpRequest, _id: "coa-erp", status: "draft" });
    renderDialog(erpRequest);
    expect(await screen.findByText(/ยังไม่พบคำร้องที่ตรงกัน/)).toBeInTheDocument();
    expect(screen.getByLabelText("ชื่อสามัญ *")).toHaveValue("Glyphosate 48% SL");
    expect(screen.getByLabelText("Appearance")).toHaveValue("เม็ดยาสีแดง");
    expect(screen.getByLabelText("เกณฑ์ความคลาดเคลื่อน")).toHaveValue("48% ± 2.40");
    const createButton = screen.getByRole("button", { name: "สร้างร่าง COA" });
    expect(createButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Batch *"), { target: { value: "B-9" } });
    fireEvent.change(screen.getByLabelText("MANUFACTURING DATE *"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("% AI *"), { target: { value: "48.1" } });
    fireEvent.click(createButton);
    await waitFor(() => expect(mocks.createManual).toHaveBeenCalled());
    expect(mocks.createManual).toHaveBeenCalledWith(expect.objectContaining({
      petitionId: undefined,
      selectedItemSeqs: [10000],
      customerSnapshot: { name: "Customer ERP" },
      sampleSnapshots: [expect.objectContaining({ sampleName: "Trade ERP", batchNo: "B-9", productionDate: "2026-09-01" })],
      resultSnapshots: [
        { itemSeq: 10000, testItem: "Appearance", result: "Conform", criteria: "เม็ดยาสีแดง" },
        { itemSeq: 10000, testItem: "%AI content", result: "48.10%", criteria: "48% ± 2.40", unit: "%" },
      ],
      externalCoaRequest: { saleOrderNo: "SO1", line: 10000, itemNo: "FC-1" },
    }));
  });

  it("prefills every ERP Batch that shares the Lot Description production date", async () => {
    mocks.eligible.mockResolvedValueOnce({ items: [] });
    renderDialog({
      ...erpRequest,
      sampleSnapshots: ['080', '081', '082'].map((batchNo) => ({
        itemSeq: 10000, sampleName: 'ช้างมาร์กี้', commonName: 'Glyphosate 48% SL',
        batchNo, lotNo: `26S-GLY48-${batchNo}-111169`, productionDate: '2026-11-11',
      })),
    });

    expect(await screen.findByLabelText("Batch *")).toHaveValue("080, 081, 082");
    expect(screen.getByLabelText("MANUFACTURING DATE *")).toHaveValue("2026-11-11");
  });
});
