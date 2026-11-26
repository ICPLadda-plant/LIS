import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import KpiRow from "./KpiRow";
import type { MetricsCtx } from "@/lib/dashboardMetrics";
import type { KpiId } from "@/lib/dashboardProfiles";
import DailyCheckProgressCard from "./DailyCheckProgressCard";

const KPI_IDS: KpiId[] = [
  "urgentTotal",
  "usersTotal",
  "usersActive",
  "rolesTotal",
  "activeTotal",
  "dailyCheckPending",
  "assignedToMe",
  "inProgress",
  "completedToday",
  "methodGaps",
  "masterItemsTotal",
];

const ctx: MetricsCtx = {
  petitions: [],
  now: Date.now(),
  abnormalFlags: {},
  returnedFlags: {},
  pendingQcCount: 0,
  assignedToMeCount: 0,
  usersTotal: 0,
  usersActive: 0,
  rolesTotal: 0,
  dailyCheckPending: 0,
  dailyCheckDone: 0,
  dailyCheckTotal: 0,
  dailyCheckLoading: false,
  stockLow: 0,
  stockExpiring: 0,
  withdrawalsToday: 0,
  withdrawalsYesterday: 0,
  qcApprovedToday: 0,
  qcApprovedYesterday: 0,
  methodGaps: 0,
  masterItemsTotal: 0,
  labInventorySummary: {
    nearEmpty: 0,
    outOfStock: 0,
    nearExpiry: 0,
    todayDeductions: 0,
    rows: [],
  },
  labInventoryLoading: false,
  deductionTrend: [],
  simpleMethodCoverage: [],
  standardTimeCoverage: [],
  configCoverageLoading: false,
};

describe("KpiRow", () => {
  it.each([
    [5, "md:grid-cols-3"],
    [6, "md:grid-cols-3"],
    [7, "md:grid-cols-4"],
    [8, "md:grid-cols-4"],
    [9, "md:grid-cols-3"],
    [10, "md:grid-cols-4"],
    [11, "md:grid-cols-4"],
  ] as const)("uses the requested desktop grid for %i cards", (count, gridClass) => {
    const { container } = render(
      <MemoryRouter>
        <KpiRow kpis={KPI_IDS.slice(0, count)} ctx={ctx} />
      </MemoryRouter>,
    );

    // children[0] = แถวชิป (มือถือ), children[1] = grid การ์ด (>= 768px)
    expect(container.children[1]).toHaveClass("hidden", "md:grid", "grid-cols-1", gridClass);
  });

  it("renders widget cards three per row and can place extra cards after the first KPI", () => {
    const { container } = render(
      <MemoryRouter>
        <KpiRow
          kpis={[
            "labHeadAll",
            "completedToday",
            "pendingAssign",
            "labHeadWaitingReceive",
            "labHeadPendingApproval",
          ]}
          ctx={ctx}
          presentation="widgets"
          extraCards={<DailyCheckProgressCard done={4} pending={2} total={6} />}
          extraCardsAfter={1}
        />
      </MemoryRouter>,
    );

    const grid = container.children[1];
    expect(grid).toHaveClass("md:grid-cols-6");
    expect(grid).not.toHaveClass("md:grid-cols-4");
    expect(grid).not.toHaveClass("xl:grid-cols-8");

    const childText = Array.from(grid?.children ?? []).map((child) => child.textContent ?? "");
    expect(childText).toHaveLength(6);
    expect(childText[0]).toContain("งานทั้งหมด");
    expect(childText[1]).toContain("Daily Check");
    expect(childText[2]).toContain("เสร็จวันนี้");
    expect(childText[3]).toContain("รอ assign");
    expect(childText[4]).toContain("รอรับ");
    expect(childText[5]).toContain("รอออกผล");

    // การ์ด KPI ถูกห่อด้วย wrapper ที่ซ่อนบนมือถือ (md:contents) — class อยู่ที่การ์ดข้างใน
    expect(grid?.children[0]).toHaveClass("hidden", "md:contents");
    expect(grid?.children[0].firstElementChild).toHaveClass("md:col-span-2");
    expect(grid?.children[0].firstElementChild).not.toHaveClass("col-span-2");
    expect(grid?.children[1]).toHaveClass("md:col-span-2");
    expect(grid?.children[1]).not.toHaveClass("col-span-2");
  });

  it("keeps widget rows with four or fewer cards on the compact grid", () => {
    const { container } = render(
      <MemoryRouter>
        <KpiRow
          kpis={["assignedToMe", "inProgress", "completedToday"]}
          ctx={ctx}
          presentation="widgets"
          extraCards={<div data-testid="daily-check-card">Daily Check</div>}
        />
      </MemoryRouter>,
    );

    const grid = container.children[1];
    expect(grid).toHaveClass("md:grid-cols-8");
    expect(grid).not.toHaveClass("md:grid-cols-4");
    expect(grid).not.toHaveClass("md:grid-cols-6");
  });

  it("shows KPI cards as filter chips on mobile that reuse the same click handler", () => {
    const onKpiClick = vi.fn();
    render(
      <MemoryRouter>
        <KpiRow
          kpis={["assignedToMe", "inProgress"]}
          ctx={ctx}
          presentation="widgets"
          activeKpi="inProgress"
          onKpiClick={onKpiClick}
        />
      </MemoryRouter>,
    );

    const chipRow = screen.getByRole("group", { name: "ตัวกรองสรุป" });
    expect(chipRow).toHaveClass("md:hidden", "overflow-x-auto");
    const chips = within(chipRow).getAllByRole("button");
    expect(chips).toHaveLength(2);
    chips.forEach((chip) => expect(chip).toHaveClass("h-11"));
    expect(chips[1]).toHaveAttribute("aria-pressed", "true");
    expect(chips[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chips[0]);
    expect(onKpiClick).toHaveBeenCalledWith("assignedToMe");
  });
});
