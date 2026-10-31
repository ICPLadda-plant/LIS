import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QueueDisplay from "./QueueDisplay";
import { usePetitionList } from "@/hooks/usePetition";
import { api } from "@/lib/api";
import { calculateQueueItemsPerColumn } from "@/lib/queueDisplayRows";
import type { Petition } from "@/types/petition.types";

vi.mock("@/hooks/usePetition", () => ({
  usePetitionList: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getParameters: vi.fn(),
    getQCProgress: vi.fn(),
    getReturnedFlags: vi.fn(),
  },
}));

const mockedUsePetitionList = vi.mocked(usePetitionList);
const mockedApi = vi.mocked(api);

const petition = {
  _id: "6aa25b630f8d55e75a609aa8",
  petitionNo: "P-2609-0004",
  dept: "production",
  status: "deliveringQC",
  submittedBy: { name: "ชนม์นุชา ภู่สุวรรณ", department: "LDI" },
  items: [
    {
      seq: 1,
      sampleName: "อัลแรม",
      commonName: "THIAMETHOXAM 25% WG",
      batchNo: "2025120701",
    },
  ],
  createdAt: "2026-09-10T07:25:23.316Z",
  updatedAt: "2026-09-11T10:04:10.866Z",
  qcReceivedAt: "2026-09-11T07:18:37.751Z",
} as Petition;

function makeQueuePetition(index: number): Petition {
  return {
    ...petition,
    _id: `petition-${index}`,
    petitionNo: `P-2609-${String(index).padStart(4, "0")}`,
    status: "sampleSent",
    updatedAt: `2026-09-11T10:${String(60 - index).padStart(2, "0")}:10.866Z`,
  } as Petition;
}

