import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QCApprovalReviewPage from "./QCApprovalReviewPage";

const { navigateMock, decideMock, rejectPetitionMock, deniedTabs } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  decideMock: vi.fn(),
  rejectPetitionMock: vi.fn(),
  deniedTabs: new Set<string>(),
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
    data: {
      _id: "p1",
      petitionNo: "P-2607-0001",
      dept: "rm",
      status: "inProgress",
      qcCompletedAt: "2026-07-13T00:30:00.000Z",
      submittedBy: { name: "ผู้ยื่น A", submittedAt: "2026-07-13T00:00:00.000Z" },
      items: [{ seq: 1, sampleName: "ตัวอย่าง A", batchNo: "RM-1", sampleId: "S-1" }],
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
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
  },
}));

vi.mock("@/lib/qcApprovalRows", () => ({
  buildApprovalGroups: () => [
    {
      seq: 1,
      sampleName: "ตัวอย่าง A",
      sampleId: "S-1",
      params: [
        {
          parameterId: "param-1",
          parameterName: "ความชื้น",
          scope: "qc",
          hasPhases: false,
          rows: [
            {
              key: "row-1",
              label: "ค่า pH",
              value: "6.2",
              standardText: "6.5 - 7.5",
              abnormal: true,
              note: "",
              phase: 1,
            },
          ],
        },
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
    decideMock.mockResolvedValue({
      _id: "p1",
      petitionNo: "P-2607-0001",
      dept: "rm",
      status: "approved",
      submittedBy: { name: "ผู้ยื่น A" },
      items: [{ seq: 1, sampleName: "ตัวอย่าง A", batchNo: "RM-1", sampleId: "S-1" }],
      itemApprovals: [{ seq: 1, side: "qc", status: "approved", conclusion: "accepted-oos" }],
    });
    rejectPetitionMock.mockResolvedValue({});
  });

  it("asks for a reason before approving an abnormal item and sends a per-item decision", async () => {
    renderPage();

    expect(await screen.findByText("รออนุมัติ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติรายการที่ 1" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("ยอมรับผลไม่ปกติ (QC)");
    fireEvent.change(screen.getByLabelText("เหตุผล"), { target: { value: "ลูกค้ายอมรับ" } });
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));

    await waitFor(() => expect(decideMock).toHaveBeenCalledTimes(1));
    expect(decideMock).toHaveBeenCalledWith("p1", {
      side: "qc",
      decision: "approve",
      note: "ลูกค้ายอมรับ",
      items: [{ seq: 1, abnormal: true }],
    });
    // อนุมัติครบทุกรายการ → server ปิดใบ → กลับหน้ารายการ
    expect(navigateMock).toHaveBeenCalledWith("/qc-approval");
  });

  it("rejects a single item back to QC with a required reason", async () => {
    decideMock.mockResolvedValue({ _id: "p1", status: "inProgress", items: [] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "ไม่อนุมัติรายการที่ 1" }));
    await screen.findByRole("dialog");
    const send = screen.getByRole("button", { name: "ส่งกลับ" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("เหตุผล"), { target: { value: "สีผิดปกติ" } });
    fireEvent.click(send);

    await waitFor(() => expect(decideMock).toHaveBeenCalledWith("p1", {
      side: "qc",
      decision: "reject",
      note: "สีผิดปกติ",
      items: [{ seq: 1, abnormal: false }],
    }));
  });

  it("keeps approve-all and the whole-petition reject in the fixed decision bar above TV overscan", async () => {
    renderPage();

    const approveAll = await screen.findByRole("button", { name: "อนุมัติทั้งหมด" });
    const actionBar = approveAll.closest(".fixed");
    expect(actionBar).not.toBeNull();
    expect(actionBar).toHaveClass("bottom-3");
    expect(actionBar).toHaveClass("pb-[calc(env(safe-area-inset-bottom)+0.75rem)]");
    expect(screen.getByRole("button", { name: "ไม่อนุมัติทั้งคำร้อง" })).toBeInTheDocument();
  });

  it("routes a whole-petition rejection with parameter references", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "ไม่อนุมัติทั้งคำร้อง" }));
    await screen.findByRole("dialog");
    expect(screen.getByText("ส่งให้ใคร")).toBeInTheDocument();
    expect(screen.getByLabelText("Lab")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("QC"));
    fireEvent.click(screen.getByLabelText("รายการที่ 1: ตัวอย่าง A / ความชื้น / ค่า pH"));
    fireEvent.change(screen.getByLabelText("รายละเอียด"), { target: { value: "ต้องตรวจใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งกลับ" }));

    await waitFor(() => expect(rejectPetitionMock).toHaveBeenCalledTimes(1));
    expect(rejectPetitionMock).toHaveBeenCalledWith("p1", "หัวหน้า QC", expect.stringContaining("ต้องตรวจใหม่"), "qc");
    expect(rejectPetitionMock.mock.calls[0][2]).toContain("อ้างอิง parameter: รายการที่ 1: ตัวอย่าง A / ความชื้น / ค่า pH");
    expect(navigateMock).toHaveBeenCalledWith("/qc-approval");
  });

  it("hides the Lab tab and Lab return target for a QC Approver", async () => {
    deniedTabs.add("lab");
    renderPage("/qc-approval/p1?tab=lab");

    expect(await screen.findByRole("tab", { name: "ผล QC" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "ผล Lab" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติทั้งคำร้อง" }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("QC")).toBeInTheDocument();
    expect(screen.queryByLabelText("Lab")).not.toBeInTheDocument();
  });

  it("opens the reject dialog from the decision query", async () => {
    renderPage("/qc-approval/p1?decision=reject");

    expect(await screen.findByRole("dialog")).toHaveTextContent("ไม่อนุมัติคำร้อง P-2607-0001");
  });
});
