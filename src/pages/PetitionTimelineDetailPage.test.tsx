import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParameterItem, QCProgressMap } from "@/lib/api";
import type { TimelineDetailHeader } from "@/lib/petitionTimelineDetail";
import { estimateMetric, formatDateTime } from "@/lib/petitionTimelineMetric";
import type { Petition, PetitionAuditLogEntry } from "@/types/petition.types";
import PetitionTimelineDetailPage from "./PetitionTimelineDetailPage";

const at = (hour: number, minute = 0) => new Date(2026, 6, 13, hour, minute).toISOString();
const atDay = (day: number, hour: number, minute = 0) => new Date(2026, 6, day, hour, minute).toISOString();

// เอฟเฟกต์ของแท่งที่ "กำลังทำอยู่จริง" — เงาเป็นสีกลาง (ไม่ย้อมทับสีประจำแถว) + shimmer วิ่ง
const ACTIVE_GLOW_CLASS = "shadow-[0_0_10px_rgba(0,0,0,0.18)]";
const ACTIVE_SHIMMER_CLASS = "after:animate-[timeline-shimmer_1.4s_linear_infinite]";

const mocks = vi.hoisted(() => {
  const petition: Petition = {
    _id: "petition-1",
    petitionNo: "P-2607-001",
    dept: "production",
    status: "inProgress",
    submittedBy: { name: "Requester", submittedAt: "2026-07-13T01:00:00.000Z" },
    assignedTo: { employeeId: "E001", name: "Analyst", assignedAt: "2026-07-13T04:00:00.000Z" },
    qcReceivedAt: "2026-07-13T03:00:00.000Z",
    items: [{ seq: 1, sampleName: "Sample A", commonName: "ABAMECTIN 1.8% W/V EC", batchNo: "BATCH-002", lotNo: "LOT-88", sampleId: "sample-1" }],
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T01:00:00.000Z",
  } as Petition;
  const parameter: ParameterItem = {
    _id: "parameter-1",
    name: "Required checks",
    scope: "qc",
    status: "active",
    applyAll: true,
    valueFields: [
      { label: "Viscosity", type: "number", required: true },
      { label: "Color", type: "text", required: true },
      { label: "Photo evidence", type: "photo", required: true },
      { label: "Optional note", type: "text", required: false },
    ],
  };
  return {
    petition,
    parameter,
    user: { employeeId: "E001", name: "Analyst", roles: ["admin"] },
    auditLogs: [{
      _id: "audit-1",
      petitionId: "petition-1",
      petitionNo: "P-2607-001",
      event: "resultEntered",
      actor: "Analyst",
      metadata: { parameterName: "Required checks" },
      createdAt: "2026-07-13T05:00:00.000Z",
    }] as PetitionAuditLogEntry[],
    getParameters: vi.fn<() => Promise<ParameterItem[]>>(),
    getQCProgress: vi.fn<() => Promise<QCProgressMap>>(),
    getQCResults: vi.fn(),
    downloadPrintPdf: vi.fn(),
    refreshPetition: vi.fn(),
    refreshAudit: vi.fn(),
    activityError: null as string | null,
    labRequests: [] as Array<{ _id: string }>,
  };
});

