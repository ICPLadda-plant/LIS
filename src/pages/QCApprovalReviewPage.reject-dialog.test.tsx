import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QCApprovalReviewPage from "./QCApprovalReviewPage";

const { navigateMock, approvePetitionMock, rejectPetitionMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  approvePetitionMock: vi.fn(),
  rejectPetitionMock: vi.fn(),
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
  }),
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
    approvePetition: approvePetitionMock,
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

describe("QCApprovalReviewPage reject dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approvePetitionMock.mockResolvedValue({
      _id: "p1",
      petitionNo: "P-2607-0001",
      status: "approved",
      approvedAt: "2026-07-13T01:00:00.000Z",
      items: [{ seq: 1, sampleName: "ตัวอย่าง A", batchNo: "RM-1", sampleId: "S-1" }],
    });
    rejectPetitionMock.mockResolvedValue({});
  });

  it("uses approve/reject wording and routes a rejection with parameter references", async () => {
    renderPage();

    await screen.findByRole("button", { name: "อนุมัติ" });
    expect(screen.getByRole("button", { name: "ไม่อนุมัติ" })).toBeInTheDocument();
    expect(screen.queryByText("ถ้าให้ทดสอบใหม่ ส่งกลับไปยัง:")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ผลถูกต้อง" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ผลไม่ถูกต้อง" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติ" }));

    await screen.findByRole("dialog");
    expect(screen.getByText("ส่งให้ใคร")).toBeInTheDocument();
    expect(screen.getByLabelText("ผู้ยื่น")).toBeInTheDocument();
    expect(screen.getByLabelText("QC")).toBeInTheDocument();
    expect(screen.getByLabelText("Lab")).toBeInTheDocument();
    expect(screen.getByLabelText("รายการที่ 1: ตัวอย่าง A / ความชื้น / ค่า pH")).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "ส่งกลับ" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText("QC"));
    fireEvent.click(screen.getByLabelText("รายการที่ 1: ตัวอย่าง A / ความชื้น / ค่า pH"));
    fireEvent.change(screen.getByLabelText("รายละเอียด"), {
      target: { value: "ต้องตรวจใหม่" },
    });

    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(rejectPetitionMock).toHaveBeenCalledTimes(1));
    expect(rejectPetitionMock).toHaveBeenCalledWith(
      "p1",
      "หัวหน้า QC",
      expect.stringContaining("ต้องตรวจใหม่"),
      "qc",
    );
    expect(rejectPetitionMock.mock.calls[0][2]).toContain(
      "อ้างอิง parameter: รายการที่ 1: ตัวอย่าง A / ความชื้น / ค่า pH",
    );
    expect(navigateMock).toHaveBeenCalledWith("/qc-approval");
  });

  it("keeps the fixed decision bar above TV overscan at the viewport bottom", async () => {
    renderPage();

    const approveButton = await screen.findByRole("button", { name: /^อนุมัติ$/ });
    const actionBar = approveButton.closest(".fixed");

    expect(actionBar).not.toBeNull();
    expect(actionBar).toHaveClass("bottom-3");
    expect(actionBar).not.toHaveClass("bottom-0");
    expect(actionBar).toHaveClass("pb-[calc(env(safe-area-inset-bottom)+0.75rem)]");
  });

  it("approves and returns to the QC approval list", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^อนุมัติ$/ }));

    await waitFor(() => expect(approvePetitionMock).toHaveBeenCalledTimes(1));
    expect(approvePetitionMock).toHaveBeenCalledWith("p1", "หัวหน้า QC", "pass", undefined);
    expect(navigateMock).toHaveBeenCalledWith("/qc-approval");
  });

  it("opens the reject dialog from the decision query", async () => {
    renderPage("/qc-approval/p1?decision=reject");

    expect(await screen.findByRole("dialog")).toHaveTextContent("ไม่อนุมัติคำร้อง P-2607-0001");
    expect(screen.getByText("ส่งให้ใคร")).toBeInTheDocument();
  });
});
