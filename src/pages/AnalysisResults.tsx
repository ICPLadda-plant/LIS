import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { usePetitionList } from "@/hooks/usePetition";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { rankSearchResults } from "@/lib/searchRanking";
import { formatDate } from "@/lib/dateTime";
import type { Petition } from "@/types/petition.types";
import { Badge } from "@/components/ui/badge";
import { ResponsiveDataTable, useViewportBand, type ResponsiveDataTableColumn } from "@/components/lis/ResponsiveDataTable";

type ConclusionKey = "pass" | "accepted-oos" | "returned-to-requester";

// คำร้องเก่าก่อนมีฟิลด์ conclusion → เดาจาก status
function resolveConclusion(p: Petition): ConclusionKey {
  if (p.conclusion) return p.conclusion as ConclusionKey;
  return p.status === "rejected" ? "returned-to-requester" : "pass";
}

// ชื่อสามัญของสารทุกรายการในคำร้อง (ตัดชื่อซ้ำ/ว่างออก)
function petitionCommonNames(p: Petition): string[] {
  const names = (p.items ?? []).map((item) => item.commonName?.trim() ?? "").filter(Boolean);
  return [...new Set(names)];
}

// เลข batch ทุกรายการในคำร้อง (ตัดซ้ำ/ว่างออก)
function petitionBatchNos(p: Petition): string[] {
  const nos = (p.items ?? []).map((item) => item.batchNo?.trim() ?? "").filter(Boolean);
  return [...new Set(nos)];
}

const CONCLUSION_META: Record<ConclusionKey, { label: string; variant: "green-soft" | "yellow-soft" | "red-soft" }> = {
  "pass": { label: "ผ่าน", variant: "green-soft" },
  "accepted-oos": { label: "ยอมรับผลไม่ปกติ", variant: "yellow-soft" },
  "returned-to-requester": { label: "ส่งคืนผู้ส่ง", variant: "red-soft" },
};

type ResultRow = { p: Petition; conclusion: ConclusionKey };

const doneAtOf = (p: Petition) => p.approvedAt || p.rejectedAt || p.completedAt;
const joinOrDash = (values: string[]) => (values.length ? values.join(", ") : "-");

// การ์ดบนมือถือ (< 768px): เลขคำร้อง + ผลสรุป, ข้อมูลรองบรรทัดเดียว
const MOBILE_COLUMNS: ResponsiveDataTableColumn<ResultRow>[] = [
  { key: "no", header: "เลขคำร้อง", card: "title", cell: ({ p }) => <span className="whitespace-nowrap">{p.petitionNo}</span> },
  {
    key: "conclusion",
    header: "ผลสรุป",
    card: "status",
    cell: ({ conclusion }) => <Badge variant={CONCLUSION_META[conclusion].variant}>{CONCLUSION_META[conclusion].label}</Badge>,
  },
  { key: "common", header: "ชื่อสามัญ", cell: ({ p }) => joinOrDash(petitionCommonNames(p)) },
  { key: "batch", header: "Batch", cell: ({ p }) => { const b = petitionBatchNos(p); return b.length ? `Batch ${b.join(", ")}` : "-"; } },
  { key: "dept", header: "แผนก", cell: ({ p }) => petitionDepartmentLabel(p) },
  { key: "doneAt", header: "วันที่จบ", cell: ({ p }) => formatDate(doneAtOf(p)) },
];

export default function AnalysisResults() {
  const navigate = useNavigate();
  const band = useViewportBand();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | ConclusionKey>("all");

  // คำร้องที่ปิดงานแล้ว (approved = ผ่าน/ยอมรับ, rejected = ส่งคืนผู้ส่ง)
  const { data, loading } = usePetitionList({ status: "approved,rejected", limit: 100 });

  const rows = useMemo(() => {
    const items = (data?.items ?? []) as Petition[];
    const matches = items
      .map((p) => ({ p, conclusion: resolveConclusion(p) }))
      .filter((r) => (filter === "all" ? true : r.conclusion === filter))
      .filter((r) =>
        search.trim()
          ? `${r.p.petitionNo} ${petitionBatchNos(r.p).join(" ")} ${petitionCommonNames(r.p).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())
          : true,
      );
    return rankSearchResults(matches, search, ({ p }) => {
      const itemNos = (p.items ?? []).map((item) => item.itemNo).filter((itemNo) => itemNo?.trim());
      return {
        primary: itemNos.length ? itemNos : [p.petitionNo],
        secondary: [p.petitionNo, ...petitionBatchNos(p), ...petitionCommonNames(p)],
      };
    });
  }, [data, filter, search]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">ผลวิเคราะห์</h1>
          <p className="text-sm text-muted-foreground">ประวัติคำร้องที่ผ่านการตัดสินจากหัวหน้า QC แล้ว</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขคำร้อง / Batch / ชื่อสามัญ"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {(["all", "pass", "accepted-oos", "returned-to-requester"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${filter === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
            >
              {k === "all" ? "ทั้งหมด" : CONCLUSION_META[k].label}
            </button>
          ))}
        </div>

        {band === "mobile" ? (
          <ResponsiveDataTable
            band="mobile"
            columns={MOBILE_COLUMNS}
            data={rows}
            rowKey={({ p }) => p._id}
            isLoading={loading}
            emptyTitle="ยังไม่มีประวัติ"
            onRowClick={({ p }) => navigate(`/record-results/${p._id}`)}
          />
        ) : (
        <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">เลขคำร้อง</th>
                <th className="px-3 py-2">Batch</th>
                <th className="hidden px-3 py-2 lg:table-cell">แผนก</th>
                <th className="px-3 py-2">ชื่อสามัญ</th>
                <th className="hidden px-3 py-2 lg:table-cell">วันที่จบ</th>
                <th className="px-3 py-2">ผลสรุป</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">กำลังโหลด…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">ยังไม่มีประวัติ</td></tr>
              )}
              {rows.map(({ p, conclusion }) => {
                const meta = CONCLUSION_META[conclusion];
                const doneAt = doneAtOf(p);
                const commonNames = petitionCommonNames(p);
                const batchNos = petitionBatchNos(p);
                return (
                  <tr
                    key={p._id}
                    onClick={() => navigate(`/record-results/${p._id}`)}
                    className="cursor-pointer border-t border-border hover:bg-accent/60"
                  >
                    <td className="px-3 py-2 font-medium">
                      <span className="whitespace-nowrap">{p.petitionNo}</span>
                      <div className="text-xs font-normal text-muted-foreground lg:hidden">
                        {petitionDepartmentLabel(p)} · {formatDate(doneAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{batchNos.length ? batchNos.join(", ") : "-"}</td>
                    <td className="hidden px-3 py-2 lg:table-cell">{petitionDepartmentLabel(p)}</td>
                    <td className="px-3 py-2">{commonNames.length ? commonNames.join(", ") : "-"}</td>
                    <td className="hidden px-3 py-2 lg:table-cell">{formatDate(doneAt)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={meta.variant} className="whitespace-nowrap">{meta.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </AppLayout>
  );
}
