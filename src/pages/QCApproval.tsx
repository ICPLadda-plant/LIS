import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertTriangle, RotateCcw, Sparkles, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { usePetitionList } from "@/hooks/usePetition";
import type { Petition } from "@/types/petition.types";
import { formatDateTime } from "@/lib/dateTime";
import { api } from "@/lib/api";
import PageHeader from "@/components/lis/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/lis/DataTable";
import { getAiStatus, streamDraftNote } from "@/lib/aiApi";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isUrgentPetition } from "@/lib/urgentPetition";
import UrgentBadge from "@/components/lis/UrgentBadge";

const API_BASE = import.meta.env.BASE_URL + "api";

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

  const [testersMap, setTestersMap] = useState<Record<string, string[]>>({});
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
  const qcPetitions = sortedPetitions.filter((petition) => !!petition.qcCompletedAt);
  const labPetitions = sortedPetitions.filter((petition) => !!petition.labCompletedAt);

  useEffect(() => {
    getAiStatus().then((s) => setOllamaAvailable(s.available));
  }, []);

  useEffect(() => {
    if (petitions.length === 0) {
      setTestersMap({});
      setAbnormalMap({});
      setReturnedMap({});
      return;
    }
    const ids = petitions.map((p) => p._id);
    const idsParam = ids.join(",");
    let alive = true;
    fetch(`${API_BASE}/qc-results/testers?petitionIds=${encodeURIComponent(idsParam)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((map: Record<string, string[]>) => {
        if (alive) setTestersMap(map || {});
      })
      .catch(() => {
        if (alive) setTestersMap({});
      });
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

  const columns = (side: "qc" | "lab"): DataTableColumn<Petition>[] => [
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
    {
      key: "testers",
      header: "ผู้ทดสอบ",
      className: "max-w-[200px] text-sm text-muted-foreground align-top",
      cell: (p) => {
        const testers = testersMap[p._id] ?? [];
        return testers.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {testers.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        ) : (
          "-"
        );
      },
    },
    { key: "count", header: "จำนวนรายการ", cell: (p) => `${p.items?.length ?? 0} รายการ` },
    {
      key: "submittedAt",
      header: "ยืนยันผลเมื่อ",
      cell: (p) => {
        const value = side === "qc" ? p.qcCompletedAt : p.labCompletedAt;
        return formatDateTime(value);
      },
    },
    {
      key: "action",
      header: "คำสั่ง",
      className: "text-right",
      cell: (p) => (
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="primary"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/qc-approval/${p._id}?tab=${side}&decision=approve`);
              }}
            >
              <CheckCircle2 className="h-4 w-4" />
              อนุมัติ
            </Button>
            <Button
              size="sm"
              variant="danger-outline"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/qc-approval/${p._id}?tab=${side}&decision=reject`);
              }}
            >
              <XCircle className="h-4 w-4" />
              ไม่อนุมัติ
            </Button>
          </div>

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
          description={`ตรวจสอบผลที่ QC หรือ Lab ยืนยันแล้ว · ${sortedPetitions.length} คำร้อง`}
        />

        <Tabs defaultValue="qc" className="space-y-4">
          <TabsList>
            <TabsTrigger value="qc">ผล QC ({qcPetitions.length})</TabsTrigger>
            <TabsTrigger value="lab">ผล Lab ({labPetitions.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="qc">
            <DataTable
              columns={columns("qc")}
              data={qcPetitions}
              rowKey={(p) => p._id}
              isLoading={petitionLoading}
              onRowClick={(p) => navigate(`/qc-approval/${p._id}?tab=qc`)}
              emptyTitle="ไม่มีผล QC ที่ยืนยันแล้ว"
              tableClassName="min-w-[800px]"
            />
          </TabsContent>
          <TabsContent value="lab">
            <DataTable
              columns={columns("lab")}
              data={labPetitions}
              rowKey={(p) => p._id}
              isLoading={petitionLoading}
              onRowClick={(p) => navigate(`/qc-approval/${p._id}?tab=lab`)}
              emptyTitle="ไม่มีผล Lab ที่ยืนยันแล้ว"
              tableClassName="min-w-[800px]"
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default QCApproval;
