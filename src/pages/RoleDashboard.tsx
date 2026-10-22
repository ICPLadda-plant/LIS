import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/lis/AppLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import KpiRow from "@/components/dashboard/KpiRow";
import DailyCheckProgressCard from "@/components/dashboard/DailyCheckProgressCard";
import ActionTable from "@/components/dashboard/ActionTable";
import WorkflowSummary from "@/components/dashboard/WorkflowSummary";
import AnalyticsSection from "@/components/dashboard/AnalyticsSection";
import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import ConfigCoveragePies from "@/components/dashboard/ConfigCoveragePies";
import LabInventorySummaryCard from "@/components/dashboard/LabInventorySummary";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { normalizeRoles } from "@/lib/roles";
import {
  resolveProfileForRole,
  resolveDashboardRole,
  DASHBOARD_PROFILES,
  labDataConfigCoveragePlacement,
  labInventorySummaryPlacement,
  weekdayWorkflowBasis,
  type KpiId,
} from "@/lib/dashboardProfiles";
import {
  buildLabHeadWorklist,
  buildQcStaffWorklist,
  buildLabWorklist,
  labHeadWorklistCounts,
  isAssignedToUser,
  labWorklistCounts,
  paginateLabWorklist,
  prioritizeUrgentPetitions,
  isUrgentPetition,
  qcStaffWorklistCounts,
  type LabHeadWorklistFilter,
  type LabHeadWorkloadPeriod,
  type LabWorklistFilter,
  type QcStaffWorklistFilter,
} from "@/lib/dashboardMetrics";
import { labTrackStatusBadge, qcTrackStatusBadge } from "@/lib/receiveStatus";
import { useDashboardData } from "@/hooks/useDashboardData";
import { loadAccessControl } from "@/lib/accessControlSource";
import GenericMenuGrid from "@/components/dashboard/GenericMenuGrid";
import ExecDashboard from "@/components/dashboard/exec/ExecDashboard";
import { ChevronLeft, ChevronRight } from "lucide-react";

const ACTION_LABEL: Record<string, string> = {
  "qc-reviewer": "ออก Final Result", "qc-head": "ออก Final Result", "qc-staff": "ดำเนินการ",
  "lab-analyze": "บันทึกผล", "lab-head": "ออกผล", "lab-config": "ดูรายละเอียด",
  "lab-inventory": "จัดการ", admin: "ดูรายละเอียด", viewer: "ดูรายละเอียด",
};

const API_BASE = import.meta.env.BASE_URL + "api";

const QC_STAFF_TABLE_TITLE: Record<QcStaffWorklistFilter, string> = {
  waitingReceive: "งานรอรับ",
  inProgress: "กำลังดำเนินการ",
  waitingReview: "รอตรวจ",
  approvedToday: "เสร็จวันนี้",
};

const QC_STAFF_FILTERS: readonly QcStaffWorklistFilter[] = [
  "waitingReceive",
  "inProgress",
  "waitingReview",
  "approvedToday",
];

const LAB_HEAD_FILTER_BY_KPI: Partial<Record<KpiId, LabHeadWorklistFilter>> = {
  labHeadAll: "all",
  labHeadWaitingReceive: "waitingReceive",
  pendingAssign: "pendingAssign",
  labHeadPendingApproval: "pendingApproval",
  completedToday: "completedToday",
};

const LAB_HEAD_KPI_BY_FILTER: Record<LabHeadWorklistFilter, KpiId> = {
  all: "labHeadAll",
  waitingReceive: "labHeadWaitingReceive",
  pendingAssign: "pendingAssign",
  pendingApproval: "labHeadPendingApproval",
  completedToday: "completedToday",
};

const LAB_HEAD_TABLE_TITLE: Record<LabHeadWorklistFilter, string> = {
  all: "งานที่กำลังดำเนินการ",
  waitingReceive: "รอรับ",
  pendingAssign: "รอ assign",
  pendingApproval: "รอออกผล",
  completedToday: "เสร็จวันนี้",
};

const LAB_HEAD_ACTION_LABEL: Record<LabHeadWorklistFilter, string> = {
  all: "ดูรายละเอียด",
  waitingReceive: "ดูรายละเอียด",
  pendingAssign: "Assign",
  pendingApproval: "ตรวจสอบ",
  completedToday: "ดูรายละเอียด",
};

