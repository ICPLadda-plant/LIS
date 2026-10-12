import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartSpec, KpiId } from "@/lib/dashboardProfiles";
import type { Petition } from "@/types/petition.types";

interface CapturedKpiProps {
  kpis?: KpiId[];
  activeKpi?: KpiId;
  onKpiClick?: (id: KpiId) => void;
  extraCards?: React.ReactNode;
  extraCardsAfter?: number;
}

interface CapturedActionTableProps {
  title?: string;
  statusBadge?: (petition: Petition) => { label: string };
  urgentIds: Set<string>;
}

interface CapturedAnalyticsProps {
  specs: ChartSpec[];
}

const state = vi.hoisted(() => ({
  roles: ["lab-analyze", "lab-inventory", "lab-data-config"] as string[],
  petitions: [] as Petition[],
  kpiProps: [] as CapturedKpiProps[],
  actionTableProps: [] as CapturedActionTableProps[],
  analyticsProps: [] as CapturedAnalyticsProps[],
}));

const ctx = vi.hoisted(() => ({
  now: Date.now(),
  abnormalFlags: {},
  returnedFlags: {},
  labInventorySummary: { nearEmpty: 0, outOfStock: 0, nearExpiry: 0, todayDeductions: 0, rows: [] },
  labInventoryLoading: false,
  simpleMethodCoverage: [],
  standardTimeCoverage: [],
  configCoverageLoading: false,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "analyst@example.com", roles: state.roles } }),
}));
vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => ({ petitions: state.petitions, ctx, refresh: vi.fn() }),
}));
vi.mock("@/lib/accessControlSource", () => ({
  loadAccessControl: () => Promise.resolve({ roles: [] }),
}));
vi.mock("@/lib/accessNav", () => ({
  getAccessibleNavItemsForRoles: () => [],
}));
vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/dashboard/DashboardHeader", () => ({ default: () => <div>Header</div> }));
vi.mock("@/components/dashboard/KpiRow", () => ({
  default: (props: CapturedKpiProps) => {
    state.kpiProps.push(props);
    return <div data-testid="kpis">KPIs{props.extraCards}</div>;
  },
}));
vi.mock("@/components/dashboard/DailyCheckProgressCard", () => ({ default: () => <div>Daily checks</div> }));
vi.mock("@/components/dashboard/ActionTable", () => ({
  default: (props: CapturedActionTableProps) => {
    state.actionTableProps.push(props);
    return <div data-testid="primary-content">{props.title ?? "Primary content"}</div>;
  },
}));
vi.mock("@/components/dashboard/WorkflowSummary", () => ({ default: () => <div>Workflow</div> }));
vi.mock("@/components/dashboard/AnalyticsSection", () => ({
  default: (props: CapturedAnalyticsProps) => {
    state.analyticsProps.push(props);
    return <div>Analytics</div>;
  },
}));
vi.mock("@/components/dashboard/ActivityTimeline", () => ({ default: () => <div>Activity</div> }));
vi.mock("@/components/dashboard/ConfigCoveragePies", () => ({ default: () => <div data-testid="config-coverage">Config coverage</div> }));
vi.mock("@/components/dashboard/LabInventorySummary", () => ({ default: () => <div data-testid="inventory-summary">Inventory summary</div> }));
vi.mock("@/components/dashboard/GenericMenuGrid", () => ({ default: () => <div>Menu</div> }));
vi.mock("@/components/dashboard/exec/ExecDashboard", () => ({ default: () => <div data-testid="exec-dashboard">Exec dashboard</div> }));

import RoleDashboard from "./RoleDashboard";

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoleDashboard />
    </QueryClientProvider>,
  );
}

function domOrder(container: HTMLElement, testIds: string[]) {
  return testIds.map((testId) => {
    const node = screen.getByTestId(testId);
    return Array.prototype.indexOf.call(container.querySelectorAll("*"), node);
  });
}

