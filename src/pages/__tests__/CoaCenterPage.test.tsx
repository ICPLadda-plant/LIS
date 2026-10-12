import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import CoaCenterPage from "../CoaCenterPage";
import type { CoaDocument } from "@/types/coa.types";

vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      name: "QC Head User",
      email: "qc-head@example.com",
      role: "qc-head",
      roles: ["qc-head"],
      permissions: ["coa.approve"],
    },
  }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    getCoaDocuments: vi.fn().mockResolvedValue({
      items: [
        {
          _id: "c1",
          coaNo: "00012026",
          coaYear: new Date().getFullYear(),
          revision: 0,
          status: "draft",
          petitionId: "p1",
          petitionNoSnapshot: "P-2608-0001",
          customerSnapshot: { name: "Customer A" },
          selectedItemSeqs: [1],
          sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade A", commonName: "Common A", batchNo: "B-001", lotNo: "L-001", productionDate: "2026-08-01" }],
          resultSnapshots: [],
          print: { printCount: 0 },
          createdAt: new Date().toISOString(),
        },
        {
          _id: "c2",
          coaNo: "00022026",
          coaYear: new Date().getFullYear(),
          revision: 1,
          status: "pendingApproval",
          petitionId: "p2",
          petitionNoSnapshot: "P-2608-0002",
          sourceCoaId: "c2-source",
          customerSnapshot: { company: "Customer B" },
          selectedItemSeqs: [1],
          sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade B", commonName: "Common B", batchNo: "B-002", productionDate: "2026-07-30" }],
          resultSnapshots: [],
          print: { printCount: 0 },
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          _id: "c3",
          coaNo: "00012025",
          coaYear: new Date().getFullYear() - 1,
          revision: 0,
          status: "approved",
          petitionId: "p3",
          petitionNoSnapshot: "P-2508-0001",
          customerSnapshot: { name: "Customer C" },
          selectedItemSeqs: [1],
          sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade C", commonName: "Common C", batchNo: "B-003", productionDate: "2025-08-01" }],
          resultSnapshots: [],
          print: { printCount: 0 },
          createdAt: new Date(new Date().getFullYear() - 1, 7, 1).toISOString(),
        },
        {
          _id: "c4",
          coaNo: "00032026",
          coaYear: new Date().getFullYear(),
          revision: 0,
          status: "approved",
          petitionId: "p4",
          petitionNoSnapshot: "P-2608-0003",
          customerSnapshot: { name: "Customer D" },
          selectedItemSeqs: [1],
          sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade D", commonName: "GLYPHOSATE 48% SL", batchNo: "B-004", productionDate: "2026-08-01" }],
          resultSnapshots: [{ itemSeq: 1, testItem: "%AI content (W/V)", result: "47.9%" }],
          print: { printCount: 0 },
          createdAt: new Date().toISOString(),
        },
        {
          _id: "c5",
          coaNo: null,
          coaYear: new Date().getFullYear(),
          revision: 0,
          status: "requested",
          petitionId: "p5",
          petitionNoSnapshot: "P-2608-0004",
          customerSnapshot: { name: "Customer E" },
          selectedItemSeqs: [1],
          sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade E", commonName: "Common A", batchNo: "B-001", productionDate: "2026-08-01" }],
          resultSnapshots: [],
          print: { printCount: 0 },
          createdAt: new Date().toISOString(),
        },
        {
          _id: "c-correction",
          coaNo: "00062026",
          coaYear: new Date().getFullYear(),
          revision: 0,
          status: "draft",
          petitionId: "p6",
          petitionNoSnapshot: "P-2608-0005",
          customerSnapshot: { name: "Customer F" },
          selectedItemSeqs: [1],
          sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade F", commonName: "Common F", batchNo: "B-006", lotNo: "L-006", productionDate: "2026-08-02" }],
          resultSnapshots: [],
          approval: { rejectedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), rejectReason: "แก้ไข Lot ใหม่" },
          print: { printCount: 0 },
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      ],
    }),
    getEligibleCoaPetitions: vi.fn().mockResolvedValue({ items: [] }),
    getCoaSourceData: vi.fn().mockResolvedValue({ results: [] }),
    getErpCoaAutofill: vi.fn().mockResolvedValue({
      sample: { itemSeq: 10000 }, results: [], match: null, candidates: [], stockCandidates: [], mfCandidates: [],
      form: { template: "standard", aiCriteria: "", needsDensity: false }, warnings: [],
      dataSources: { erp: true, stock: false, mf: false, lab: false, density: false },
    }),
    getCoaLabAiByBatch: vi.fn().mockImplementation(({ batchNo, commonName }: { batchNo: string; commonName: string }) => Promise.resolve({
      batchNo, commonName, ai: null, analysisDate: "", match: null,
    })),
    createCoaDocument: vi.fn().mockResolvedValue({}),
    createManualCoaDocument: vi.fn().mockResolvedValue({}),
    createErpManualCoaDocument: vi.fn().mockResolvedValue({}),
    updateCoaDocument: vi.fn().mockResolvedValue({}),
    reviseCoaDocument: vi.fn().mockResolvedValue({ _id: "c6" }),
    submitCoaDocument: vi.fn().mockResolvedValue({}),
    approveCoaDocument: vi.fn().mockResolvedValue({}),
    rejectCoaDocument: vi.fn().mockResolvedValue({}),
    getPrinterConfigs: vi.fn().mockResolvedValue([]),
  },
}));

