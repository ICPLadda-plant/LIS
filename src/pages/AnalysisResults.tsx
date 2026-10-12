import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { usePetitionList } from "@/hooks/usePetition";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { rankSearchResults } from "@/lib/searchRanking";
import { formatDate } from "@/lib/dateTime";
import type { Petition } from "@/types/petition.types";

type ConclusionKey = "pass" | "accepted-oos" | "returned-to-requester";

// คำร้องเก่าก่อนมีฟิลด์ conclusion → เดาจาก status
function resolveConclusion(p: Petition): ConclusionKey {
  if (p.conclusion) return p.conclusion as ConclusionKey;
  return p.status === "rejected" ? "returned-to-requester" : "pass";
}

const CONCLUSION_META: Record<ConclusionKey, { label: string; cls: string }> = {
  "pass": { label: "ผ่าน", cls: "border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300" },
  "accepted-oos": { label: "ยอมรับผลไม่ปกติ", cls: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-500/30 dark:bg-yellow-500/15 dark:text-yellow-300" },
  "returned-to-requester": { label: "ส่งคืนผู้ส่ง", cls: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-300" },
};

export default function AnalysisResults() {
  const navigate = useNavigate();
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
          ? `${r.p.petitionNo} ${r.p.submittedBy?.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())
          : true,
      );
    return rankSearchResults(matches, search, ({ p }) => {
      const itemNos = (p.items ?? []).map((item) => item.itemNo).filter((itemNo) => itemNo?.trim());
      return {
        primary: itemNos.length ? itemNos : [p.petitionNo],
        secondary: [p.petitionNo, p.submittedBy?.name],
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
            placeholder="ค้นหาเลขคำร้อง / ผู้ส่ง"
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

        <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">เลขคำร้อง</th>
                <th className="px-3 py-2">แผนก</th>
                <th className="px-3 py-2">ผู้ส่ง</th>
                <th className="px-3 py-2">วันที่จบ</th>
                <th className="px-3 py-2">ผลสรุป</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">กำลังโหลด…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">ยังไม่มีประวัติ</td></tr>
              )}
              {rows.map(({ p, conclusion }) => {
                const meta = CONCLUSION_META[conclusion];
                const doneAt = p.approvedAt || p.rejectedAt || p.completedAt;
                return (
                  <tr
                    key={p._id}
                    onClick={() => navigate(`/record-results/${p._id}`)}
                    className="cursor-pointer border-t border-border hover:bg-accent/60"
                  >
                    <td className="px-3 py-2 font-medium">{p.petitionNo}</td>
                    <td className="px-3 py-2">{petitionDepartmentLabel(p)}</td>
                    <td className="px-3 py-2">{p.submittedBy?.name ?? "-"}</td>
                    <td className="px-3 py-2">{formatDate(doneAt)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
