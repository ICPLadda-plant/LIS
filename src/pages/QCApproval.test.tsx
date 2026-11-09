import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QCApproval from "./QCApproval";

const { navigateMock, deniedTabs } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
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
  default: ({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {description}
    </header>
  ),
}));

vi.mock("@/hooks/usePetition", () => ({
  usePetitionList: () => ({
    data: {
      items: [
        {
          _id: "p1",
          petitionNo: "P-2608-0001",
          dept: "rm",
          status: "inProgress",
          routeTargets: ["qc", "lab"],
          submittedBy: { name: "ผู้ยื่น A" },
          qcCompletedAt: "2026-08-05T01:00:00.000Z",
          labCompletedAt: null,
          completedAt: "2026-08-05T00:00:00.000Z",
          items: [{ seq: 1, sampleName: "ตัวอย่าง A", sendToQc: true, sendToLab: true }],
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
        {
          _id: "p2",
          petitionNo: "P-2608-0002",
          dept: "rm",
          status: "inProgress",
          routeTargets: ["qc", "lab"],
          submittedBy: { name: "ผู้ยื่น B" },
          qcCompletedAt: "2026-08-05T01:00:00.000Z",
          labCompletedAt: "2026-08-05T02:00:00.000Z",
          items: [{ seq: 1, sampleName: "ตัวอย่าง B", sendToQc: true, sendToLab: true }],
          itemApprovals: [{ seq: 1, side: "qc", status: "approved", conclusion: "pass", by: "QC Approver A", at: "2026-08-05T01:30:00.000Z" }],
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
    },
    loading: false,
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getAbnormalFlags: vi.fn(async () => ({})),
    getReturnedFlags: vi.fn(async () => ({})),
  },
}));

vi.mock("@/lib/aiApi", () => ({
  getAiStatus: vi.fn(async () => ({ available: false })),
  streamDraftNote: vi.fn(),
}));

vi.mock("@/hooks/useAccessibleTabs", () => ({
  useAccessibleTabs: () => ({ isVisible: (key: string) => !deniedTabs.has(key) }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <QCApproval />
    </MemoryRouter>,
  );
}

describe("QCApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deniedTabs.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ p1: ["Tester A"] }),
    })));
  });

  it("offers only a details button and shows that Lab results are still pending", async () => {
    renderPage();

    const row = screen.getByRole("row", { name: /P-2608-0001/ });
    expect(within(row).queryByRole("button", { name: "อนุมัติ" })).not.toBeInTheDocument();
    expect(within(row).getByText("รออนุมัติ")).toBeInTheDocument();
    expect(within(row).getByText("รอผล Lab")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "ดูรายละเอียด" }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/qc-approval/p1?tab=qc"));
  });

  it("tells the QC head who already passed the physical results", () => {
    renderPage();

    const row = screen.getByRole("row", { name: /P-2608-0002/ });
    expect(within(row).getByText("กายภาพผ่าน")).toBeInTheDocument();
    expect(within(row).getByText(/โดย QC Approver A/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "ดูรายละเอียด" }));
    expect(navigateMock).toHaveBeenCalledWith("/qc-approval/p2?tab=lab");
  });

  it("shows only physical status to a QC Approver", () => {
    deniedTabs.add("lab");
    renderPage();

    expect(screen.queryByRole("columnheader", { name: "ผู้ทดสอบ" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "กายภาพ" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "AI" })).not.toBeInTheDocument();
    // คำร้องที่กายภาพผ่านแล้วไม่ต้องรอ QC Approver อีก
    expect(screen.queryByRole("row", { name: /P-2608-0002/ })).not.toBeInTheDocument();
  });
});