function renderPage(initialEntry = "/coa") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <CoaCenterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CoaCenterPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a created draft to the in-progress tab and clears the request search", async () => {
    vi.mocked(api.getEligibleCoaPetitions).mockResolvedValueOnce({ items: [{
      _id: "p5", petitionNo: "P-2608-0004",
      items: [{ seq: 1, sampleName: "Trade E", commonName: "Glyphosate 48% SL", batchNo: "B-001", productionDate: "2026-09-01" }],
    }] });
    vi.mocked(api.getCoaSourceData).mockResolvedValueOnce({ results: [{
      itemSeq: 1, kind: "ai", key: "ai", label: "%AI", result: "48.1%",
    }] });
    const createdDoc: CoaDocument = {
      _id: "new-draft", revision: 0, status: "draft", petitionId: "p5", selectedItemSeqs: [1],
      coaYear: new Date().getFullYear(), createdAt: new Date().toISOString(),
      petitionNoSnapshot: "P-2608-0004", sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade E", commonName: "Glyphosate 48% SL" }],
      resultSnapshots: [{ itemSeq: 1, testItem: "pH", result: "7.1" }],
      formSelections: [{ itemSeq: 1, resultKeys: ["ph"] }],
    };
    vi.mocked(api.createManualCoaDocument).mockResolvedValueOnce(createdDoc);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "สถานะ ขอ COA" }));
    fireEvent.change(screen.getByPlaceholderText("ค้นหา COA / คำร้อง"), { target: { value: "P-2608-0004" } });
    fireEvent.click(await screen.findByRole("button", { name: "สร้าง COA P-2608-0004" }));
    await screen.findByDisplayValue("48.1%");
    fireEvent.click(screen.getByRole("button", { name: "สร้างร่าง COA" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "สถานะ ดำเนินการแล้ว" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByPlaceholderText("ค้นหา COA / คำร้อง")).toHaveValue("");
    expect(screen.getByRole("row", { name: /Trade E/ })).toBeInTheDocument();
  });

  it.each(["coaNo", "petitionNoSnapshot", "lotNo", "batchNo"])("ranks %s before names within the selected date scope", async (field) => {
    const makeDocument = (id: string, code: string): CoaDocument => ({
      _id: id, coaNo: id, petitionId: id, petitionNoSnapshot: id,
      coaYear: new Date().getFullYear(), revision: 0, status: "draft", selectedItemSeqs: [1],
      customerSnapshot: { name: id === "name" ? "AB" : "Customer" },
      sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade", commonName: "Common",
        ...(field === "lotNo" || field === "batchNo" ? { [field]: code } : {}),
      }],
      resultSnapshots: [], createdAt: new Date().toISOString(),
      ...(field === "coaNo" || field === "petitionNoSnapshot" ? { [field]: code } : {}),
    });
    const documents = [
      makeDocument("name", "other"), makeDocument("later", "XXAB"), makeDocument("earlier", "XAB"),
      makeDocument("prefix", "AB1"), makeDocument("exact", "AB"),
    ];
    vi.mocked(api.getCoaDocuments).mockResolvedValueOnce({ items: [
      ...documents,
      { ...makeDocument("old", "AB"), createdAt: new Date(Date.now() - 86400000).toISOString() },
    ] });
    const { container } = renderPage();
    const input = await screen.findByPlaceholderText("ค้นหา COA / คำร้อง");
    await screen.findByRole("row", { name: /prefix/ });
    const rowText = () => Array.from(container.querySelectorAll("tbody tr"), (row) => row.textContent ?? "");
    const original = rowText();
    expect(original).toHaveLength(5);
    fireEvent.change(input, { target: { value: "ab" } });
    expect(rowText()).toHaveLength(5);
    ["exact", "prefix", "earlier", "later", "name"].forEach((id, index) => {
      expect(rowText()[index]).toContain(id);
    });
    fireEvent.change(input, { target: { value: "   " } });
    expect(rowText()).toEqual(original);
  });

  it("uses sample names as primary fields when document and lot codes are absent", async () => {
    const base: CoaDocument = {
      _id: "customer", petitionId: "petition", coaYear: new Date().getFullYear(), revision: 0,
      status: "draft", selectedItemSeqs: [1], resultSnapshots: [],
      customerSnapshot: { name: "AB" }, sampleSnapshots: [{ itemSeq: 1, sampleName: "Other trade" }],
      createdAt: new Date().toISOString(),
    };
    vi.mocked(api.getCoaDocuments).mockResolvedValueOnce({ items: [base, {
      ...base, _id: "sample", customerSnapshot: { name: "Other customer" },
      sampleSnapshots: [{ itemSeq: 1, sampleName: "AB" }],
    }] });
    const { container } = renderPage();
    await screen.findByText("Other customer");
    fireEvent.change(screen.getByPlaceholderText("ค้นหา COA / คำร้อง"), { target: { value: "AB" } });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector("tbody tr")).toHaveTextContent("Other customer");
  });

  it("renders COA list and create action", async () => {
    const { container } = renderPage();

    expect(await screen.findByText("ออกเอกสาร COA")).toBeInTheDocument();
    expect(await screen.findByText("00012026")).toBeInTheDocument();
    expect(screen.getByTestId("coa-center-page")).toHaveClass("space-y-4");
    const notificationButton = screen.getByRole("button", { name: "แจ้งเตือน COA 5 รายการ" });
    expect(notificationButton).toHaveAttribute("aria-controls", "coa-notification-panel");
    expect(screen.queryByRole("button", { name: /สร้าง COA/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Document No" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "COA No" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ชื่อลูกค้า" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ชื่อการค้า" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ชื่อสามัญ" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "LOT No. (แบช+วันที่ผลิต)" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "สถานะ" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "พิมพ์" })).not.toBeInTheDocument();
    expect(screen.getByText("Customer A")).toBeInTheDocument();
    expect(screen.getByText("Trade A")).toBeInTheDocument();
    expect(screen.getAllByText("Common A").length).toBeGreaterThan(0);
    expect(screen.getByText("L-001 / B-001 / 01/08/2026")).toBeInTheDocument();
    expect(screen.getAllByText("ดำเนินการแล้ว").length).toBeGreaterThan(0);
  });

  it("shows request trend with drug frequency and %AI", async () => {
    renderPage();

    const trend = await screen.findByTestId("coa-request-trend");
    expect(within(trend).getByText("Trend การขอ COA (%AI)")).toBeInTheDocument();
    expect(within(trend).getAllByText("Common A").length).toBeGreaterThan(0);
    expect(within(trend).getAllByText("2 ครั้ง").length).toBeGreaterThan(0);
    expect(within(trend).getByText("GLYPHOSATE 48% SL")).toBeInTheDocument();
    expect(within(trend).getByText("Label %AI 48%")).toBeInTheDocument();
    expect(within(trend).getByText("Avg %AI 47.9%")).toBeInTheDocument();
  });

  it("alerts COAs waiting for approval and COAs that need correction", async () => {
    renderPage();

    expect(await screen.findByText("แจ้งเตือนเอกสาร COA")).toBeInTheDocument();
    expect(screen.getByText("รออนุมัติ 1 รายการ")).toBeInTheDocument();
    expect(screen.getByText("ต้องแก้ไขข้อมูลใหม่ 1 รายการ")).toBeInTheDocument();
    expect(screen.getByText("ขอใบซ้ำ 1 รายการ")).toBeInTheDocument();
    expect(screen.getByText("ชื่อสามัญซ้ำ 1 กลุ่ม")).toBeInTheDocument();
    expect(screen.getByText("Batch/วันที่ผลิตซ้ำ 1 กลุ่ม")).toBeInTheDocument();
    expect(screen.getByText("อนุมัติแล้ว 1 รายการ")).toBeInTheDocument();
    expect(screen.getAllByText("00022026 · P-2608-0002").length).toBeGreaterThan(0);
    expect(screen.getByText("00062026 · P-2608-0005")).toBeInTheDocument();
    expect(screen.getByText("แก้ไข Lot ใหม่")).toBeInTheDocument();
    expect(screen.getAllByText("Common A").length).toBeGreaterThan(0);
    expect(screen.getByText("Batch B-001 · ผลิต 01/08/2026")).toBeInTheDocument();
    expect(within(screen.getByTestId("coa-approved-summary")).getByText("00032026 · P-2608-0003")).toBeInTheDocument();
    expect(within(screen.getByTestId("coa-daily-request-summary")).getByText("3 คำขอ")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ดูรายการรออนุมัติ" }));
    expect(await screen.findByRole("row", { name: /00022026/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ดูรายการต้องแก้ไข" }));
    const correctionRow = await screen.findByRole("row", { name: /00062026/ });
    expect(within(correctionRow).getByText("ต้องแก้ไขข้อมูลใหม่")).toBeInTheDocument();
    expect(within(correctionRow).getByRole("button", { name: "แก้ไข COA 00062026" })).toBeInTheDocument();
  });

  it("defaults to today's COA requests and can switch to all requests", async () => {
    const { container } = renderPage();

    expect(await screen.findByText("00012026")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /00022026/ })).not.toBeInTheDocument();
    const tabButtons = Array.from(container.querySelectorAll("button[aria-pressed]:not([aria-label])"));
    expect(tabButtons).toHaveLength(2);
    expect(tabButtons[0]).toHaveAttribute("aria-pressed", "true");
    expect(tabButtons[1]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /คำขอ COA ทั้งหมด/ }));

    expect(await screen.findByRole("button", { name: /แฟ้มปี 2569/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /00022026/ })).not.toBeInTheDocument();
    expect(tabButtons[0]).toHaveAttribute("aria-pressed", "false");
    expect(tabButtons[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("shows Buddhist-year folders in all requests before opening a COA list", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /คำขอ COA ทั้งหมด/ }));

    expect(screen.getByRole("button", { name: /แฟ้มปี 2569/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /แฟ้มปี 2568/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /00022026/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /แฟ้มปี 2569/ }));

    expect(await screen.findByText("00022026")).toBeInTheDocument();
    const requestedRow = await screen.findByRole("row", { name: /P-2608-0004/ });
    expect(within(requestedRow).getByRole("button", { name: /สร้าง COA/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "สถานะ" })).not.toBeInTheDocument();
    expect(screen.queryByText("00012025")).not.toBeInTheDocument();
  });

  it("indicates and filters COA workflow status", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "สถานะ ขอ COA" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "สถานะ ดำเนินการแล้ว" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "สถานะ รออนุมัติ" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "สถานะ อนุมัติแล้ว" })).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "สถานะ รออนุมัติ" }));

    expect(await screen.findByText("00022026")).toBeInTheDocument();
    expect(screen.queryByText("00012026")).not.toBeInTheDocument();
    expect(screen.queryByText("00032026")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Document No" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "ชื่อลูกค้า" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "คำสั่ง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดดูไฟล์ COA 00022026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QC Head อนุมัติ COA 00022026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ไม่อนุมัติ COA 00022026" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "สถานะ อนุมัติแล้ว" }));

    expect(await screen.findByText("00032026")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /00022026/ })).not.toBeInTheDocument();
  });

  it("shows the create COA action in a command column for requested COAs", async () => {
    renderPage();

    expect(await screen.findByText("00012026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /สร้าง COA/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "สถานะ ขอ COA" }));

    const requestedRow = await screen.findByRole("row", { name: /P-2608-0004/ });
    expect(screen.getByRole("columnheader", { name: "คำสั่ง" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "สถานะ" })).not.toBeInTheDocument();
    expect(within(requestedRow).queryByText("ขอ COA")).not.toBeInTheDocument();
    expect(within(requestedRow).getByRole("button", { name: /สร้าง COA/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "สถานะ ดำเนินการแล้ว" }));

    expect(screen.queryByRole("button", { name: /สร้าง COA/ })).not.toBeInTheDocument();
  });

  it("opens manual creation for ERP requests without loading Lab petitions", async () => {
    vi.mocked(api.getCoaDocuments).mockResolvedValueOnce({
      items: [{
        _id: "external-coa-request-SO26040020-10000",
        coaNo: null,
        coaYear: new Date().getFullYear(),
        revision: 0,
        status: "requested",
        petitionId: "external-coa-request-SO26040020-10000",
        petitionNoSnapshot: "SO26040020",
        customerSnapshot: { name: "Customer A", company: "ICPL" },
        selectedItemSeqs: [10000],
        sampleSnapshots: [{ itemSeq: 10000, sampleName: "Carval", commonName: "SPIRODICLOFEN 24 % W/V SC", sampleId: "FC-CAVAL-1X16", condition: "16*1 L" }],
        resultSnapshots: [],
        print: { printCount: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        externalCoaRequest: { saleOrderNo: "SO26040020", pendingStatus: "pending shipment", shipmentDate: "2026-05-26T00:00:00.000Z" },
      }],
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "สถานะ ขอ COA" }));

    const requestedRow = await screen.findByRole("row", { name: /SO26040020/ });
    expect(within(requestedRow).getByText("คำขอจาก ERP")).toBeInTheDocument();
    expect(within(requestedRow).getByText("pending shipment")).toBeInTheDocument();
    expect(within(requestedRow).getByText("ERP")).toBeInTheDocument();
    expect(within(requestedRow).getByRole("button", { name: /สร้าง COA/ })).toBeInTheDocument();

    fireEvent.click(requestedRow);

    expect(await screen.findByRole("dialog")).toHaveTextContent("สร้าง COA แบบกรอกเอง");
    expect(screen.getByLabelText("ชื่อการค้า *")).toHaveValue("Carval");
    expect(screen.getByLabelText("ชื่อสามัญ *")).toHaveValue("SPIRODICLOFEN 24 % W/V SC");
    expect(screen.getByRole("button", { name: "บันทึกร่าง COA" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Batch No. *"), { target: { value: "B-ERP-1" } });
    fireEvent.change(screen.getByLabelText("วันที่ผลิต *"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Date of analysis *"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("เกณฑ์ความคลาดเคลื่อน *"), { target: { value: "24% ± 1.20" } });
    fireEvent.change(screen.getByLabelText("Density at 30°C (g/cm³) *"), { target: { value: "1.100" } });
    fireEvent.change(screen.getByLabelText("%AI content (W/V) *"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("Appearance *"), { target: { value: "Clear liquid" } });
    vi.mocked(api.createErpManualCoaDocument).mockRejectedValueOnce(new Error("บันทึกไม่สำเร็จ"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกร่าง COA" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกไม่สำเร็จ");
    expect(api.createErpManualCoaDocument).toHaveBeenCalledWith(expect.objectContaining({
      externalRequestId: "external-coa-request-SO26040020-10000",
      sample: expect.objectContaining({ batchNo: "B-ERP-1", productionDate: "2026-10-01" }),
      results: expect.arrayContaining([
        expect.objectContaining({ testItem: "Appearance", criteria: "Clear liquid", result: "Conform" }),
        expect.objectContaining({ testItem: "%AI content (W/V)", criteria: "24% ± 1.20", result: "24%" }),
        expect.objectContaining({ testItem: "Density at 30°C (g/cm³)", result: "1.100" }),
        expect.objectContaining({ testItem: "Date of analysis", result: "2026-10-08" }),
      ]),
    }));
    const entered = vi.mocked(api.createErpManualCoaDocument).mock.calls.at(-1)![0];
    vi.mocked(api.createErpManualCoaDocument).mockResolvedValueOnce({
      _id: "manual-coa-1", sourceType: "erpManual", externalRequestId: entered.externalRequestId,
      status: "draft", revision: 0, petitionId: "", petitionNoSnapshot: "SO26040020",
      selectedItemSeqs: [10000], sampleSnapshots: [entered.sample], resultSnapshots: entered.results,
      createdAt: new Date().toISOString(),
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกร่าง COA" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "สถานะ ดำเนินการแล้ว" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("row", { name: /Carval.*B-ERP-1/ })).toBeInTheDocument();

    expect(api.getEligibleCoaPetitions).not.toHaveBeenCalled();
    expect(api.getCoaSourceData).not.toHaveBeenCalled();
  });

  it("prefills ERP COA fields from the shared ERP and Lab autofill endpoint", async () => {
    vi.mocked(api.getCoaDocuments).mockResolvedValueOnce({
      items: [{
        _id: "external-coa-request-SO-AUTO-1-10000", coaNo: null, coaYear: 2026, revision: 0, status: "requested",
        petitionId: "external-coa-request-SO-AUTO-1-10000", petitionNoSnapshot: "SO-AUTO-1", selectedItemSeqs: [10000],
        customerSnapshot: { name: "Customer A" },
        sampleSnapshots: [{ itemSeq: 10000, sampleName: "Test Trade", commonName: "GLYPHOSATE 48% W/V SL" }],
        resultSnapshots: [], externalRequestId: "external-coa-request-SO-AUTO-1-10000",
        externalCoaRequest: { saleOrderNo: "SO-AUTO-1", line: 10000 },
      }],
    });
    vi.mocked(api.getErpCoaAutofill).mockResolvedValueOnce({
      externalRequestId: "external-coa-request-SO-AUTO-1-10000",
      source: {},
      sample: {
        itemSeq: 10000, sampleName: "Test Trade", commonName: "GLYPHOSATE 48% W/V SL",
        batchNo: "FG260902-008", lotNo: "FG260902-008", productionDate: "2026-09-02",
      },
      results: [{ itemSeq: 10000, testItem: "%AI content", criteria: "48% ± 2.40", result: "48.35%", unit: "%" }],
      match: { petitionId: "p1", petitionNo: "P-AUTO-1", itemSeq: 1, batchNo: "FG260902-008", matchKind: "exact", batchScore: 1 },
      candidates: [], stockCandidates: [], mfCandidates: [], form: { template: "liquid", aiCriteria: "48% ± 2.40", needsDensity: true },
      warnings: [], dataSources: { erp: true, stock: true, mf: true, lab: true, density: false },
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "สถานะ ขอ COA" }));
    const requestedRow = await screen.findByRole("row", { name: /SO-AUTO-1/ });
    fireEvent.click(requestedRow);

    await waitFor(() => expect(screen.getByLabelText("Batch No. *")).toHaveValue("FG260902-008"));
    expect(screen.getByLabelText("วันที่ผลิต *")).toHaveValue("2026-09-02");
    expect(screen.getByLabelText("%AI content (W/V) *")).toHaveValue("48.35%");
    expect(screen.getByText("แบบฟอร์ม: ยาน้ำ")).toBeInTheDocument();
  });

  it("refreshes %AI from the entered batch in real time", async () => {
    vi.mocked(api.getCoaDocuments).mockResolvedValueOnce({
      items: [{
        _id: "external-coa-request-SO-AI-LOOKUP-10000", coaNo: null, coaYear: 2026, revision: 0, status: "requested",
        petitionId: "external-coa-request-SO-AI-LOOKUP-10000", petitionNoSnapshot: "SO-AI-LOOKUP", selectedItemSeqs: [10000],
        customerSnapshot: { name: "Customer AI" },
        sampleSnapshots: [{ itemSeq: 10000, sampleName: "ช้างมาร์กี้", commonName: "GLYPHOSATE 48% W/V SL" }],
        resultSnapshots: [], externalRequestId: "external-coa-request-SO-AI-LOOKUP-10000",
        externalCoaRequest: { saleOrderNo: "SO-AI-LOOKUP", line: 10000 },
      }],
    });
    vi.mocked(api.getErpCoaAutofill).mockResolvedValueOnce({
      externalRequestId: "external-coa-request-SO-AI-LOOKUP-10000", source: {},
      sample: { itemSeq: 10000, sampleName: "ช้างมาร์กี้", commonName: "GLYPHOSATE 48% W/V SL", batchNo: "080", productionDate: "2026-10-01" },
      results: [], match: null, candidates: [], stockCandidates: [], mfCandidates: [],
      form: { template: "liquid", aiCriteria: "48% ± 2.40", needsDensity: true }, warnings: [],
      dataSources: { erp: true, stock: false, mf: false, lab: false, density: false },
    });
    vi.mocked(api.getCoaLabAiByBatch).mockImplementation(async ({ batchNo, commonName }) => ({
      batchNo, commonName,
      ai: batchNo === "080" ? { testItem: "%AI content", result: "48.15%", criteria: "48% ± 2.40", unit: "%" } : null,
      analysisDate: batchNo === "080" ? "2026-10-08" : "",
      match: batchNo === "080" ? { petitionId: "p-ai", petitionNo: "P-AI-LOOKUP", itemSeq: 1, batchNo: "080" } : null,
    }));

    renderPage();
    const statusButton = await waitFor(() => {
      const button = screen.getAllByRole("button").find((candidate) => {
        const label = candidate.getAttribute("aria-label") || "";
        return label.includes("COA") && !label.includes("คำขอ") && !label.includes("แจ้งเตือน");
      });
      expect(button).toBeTruthy();
      return button as HTMLElement;
    });
    fireEvent.click(statusButton);
    fireEvent.click(await screen.findByRole("row", { name: /SO-AI-LOOKUP/ }));
    await waitFor(() => expect(screen.getByLabelText("Batch No. *")).toHaveValue("080"));
    await waitFor(() => expect(api.getCoaLabAiByBatch).toHaveBeenCalledWith(expect.objectContaining({ batchNo: "080", commonName: "GLYPHOSATE 48% W/V SL" })));
    await waitFor(() => expect(screen.getByLabelText("%AI content (W/V) *")).toHaveValue("48.15%"));
    expect(screen.getByLabelText("Date of analysis *")).toHaveValue("2026-10-08");

    fireEvent.change(screen.getByLabelText("Batch No. *"), { target: { value: "081" } });
    await waitFor(() => expect(api.getCoaLabAiByBatch).toHaveBeenCalledWith(expect.objectContaining({ batchNo: "081" })));
    await waitFor(() => expect(screen.getByLabelText("%AI content (W/V) *")).toHaveValue(""));
  });

  it("opens the clicked COA request with its common name and parameter sources selected", async () => {
    vi.mocked(api.getEligibleCoaPetitions).mockResolvedValueOnce({ items: [{
      _id: "p5", petitionNo: "P-2608-0004",
      items: [{ seq: 1, sampleName: "Trade E", commonName: "Glyphosate 48% SL", batchNo: "B-001" }],
    }] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "สถานะ ขอ COA" }));
    fireEvent.click(await screen.findByRole("button", { name: "สร้าง COA P-2608-0004" }));
    await waitFor(() => expect(api.getCoaSourceData).toHaveBeenCalledWith("p5", [1]));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("checkbox")).toBeChecked();
    expect(dialog.getByText("ชื่อสามัญ: Glyphosate 48% SL")).toBeInTheDocument();
  });

  it("warns on repeated common name and batch then sends existing COA to approval", async () => {
    vi.mocked(api.getEligibleCoaPetitions).mockResolvedValueOnce({
      items: [
        {
          _id: "p-dup",
          petitionNo: "P-2608-DUP",
          items: [
            {
              seq: 1,
              sampleName: "Trade Duplicate",
              commonName: "BROMADIOLONE 0.005%",
              batchNo: "B-DUP-001",
              activeCoa: {
                coaId: "coa-old",
                coaNo: "00052026",
                revision: 0,
                petitionNo: "P-2608-OLD",
                commonName: "BROMADIOLONE 0.005%",
                batchNo: "B-DUP-001",
              },
            },
          ],
        },
      ],
    });
    vi.mocked(api.reviseCoaDocument).mockResolvedValueOnce({ _id: "coa-revision" } as never);
    vi.mocked(api.submitCoaDocument).mockResolvedValueOnce({
      _id: "coa-revision",
      coaNo: "00052026",
      coaYear: new Date().getFullYear(),
      revision: 1,
      status: "pendingRevisionApproval",
      petitionId: "p-dup",
      petitionNoSnapshot: "P-2608-DUP",
      customerSnapshot: { name: "Customer Duplicate" },
      selectedItemSeqs: [1],
      sampleSnapshots: [{ itemSeq: 1, sampleName: "Trade Duplicate", commonName: "BROMADIOLONE 0.005%", batchNo: "B-DUP-001" }],
      resultSnapshots: [],
      print: { printCount: 0 },
      createdAt: new Date().toISOString(),
    } as never);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "สถานะ ขอ COA" }));
    fireEvent.click(await screen.findByRole("button", { name: /สร้าง COA P-2608-0004/ }));
    fireEvent.click(await screen.findByText("P-2608-DUP"));
    fireEvent.click(screen.getByText("Trade Duplicate"));

    expect(await screen.findByText("พบประวัติการทำ COA แล้ว")).toBeInTheDocument();
    expect(screen.getAllByText(/00052026/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "ส่งใบเดิมไปรออนุมัติ" }));

    expect(await screen.findByRole("button", { name: "สถานะ รออนุมัติ" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("row", { name: /00052026/ })).toBeInTheDocument();
    expect(api.reviseCoaDocument).toHaveBeenCalledWith("coa-old", expect.any(Object));
    expect(api.submitCoaDocument).toHaveBeenCalledWith("coa-revision", expect.any(Object));
  });

  it("shows an admin edit action and focused COA columns for in-progress COAs", async () => {
    renderPage();

    expect(await screen.findByText("00012026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "สถานะ ดำเนินการแล้ว" }));

    expect(await screen.findByText("00012026")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Document No" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "COA No" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "ชื่อลูกค้า" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ชื่อการค้า" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ชื่อสามัญ" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "LOT No. (แบช+วันที่ผลิต)" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "สถานะ" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "คำสั่ง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดดูไฟล์ COA 00012026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แก้ไข COA 00012026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เสร็จสิ้น COA 00012026" })).toBeInTheDocument();
  });

  it("simulates a BROMADIOLONE 0.005% COA through QC Head approval", async () => {
    renderPage("/coa?demoCoa=bromadiolone");

    expect(await screen.findByText("โหมดจำลอง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "สถานะ ขอ COA" })).toHaveAttribute("aria-pressed", "true");

    const requestedRow = await screen.findByRole("row", { name: /P-2608-DEMO-001/ });
    expect(within(requestedRow).getByText("Red Wax Block")).toBeInTheDocument();
    expect(within(requestedRow).getByText("BROMADIOLONE 0.005%")).toBeInTheDocument();
    expect(within(requestedRow).getByText("LOT-DEMO-001 / B-DEMO-001 / 08/08/2026")).toBeInTheDocument();

    fireEvent.click(within(requestedRow).getByRole("button", { name: "สร้าง COA P-2608-DEMO-001" }));

    expect(screen.getByRole("button", { name: "สถานะ ดำเนินการแล้ว" })).toHaveAttribute("aria-pressed", "true");
    const inProgressRow = await screen.findByRole("row", { name: /00042026/ });
    expect(within(inProgressRow).getByRole("button", { name: "เปิดดูไฟล์ COA 00042026" })).toBeInTheDocument();
    expect(within(inProgressRow).getByRole("button", { name: "แก้ไข COA 00042026" })).toBeInTheDocument();
    expect(within(inProgressRow).getByRole("button", { name: "เสร็จสิ้น COA 00042026" })).toBeInTheDocument();

    fireEvent.click(within(inProgressRow).getByRole("button", { name: "เสร็จสิ้น COA 00042026" }));

    expect(screen.getByRole("button", { name: "สถานะ รออนุมัติ" })).toHaveAttribute("aria-pressed", "true");
    const pendingApprovalRow = await screen.findByRole("row", { name: /00042026/ });
    expect(within(pendingApprovalRow).getByRole("button", { name: "เปิดดูไฟล์ COA 00042026" })).toBeInTheDocument();
    expect(within(pendingApprovalRow).getByRole("button", { name: "QC Head อนุมัติ COA 00042026" })).toBeInTheDocument();
    expect(within(pendingApprovalRow).getByRole("button", { name: "ไม่อนุมัติ COA 00042026" })).toBeInTheDocument();

    fireEvent.click(within(pendingApprovalRow).getByRole("button", { name: "QC Head อนุมัติ COA 00042026" }));

    expect(screen.getByRole("button", { name: "สถานะ อนุมัติแล้ว" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("coa-center-page")).toHaveClass("space-y-4");
    const approvedRow = await screen.findByRole("row", { name: /00042026/ });
    expect(within(approvedRow).getByText("Red Wax Block")).toBeInTheDocument();
    expect(within(approvedRow).getByRole("button", { name: "พิมพ์ COA 00042026" })).toBeEnabled();
  });

  it("shows print and PDF commands with focused COA columns in the approved workflow tab", async () => {
    renderPage();

    expect(await screen.findByText("00012026")).toBeInTheDocument();
    expect(screen.getByTestId("coa-center-page")).toHaveClass("space-y-4");
    expect(screen.queryByRole("columnheader", { name: "พิมพ์" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "พิมพ์ COA 00032026" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "สถานะ อนุมัติแล้ว" }));

    expect(await screen.findByText("00032026")).toBeInTheDocument();
    expect(screen.getByTestId("coa-center-page")).toHaveClass("space-y-4");
    expect(screen.getByTestId("coa-center-page")).not.toHaveClass("bg-green-50");
    expect(screen.queryByRole("columnheader", { name: "Document No" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "COA No" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ชื่อการค้า" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ชื่อลูกค้า" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "ชื่อบริษัท" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "ชื่อสามัญ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "LOT No. (แบช+วันที่ผลิต)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "สถานะ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "พิมพ์" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "คำสั่ง" })).toBeInTheDocument();
    expect(screen.getByText("Customer D")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "พิมพ์ COA 00032026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "บันทึกไฟล์ PDF COA 00032026" })).toBeEnabled();
  });
});