describe("RoleDashboard overlays", () => {
  beforeEach(() => {
    state.roles = ["lab-analyze", "lab-inventory", "lab-data-config"];
    state.petitions = [];
    state.kpiProps = [];
    state.actionTableProps = [];
    state.analyticsProps = [];
  });

  it("keeps Lab Analyze primary content before config and inventory overlays", () => {
    const { container } = renderDashboard();

    expect(domOrder(container, ["primary-content", "config-coverage", "inventory-summary"]))
      .toEqual([...domOrder(container, ["primary-content", "config-coverage", "inventory-summary"])].sort((a, b) => a - b));
  });

  it("places the primary Lab Inventory card directly after KPIs", () => {
    state.roles = ["lab-inventory"];
    const { container } = renderDashboard();

    expect(domOrder(container, ["kpis", "inventory-summary", "primary-content"]))
      .toEqual([...domOrder(container, ["kpis", "inventory-summary", "primary-content"])].sort((a, b) => a - b));
  });

  it("renders Lab Head as a dedicated dashboard with Daily Check and a period chart", () => {
    state.roles = ["lab-head"];
    renderDashboard();

    expect(screen.getByText("Daily checks")).toBeInTheDocument();
    expect(state.kpiProps.at(-1).kpis).toEqual([
      "urgentTotal",
      "labHeadAll",
      "completedToday",
      "pendingAssign",
      "labHeadWaitingReceive",
      "labHeadPendingApproval",
    ]);
    expect(state.kpiProps.at(-1).extraCardsAfter).toBe(1);
    expect(state.kpiProps.at(-1).activeKpi).toBe("labHeadAll");
    expect(state.actionTableProps.at(-1).title).toBe("งานที่กำลังดำเนินการ");
    expect(state.analyticsProps.at(-1).specs).toEqual([
      { kind: "labHeadAnalystBar", title: "จำนวนงานต่อผู้วิเคราะห์" },
    ]);
  });

  it("lets Lab Head override Lab Analyze when the user has both roles", () => {
    state.roles = ["lab-head", "lab-analyze"];
    renderDashboard();

    expect(screen.getByText("Daily checks")).toBeInTheDocument();
    expect(state.kpiProps.at(-1).activeKpi).toBe("labHeadAll");
    expect(state.actionTableProps.at(-1).title).toBe("งานที่กำลังดำเนินการ");
  });

  it("uses Lab Head KPI clicks to filter the worklist table", () => {
    state.roles = ["lab-head"];
    renderDashboard();

    const firstClick = state.kpiProps.at(-1).onKpiClick;
    expect(firstClick).toBeTypeOf("function");
    act(() => firstClick?.("labHeadWaitingReceive"));
    expect(state.kpiProps.at(-1).activeKpi).toBe("labHeadWaitingReceive");
    expect(state.actionTableProps.at(-1).title).toBe("รอรับ");

    const assignClick = state.kpiProps.at(-1).onKpiClick;
    expect(assignClick).toBeTypeOf("function");
    act(() => assignClick?.("pendingAssign"));
    expect(state.kpiProps.at(-1).activeKpi).toBe("pendingAssign");
    expect(state.actionTableProps.at(-1).title).toBe("รอ assign");
    expect(state.actionTableProps.at(-1).statusBadge?.({ status: "sampleSent" } as Petition).label).toBe("รอรับ");
    expect(state.actionTableProps.at(-1).statusBadge?.({
      status: "sampleSent",
      assignedTo: { employeeId: "E1", name: "Analyst A" },
    } as Petition).label).toBe("รอรับ");

    const secondClick = state.kpiProps.at(-1).onKpiClick;
    expect(secondClick).toBeTypeOf("function");
    act(() => secondClick?.("labHeadPendingApproval"));
    expect(state.kpiProps.at(-1).activeKpi).toBe("labHeadPendingApproval");
    expect(state.actionTableProps.at(-1).title).toBe("รอออกผล");
  });

  it("does not show the activity timeline on the QC Staff home dashboard", () => {
    state.roles = ["qc-staff"];
    renderDashboard();

    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
  });

  it("renders the Executive Dashboard for the admin profile", () => {
    // Regression coverage: every other profile has a dedicated assertion below,
    // but until now nothing pinned the admin → ExecDashboard wiring in
    // RoleDashboard.tsx — a silent revert of that branch would go uncaught.
    state.roles = ["admin"];
    renderDashboard();

    expect(screen.getByTestId("exec-dashboard")).toBeInTheDocument();
  });

  it("uses persisted priority to flag dashboard work as urgent", () => {
    state.roles = ["viewer"];
    state.petitions = [
      { _id: "urgent", petitionNo: "P-URGENT", dept: "production", status: "inProgress", priority: 1, submittedBy: { name: "A" }, items: [], createdAt: "2026-07-06T01:00:00.000Z", updatedAt: "2026-07-06T01:00:00.000Z" },
      { _id: "normal", petitionNo: "P-NORMAL", dept: "production", status: "inProgress", priority: 0, submittedBy: { name: "B" }, items: [], createdAt: "2026-07-06T01:00:00.000Z", updatedAt: "2026-07-06T01:00:00.000Z" },
    ] as Petition[];

    renderDashboard();

    expect(state.actionTableProps.at(-1).urgentIds).toEqual(new Set(["urgent"]));
  });
});
