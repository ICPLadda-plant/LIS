import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertTriangle, RotateCcw, Sparkles, Loader2 } from "lucide-react";
import { usePetitionList } from "@/hooks/usePetition";
import type { Petition } from "@/types/petition.types";
import { api } from "@/lib/api";
import PageHeader from "@/components/lis/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/lis/DataTable";
import { petitionStatusBadge } from "@/lib/statusBadge";
import { getAiStatus, streamDraftNote } from "@/lib/aiApi";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { isUrgentPetition } from "@/lib/urgentPetition";
import UrgentBadge from "@/components/lis/UrgentBadge";
import { shouldSendItemToLab } from "@/lib/petitionRouting";
import { fullThaiTitle } from "@/lib/labReport";
import { formatLabSampleNo, labLabelNumbersForItems } from "@/lib/petitionSampler";

export const labApprovalItems = (petition: Petition) => (petition.items ?? [])
  .filter((item) => shouldSendItemToLab(item) && item.sampleId?.trim());

// ชื่อยาเดียวกัน (ตัดวงเล็บท้าย เช่น (GREEN)/(BLUE)) รวมเป็นแถวเดียว ไม่สน batch/คำร้อง
export const labApprovalNameKey = (petition: Petition) => [...new Set(labApprovalItems(petition)
  .map((item) => (item.sampleName || item.commonName || "").replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase()))]
  .sort().join("|") || petition._id;

