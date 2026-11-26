import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, AlertTriangle, RotateCcw, Sparkles, Loader2, Eye } from "lucide-react";
import { usePetitionList } from "@/hooks/usePetition";
import type { Petition } from "@/types/petition.types";
import { formatDateTime } from "@/lib/dateTime";
import { api } from "@/lib/api";
import PageHeader from "@/components/lis/PageHeader";
import { ResponsiveDataTable, type ResponsiveDataTableColumn } from "@/components/lis/ResponsiveDataTable";
import { getAiStatus, streamDraftNote } from "@/lib/aiApi";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { isUrgentPetition } from "@/lib/urgentPetition";
import UrgentBadge from "@/components/lis/UrgentBadge";
import { useAccessibleTabs } from "@/hooks/useAccessibleTabs";
import { awaitingFinalReport, sideApprovalState, type ApprovalSide } from "@/lib/itemApprovals";
import SideApprovalBadge from "@/components/lis/approval/SideApprovalBadge";

function priorityScore(
  petition: Petition,
  abnormalMap: Record<string, boolean>,
  returnedMap: Record<string, boolean>,
): number {
  const deptScore = petition.dept === 'rm' ? 5 : petition.dept === 'fg' ? 3 : 1;
  const isOverdue = petition.completedAt
    ? Date.now() - new Date(petition.completedAt).getTime() > 24 * 60 * 60 * 1000
    : false;
  return (
    (abnormalMap[petition._id] ? 30 : 0) +
    (isOverdue ? 20 : 0) +
    (returnedMap[petition._id] ? 10 : 0) +
    deptScore
  );
}