const LAB_HEAD_ACTION_PATH_PREFIX: Record<LabHeadWorklistFilter, string> = {
  all: "/petition",
  waitingReceive: "/petition",
  pendingAssign: "/petition",
  pendingApproval: "/lab-approval",
  completedToday: "/petition",
};

function isQcStaffFilter(id: KpiId): id is QcStaffWorklistFilter {
  return QC_STAFF_FILTERS.includes(id as QcStaffWorklistFilter);
}

export default function RoleDashboard() {
  const { user } = useAuth();
  const roles = normalizeRoles(user);
  const [labFilter, setLabFilter] = useState<LabWorklistFilter>("inProgress");
  const [labPage, setLabPage] = useState(1);
  const [labHeadFilter, setLabHeadFilter] = useState<LabHeadWorklistFilter>("all");
  const [labHeadPage, setLabHeadPage] = useState(1);
  const [labHeadPeriod, setLabHeadPeriod] = useState<LabHeadWorkloadPeriod>("today");
  const [qcStaffFilter, setQcStaffFilter] = useState<QcStaffWorklistFilter>("inProgress");
  const [qcStaffPage, setQcStaffPage] = useState(1);

  const { data: access } = useQuery({ queryKey: ["access-control"], queryFn: () => loadAccessControl() });
  const roleObjs = access?.roles ?? [];

  // resolveProfileForRole returns null for a custom/unknown role with no real
  // profile match (explicit `viewer` role still resolves to "viewer" via the
  // default map). Hooks below must stay unconditional, so we feed
  // useDashboardData a harmless placeholder profile in the no-match case and
  // branch only on what gets rendered.
  const profileId = resolveProfileForRole(resolveDashboardRole(roles), roleObjs);
  const profile = profileId ? DASHBOARD_PROFILES[profileId] : null;
  const { petitions, ctx } = useDashboardData(profile ?? DASHBOARD_PROFILES.viewer);
  const isLabAnalyze = profileId === "lab-analyze";
  const isLabHead = profileId === "lab-head";
  const isQcStaff = profileId === "qc-staff";
  const weekdayBasis = weekdayWorkflowBasis(profileId);
  const showActivityTimeline = !isLabAnalyze && !isLabHead && !isQcStaff;
  const inventorySummaryPlacement = labInventorySummaryPlacement(roles, profileId);
  const inventorySummarySection = inventorySummaryPlacement === "hidden" ? null : (
    <LabInventorySummaryCard
      summary={ctx.labInventorySummary}
      loading={ctx.labInventoryLoading}
    />
  );
  const labConfigCoveragePlacement = labDataConfigCoveragePlacement(roles, profileId);
  const labConfigCoverageSection = labConfigCoveragePlacement === "hidden" ? null : (
    <ConfigCoveragePies
      simpleMethodData={ctx.simpleMethodCoverage}
      standardTimeData={ctx.standardTimeCoverage}
      loading={ctx.configCoverageLoading}
    />
  );
  const qcStaffIdsParam = useMemo(() => petitions.map((p) => p._id).join(","), [petitions]);
  const { data: qcParticipants = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["dash", "qc-testers", qcStaffIdsParam],
    enabled: isQcStaff && qcStaffIdsParam.length > 0,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/qc-results/testers?petitionIds=${encodeURIComponent(qcStaffIdsParam)}`, {
        cache: "no-store",
      });
      if (!res.ok) return {};
      return (await res.json()) as Record<string, string[]>;
    },
  });
  const labRows = useMemo(
    () => buildLabWorklist(petitions, labFilter, user, ctx.now),
    [petitions, labFilter, user, ctx.now],
  );
  const labAssignedPetitions = useMemo(
    () => petitions.filter((p) => isAssignedToUser(p, user)),
    [petitions, user],
  );
  const labAnalyticsCtx = useMemo(
    () => ({ ...ctx, petitions: labAssignedPetitions }),
    [ctx, labAssignedPetitions],
  );
  const labKpiValues = useMemo(() => labWorklistCounts(petitions, user, ctx.now), [petitions, user, ctx.now]);
  const labPageData = useMemo(
    () => paginateLabWorklist(prioritizeUrgentPetitions(labRows), labPage),
    [labRows, labPage],
  );
  const labHeadRows = useMemo(
    () => buildLabHeadWorklist(petitions, labHeadFilter, ctx.now),
    [petitions, labHeadFilter, ctx.now],
  );
  const labHeadKpiValues = useMemo(() => {
    const counts = labHeadWorklistCounts(petitions, ctx.now);
    return {
      labHeadAll: counts.all,
      labHeadWaitingReceive: counts.waitingReceive,
      pendingAssign: counts.pendingAssign,
      labHeadPendingApproval: counts.pendingApproval,
      completedToday: counts.completedToday,
    };
  }, [petitions, ctx.now]);
  const labHeadPageData = useMemo(
    () => paginateLabWorklist(prioritizeUrgentPetitions(labHeadRows), labHeadPage),
    [labHeadRows, labHeadPage],
  );
  const qcStaffRows = useMemo(
    () => buildQcStaffWorklist(petitions, qcStaffFilter, user, ctx.now, qcParticipants),
    [petitions, qcStaffFilter, user, ctx.now, qcParticipants],
  );
  const qcStaffKpiValues = useMemo(
    () => qcStaffWorklistCounts(petitions, user, ctx.now, qcParticipants),
    [petitions, user, ctx.now, qcParticipants],
  );
  const qcStaffPageData = useMemo(
    () => paginateLabWorklist(prioritizeUrgentPetitions(qcStaffRows), qcStaffPage),
    [qcStaffRows, qcStaffPage],
  );

  const urgentIds = useMemo(
    () => new Set(petitions.filter(isUrgentPetition).map((petition) => petition._id)),
    [petitions],
  );

  const handleLabKpiClick = (id: KpiId) => {
    if (id !== "assignedToMe" && id !== "inProgress" && id !== "completedToday") return;
    setLabFilter(id);
    setLabPage(1);
  };

  const handleLabHeadKpiClick = (id: KpiId) => {
    const nextFilter = LAB_HEAD_FILTER_BY_KPI[id];
    if (!nextFilter) return;
    setLabHeadFilter(nextFilter);
    setLabHeadPage(1);
  };

  const handleQcStaffKpiClick = (id: KpiId) => {
    if (!isQcStaffFilter(id)) return;
    setQcStaffFilter(id);
    setQcStaffPage(1);
  };

  const labPaginationFooter = (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        หน้า {labPageData.page}/{labPageData.totalPages} · {labPageData.total} รายการ
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={labPageData.page <= 1}
          onClick={() => setLabPage((page) => Math.max(1, page - 1))}
          aria-label="หน้าก่อนหน้า"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={labPageData.page >= labPageData.totalPages}
          onClick={() => setLabPage((page) => Math.min(labPageData.totalPages, page + 1))}
          aria-label="หน้าถัดไป"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const labHeadPaginationFooter = (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        หน้า {labHeadPageData.page}/{labHeadPageData.totalPages} · {labHeadPageData.total} รายการ
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={labHeadPageData.page <= 1}
          onClick={() => setLabHeadPage((page) => Math.max(1, page - 1))}
          aria-label="หน้าก่อนหน้า"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={labHeadPageData.page >= labHeadPageData.totalPages}
          onClick={() => setLabHeadPage((page) => Math.min(labHeadPageData.totalPages, page + 1))}
          aria-label="หน้าถัดไป"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const qcStaffPaginationFooter = (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        หน้า {qcStaffPageData.page}/{qcStaffPageData.totalPages} · {qcStaffPageData.total} รายการ
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={qcStaffPageData.page <= 1}
          onClick={() => setQcStaffPage((page) => Math.max(1, page - 1))}
          aria-label="หน้าก่อนหน้า"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={qcStaffPageData.page >= qcStaffPageData.totalPages}
          onClick={() => setQcStaffPage((page) => Math.min(qcStaffPageData.totalPages, page + 1))}
          aria-label="หน้าถัดไป"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  if (!profileId || !profile) {
    return (
      <AppLayout>
        <GenericMenuGrid />
      </AppLayout>
    );
  }

  if (profileId === "admin") {
    return (
      <AppLayout>
        <ExecDashboard />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <DashboardHeader
        titleEn={profile.titleEn}
        subtitleTh={profile.subtitleTh}
      />
      {labConfigCoveragePlacement === "top" ? labConfigCoverageSection : null}
      <KpiRow
        kpis={profile.kpis}
        ctx={ctx}
        activeKpi={isLabAnalyze ? labFilter : isLabHead ? LAB_HEAD_KPI_BY_FILTER[labHeadFilter] : isQcStaff ? qcStaffFilter : undefined}
        onKpiClick={isLabAnalyze ? handleLabKpiClick : isLabHead ? handleLabHeadKpiClick : isQcStaff ? handleQcStaffKpiClick : undefined}
        valueOverrides={isLabAnalyze ? labKpiValues : isLabHead ? labHeadKpiValues : isQcStaff ? qcStaffKpiValues : undefined}
        presentation={isLabAnalyze || isLabHead || isQcStaff ? "widgets" : "default"}
        extraCardsAfter={isLabHead ? 1 : undefined}
        extraCards={isLabAnalyze || isLabHead ? (
          <DailyCheckProgressCard
            done={ctx.dailyCheckDone}
            pending={ctx.dailyCheckPending}
            total={ctx.dailyCheckTotal}
            loading={ctx.dailyCheckLoading}
          />
        ) : undefined}
      />
      {inventorySummaryPlacement === "top" ? inventorySummarySection : null}
      {isLabHead ? (
        <div className="mb-4">
          <ActionTable
            petitions={labHeadPageData.pageRows}
            title={LAB_HEAD_TABLE_TITLE[labHeadFilter]}
            emptyMessage="ไม่มีงานในหมวดนี้"
            actionLabel={LAB_HEAD_ACTION_LABEL[labHeadFilter]}
            actionPathPrefix={LAB_HEAD_ACTION_PATH_PREFIX[labHeadFilter]}
            urgentIds={urgentIds}
            sortRows={false}
            statusBadge={labTrackStatusBadge}
            footer={labHeadPaginationFooter}
          />
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,65fr)_35fr]">
          <ActionTable
            petitions={isLabAnalyze ? labPageData.pageRows : isQcStaff ? qcStaffPageData.pageRows : petitions}
            title={isLabAnalyze ? "งานที่กำลังดำเนินการ" : isQcStaff ? QC_STAFF_TABLE_TITLE[qcStaffFilter] : undefined}
            emptyMessage={isLabAnalyze ? "ไม่มีงานในหมวดนี้" : isQcStaff ? "ไม่มีงานในหมวดนี้" : undefined}
            actionLabel={ACTION_LABEL[profileId] ?? "ดูรายละเอียด"}
            actionPathPrefix={isLabAnalyze ? "/lab-testing" : isQcStaff ? "/qc-testing" : "/petition"}
            urgentIds={urgentIds}
            sortRows={!isLabAnalyze && !isQcStaff}
            statusBadge={isLabAnalyze ? labTrackStatusBadge : isQcStaff ? qcTrackStatusBadge : undefined}
            footer={isLabAnalyze ? labPaginationFooter : isQcStaff ? qcStaffPaginationFooter : undefined}
          />
          {isLabAnalyze ? (
            <AnalyticsSection
              specs={profile.analytics}
              ctx={labAnalyticsCtx}
              layout="single"
              weekdayBasis="labAssigned"
            />
          ) : profile.workflow ? (
            <WorkflowSummary
              kind={profile.workflow}
              petitions={petitions}
              now={ctx.now}
              weekdayBasis={weekdayBasis}
            />
          ) : <div />}
        </div>
      )}
      {!isLabAnalyze ? (
        <AnalyticsSection
          specs={profile.analytics}
          ctx={ctx}
          labHeadPeriod={labHeadPeriod}
          onLabHeadPeriodChange={isLabHead ? setLabHeadPeriod : undefined}
          weekdayBasis={weekdayBasis}
        />
      ) : null}
      {showActivityTimeline ? <ActivityTimeline kind={profile.activity} /> : null}
      {labConfigCoveragePlacement === "bottom" ? labConfigCoverageSection : null}
      {inventorySummaryPlacement === "bottom" ? inventorySummarySection : null}
    </AppLayout>
  );
}
