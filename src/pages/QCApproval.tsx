import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertTriangle, RotateCcw, Sparkles, Loader2, Eye } from "lucide-react";
import { usePetitionList } from "@/hooks/usePetition";
import type { Petition } from "@/types/petition.types";
import { formatDateTime } from "@/lib/dateTime";
import { api } from "@/lib/api";
import PageHeader from "@/components/lis/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/lis/DataTable";
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

  const columns: DataTableColumn<Petition>[] = [
    {
      key: "no",
      header: "เลขที่คำร้อง",
      className: "font-semibold text-primary",
      cell: (p) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span>{p.petitionNo}</span>
            <UrgentBadge petition={p} />
            {returnedMap[p._id] && (
              <RotateCcw className="h-4 w-4 text-orange-500 shrink-0" aria-label="ส่งกลับมาบันทึกผลใหม่" />
            )}
            {abnormalMap[p._id] && (
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" aria-label="พบค่าผิดปกติในผลทดสอบ" />
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {canIssueFinal && awaitingFinalReport(p) && (
              <Badge variant="blue-soft">Pre Result · รอออก Final Report</Badge>
            )}
            {abnormalMap[p._id] && (
              <span className="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                ผิดปกติ
              </span>
            )}
            {p.completedAt && Date.now() - new Date(p.completedAt).getTime() > 24 * 60 * 60 * 1000 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                ⏰ เกิน 24h
              </span>
            )}
            {returnedMap[p._id] && (
              <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                🔄 Revision
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "dept",
      header: "แผนก",
      cell: (p) => <Badge variant="blue-soft">{petitionDepartmentLabel(p)}</Badge>,
    },
    { key: "submitter", header: "ผู้นำส่ง", cell: (p) => p.submittedBy?.name ?? "-" },
    ...visibleSides.map((side): DataTableColumn<Petition> => ({
      key: `status-${side}`,
      header: side === "qc" ? "กายภาพ" : "AI",
      cell: (p) => <SideApprovalBadge state={sideApprovalState(p, side)} showApprover />,
    })),
    {
      key: "submittedAt",
      header: "ยืนยันผลล่าสุด",
      cell: (p) => {
        const times = visibleSides
          .map((side) => (side === "qc" ? p.qcCompletedAt : p.labCompletedAt))
          .filter((value): value is string => Boolean(value))
          .sort();
        return formatDateTime(times[times.length - 1]);
      },
    },
    {
      key: "action",
      header: "คำสั่ง",
      className: "text-right",
      cell: (p) => (
        <div className="flex flex-col items-end gap-2">
          <Button
            size="sm"
            variant="primary"
            className="gap-1.5"
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
              <button
                type="button"
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
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-100 border border-violet-200 disabled:opacity-50"
              >
                {draftingId === p._id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Draft หมายเหตุ (AI)
              </button>

              {draftNotes[p._id] && (
                <textarea
                  value={draftNotes[p._id]}
                  onChange={(e) =>
                    setDraftNotes((prev) => ({ ...prev, [p._id]: e.target.value }))
                  }
                  className="w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm min-h-[100px] focus:outline-none focus:ring-1 focus:ring-violet-400"
                  placeholder="AI กำลังสร้าง draft..."
                />
              )}
            </div>
          )}
        </div>
      ),
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
          description={`เปิดดูรายละเอียดเพื่อให้ผล${showLabTab ? "กายภาพ / AI หรือออก Final Report" : "กายภาพ"} · ${pendingPetitions.length} คำร้องรอตัดสิน`}
        />

        <DataTable
          columns={columns}
          data={pendingPetitions}
          rowKey={(p) => p._id}
          isLoading={petitionLoading}
          onRowClick={(p) => navigate(detailPath(p))}
          emptyTitle="ไม่มีคำร้องที่รอตัดสินผล"
          tableClassName="min-w-[800px]"
        />
      </div>
    </AppLayout>
  );
};

export default QCApproval;
