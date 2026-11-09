import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QCApprovalReviewPage from "./QCApprovalReviewPage";

const { navigateMock, decideMock, rejectPetitionMock, issueFinalMock, deniedTabs, fixture } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  decideMock: vi.fn(),
  rejectPetitionMock: vi.fn(),
  issueFinalMock: vi.fn(),
  deniedTabs: new Set<string>(),
  fixture: { petition: {} as Record<string, unknown> },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/components/lis/PageHeader", () => ({
  default: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

vi.mock("@/hooks/usePetition", () => ({
  usePetition: () => ({
    data: fixture.petition,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAccessibleTabs", () => ({
  useAccessibleTabs: () => ({ isVisible: (key: string) => !deniedTabs.has(key) }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { name: "หัวหน้า QC", roles: ["qc-head"] } }),
}));

vi.mock("@/context/ConfirmDialog", () => ({
  useConfirm: () => vi.fn(async () => true),
  releaseBodyPointerLock: vi.fn(),
}));

vi.mock("@/hooks/useItemGroupMembership", () => ({
  useItemGroupMembership: () => new Map(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getParameters: vi.fn(async () => []),
    getQCResults: vi.fn(async () => []),
    getAbnormalFlags: vi.fn(async () => ({ p1: false })),
    decideApprovalItems: decideMock,
    rejectPetition: rejectPetitionMock,
    issueFinalReport: issueFinalMock,
  },
}));

const row = (key: string, label: string, abnormal: boolean) => ({
  key, label, value: "6.2", standardText: "6.5 - 7.5", abnormal, note: "", phase: 1,
});

vi.mock("@/lib/qcApprovalRows", () => ({
  buildApprovalGroups: () => [
    {
      seq: 1,
      sampleName: "ตัวอย่าง A",
      sampleId: "S-1",
      params: [
        { parameterId: "param-1", parameterName: "ความชื้น", scope: "qc", hasPhases: false, rows: [row("row-1", "ค่า pH", true)] },
        { parameterId: "param-2", parameterName: "%AI", scope: "lab", hasPhases: false, rows: [row("row-2", "สารสำคัญ", false)] },
      ],
      unmatched: false,
    },
  ],
  filterApprovalGroupsByScope: (groups: Array<{ params: Array<{ scope: string }> }>, scope: string) =>
    groups
      .map((group) => ({ ...group, params: group.params.filter((param) => param.scope === scope) }))
      .filter((group) => group.params.length > 0),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const basePetition = {
  _id: "p1",
  petitionNo: "P-2607-0001",
  dept: "rm",
  status: "inProgress",
  routeTargets: ["qc", "lab"],
  qcCompletedAt: "2026-07-13T00:30:00.000Z",
  labCompletedAt: "2026-07-13T01:30:00.000Z",
  submittedBy: { name: "ผู้ยื่น A", submittedAt: "2026-07-13T00:00:00.000Z" },
  items: [{ seq: 1, sampleName: "ตัวอย่าง A", batchNo: "RM-1", sampleId: "S-1", sendToQc: true, sendToLab: true }],
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

function renderPage(initialEntry = "/qc-approval/p1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/qc-approval/:id" element={<QCApprovalReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("QCApprovalReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deniedTabs.clear();
    fixture.petition = { ...basePetition };
    decideMock.mockResolvedValue({ ...basePetition, status: "inProgress" });
    rejectPetitionMock.mockResolvedValue({});
  });

  it("gives the QC head one decision bar with physical, AI and Final Report choices", async () => {
    renderPage();

    const finalButton = await screen.findByRole("button", { name: "ออก Final Report" });
    const bar = finalButton.closest(".fixed") as HTMLElement;
    expect(bar).toHaveClass("bottom-3");
    expect(within(bar).getByRole("button", { name: "กายภาพผ่าน" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "AI ผ่าน" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "ผลไม่ผ่าน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /อนุมัติรายการที่/ })).not.toBeInTheDocument();
    // แสดงผลเรียงลงมา ไม่ใช้ tab
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["ค่ากายภาพ (QC)", "AI (Lab)"]);
  });

  it("asks for a reason when issuing the Final Report with an abnormal physical value", async () => {
    decideMock.mockResolvedValue({ ...basePetition, status: "approved" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "ออก Final Report" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("ยอมรับผลไม่ปกติ");
    fireEvent.change(screen.getByLabelText("เหตุผล"), { target: { value: "ลูกค้ายอมรับ" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันให้ผ่าน" }));

    await waitFor(() => expect(decideMock).toHaveBeenCalledTimes(2));
    expect(decideMock).toHaveBeenNthCalledWith(1, "p1", {
      side: "qc", decision: "approve", note: "ลูกค้ายอมรับ", items: [{ seq: 1, abnormal: true }],
    });
    expect(decideMock).toHaveBeenNthCalledWith(2, "p1", {
      side: "lab", decision: "approve", note: "ลูกค้ายอมรับ", items: [{ seq: 1, abnormal: false }],
    });
    expect(navigateMock).toHaveBeenCalledWith("/qc-approval");
  });

  it("sends only the ticked failing side back for retesting", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "ผลไม่ผ่าน" }));
    await screen.findByRole("dialog");
    const confirmButton = screen.getByRole("button", { name: "ยืนยันผลไม่ผ่าน" });
    fireEvent.click(screen.getByLabelText("รายการที่ 1: ตัวอย่าง A / ความชื้น / ค่า pH"));
    fireEvent.change(screen.getByLabelText("เหตุผล"), { target: { value: "สีผิดปกติ" } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(decideMock).toHaveBeenCalledTimes(1));
    expect(decideMock).toHaveBeenCalledWith("p1", {
      side: "qc",
      decision: "reject",
      note: expect.stringContaining("ไม่ผ่าน: รายการที่ 1: ตัวอย่าง A / ความชื้น / ค่า pH"),
      items: [{ seq: 1, abnormal: false }],
    });
  });

  it("limits a QC Approver to physical results and physical decisions", async () => {
    deniedTabs.add("lab");
    renderPage("/qc-approval/p1?tab=lab");

    expect(await screen.findByRole("button", { name: "กายภาพผ่าน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI ผ่าน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ออก Final Report" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ค่ากายภาพ (QC)" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI (Lab)" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ผลไม่ผ่าน" }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("กายภาพไม่ผ่าน")).toBeInTheDocument();
    expect(screen.queryByLabelText("AI ไม่ผ่าน")).not.toBeInTheDocument();
  });

  it("shows who already passed the physical results and leaves the Final Report as the next step", async () => {
    fixture.petition = {
      ...basePetition,
      itemApprovals: [{ seq: 1, side: "qc", status: "approved", conclusion: "pass", by: "QC Approver A", at: "2026-07-13T01:00:00.000Z" }],
    };
    renderPage();

    expect(await screen.findByText(/มีคนให้กายภาพผ่านแล้ว: QC Approver A/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ออก Final Report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI ผ่าน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "กายภาพผ่าน" })).not.toBeInTheDocument();
  });

  it("lets the QC head pass physical while Lab results are still pending", async () => {
    fixture.petition = { ...basePetition, labCompletedAt: null };
    renderPage();

    expect(await screen.findByRole("button", { name: "กายภาพผ่าน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ออก Final Report" })).not.toBeInTheDocument();
    expect(screen.getAllByText("รอผล Lab").length).toBeGreaterThan(0);
  });

  it("lets a QC Approver issue the physical result of a QC-only request as a Pre Result", async () => {
    deniedTabs.add("lab");
    fixture.petition = {
      ...basePetition,
      routeTargets: ["qc"],
      labCompletedAt: null,
      items: [{ seq: 1, sampleName: "ตัวอย่าง A", batchNo: "RM-1", sampleId: "S-1", sendToQc: true }],
    };
    renderPage();

    const preResult = await screen.findByRole("button", { name: "ออกผลกายภาพ (Pre Result)" });
    expect(screen.queryByRole("button", { name: "ออก Final Report" })).not.toBeInTheDocument();
    fireEvent.click(preResult);
    // ค่ากายภาพผิดปกติ → ต้องระบุเหตุผลก่อน
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("เหตุผล"), { target: { value: "ยอมรับได้" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันให้ผ่าน" }));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith("p1", expect.objectContaining({ side: "qc", decision: "approve" })));
  });

  it("lets the QC head issue the Final Report after the Pre Result", async () => {
    issueFinalMock.mockResolvedValue({ ...basePetition, status: "approved" });
    fixture.petition = {
      ...basePetition,
      routeTargets: ["qc"],
      labCompletedAt: null,
      items: [{ seq: 1, sampleName: "ตัวอย่าง A", batchNo: "RM-1", sampleId: "S-1", sendToQc: true }],
      itemApprovals: [{ seq: 1, side: "qc", status: "approved", conclusion: "pass", by: "QC Approver A" }],
    };
    renderPage();

    expect(await screen.findByText(/ออก Pre Result แล้ว/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ออก Final Report" }));
    await waitFor(() => expect(issueFinalMock).toHaveBeenCalledWith("p1"));
    expect(navigateMock).toHaveBeenCalledWith("/qc-approval");
  });
});