export function groupLabApprovalByName(petitions: Petition[]): Petition[][] {
  const groups = new Map<string, Petition[]>();
  for (const p of petitions) {
    const key = labApprovalNameKey(p);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

export const labApprovalTesterName = (petition: Petition) => fullThaiTitle(petition.labCompletedBy) || "-";

function priorityScore(
  petition: Petition,
  abnormalMap: Record<string, boolean>,
  returnedMap: Record<string, boolean>,
): number {
  const deptScore = petition.dept === "rm" ? 5 : petition.dept === "fg" ? 3 : 1;
  const isOverdue = petition.labCompletedAt
    ? Date.now() - new Date(petition.labCompletedAt).getTime() > 24 * 60 * 60 * 1000
    : false;
  return (
    (abnormalMap[petition._id] ? 30 : 0) +
    (isOverdue ? 20 : 0) +
    (returnedMap[petition._id] ? 10 : 0) +
    deptScore
  );
}

const LabApproval = () => {
  const navigate = useNavigate();
  const { data, loading } = usePetitionList({ awaitingLabApproval: true, limit: 100 });
  const petitions = data?.items ?? [];

  const [abnormalMap, setAbnormalMap] = useState<Record<string, boolean>>({});
  const [returnedMap, setReturnedMap] = useState<Record<string, boolean>>({});
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});

  const sortedPetitions = useMemo(
    () =>
      [...petitions]
        .filter((petition) => labApprovalItems(petition).length > 0)
        .sort(
          (a, b) =>
            Number(isUrgentPetition(b)) - Number(isUrgentPetition(a)) ||
            priorityScore(b, abnormalMap, returnedMap) - priorityScore(a, abnormalMap, returnedMap),
        ),
    [petitions, abnormalMap, returnedMap],
  );

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
    api.getAbnormalFlags(ids, { includeRestricted: false })
      .then((map) => { if (alive) setAbnormalMap(map || {}); })
      .catch(() => { if (alive) setAbnormalMap({}); });
    api.getReturnedFlags(ids)
      .then((map) => { if (alive) setReturnedMap(map || {}); })
      .catch(() => { if (alive) setReturnedMap({}); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petitions.map((p) => p._id).join(",")]);

  const petitionColumns: DataTableColumn<Petition>[] = [
    {
      key: "no",
      header: "เลขที่คำร้อง",
      className: "w-28 align-top font-semibold text-primary",
      cell: (p) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span>{labLabelNumbersForItems(p, labApprovalItems(p)).join(", ") || "-"}</span>
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
            {p.labCompletedAt && Date.now() - new Date(p.labCompletedAt).getTime() > 24 * 60 * 60 * 1000 && (
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
      key: "sampleNos", header: "เลขที่ตัวอย่าง", className: "w-28 align-top",
      cell: (p) => (
        <div className="space-y-2">
          {labApprovalItems(p).map((item) => (
            <div key={item.seq} className="font-semibold text-primary">
              {formatLabSampleNo(p, item.sampleId)}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "samples", header: "ชื่อยา / Batch", className: "min-w-[260px] align-top",
      cell: (p) => (
        <div className="space-y-2">
          {labApprovalItems(p).map((item) => (
            <div key={item.seq}>
              <div className="font-medium text-foreground">{item.sampleName || item.commonName || "-"}</div>
              <div className="text-xs text-muted-foreground">Batch: {item.batchNo || "-"}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "deptSubmitter", header: "แผนก / ผู้นำส่ง", className: "min-w-40 align-top",
      cell: (p) => (
        <div className="space-y-2">
          <Badge variant="blue-soft">{petitionDepartmentLabel(p)}</Badge>
          <div>{p.submittedBy?.name ?? "-"}</div>
        </div>
      ),
    },
    {
      key: "testers", header: "ผู้ทดสอบ", className: "min-w-36 max-w-[200px] align-top text-sm text-muted-foreground",
      cell: labApprovalTesterName,
    },
    { key: "count", header: "จำนวนรายการ", className: "w-24 align-top", cell: (p) => `${labApprovalItems(p).length} รายการ` },
    { key: "status", header: "สถานะ", className: "w-28 align-top", cell: (p) => { const b = petitionStatusBadge(p); return <Badge variant={b.variant}>{b.label}</Badge>; } },
    {
      key: "action", header: "การดำเนินการ", className: "w-28 align-top text-right",
      cell: (p) => (
        <div className="flex flex-col items-end gap-2">
          <Button size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/lab-approval/${p._id}`); }}>
            ตรวจสอบ
          </Button>

          {ollamaAvailable && (
            <div className="mt-1 space-y-2 w-full" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={draftingId === p._id}
                onClick={async () => {
                  setDraftingId(p._id);
                  setDraftNotes((prev) => ({ ...prev, [p._id]: "" }));
                  try {
                    await streamDraftNote(p._id, (chunk) => {
                      setDraftNotes((prev) => ({ ...prev, [p._id]: (prev[p._id] ?? "") + chunk }));
                    });
                  } catch {
                    setDraftNotes((prev) => ({ ...prev, [p._id]: "(เกิดข้อผิดพลาด — กรุณาลองใหม่)" }));
                  } finally {
                    setDraftingId(null);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-100 border border-violet-200 disabled:opacity-50"
              >
                {draftingId === p._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Draft หมายเหตุ (AI)
              </button>

              {draftNotes[p._id] && (
                <textarea
                  value={draftNotes[p._id]}
                  onChange={(e) => setDraftNotes((prev) => ({ ...prev, [p._id]: e.target.value }))}
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

  const groups = groupLabApprovalByName(sortedPetitions);
  const columns: DataTableColumn<Petition[]>[] = petitionColumns.map((c) => ({
    ...c,
    cell: (g) => <div className="space-y-3">{g.map((p) => <div key={p._id}>{c.cell(p)}</div>)}</div>,
  }));

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title={<span className="inline-flex items-center gap-2"><ShieldCheck className="w-6 h-6" />ออกผล Lab</span>}
          description={`ตรวจสอบและออกผลการทดสอบจาก Lab · ${sortedPetitions.length} รายการรอออกผล`}
        />
        <DataTable
          columns={columns}
          data={groups}
          rowKey={(g) => g[0]._id}
          isLoading={loading}
          onRowClick={(g) => navigate(`/lab-approval/${g[0]._id}`)}
          emptyTitle="ไม่มีคำร้องที่รอออกผล Lab"
          tableClassName="min-w-[960px]"
        />
      </div>
    </AppLayout>
  );
};

export default LabApproval;

