import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QCApproval from "./QCApproval";

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
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
          status: "success",
          submittedBy: { name: "ผู้ยื่น A" },
          qcCompletedAt: "2026-08-05T01:00:00.000Z",
          labCompletedAt: "2026-08-05T02:00:00.000Z",
          completedAt: "2026-08-05T00:00:00.000Z",
          items: [{ seq: 1, sampleName: "ตัวอย่าง A" }],
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
    getAbnormalFlags: vi.fn(async () => ({ p1: false })),
    getReturnedFlags: vi.fn(async () => ({ p1: false })),
  },
}));

vi.mock("@/lib/aiApi", () => ({
  getAiStatus: vi.fn(async () => ({ available: false })),
  streamDraftNote: vi.fn(),
}));

describe("QCApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ p1: ["Tester A"] }),
    })));
  });

  it("shows command choices instead of a status column", async () => {
    render(
      <MemoryRouter>
        <QCApproval />
      </MemoryRouter>,
    );

    expect(screen.getByRole("columnheader", { name: "คำสั่ง" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "สถานะ" })).not.toBeInTheDocument();

    const row = screen.getByRole("row", { name: /P-2608-0001/ });
    expect(within(row).getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "ไม่อนุมัติ" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "ตรวจสอบ" })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "ไม่อนุมัติ" }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/qc-approval/p1?tab=qc&decision=reject");
    });
  });

  it("separates submitted QC and Lab results into tabs", async () => {
    render(
      <MemoryRouter>
        <QCApproval />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tab", { name: "ผล QC (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ผล Lab (1)" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ยืนยันผลเมื่อ" })).toBeInTheDocument();
  });
});
