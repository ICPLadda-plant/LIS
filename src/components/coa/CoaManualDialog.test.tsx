import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { CoaDocument } from "@/types/coa.types";
import CoaManualDialog from "./CoaManualDialog";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { name: "QC Head", email: "qc@example.com", role: "qc-head" } }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getErpCoaAutofill: vi.fn(),
    getCoaLabAiByBatch: vi.fn().mockResolvedValue({ ai: null, analysisDate: "", match: null }),
    createErpManualCoaDocument: vi.fn(),
    updateCoaDocument: vi.fn(),
  },
}));

describe("CoaManualDialog", () => {
  it("uses the plus-minus criterion from the common name instead of a legacy range", async () => {
    const request = {
      _id: "manual-coa-criteria",
      sourceType: "erpManual",
      externalRequestId: "external-coa-request-SO-CRITERIA-10000",
      revision: 0,
      status: "draft",
      petitionId: "",
      petitionNoSnapshot: "SO-CRITERIA",
      selectedItemSeqs: [10000],
      sampleSnapshots: [{
        itemSeq: 10000,
        sampleName: "Trade A",
        commonName: "PRODUCT 5% SL",
        batchNo: "B-1",
        productionDate: "2026-10-01",
      }],
      resultSnapshots: [{
        itemSeq: 10000,
        testItem: "%AI content",
        result: "5.02%",
        criteria: "4.50-5.50",
        unit: "%",
      }],
    } as CoaDocument;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <CoaManualDialog open onOpenChange={vi.fn()} request={request} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("เกณฑ์ความคลาดเคลื่อน *")).toHaveValue("5% ± 0.50"));
  });

  it("shows the production date from an existing draft Lot No.", async () => {
    const request = {
      _id: "manual-coa-1",
      sourceType: "erpManual",
      externalRequestId: "external-coa-request-SO-1-10000",
      revision: 0,
      status: "draft",
      petitionId: "",
      petitionNoSnapshot: "SO-1",
      selectedItemSeqs: [10000],
      sampleSnapshots: [{
        itemSeq: 10000,
        sampleName: "Trade A",
        commonName: "PACLOBUTRAZOL 25% SC",
        batchNo: "480",
        lotNo: "26S-PCB25-480-091069",
        productionDate: "2026-06-18",
      }],
      resultSnapshots: [],
    } as CoaDocument;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <CoaManualDialog open onOpenChange={vi.fn()} request={request} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("วันที่ผลิต *")).toHaveValue("2026-10-09"));
    expect(api.getErpCoaAutofill).not.toHaveBeenCalled();
  });
});
