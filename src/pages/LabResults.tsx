import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { usePetitionList } from "@/hooks/usePetition";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { rankSearchResults } from "@/lib/searchRanking";
import { formatDate } from "@/lib/dateTime";
import type { Petition } from "@/types/petition.types";

export default function LabResults() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  // คำร้องฝั่ง Lab ที่หัวหน้าห้องปฏิบัติการออกผลแล้ว
  const { data, loading } = usePetitionList({ labApproved: true, limit: 100 });

  const rows = useMemo(() => {
    const items = (data?.items ?? []) as Petition[];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    const matches = items.filter((p) =>
      `${p.petitionNo} ${p.submittedBy?.name ?? ""}`.toLowerCase().includes(q),
    );
    return rankSearchResults(matches, search, (petition) => {
      const itemNos = (petition.items ?? []).map((item) => item.itemNo).filter((itemNo) => itemNo?.trim());
      return {
        primary: itemNos.length ? itemNos : [petition.petitionNo],
        secondary: [petition.petitionNo, petition.submittedBy?.name],
      };
    });
  }, [data, search]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">ผลวิเคราะห์ Lab</h1>
          <p className="text-sm text-muted-foreground">คำร้องที่หัวหน้าห้องปฏิบัติการออกผลแล้ว</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขคำร้อง / ผู้ส่ง"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">เลขคำร้อง</th>
                <th className="px-3 py-2">แผนก</th>
                <th className="px-3 py-2">ผู้ส่ง</th>
                <th className="px-3 py-2">วันที่ออกผล Lab</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">กำลังโหลด…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">ยังไม่มีคำร้องที่หัวหน้า Lab ออกผล</td></tr>
              )}
              {rows.map((p) => (
                <tr
                  key={p._id}
                  onClick={() => navigate(`/lab-results/${p._id}`)}
                  className="cursor-pointer border-t border-border hover:bg-accent/60"
                >
                  <td className="px-3 py-2 font-medium">{p.petitionNo}</td>
                  <td className="px-3 py-2">{petitionDepartmentLabel(p)}</td>
                  <td className="px-3 py-2">{p.submittedBy?.name ?? "-"}</td>
                  <td className="px-3 py-2">
                    {formatDate(p.labApprovedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