describe("QueueDisplay", () => {
  const audioPlay = vi.fn().mockResolvedValue(undefined);
  const audioPause = vi.fn();

  it("calculates visible queue rows from the available column height", () => {
    expect(calculateQueueItemsPerColumn(240)).toBe(1);
    expect(calculateQueueItemsPerColumn(380)).toBe(2);
    expect(calculateQueueItemsPerColumn(476)).toBe(3);
    expect(calculateQueueItemsPerColumn(560)).toBe(3);
    expect(calculateQueueItemsPerColumn(736)).toBe(5);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    audioPlay.mockResolvedValue(undefined);
    vi.stubGlobal("Audio", vi.fn(() => ({
      play: audioPlay,
      pause: audioPause,
      currentTime: 0,
      loop: false,
      muted: false,
      preload: "",
    })));
    mockedUsePetitionList.mockImplementation((params) => {
      const statuses = params.status?.split(",") ?? [];
      const items = statuses.includes(petition.status) ? [petition] : [];
      return {
        data: { items, total: items.length, page: 1, limit: 100 },
        loading: false,
        error: null,
        refresh: vi.fn(),
      };
    });
    mockedApi.getParameters.mockResolvedValue([
      {
        _id: "param-1",
        name: "สี",
        status: "active",
        scope: "qc",
        applyAll: true,
        valueFields: [{ label: "สี", type: "text" }],
      },
    ]);
    mockedApi.getQCProgress.mockResolvedValue({
      [petition._id]: [{ itemSeq: 1, parameterId: "param-1", filledLabels: ["สี"] }],
    });
    mockedApi.getReturnedFlags.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("arms queue notification audio automatically when the browser allows it", async () => {
    render(<QueueDisplay mode="qc" />);

    await waitFor(() => {
      expect(audioPlay).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: "เปิดเสียงแจ้งเตือน" })).not.toBeInTheDocument();
    });
    expect(audioPause).toHaveBeenCalledOnce();
  });

  it("arms queue notification audio on the first interaction anywhere when autoplay is blocked", async () => {
    audioPlay.mockRejectedValueOnce(new Error("NotAllowedError"));
    render(<QueueDisplay mode="qc" />);

    await waitFor(() => expect(audioPlay).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "เปิดเสียงแจ้งเตือน" })).toBeInTheDocument();

    window.dispatchEvent(new Event("pointerdown"));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "เปิดเสียงแจ้งเตือน" })).not.toBeInTheDocument();
    });
  });

  it("shows stale received deliveringQC petitions in the QC progress column", async () => {
    render(<QueueDisplay mode="qc" />);

    const progressHeading = screen.getByRole("heading", { name: "กำลังดำเนินการ" });
    const progressSection = progressHeading.closest("section");

    expect(progressSection).not.toBeNull();
    await waitFor(() => {
      expect(within(progressSection as HTMLElement).getByText("P-2609-0004")).toBeInTheDocument();
    });
  });

  it("loads progress for stale received deliveringQC petitions", async () => {
    render(<QueueDisplay mode="qc" />);

    await waitFor(() => {
      expect(mockedApi.getQCProgress).toHaveBeenCalledWith([petition._id]);
    });
    expect(await screen.findByText("100%")).toBeInTheDocument();
  });

  it("loads Lab waiting samples from the sampleSent queue directly", () => {
    render(<QueueDisplay mode="lab" />);

    expect(mockedUsePetitionList).toHaveBeenCalledWith({ page: 1, limit: 200, status: "sampleSent" });
  });

  describe("QC column follows the QC track", () => {
    const columnOf = (title: string) =>
      screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
    const serve = (items: Petition[]) =>
      mockedUsePetitionList.mockImplementation((params) => {
        const statuses = params.status?.split(",") ?? [];
        const matched = items.filter((item) => statuses.includes(item.status));
        return {
          data: { items: matched, total: matched.length, page: 1, limit: 100 },
          loading: false,
          error: null,
          refresh: vi.fn(),
        };
      });
    const fresh = (overrides: Partial<Petition>) =>
      ({
        ...petition,
        _id: "petition-new",
        petitionNo: "P-2611-0002",
        qcReceivedAt: undefined,
        qcCompletedAt: undefined,
        ...overrides,
      }) as Petition;

    it("keeps a sample in ตัวอย่างใหม่ only, even after Lab receives it first", async () => {
      serve([fresh({ status: "inProgress", labReceivedAt: "2026-09-11T07:00:00.000Z" })]);
      mockedApi.getQCProgress.mockResolvedValue({});
      render(<QueueDisplay mode="qc" />);

      await waitFor(() => expect(within(columnOf("ตัวอย่างใหม่")).getByText("P-2611-0002")).toBeInTheDocument());
      expect(within(columnOf("กำลังดำเนินการ")).queryByText("P-2611-0002")).not.toBeInTheDocument();
      expect(screen.getAllByText("P-2611-0002")).toHaveLength(1);
    });

    it("moves the sample to กำลังดำเนินการ once QC receives it", async () => {
      serve([fresh({ status: "pendingReview", qcReceivedAt: "2026-09-11T07:00:00.000Z" })]);
      mockedApi.getQCProgress.mockResolvedValue({});
      render(<QueueDisplay mode="qc" />);

      await waitFor(() => expect(within(columnOf("กำลังดำเนินการ")).getByText("P-2611-0002")).toBeInTheDocument());
      expect(within(columnOf("ตัวอย่างใหม่")).queryByText("P-2611-0002")).not.toBeInTheDocument();
    });

    it("moves the sample to กำลังดำเนินการ once QC starts recording results", async () => {
      serve([fresh({ status: "sampleSent" })]);
      mockedApi.getQCProgress.mockResolvedValue({
        "petition-new": [{ itemSeq: 1, parameterId: "param-1", filledLabels: ["สี"] }],
      });
      render(<QueueDisplay mode="qc" />);

      await waitFor(() => expect(within(columnOf("กำลังดำเนินการ")).getByText("P-2611-0002")).toBeInTheDocument());
      expect(within(columnOf("ตัวอย่างใหม่")).queryByText("P-2611-0002")).not.toBeInTheDocument();
    });
  });

  it("keeps empty queue groups visible while the overflowing column slides", async () => {
    vi.useFakeTimers();
    const queueItems = Array.from({ length: 6 }, (_, index) => makeQueuePetition(index + 1));

    mockedUsePetitionList.mockImplementation((params) => {
      const statuses = params.status?.split(",") ?? [];
      const items = statuses.includes("sampleSent") ? queueItems : [];
      return {
        data: { items, total: items.length, page: 1, limit: 100 },
        loading: false,
        error: null,
        refresh: vi.fn(),
      };
    });

    render(<QueueDisplay mode="lab" />);

    expect(screen.getByRole("heading", { name: "ตัวอย่างใหม่" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "กำลังดำเนินการ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "เรียบร้อยแล้ว" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("min-h-screen", "overflow-x-hidden", "lg:h-screen", "lg:overflow-hidden");
    expect(screen.getByTestId("queue-board")).toHaveClass("lg:overflow-hidden");
    expect(screen.getByTestId("queue-grid")).toHaveClass("grid-cols-1", "lg:grid-cols-3");
    const firstPage = screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 1" });
    expect(within(firstPage).getByText("P-2609-0001")).toBeInTheDocument();
    expect(within(firstPage).getByText("P-2609-0003")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });

    expect(within(screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 1" })).getByText("P-2609-0001")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    const secondPage = screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 2" });
    expect(within(secondPage).getByText("P-2609-0004")).toBeInTheDocument();
    expect(within(secondPage).getByText("P-2609-0006")).toBeInTheDocument();
  });

  it("resets overflowing columns to the first slide when queue items update", async () => {
    vi.useFakeTimers();
    let queueItems = Array.from({ length: 6 }, (_, index) => makeQueuePetition(index + 1));

    mockedUsePetitionList.mockImplementation((params) => {
      const statuses = params.status?.split(",") ?? [];
      const items = statuses.includes("sampleSent") ? queueItems : [];
      return {
        data: { items, total: items.length, page: 1, limit: 100 },
        loading: false,
        error: null,
        refresh: vi.fn(),
      };
    });

    const { rerender } = render(<QueueDisplay mode="lab" />);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(within(screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 2" })).getByText("P-2609-0004")).toBeInTheDocument();

    queueItems = queueItems.map((item, index) =>
      index === 0 ? ({ ...item, updatedAt: "2026-09-11T11:00:10.866Z" } as Petition) : item,
    );
    await act(async () => {
      rerender(<QueueDisplay mode="lab" />);
    });

    expect(within(screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 1" })).getByText("P-2609-0001")).toBeInTheDocument();
  });

  it("cycles overflowing queue columns automatically so every petition is shown", async () => {
    vi.useFakeTimers();
    const queueItems = Array.from({ length: 10 }, (_, index) => makeQueuePetition(index + 1));

    mockedUsePetitionList.mockImplementation((params) => {
      const statuses = params.status?.split(",") ?? [];
      const items = statuses.includes("sampleSent") ? queueItems : [];
      return {
        data: { items, total: items.length, page: 1, limit: 100 },
        loading: false,
        error: null,
        refresh: vi.fn(),
      };
    });

    render(<QueueDisplay mode="lab" />);

    expect(within(screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 1" })).getByText("P-2609-0001")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 1" })).getByText("P-2609-0003")).toBeInTheDocument();
    expect(screen.getByText(/หน้า 1\/4/)).toBeInTheDocument();
    expect(screen.queryByText(/แสดง 1-3 จาก 10 รายการ/)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(within(screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 2" })).getByText("P-2609-0004")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "ตัวอย่างใหม่ หน้า 2" })).getByText("P-2609-0006")).toBeInTheDocument();
    expect(screen.getByText(/หน้า 2\/4/)).toBeInTheDocument();
    expect(screen.queryByText(/แสดง 4-6 จาก 10 รายการ/)).not.toBeInTheDocument();
  });
});