const QCApproval = () => {
  const navigate = useNavigate();
  const { data: petitionData, loading: petitionLoading } = usePetitionList({
    awaitingQcApproval: true,
    limit: 100,
  });
  const petitions = useMemo(() => petitionData?.items ?? [], [petitionData?.items]);
  const petitionIds = useMemo(() => petitions.map((petition) => petition._id).join(","), [petitions]);

  const [abnormalMap, setAbnormalMap] = useState<Record<string, boolean>>({});
  const [returnedMap, setReturnedMap] = useState<Record<string, boolean>>({});
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [view, setView] = useState<"pending" | "waiting">("pending");

  const sortedPetitions = useMemo(
    () =>
      [...petitions].sort(
        (a, b) =>
          Number(isUrgentPetition(b)) - Number(isUrgentPetition(a)) ||
          priorityScore(b, abnormalMap, returnedMap) - priorityScore(a, abnormalMap, returnedMap),
      ),
    [petitions, abnormalMap, returnedMap],
  );
  const { isVisible } = useAccessibleTabs("/qc-approval");
  const showQcTab = isVisible("qc");
  const showLabTab = isVisible("lab");
  // QC Approver เห็นแค่ฝั่งกายภาพ; หัวหน้า QC / admin เห็นทั้งกายภาพและ AI
  const visibleSides = useMemo<ApprovalSide[]>(
    () => [showQcTab && "qc", showLabTab && "lab"].filter(Boolean) as ApprovalSide[],
    [showQcTab, showLabTab],
  );
  // หัวหน้า QC / admin ออก Final Report ได้ จึงเห็นคำร้องที่ออก Pre Result แล้วด้วย
  const canIssueFinal = showQcTab && showLabTab;
  // แสดงคำร้องที่มีอย่างน้อยหนึ่งฝั่ง (ที่ผู้ใช้เห็น) ยืนยันผลแล้วและรอตัดสิน หรือรอออก Final Report
  const pendingPetitions = sortedPetitions.filter((petition) =>
    visibleSides.some((side) => sideApprovalState(petition, side).kind === "pending") ||
    (canIssueFinal && awaitingFinalReport(petition)),
  );
  // ยังไม่มีเรื่องให้ตัดสิน เพราะฝั่งที่ผู้ใช้เห็นยังรอผล Lab / ผล QC (รวมที่ส่งกลับไปทดสอบใหม่)
  const pendingIds = new Set(pendingPetitions.map((petition) => petition._id));
  const waitingPetitions = sortedPetitions.filter((petition) =>
    !pendingIds.has(petition._id) &&
    visibleSides.some((side) => ["waiting-result", "returned"].includes(sideApprovalState(petition, side).kind)),
  );
  const shownPetitions = view === "pending" ? pendingPetitions : waitingPetitions;
  const detailPath = (petition: Petition) => {
    const side = visibleSides.find((s) => sideApprovalState(petition, s).kind === "pending") ?? visibleSides[0] ?? "qc";
    return `/qc-approval/${petition._id}?tab=${side}`;
  };

  useEffect(() => {
    getAiStatus().then((s) => setOllamaAvailable(s.available));
  }, []);

  useEffect(() => {
    if (petitions.length === 0) {
      setAbnormalMap({});
      setReturnedMap({});
      return;
    }
    const ids = petitions.map((p) => p._id);
    let alive = true;
    api.getAbnormalFlags(ids, { includeRestricted: true })
      .then((map) => {
        if (alive) setAbnormalMap(map || {});
      })
      .catch(() => {
        if (alive) setAbnormalMap({});
      });
    api.getReturnedFlags(ids)
      .then((map) => {
        if (alive) setReturnedMap(map || {});
      })
      .catch(() => {
        if (alive) setReturnedMap({});
      });
    return () => {
      alive = false;
    };
    // petitionIds is the stable trigger; depending on the array itself would refetch on identical poll responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petitionIds]);

  const renderActions = (p: Petition, mobile: boolean) => (
    <div className={mobile ? "flex w-full flex-col gap-2" : "flex flex-col items-end gap-2"}>
      <Button
        size="sm"
        variant="primary"
        className={mobile ? "w-full gap-1.5" : "gap-1.5"}
        onClick={(e) => {
          e.stopPropagation();
          navigate(detailPath(p));
        }}
      >
        <Eye className="h-4 w-4" />
        ดูรายละเอียด
      </Button>

      {ollamaAvailable && (
        <div className="mt-1 space-y-2 w-full" onClick={(e) => e.stopPropagation()}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={draftingId === p._id}
            onClick={async () => {
              setDraftingId(p._id);
              setDraftNotes((prev) => ({ ...prev, [p._id]: '' }));
              try {
                await streamDraftNote(p._id, (chunk) => {
                  setDraftNotes((prev) => ({ ...prev, [p._id]: (prev[p._id] ?? '') + chunk }));
                });
              } catch {
                setDraftNotes((prev) => ({ ...prev, [p._id]: '(เกิดข้อผิดพลาด — กรุณาลองใหม่)' }));
              } finally {
                setDraftingId(null);
              }
            }}
            className={mobile ? "w-full gap-1.5" : "gap-1.5"}
          >
            {draftingId === p._id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Draft หมายเหตุ (AI)
          </Button>

          {draftNotes[p._id] && (
            <textarea
              value={draftNotes[p._id]}
              onChange={(e) =>
                setDraftNotes((prev) => ({ ...prev, [p._id]: e.target.value }))
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px] focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="AI กำลังสร้าง draft..."
            />
          )}
        </div>
      )}
    </div>
  );

  const latestConfirmedAt = (p: Petition) => {
    const times = visibleSides
      .map((side) => (side === "qc" ? p.qcCompletedAt : p.labCompletedAt))
      .filter((value): value is string => Boolean(value))
      .sort();
    return formatDateTime(times[times.length - 1]);
  };

  const columns: ResponsiveDataTableColumn<Petition>[] = [
    {
      key: "no",
      header: "เลขที่คำร้อง",
      className: "font-semibold text-primary",
      card: "title",
      cell: (p) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="whitespace-nowrap">{p.petitionNo}</span>
            <UrgentBadge petition={p} />
            {returnedMap[p._id] && (
              <RotateCcw className="h-4 w-4 text-yellow-700 dark:text-yellow-300 shrink-0" aria-label="ส่งกลับมาบันทึกผลใหม่" />
            )}
            {abnormalMap[p._id] && (
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-label="พบค่าผิดปกติในผลทดสอบ" />
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {canIssueFinal && awaitingFinalReport(p) && (
              <Badge variant="blue-soft">Pre Result · รอออก Final Report</Badge>
            )}
            {abnormalMap[p._id] && (
              <Badge variant="red-soft" className="px-1.5 text-[10px] font-medium">
                ผิดปกติ
              </Badge>
            )}
            {p.completedAt && Date.now() - new Date(p.completedAt).getTime() > 24 * 60 * 60 * 1000 && (
              <Badge variant="yellow-soft" className="px-1.5 text-[10px] font-medium">
                ⏰ เกิน 24h
              </Badge>
            )}
            {returnedMap[p._id] && (
              <Badge variant="yellow-soft" className="px-1.5 text-[10px] font-medium">
                🔄 Revision
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "dept",
      header: "แผนก",
      hideOnTablet: true,
      metaText: (p) => petitionDepartmentLabel(p),
      cell: (p) => <Badge variant="blue-soft">{petitionDepartmentLabel(p)}</Badge>,
    },
    { key: "submitter", header: "ผู้นำส่ง", hideOnTablet: true, cell: (p) => p.submittedBy?.name ?? "-" },
    ...visibleSides.map((side): ResponsiveDataTableColumn<Petition> => ({
      key: `status-${side}`,
      header: side === "qc" ? "กายภาพ" : "AI",
      card: "status",
      cell: (p) => <SideApprovalBadge state={sideApprovalState(p, side)} showApprover />,
      cardCell: (p) => (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">{side === "qc" ? "กายภาพ" : "AI"}</span>
          <SideApprovalBadge state={sideApprovalState(p, side)} />
        </div>
      ),
    })),
    {
      key: "submittedAt",
      header: "ยืนยันผลล่าสุด",
      hideOnTablet: true,
      cell: (p) => latestConfirmedAt(p),
      metaText: (p) => {
        const value = latestConfirmedAt(p);
        return value && value !== "-" ? `ยืนยัน ${value}` : null;
      },
    },
    {
      key: "action",
      header: "คำสั่ง",
      className: "text-right",
      card: "actions",
      cell: (p) => renderActions(p, false),
      cardCell: (p) => renderActions(p, true),
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="w-6 h-6" />
              ออก Final Result
            </span>
          }
          description={`เปิดดูรายละเอียดเพื่อให้ผล${showLabTab ? "กายภาพ / AI หรือออก Final Report" : "กายภาพ"} · ${pendingPetitions.length} คำร้องรอตัดสิน · ${waitingPetitions.length} คำร้องรอผล`}
        />

        <Tabs value={view} onValueChange={(value) => setView(value as "pending" | "waiting")}>
          <TabsList>
            <TabsTrigger value="pending">รอตัดสิน ({pendingPetitions.length})</TabsTrigger>
            <TabsTrigger value="waiting">รอผล Lab / QC ({waitingPetitions.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        <ResponsiveDataTable
          columns={columns}
          data={shownPetitions}
          rowKey={(p) => p._id}
          isLoading={petitionLoading}
          onRowClick={(p) => navigate(detailPath(p))}
          emptyTitle={view === "pending" ? "ไม่มีคำร้องที่รอตัดสินผล" : "ไม่มีคำร้องที่รอผล Lab หรือ QC"}
          tableClassName="min-w-[800px]"
        />
      </div>
    </AppLayout>
  );
};

export default QCApproval;