vi.mock("@/components/lis/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/lis/PageHeader", () => ({
  default: ({ title, onBack, actions }: { title: ReactNode; onBack?: () => void; actions?: ReactNode }) => (
    <header><button type="button" onClick={onBack}>Back</button><h1>{title}</h1>{actions}</header>
  ),
}));
vi.mock("@/components/lis/PrintPreviewDialog", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="print-preview">{children}</div>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useItemGroupMembership", () => ({ useItemGroupMembership: () => new Map() }));
vi.mock("@/hooks/usePetition", () => ({
  usePetition: () => ({ data: mocks.petition, loading: false, error: null, refresh: mocks.refreshPetition }),
  usePetitionAuditLog: () => ({ data: mocks.auditLogs, loading: false, error: mocks.activityError, refresh: mocks.refreshAudit }),
  useLabRequestsByPetition: () => ({ data: mocks.labRequests, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    getParameters: mocks.getParameters,
    getQCProgress: mocks.getQCProgress,
    getQCResults: mocks.getQCResults,
    downloadPrintPdf: mocks.downloadPrintPdf,
  },
}));
vi.mock("@/lib/labResultReport", () => ({
  buildLabResultReportPages: () => [{ reportNo: "LR-1" }],
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/petition/petition-1"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes><Route path="/petition/:id" element={<PetitionTimelineDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

function selectFirstTimelineDayTab() {
  const timelineTablist = screen.queryByRole("tablist", { name: "Timeline days" });
  const firstDayTab = timelineTablist
    ? within(timelineTablist).queryAllByRole("tab").find((tab) => tab.textContent !== "ภาพรวม")
    : null;
  if (firstDayTab) fireEvent.click(firstDayTab);
}

// jsdom คืน getBoundingClientRect() เป็นศูนย์หมด — ต้อง mock ขนาดรางเอง ไม่งั้น crosshairAt คืน null เสมอ
function mockRect(element: HTMLElement, rect: { left: number; width: number }) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: rect.left,
    right: rect.left + rect.width,
    width: rect.width,
    top: 0,
    bottom: 200,
    height: 200,
    x: rect.left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 13, 18, 0, 0));
  vi.clearAllMocks();
  mocks.user = { employeeId: "E001", name: "Analyst", roles: ["admin"] };
  mocks.activityError = null;
  mocks.labRequests = [];
  mocks.auditLogs = [{
    _id: "audit-1",
    petitionId: "petition-1",
    petitionNo: "P-2607-001",
    event: "resultEntered",
    actor: "Analyst",
    metadata: { parameterName: "Required checks" },
    createdAt: "2026-07-13T05:00:00.000Z",
  }];
  Object.assign(mocks.petition, {
    additionalSampleRequests: undefined,
    productionWorkflow: undefined,
    status: "inProgress",
    approvedAt: null,
    submittedBy: { name: "Requester", submittedAt: "2026-07-13T01:00:00.000Z" },
    assignedTo: { employeeId: "E001", name: "Analyst", assignedAt: "2026-07-13T04:00:00.000Z" },
    qcReceivedAt: "2026-07-13T03:00:00.000Z",
    qcCompletedAt: undefined,
    qcReceivedBy: undefined,
    labReceivedBy: undefined,
    labCompletedAt: undefined,
    labApprovedAt: undefined,
    firstResultAt: undefined,
    items: [{ seq: 1, sampleName: "Sample A", commonName: "ABAMECTIN 1.8% W/V EC", batchNo: "BATCH-002", lotNo: "LOT-88", sampleId: "sample-1" }],
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T01:00:00.000Z",
  });
  mocks.parameter = {
    _id: "parameter-1",
    name: "Required checks",
    scope: "qc",
    status: "active",
    applyAll: true,
    valueFields: [
      { label: "Viscosity", type: "number", required: true },
      { label: "Color", type: "text", required: true },
      { label: "Photo evidence", type: "photo", required: true },
      { label: "Optional note", type: "text", required: false },
    ],
  };
  mocks.getParameters.mockResolvedValue([mocks.parameter]);
  mocks.getQCProgress.mockResolvedValue({ "petition-1": [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity"] }] });
  mocks.getQCResults.mockResolvedValue([]);
  mocks.downloadPrintPdf.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PetitionTimelineDetailPage", () => {
  it.each(['employeeId', 'workflowEmail'] as const)('opens bell route and prints extra samples for requester matched by %s without exposing timeline results', async (identity) => {
    mocks.user = { employeeId: identity === 'employeeId' ? 'REQUESTER-1' : 'OTHER', name: 'Different display name', roles: ['viewer'] };
    Object.assign(mocks.user, { email: 'requester@example.test' });
    mocks.petition.submittedBy.employeeId = 'REQUESTER-1';
    mocks.petition.productionWorkflow = identity === 'workflowEmail' ? { requesterEmail: 'requester@example.test' } : undefined;
    const qrCode = 'LIS-EXTRA-11111111-1111-4111-8111-111111111111';
    mocks.petition.additionalSampleRequests = [{
      _id: 'round-1', qrCode, side: 'qc', reason: 'ตัวอย่างไม่พอ', status: 'requested',
      items: [{ itemSeq: 1, quantity: 2 }], requestedAt: at(12), requestedBy: { name: 'QC Reviewer' },
    }];
    render(<MemoryRouter basename="/LIS" initialEntries={['/LIS/petition/petition-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes><Route path="/petition/:id" element={<PetitionTimelineDetailPage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('รอนำส่ง')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'พิมพ์ใบนำส่งตัวอย่างเพิ่ม' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ฉลากตัวอย่างเพิ่ม' }));
    expect(screen.getByRole('img', { name: 'QR ' + qrCode })).toBeInTheDocument();
    expect(screen.queryByLabelText('Parameter ที่ต้องตรวจสอบ')).not.toBeInTheDocument();
  });

  it('shows the same extra sample print actions within the normal timeline', async () => {
    mocks.petition.additionalSampleRequests = [{
      _id: 'round-1', qrCode: 'LIS-EXTRA-11111111-1111-4111-8111-111111111111', side: 'lab', reason: 'ตรวจซ้ำ', status: 'requested',
      items: [{ itemSeq: 1, quantity: 2 }], requestedAt: at(12), requestedBy: { name: 'LAB Reviewer' },
    }];
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'P-2607-001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'พิมพ์ใบนำส่งตัวอย่างเพิ่ม' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'พิมพ์ฉลากตัวอย่างเพิ่ม' })).toBeInTheDocument();
  });

  it("renders one petition's header, required task progress, and same-day timeline", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    expect(await screen.findByText("40%")).toBeInTheDocument();
    expect(screen.queryByText(/required fields/i)).not.toBeInTheDocument();
    const progressBar = screen.getByRole("progressbar", { name: "Progress" });
    expect(progressBar).toHaveAttribute("aria-valuenow", "40");
    expect(progressBar.firstElementChild).toHaveClass("bg-gradient-to-r", "from-red-500", "to-amber-400");
    expect(screen.queryByRole("status", { name: "Progress complete" })).not.toBeInTheDocument();
    selectFirstTimelineDayTab();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("17:00")).toBeInTheDocument();
    expect(screen.queryByText("20:00")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Parameter ที่ต้องตรวจสอบ")).toHaveTextContent("Required checks");
    expect(screen.getByLabelText("Parameter ที่ต้องตรวจสอบ")).toHaveTextContent("1/2");
    expect(screen.getByLabelText("petition timeline")).not.toHaveTextContent("Required checks");
  });

  it("keeps the sample image placeholder compact on tablet and mobile", async () => {
    renderDetail();

    const imageArea = await screen.findByLabelText("พื้นที่รูปตัวอย่าง");

    expect(imageArea).toHaveClass("h-20", "w-20", "sm:h-24", "sm:w-24", "xl:h-28", "xl:w-28", "justify-self-start");
    expect(imageArea).not.toHaveClass("aspect-square", "w-full");
  });

  it("highlights unreceived estimate status in large orange text", async () => {
    Object.assign(mocks.petition, {
      assignedTo: undefined,
      qcReceivedAt: undefined,
      receivedAt: undefined,
      labReceivedAt: undefined,
    });
    renderDetail();

    const unreceived = await screen.findByText("ยังไม่รับงาน");

    expect(unreceived).toHaveClass("text-base", "font-bold", "text-orange-600");
  });

  it("highlights overdue estimate status in large red text", async () => {
    renderDetail();

    const overdue = await screen.findByText("เลยกำหนด");

    expect(overdue).toHaveClass("text-base", "font-bold", "text-red-600");
  });

  it("shows a red progress bar up to 33 percent", async () => {
    mocks.getQCProgress.mockResolvedValue({ "petition-1": [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: [] }] });
    renderDetail();

    expect(await screen.findByText("20%")).toBeInTheDocument();
    const progressBar = screen.getByRole("progressbar", { name: "Progress" });
    expect(progressBar).toHaveAttribute("aria-valuenow", "20");
    expect(progressBar.firstElementChild).toHaveClass("bg-red-500");
    expect(progressBar.firstElementChild).not.toHaveClass("bg-gradient-to-r");
  });

  it("shows a progress gradient ending in green at 100 percent", async () => {
    Object.assign(mocks.petition, { status: "approved", approvedAt: "2026-07-13T08:00:00.000Z" });
    renderDetail();

    expect(await screen.findByText("100%")).toBeInTheDocument();
    const progressBar = screen.getByRole("progressbar", { name: "Progress" });
    expect(progressBar).toHaveAttribute("aria-valuenow", "100");
    expect(progressBar.firstElementChild).toHaveClass("bg-gradient-to-r", "from-red-500", "via-amber-400", "to-green-500");
    const completeBubble = screen.getByRole("status", { name: "Progress complete" });
    expect(completeBubble).toHaveTextContent("Complete");
    expect(completeBubble).toHaveClass("after:rotate-45", "after:content-['']");
  });

  it("shows petition and item details instead of requester and assignee metrics", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    expect(screen.getByLabelText("เลขคำขอ")).toHaveTextContent("P-2607-001");
    expect(document.querySelector("header")).not.toHaveTextContent("Timeline");
    expect(document.querySelector("header")).not.toHaveTextContent("P-2607-001");
    expect(screen.getByText("คำร้องโดย Requester · ผู้รับผิดชอบ Analyst")).toBeInTheDocument();
    expect(screen.getByText("ABAMECTIN 1.8% W/V EC")).toBeInTheDocument();
    expect(screen.getByText("BATCH-002")).toBeInTheDocument();
    expect(screen.queryByText("Lot")).not.toBeInTheDocument();
    expect(screen.queryByText("LOT-88")).not.toBeInTheDocument();
    expect(screen.queryByText("ผู้ยื่นคำร้อง")).not.toBeInTheDocument();
    expect(screen.queryByText("ผู้รับงาน")).not.toBeInTheDocument();
  });

  it("keeps timeline panels in the required desktop and mobile order", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    const timelineCard = screen.getByLabelText("petition timeline");
    const tasksCard = screen.getByLabelText("Parameter ที่ต้องตรวจสอบ");
    const activityCard = screen.getByLabelText("Recent Activity");
    const documentsCard = screen.getByLabelText("Documents");

    const panelGrid = document.querySelector(".xl\\:grid-cols-\\[minmax\\(0\\,1fr\\)_260px\\]");
    expect(panelGrid).toBeInTheDocument();
    expect(panelGrid).toHaveClass("2xl:grid-cols-[minmax(0,1fr)_320px]");
    const columns = Array.from(panelGrid?.children ?? []);
    expect(columns).toHaveLength(2);
    expect(Array.from(columns[0]?.children ?? [])).toEqual([timelineCard, tasksCard]);
    expect(Array.from(columns[1]?.children ?? [])).toEqual([activityCard, documentsCard]);
  });

  it("fits the project timeline panel without horizontal scrolling", async () => {
    renderDetail();

    const timelineCard = await screen.findByLabelText("petition timeline");
    expect(timelineCard.querySelector(".overflow-x-auto")).not.toBeInTheDocument();
    expect(Array.from(timelineCard.querySelectorAll("[class]")).some((node) => (node.getAttribute("class") ?? "").includes("min-w-[760px]"))).toBe(false);
  });

  it("adds a moving glow marker to timeline bars that are still in progress", async () => {
    renderDetail();

    const timelineCard = await screen.findByLabelText("petition timeline");
    const activeBar = Array.from(timelineCard.querySelectorAll("[aria-label]")).find((node) =>
      node.getAttribute("aria-label")?.includes("(ช่วงเวลา)") && node.classList.contains("rounded-r-none"),
    );

    // ต้อง assert เฉพาะ class ที่มีผลจริง (Tailwind สร้าง CSS ให้) ไม่ใช่ marker class ลอย ๆ
    expect(activeBar).toHaveClass("overflow-hidden");
    expect(activeBar).toHaveClass("h-5");
    expect(activeBar).toHaveClass("after:bg-gradient-to-r");
    expect(activeBar).toHaveClass(ACTIVE_SHIMMER_CLASS);
    expect(activeBar).toHaveClass(ACTIVE_GLOW_CLASS);
    expect(activeBar).not.toHaveClass("timeline-active-bar");
    // เงาต้องเป็นสีกลาง ไม่ใช่น้ำเงินย้อมทับสีประจำแถว
    expect(activeBar).not.toHaveClass("shadow-[0_0_14px_rgba(59,130,246,0.35)]");
  });

  it("shows an in-progress bubble at the current active timeline position", async () => {
    renderDetail();

    const timelineCard = await screen.findByLabelText("petition timeline");
    const activeBubble = within(timelineCard).getByRole("status", { name: /กำลังดำเนินการ/ });

    expect(activeBubble).toHaveTextContent("กำลังดำเนินการ");
    expect(activeBubble).toHaveClass("bg-amber-50", "text-amber-700", "after:rotate-45");
    expect((activeBubble as HTMLElement).style.left).toBe("100%");
  });

  it("คำร้องที่ปิดแล้วแต่มีรูข้อมูล (ไม่มี labApprovedAt): แท่งที่ไม่มีเวลาจบต้องไม่เรืองแสง/วิ่ง shimmer ตลอดกาล", async () => {
    Object.assign(mocks.petition, {
      status: "approved",
      items: [{ seq: 1, sampleName: "Lab Sample", commonName: "ABAMECTIN 1.8% W/V EC", batchNo: "BATCH-001", lotNo: "LOT-88", sampleId: "sample-1" }],
      qcCompletedAt: at(12),
      labCompletedAt: at(13),
      // ไม่มี labApprovedAt โดยตั้งใจ — คำร้องเก่าที่ปิดไปก่อนจะมีด่านนี้
      approvedAt: at(15),
    });
    renderDetail();

    const bar = await screen.findByLabelText("ออกผล Lab (ช่วงเวลา)");
    // สีอ่อน + ปลายขวาตรง ยังคงอยู่ (แปลว่า "ไม่มีเวลาจบที่บันทึกไว้") แต่ไม่ใช่ "กำลังทำอยู่"
    expect(bar).toHaveClass("bg-lime-200");
    expect(bar).toHaveClass("rounded-r-none");
    expect(bar).not.toHaveClass("overflow-hidden");
    expect(bar).not.toHaveClass(ACTIVE_SHIMMER_CLASS);
    expect(bar).not.toHaveClass(ACTIVE_GLOW_CLASS);
    expect(screen.queryByText("กำลังดำเนินการ")).not.toBeInTheDocument();
  });

  it("แท่งที่ถูกตัดที่ขอบเวลาทำการของวันเดียวกัน ไม่บอกว่าต่อเนื่องข้ามวัน", async () => {
    // เปิดดูตอน 18:00 ของวันเดียวกัน — แท่ง QC ที่ยังไม่จบลากถึง "ตอนนี้" ซึ่งเลยขอบหน้าต่าง 17:00
    renderDetail();

    const bar = await screen.findByLabelText("QC กำลังวิเคราะห์ (ช่วงเวลา)");
    expect(bar).not.toHaveAttribute("title");
  });

  it("แท่งที่ข้ามวันปฏิทินจริง ยังบอกว่าต่อเนื่องข้ามวัน", async () => {
    Object.assign(mocks.petition, { qcReceivedAt: atDay(12, 10), qcCompletedAt: atDay(13, 11) });
    renderDetail();

    fireEvent.click(await screen.findByRole("tab", { name: "12 ก.ค." }));
    expect(screen.getByLabelText("QC กำลังวิเคราะห์ (ช่วงเวลา)")).toHaveAttribute("title", "ต่อเนื่องข้ามวัน");
  });

  it("แท็บภาพรวมขยายแกนเวลาให้ครอบคลุมกิจกรรมก่อนเวลาทำการ (06:30) ไม่ดันแท่งไปติดขอบซ้าย", async () => {
    vi.setSystemTime(new Date(2026, 6, 14, 12, 0, 0));
    Object.assign(mocks.petition, {
      submittedBy: { name: "Requester", submittedAt: atDay(13, 6, 30) },
      createdAt: atDay(13, 6, 30),
      qcReceivedAt: atDay(14, 10),
    });
    renderDetail();

    expect(await screen.findByRole("tab", { name: "ภาพรวม" })).toHaveAttribute("aria-selected", "true");
    expect((screen.getByLabelText("ยื่นคำขอ (ช่วงเวลา)") as HTMLElement).style.left).not.toBe("0%");
  });

  it("reduces dense timeline tick labels before the wide desktop breakpoint", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    selectFirstTimelineDayTab();
    expect(await screen.findByText("16:00")).toHaveClass("hidden", "2xl:block");
    expect(screen.getByText("17:00")).not.toHaveClass("hidden");
  });

  it("shows day tabs for project timelines that span multiple days", async () => {
    Object.assign(mocks.petition, {
      qcReceivedAt: "2026-07-12T03:00:00.000Z",
      firstResultAt: "2026-07-13T02:00:00.000Z",
    });
    renderDetail();

    expect(await screen.findByRole("tab", { name: "12 ก.ค." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "13 ก.ค." }));
    expect(screen.getByRole("tab", { name: "13 ก.ค." })).toHaveAttribute("aria-selected", "true");
  });

  it("shows an overview tab for multi-day timelines and hides inactive rows in daily tabs", async () => {
    Object.assign(mocks.petition, {
      submittedBy: { name: "Requester", submittedAt: "2026-07-12T01:00:00.000Z" },
      createdAt: "2026-07-12T01:00:00.000Z",
      qcReceivedAt: "2026-07-12T03:00:00.000Z",
      qcCompletedAt: "2026-07-13T04:00:00.000Z",
    });
    renderDetail();

    const timelineCard = await screen.findByLabelText("petition timeline");
    expect(screen.getByRole("tab", { name: "ภาพรวม" })).toHaveAttribute("aria-selected", "true");
    expect(timelineCard).toHaveTextContent("ยื่นคำขอ");

    fireEvent.click(screen.getByRole("tab", { name: "13 ก.ค." }));

    expect(screen.getByRole("tab", { name: "13 ก.ค." })).toHaveAttribute("aria-selected", "true");
    expect(timelineCard).toHaveTextContent("QC กำลังวิเคราะห์");
    expect(timelineCard).not.toHaveTextContent("ยื่นคำขอ");
  });

  it("right-aligns the final overview date tick near the end so it does not overflow", async () => {
    Object.assign(mocks.petition, {
      status: "success",
      submittedBy: { name: "Requester", submittedAt: "2026-07-13T01:00:00.000Z" },
      createdAt: "2026-07-13T01:00:00.000Z",
      qcReceivedAt: "2026-07-13T03:00:00.000Z",
      qcCompletedAt: "2026-07-14T06:18:00.000Z",
    });
    renderDetail();

    expect(await screen.findByRole("tab", { name: "ภาพรวม" })).toHaveAttribute("aria-selected", "true");
    const axis = within(screen.getByTestId("timeline-axis"));
    expect(axis.getByText("14 ก.ค.")).toHaveClass("right-1");
    expect(axis.queryByText("13:18")).not.toBeInTheDocument();
  });

  it("omits inactive overview tick labels and lines across long multi-day timelines", async () => {
    Object.assign(mocks.petition, {
      status: "success",
      submittedBy: { name: "Requester", submittedAt: "2026-06-24T01:00:00.000Z" },
      createdAt: "2026-06-24T01:00:00.000Z",
      qcReceivedAt: "2026-06-24T01:00:00.000Z",
      qcCompletedAt: "2026-07-01T09:39:00.000Z",
    });
    renderDetail();

    expect(await screen.findByRole("tab", { name: "ภาพรวม" })).toHaveAttribute("aria-selected", "true");
    const axis = within(screen.getByTestId("timeline-axis"));
    expect(axis.getByText("24 มิ.ย.")).not.toHaveClass("hidden");
    expect(axis.queryByText("25 มิ.ย.")).not.toBeInTheDocument();
    expect(axis.getByText("01 ก.ค.")).not.toHaveClass("hidden");
    expect(axis.queryByText("16:39")).not.toBeInTheDocument();
  });

  it("shows overview day ticks only for days with timeline actions", async () => {
    Object.assign(mocks.petition, {
      status: "success",
      submittedBy: { name: "Requester", submittedAt: "2026-06-24T01:00:00.000Z" },
      createdAt: "2026-06-24T01:00:00.000Z",
      qcReceivedAt: "2026-06-24T01:00:00.000Z",
      qcCompletedAt: "2026-07-02T01:00:00.000Z",
    });
    renderDetail();

    expect(await screen.findByRole("tab", { name: "ภาพรวม" })).toHaveAttribute("aria-selected", "true");
    const axis = within(screen.getByTestId("timeline-axis"));
    expect(axis.getByText("24 มิ.ย.")).toBeInTheDocument();
    expect(axis.queryByText("27 มิ.ย.")).not.toBeInTheDocument();
    expect(axis.queryByText("30 มิ.ย.")).not.toBeInTheDocument();
    expect(axis.getByText("02 ก.ค.")).toBeInTheDocument();
  });

  it("retries activity loading without blanking header and task panels", async () => {
    mocks.activityError = "network";
    renderDetail();

    expect(await screen.findByText(/โหลดกิจกรรมไม่สำเร็จ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(mocks.refreshAudit).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
  });

  it("opens all recent activity in a paged popup with six entries per page", async () => {
    mocks.auditLogs = Array.from({ length: 13 }, (_, index) => {
      const number = index + 1;
      return {
        _id: `audit-${number}`,
        petitionId: "petition-1",
        petitionNo: "P-2607-001",
        event: "resultEntered",
        actor: `Actor ${number}`,
        metadata: { parameterName: `Parameter ${number}` },
        createdAt: new Date(2026, 6, 13, 5, number).toISOString(),
      } satisfies PetitionAuditLogEntry;
    });
    renderDetail();

    const activityCard = await screen.findByLabelText("Recent Activity");
    expect(activityCard).toHaveTextContent("Actor 13");
    expect(activityCard).toHaveTextContent("Actor 9");
    expect(activityCard).not.toHaveTextContent("Actor 8");

    fireEvent.click(within(activityCard).getByRole("button", { name: "ดูทั้งหมด" }));

    const dialog = await screen.findByRole("dialog", { name: "Recent Activity" });
    expect(dialog).toHaveTextContent("หน้า 1 / 3");
    expect(dialog).toHaveTextContent("Actor 13");
    expect(dialog).toHaveTextContent("Actor 8");
    expect(dialog).not.toHaveTextContent("Actor 7");

    fireEvent.click(within(dialog).getByRole("button", { name: "ถัดไป" }));

    expect(dialog).toHaveTextContent("หน้า 2 / 3");
    expect(dialog).toHaveTextContent("Actor 7");
    expect(dialog).toHaveTextContent("Actor 2");
    expect(dialog).not.toHaveTextContent("Actor 8");
  });

  it("reloads task data when its retry action is selected", async () => {
    mocks.getParameters
      .mockRejectedValueOnce(new Error("parameters unavailable"))
      .mockResolvedValueOnce([mocks.parameter]);
    renderDetail();

    expect(await screen.findByText(/โหลดข้อมูล parameter ไม่สำเร็จ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));

    await waitFor(() => expect(mocks.getParameters).toHaveBeenCalledTimes(2));
    expect(mocks.getQCProgress).toHaveBeenCalledTimes(2);
  });

  it("does not render Lab-only tasks while parameter visibility is unresolved", async () => {
    mocks.user = { employeeId: "L001", name: "Lab", roles: ["lab"] };
    mocks.parameter = {
      ...mocks.parameter,
      name: "Lab-only required parameter",
      scope: "lab",
    };
    mocks.getParameters.mockReturnValue(new Promise<ParameterItem[]>(() => {}));
    renderDetail();

    expect(await screen.findByText(/กำลังโหลดข้อมูล Timeline/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "P-2607-001" })).not.toBeInTheDocument();
    expect(screen.queryByText("Lab-only required parameter")).not.toBeInTheDocument();
  });

  it("shows the same eligible document actions as the petition detail page", async () => {
    Object.assign(mocks.petition, { status: "approved", approvedAt: "2026-07-13T08:00:00.000Z" });
    mocks.labRequests = [{ _id: "lab-request-1" }];
    renderDetail();

    expect(await screen.findByRole("button", { name: "ป้ายนำส่งตัวอย่าง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ใบคำขอรับบริการ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Final Report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pre Report" })).not.toBeInTheDocument();
  });

  it("shows approved document actions with distinct border colors", async () => {
    Object.assign(mocks.petition, { status: "approved", approvedAt: "2026-07-13T08:00:00.000Z" });
    mocks.labRequests = [{ _id: "lab-request-1" }];
    renderDetail();

    await screen.findByRole("button", { name: "Final Report" });
    const documentButtons = Array.from(screen.getByLabelText("Documents").querySelectorAll("button"));
    expect(documentButtons).toHaveLength(3);
    expect(documentButtons[0]).toHaveClass("border-primary-500");
    expect(documentButtons[1]).toHaveClass("border-yellow-500");
    expect(documentButtons[2]).toHaveClass("border-red-500");
  });

  it("hides the lab-result print button when QC has not confirmed Final Result", async () => {
    Object.assign(mocks.petition, {
      status: "success",
      labApprovedAt: "2026-07-14T00:00:00.000Z",
    });
    renderDetail();
    await screen.findByRole("heading", { name: "P-2607-001" });
    expect(screen.queryByRole("button", { name: /พิมพ์ผลวิเคราะห์ Lab/ })).not.toBeInTheDocument();
  });

  it("shows the lab-result print button when Lab has issued results and QC has confirmed Final Result", async () => {
    Object.assign(mocks.petition, {
      status: "approved",
      approvedAt: "2026-07-13T08:00:00.000Z",
      labApprovedAt: "2026-07-14T00:00:00.000Z",
    });
    renderDetail();
    await screen.findByRole("heading", { name: "P-2607-001" });
    expect(screen.getByRole("button", { name: /พิมพ์ผลวิเคราะห์ Lab/ })).toBeInTheDocument();
  });

  it("เรียงปุ่มพิมพ์ผลวิเคราะห์ Lab ไว้ก่อน Final Report (Lab ออกผลก่อน แล้วหัวหน้า QC ค่อยออก Final)", async () => {
    Object.assign(mocks.petition, {
      status: "approved",
      approvedAt: "2026-07-13T08:00:00.000Z",
      labApprovedAt: "2026-07-14T00:00:00.000Z",
    });
    renderDetail();
    await screen.findByRole("button", { name: "Final Report" });
    const buttons = Array.from(screen.getByLabelText("Documents").querySelectorAll("button"));
    const labIndex = buttons.findIndex((button) => /พิมพ์ผลวิเคราะห์ Lab/.test(button.textContent ?? ""));
    const finalIndex = buttons.findIndex((button) => button.textContent === "Final Report");
    expect(labIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(labIndex);
  });

  it("hides the lab-result print button when Lab is not finished", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "P-2607-001" });
    expect(screen.queryByRole("button", { name: /พิมพ์ผลวิเคราะห์ Lab/ })).not.toBeInTheDocument();
  });

  it("shows Pre Report with its own green border color", async () => {
    Object.assign(mocks.petition, {
      qcCompletedAt: "2026-07-13T06:00:00.000Z",
      labCompletedAt: "2026-07-13T07:00:00.000Z",
    });
    mocks.labRequests = [{ _id: "lab-request-1" }];
    mocks.getQCProgress.mockResolvedValue({
      "petition-1": [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity", "Color"] }],
    });
    renderDetail();

    expect(await screen.findByRole("button", { name: "Pre Report" })).toHaveClass("border-green-500");
  });

  it("does not show Pre Report while in progress before all required fields are recorded", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pre Report" })).not.toBeInTheDocument();
  });

  it("does not show Pre Report after QC completion until Lab is complete", async () => {
    Object.assign(mocks.petition, { qcCompletedAt: "2026-07-13T06:00:00.000Z" });
    mocks.getQCProgress.mockResolvedValue({
      "petition-1": [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity", "Color"] }],
    });
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pre Report" })).not.toBeInTheDocument();
  });

  it('hides the sample-label button once QC has received the sample', async () => {
    mocks.petition.qcReceivedBy = 'QC Staff';
    renderDetail();
    await screen.findByRole('heading', { name: 'P-2607-001' });
    expect(screen.queryByRole('button', { name: /ป้ายนำส่งตัวอย่าง/ })).not.toBeInTheDocument();
  });

  it('shows the sample-label button when not yet received', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'P-2607-001' });
    expect(screen.getByRole('button', { name: /ป้ายนำส่งตัวอย่าง/ })).toBeInTheDocument();
  });

  it("keeps document actions disabled until document data is ready", async () => {
    let resolveResults: ((value: []) => void) | undefined;
    mocks.getQCResults.mockReturnValue(new Promise((resolve) => { resolveResults = resolve; }));
    renderDetail();

    const labelButton = await screen.findByRole("button", { name: "ป้ายนำส่งตัวอย่าง" });
    expect(mocks.getQCResults).toHaveBeenCalledOnce();
    expect(labelButton).toBeDisabled();

    await act(async () => {
      resolveResults?.([]);
    });
    await waitFor(() => expect(labelButton).not.toBeDisabled());

    fireEvent.click(labelButton);
    expect(await screen.findByTestId("print-preview")).toBeInTheDocument();
  });

  it("opens timeline document actions in a print preview popup", async () => {
    renderDetail();

    const documentsCard = await screen.findByLabelText("Documents");
    await waitFor(() => expect(screen.getByRole("button", { name: "ป้ายนำส่งตัวอย่าง" })).not.toBeDisabled());
    expect(screen.queryByTestId("print-preview")).not.toBeInTheDocument();

    fireEvent.click(documentsCard.querySelector("button") as HTMLButtonElement);

    const preview = await screen.findByTestId("print-preview");
    expect(preview).toHaveTextContent("P-2607-001");
    expect(mocks.downloadPrintPdf).not.toHaveBeenCalled();
  });

  it("ไม่มีแถวสถานะเก่า (รับตัวอย่าง/ครบ/บันทึกผล) อีกต่อไป มีแต่แท่งช่วงเวลาใหม่", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    const timelineCard = screen.getByLabelText("petition timeline");
    // แถวเก่าที่ถูกแทนที่ด้วยแท่งช่วงเวลาต้องไม่หลงเหลืออยู่อีก
    expect(timelineCard).not.toHaveTextContent("QC รับตัวอย่าง");
    expect(timelineCard).not.toHaveTextContent("Lab รับตัวอย่าง");
    expect(timelineCard).not.toHaveTextContent("QC ครบ");
    expect(timelineCard).not.toHaveTextContent("Lab ครบ");
    expect(timelineCard).not.toHaveTextContent("บันทึกผล");
    // แถวแท่งช่วงเวลาของโมเดลใหม่ต้องแสดงแทน
    expect(timelineCard).toHaveTextContent("ยื่นคำขอ");
    expect(timelineCard).toHaveTextContent("QC กำลังวิเคราะห์");
  });

  it("จุด milestone ไม่ลากเส้นยาวมาจากขอบซ้ายของแถว", async () => {
    Object.assign(mocks.petition, { status: "approved", approvedAt: "2026-07-13T08:00:00.000Z" });
    renderDetail();

    const dot = await screen.findByLabelText("Final Result (จุด)");
    expect(dot.parentElement?.children).toHaveLength(1);
  });

  it("แท่งที่ยังทำไม่เสร็จใช้สีอ่อนและปลายขวาตรง", async () => {
    renderDetail();

    const bar = await screen.findByLabelText("QC กำลังวิเคราะห์ (ช่วงเวลา)");
    expect(bar).toHaveClass("bg-sky-200");
    expect(bar).toHaveClass("rounded-r-none");
    expect(bar).not.toHaveClass("bg-sky-500");
  });

  it("แท่งที่ทำเสร็จแล้วใช้สีเข้มและปลายมน", async () => {
    Object.assign(mocks.petition, { qcCompletedAt: "2026-07-13T06:00:00.000Z" });
    renderDetail();

    const bar = await screen.findByLabelText("QC กำลังวิเคราะห์ (ช่วงเวลา)");
    expect(bar).toHaveClass("bg-sky-500");
    expect(bar).not.toHaveClass("rounded-r-none");
  });

  const twoItems = [
    { seq: 1, sampleName: "Sample A", commonName: "ABAMECTIN 1.8% W/V EC", batchNo: "BATCH-002", lotNo: "LOT-88", sampleId: "sample-1" },
    { seq: 2, sampleName: "Sample B", commonName: "EMAMECTIN 1.9% EC", batchNo: "BATCH-003", lotNo: "LOT-99", sampleId: "sample-2" },
  ];

  it("ไม่แสดงแถบแท็บตัวอย่างเมื่อคำขอมีตัวอย่างเดียว", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "ตัวอย่างในคำขอ" })).not.toBeInTheDocument();
  });

  it("แสดงแท็บตัวอย่างชื่อ commonName เมื่อคำขอมีหลายตัวอย่าง", async () => {
    Object.assign(mocks.petition, { items: twoItems });
    renderDetail();

    expect(await screen.findByRole("tab", { name: "ABAMECTIN 1.8% W/V EC" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "EMAMECTIN 1.9% EC" })).toHaveAttribute("aria-selected", "false");
  });

  it("แท็บตัวอย่างอยู่เหนือการ์ด Petition Timeline (ไม่ใช่บนสุดของหน้า)", async () => {
    Object.assign(mocks.petition, { items: twoItems });
    renderDetail();

    const tablist = await screen.findByRole("tablist", { name: "ตัวอย่างในคำขอ" });
    const heading = screen.getByRole("heading", { name: "P-2607-001" });
    const timelineCard = screen.getByLabelText("petition timeline");
    // อยู่หลังการ์ดข้อมูล (heading คำขอ) แต่ต้องมาก่อนการ์ด Petition Timeline
    expect(heading.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablist.compareDocumentPosition(timelineCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ต้องไม่อยู่ในการ์ด Timeline (อยู่เหนือ ไม่ใช่ข้างใน)
    expect(timelineCard).not.toContainElement(tablist);
  });

  it("สลับแท็บแล้ว Metric และการ์ด Parameter ที่ต้องตรวจสอบเปลี่ยนตามตัวอย่างที่เลือก", async () => {
    Object.assign(mocks.petition, { items: twoItems });
    mocks.getQCProgress.mockResolvedValue({
      "petition-1": [
        { itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity"] },
        { itemSeq: 2, parameterId: "parameter-1", filledLabels: [] },
      ],
    });
    renderDetail();

    // อย่าใช้ getByText(commonName) — ชื่อสารโผล่ทั้งในปุ่มแท็บและใน Metric จะได้ 2 element
    expect(await screen.findByRole("tab", { name: "ABAMECTIN 1.8% W/V EC" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("BATCH-002")).toBeInTheDocument();
    expect(screen.getByLabelText("Parameter ที่ต้องตรวจสอบ")).toHaveTextContent("Sample A");
    expect(screen.getByLabelText("Parameter ที่ต้องตรวจสอบ")).not.toHaveTextContent("Sample B");

    fireEvent.click(screen.getByRole("tab", { name: "EMAMECTIN 1.9% EC" }));

    expect(screen.getByRole("tab", { name: "EMAMECTIN 1.9% EC" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("BATCH-003")).toBeInTheDocument();
    expect(screen.queryByText("BATCH-002")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Parameter ที่ต้องตรวจสอบ")).toHaveTextContent("Sample B");
    expect(screen.getByLabelText("Parameter ที่ต้องตรวจสอบ")).not.toHaveTextContent("Sample A");
  });

  it("ไม่แสดงปุ่ม Pre Report เมื่อคำร้องทดสอบเสร็จสิ้น แต่ QC และ Lab ยังไม่ complete", async () => {
    Object.assign(mocks.petition, { status: "success", items: twoItems });
    mocks.getQCProgress.mockResolvedValue({
      "petition-1": [
        { itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity", "Color"] },
        { itemSeq: 2, parameterId: "parameter-1", filledLabels: [] },
      ],
    });
    renderDetail();

    expect(await screen.findByRole("tab", { name: "ABAMECTIN 1.8% W/V EC" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pre Report" })).not.toBeInTheDocument();
  });

  it("ไม่แสดงปุ่ม Pre Report เมื่อผล Lab ออกแล้วแต่ QC ยังไม่ complete", async () => {
    Object.assign(mocks.petition, {
      status: "inProgress",
      labApprovedAt: "2026-07-13T07:00:00.000Z",
      labCompletedAt: "2026-07-13T06:00:00.000Z",
    });
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pre Report" })).not.toBeInTheDocument();
  });

  it("แสดงปุ่ม Pre Report เมื่อ QC และ Lab complete แล้ว", async () => {
    Object.assign(mocks.petition, {
      qcCompletedAt: "2026-07-13T06:00:00.000Z",
      labCompletedAt: "2026-07-13T07:00:00.000Z",
    });
    renderDetail();

    expect(await screen.findByRole("button", { name: "Pre Report" })).toBeInTheDocument();
  });

  it("แสดงปุ่ม Pre Report ของคำร้องที่ไม่มี Lab track เมื่อ QC ตรวจครบและงานเสร็จสิ้น", async () => {
    // BATCH-002 → ไม่มี Lab track → labCompletedAt ไม่มีวันถูกเขียน (server เขียนเฉพาะตอน Lab บันทึกผล)
    // ถ้าไปบังคับรอ labCompletedAt คำร้องแบบนี้จะไม่มีวันได้ปุ่ม Pre Report เลย
    Object.assign(mocks.petition, { status: "success", qcCompletedAt: at(13) });
    mocks.getQCProgress.mockResolvedValue({
      "petition-1": [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity", "Color"] }],
    });
    renderDetail();

    expect(await screen.findByRole("button", { name: "Pre Report" })).toBeInTheDocument();
  });

  it("ไม่แสดงปุ่ม Pre Report ของคำร้องที่มี Lab track เมื่อ Lab ยังไม่บันทึกผล", async () => {
    Object.assign(mocks.petition, {
      status: "success",
      items: [{ seq: 1, sampleName: "Lab Sample", commonName: "ABAMECTIN 1.8% W/V EC", batchNo: "BATCH-001", lotNo: "LOT-88", sampleId: "sample-1" }],
      qcCompletedAt: at(13),
    });
    renderDetail();

    expect(await screen.findByRole("heading", { name: "P-2607-001" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pre Report" })).not.toBeInTheDocument();
  });
});

describe("สีประจำแถวของกราฟ timeline", () => {
  it("แท่งแต่ละแถวมีสีประจำตัวเอง ไม่ซ้ำกัน", async () => {
    // หมายเหตุ: ตอนนี้เหลือ milestone เดียวคือ Final Result (ดู "จุด milestone ไม่ลากเส้นยาว...")
    // ดังนั้นความ "ไม่ซ้ำสี" ที่ยังมีความหมายคือระหว่างแท่งช่วงเวลาของแต่ละแถว ไม่ใช่ระหว่างจุด
    Object.assign(mocks.petition, {
      labReceivedAt: "2026-07-13T04:30:00.000Z",
      qcCompletedAt: "2026-07-13T05:30:00.000Z",
      labCompletedAt: "2026-07-13T06:00:00.000Z",
      labApprovedAt: "2026-07-13T07:00:00.000Z",
    });
    renderDetail();

    const submittedBar = await screen.findByLabelText("ยื่นคำขอ (ช่วงเวลา)");
    const sampleSentBar = screen.getByLabelText("ส่งตัวอย่าง (ช่วงเวลา)");
    const qcBar = screen.getByLabelText("QC กำลังวิเคราะห์ (ช่วงเวลา)");
    const labBar = screen.getByLabelText("Lab กำลังวิเคราะห์ (ช่วงเวลา)");

    expect(submittedBar).toHaveClass("bg-violet-500");
    expect(sampleSentBar).toHaveClass("bg-orange-500");
    expect(qcBar).toHaveClass("bg-sky-500");
    expect(labBar).toHaveClass("bg-amber-500");

    const distinctBarColors = new Set(
      [submittedBar, sampleSentBar, qcBar, labBar].map((bar) => Array.from(bar.classList).find((cls) => cls.startsWith("bg-"))),
    );
    expect(distinctBarColors.size).toBe(4);
  });

  it("แท่ง Pre Result ไม่ใช้สีเดียวกับแท่ง Lab กำลังวิเคราะห์", async () => {
    Object.assign(mocks.petition, {
      status: "approved",
      approvedAt: "2026-07-13T08:00:00.000Z",
      labReceivedAt: "2026-07-13T04:30:00.000Z",
      qcCompletedAt: "2026-07-13T05:30:00.000Z",
      labCompletedAt: "2026-07-13T06:00:00.000Z",
      labApprovedAt: "2026-07-13T07:00:00.000Z",
    });
    renderDetail();

    expect(await screen.findByLabelText("Pre Result (ช่วงเวลา)")).toHaveClass("bg-cyan-500");
    expect(screen.getByLabelText("Lab กำลังวิเคราะห์ (ช่วงเวลา)")).toHaveClass("bg-amber-500");
  });

  it("จุดที่ยังไม่ถึงไม่วาดจุด Final Result ค้างไว้ (ด่านที่ยังไม่มี timestamp ไม่วาดแท่ง/จุด)", async () => {
    // หมายเหตุ: ตอนนี้เหลือ milestone เดียวคือ Final Result — ด่านอื่นกลายเป็นแท่งช่วงเวลาหมดแล้ว
    // เทสต์นี้ยืนยันว่าด่านที่ยังไม่มี timestamp จริง (ยังไม่รับตัวอย่าง/ยังไม่ปิดคำร้อง) จะไม่วาด
    // แท่ง/จุดค้างไว้ผิด ๆ — ไม่ใช่จุดสีเทา (เคสนั้นครอบคลุมที่ src/lib/petitionTimelineColors.test.ts)
    Object.assign(mocks.petition, {
      qcReceivedAt: undefined,
      receivedAt: undefined,
      labReceivedAt: undefined,
      assignedTo: undefined,
    });
    renderDetail();

    await screen.findByLabelText("ยื่นคำขอ (ช่วงเวลา)");
    expect(screen.queryByLabelText("ส่งตัวอย่าง (ช่วงเวลา)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("QC กำลังวิเคราะห์ (ช่วงเวลา)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Final Result (จุด)")).not.toBeInTheDocument();
  });
});

describe("PetitionTimelineDetailPage crosshair", () => {
  it("hover ในกราฟแล้วเห็นเส้นตั้ง + ป้ายวันเวลา และหายเมื่อเมาส์ออก", async () => {
    renderDetail();

    const area = await screen.findByTestId("timeline-area");
    mockRect(area, { left: 0, width: 500 });
    mockRect(screen.getByTestId("timeline-axis"), { left: 100, width: 400 });

    fireEvent.mouseMove(area, { clientX: 300, clientY: 40 });

    expect(screen.getByTestId("timeline-crosshair-line")).toHaveStyle({ left: "50%" });
    // แกนวันนี้คือ 08:00–17:00 (9 ชม.) mock ราง left:100 width:400 เมาส์ clientX:300 = กึ่งกลางราง (50%)
    // → 08:00 + 4:30 ชม. = 12:30 พอดี ไม่ใช่แค่ "เวลาสองหลักอะไรก็ได้"
    expect(screen.getByTestId("timeline-crosshair-label")).toHaveTextContent("13 ก.ค. 12:30");

    fireEvent.mouseLeave(area);

    expect(screen.queryByTestId("timeline-crosshair-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-crosshair-label")).not.toBeInTheDocument();
  });

  it("hover ฝั่งคอลัมน์ชื่อด่าน (นอกราง) ไม่ขึ้น crosshair", async () => {
    renderDetail();

    const area = await screen.findByTestId("timeline-area");
    mockRect(area, { left: 0, width: 500 });
    mockRect(screen.getByTestId("timeline-axis"), { left: 100, width: 400 });

    fireEvent.mouseMove(area, { clientX: 40, clientY: 40 });

    expect(screen.queryByTestId("timeline-crosshair-line")).not.toBeInTheDocument();
  });
});

function buildTimelineDetailHeader(overrides: Partial<TimelineDetailHeader> = {}): TimelineDetailHeader {
  return {
    startAt: "2026-07-13T01:00:00.000Z",
    startKind: "submitted",
    endAt: "2026-07-13T08:00:00.000Z",
    endKind: "actual",
    overdue: false,
    ...overrides,
  };
}

describe("estimateMetric", () => {
  it("endKind actual → End time ไม่มีป้าย hint", () => {
    const header = buildTimelineDetailHeader({ endKind: "actual", overdue: false });

    expect(estimateMetric(header)).toEqual({
      label: "End time",
      value: formatDateTime(header.endAt),
    });
  });

  it("endKind estimated + ยังไม่เลยกำหนด → Estimate Time ค่าประมาณ", () => {
    const header = buildTimelineDetailHeader({ endKind: "estimated", overdue: false });

    expect(estimateMetric(header)).toEqual({
      label: "Estimate Time",
      value: formatDateTime(header.endAt),
      hint: "ค่าประมาณ",
      tone: "default",
    });
  });

  it("endKind estimated + เลยกำหนดแล้ว → Estimate Time เลยกำหนด", () => {
    const header = buildTimelineDetailHeader({ endKind: "estimated", overdue: true });

    expect(estimateMetric(header)).toEqual({
      label: "Estimate Time",
      value: formatDateTime(header.endAt),
      hint: "เลยกำหนด",
      tone: "danger",
    });
  });

  it("endKind unreceived → Estimate Time ยังไม่รับงาน", () => {
    const header = buildTimelineDetailHeader({ endKind: "unreceived", overdue: false });

    expect(estimateMetric(header)).toEqual({
      label: "Estimate Time",
      value: "คาดว่าผลจะออก 1-2 วัน",
      hint: "ยังไม่รับงาน",
      tone: "warning",
    });
  });
});
