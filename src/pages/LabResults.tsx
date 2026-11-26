import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import { usePetitionList } from "@/hooks/usePetition";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { rankSearchResults } from "@/lib/searchRanking";
import { shouldSendItemToLab } from "@/lib/petitionRouting";
import type { Petition } from "@/types/petition.types";
import { fullThaiTitle } from "@/lib/labReport";
import { formatLabSampleNo, labLabelNumbersForItems } from "@/lib/petitionSampler";
import { ResponsiveDataTable, useViewportBand, type ResponsiveDataTableColumn } from "@/components/lis/ResponsiveDataTable";

const resultItems = (petition: Petition) => (petition.items ?? [])
  .filter((item) => shouldSendItemToLab(item) && item.sampleId?.trim());

// การ์ดบนมือถือ (< 768px): เลขที่คำร้อง + จำนวน, แผนก · ผู้นำส่ง · ผู้ทดสอบ, แล้วรายการตัวอย่าง
const MOBILE_COLUMNS: ResponsiveDataTableColumn<Petition>[] = [
  {
    key: "no",
    header: "เลขที่คำร้อง",
    card: "title",
    cell: (p) => <span className="whitespace-nowrap">{labLabelNumbersForItems(p, resultItems(p)).join(", ") || "-"}</span>,
  },
  {
    key: "count",
    header: "จำนวนรายการ",
    card: "status",
    cell: (p) => <span className="whitespace-nowrap text-xs text-muted-foreground">{resultItems(p).length} รายการ</span>,
  },
  { key: "dept", header: "แผนก", cell: (p) => petitionDepartmentLabel(p) },
  { key: "submitter", header: "ผู้นำส่ง", cell: (p) => p.submittedBy?.name || "-" },
  { key: "tester", header: "ผู้ทดสอบ", cell: (p) => fullThaiTitle(p.labCompletedBy) || "-" },
  {
    key: "samples",
    header: "ตัวอย่าง",
    card: "body",
    cell: (p) => (
      <div className="space-y-2">
        {resultItems(p).map((item) => (
          <div key={item.seq} className="min-w-0">
            <div className="font-semibold text-primary">{formatLabSampleNo(p, item.sampleId)}</div>
            <div className="break-words font-medium text-foreground">{item.sampleName || item.commonName || "-"}</div>
            <div className="text-xs text-muted-foreground">Batch: {item.batchNo || "-"}</div>
          </div>
        ))}
      </div>
    ),
  },
];

export default function LabResults() {
  const navigate = useNavigate();
  const band = useViewportBand();
  const [search, setSearch] = useState("");

  // คำร้องฝั่ง Lab ที่หัวหน้าห้องปฏิบัติการออกผลแล้ว
  const { data, loading } = usePetitionList({ labApproved: true, limit: 100 });

  const rows = useMemo(() => {
    const items = ((data?.items ?? []) as Petition[]).filter((petition) => resultItems(petition).length);
    const q = search.trim().toLowerCase();
    if (!q) return items;
    const matches = items.filter((p) => {
      const sampleText = resultItems(p).map((item) => `${item.sampleName} ${item.commonName ?? ""} ${item.batchNo} ${item.sampleId}`).join(" ");
      return `${p.petitionNo} ${labLabelNumbersForItems(p, resultItems(p)).join(" ")} ${p.submittedBy?.name ?? ""} ${p.labCompletedBy ?? p.assignedTo?.name ?? ""} ${sampleText}`.toLowerCase().includes(q);
    });
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
            placeholder="ค้นหาเลขคำร้อง / เลขที่ตัวอย่าง / ชื่อยา / Batch / ผู้วิเคราะห์"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {band === "mobile" ? (
          <ResponsiveDataTable
            band="mobile"
            columns={MOBILE_COLUMNS}
            data={rows}
            rowKey={(p) => p._id}
            isLoading={loading}
            emptyTitle="ยังไม่มีคำร้องที่หัวหน้า Lab ออกผล"
            onRowClick={(p) => navigate(`/lab-results/${p._id}`)}
          />
        ) : (
        <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">เลขที่คำร้อง</th>
                <th className="px-3 py-2">เลขที่ตัวอย่าง</th>
                <th className="px-3 py-2">ชื่อยา / Batch</th>
                <th className="px-3 py-2">แผนก / ผู้นำส่ง</th>
                <th className="hidden px-3 py-2 lg:table-cell">ผู้ทดสอบ</th>
                <th className="hidden px-3 py-2 lg:table-cell">จำนวนรายการ</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">กำลังโหลด…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">ยังไม่มีคำร้องที่หัวหน้า Lab ออกผล</td></tr>
              )}
              {rows.map((p) => (
                <tr
                  key={p._id}
                  onClick={() => navigate(`/lab-results/${p._id}`)}
                  className="cursor-pointer border-t border-border hover:bg-accent/60"
                >
                  <td className="px-3 py-2 align-top font-medium">
                    <span className="whitespace-nowrap">{labLabelNumbersForItems(p, resultItems(p)).join(", ") || "-"}</span>
                    <div className="text-xs font-normal text-muted-foreground lg:hidden">
                      {resultItems(p).length} รายการ · {fullThaiTitle(p.labCompletedBy) || "-"}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="space-y-2">
                      {resultItems(p).map((item) => (
                        <div key={item.seq} className="font-semibold text-primary">{formatLabSampleNo(p, item.sampleId)}</div>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top lg:min-w-[260px]">
                    <div className="space-y-2">
                      {resultItems(p).map((item) => (
                        <div key={item.seq}>
                          <div className="font-medium text-foreground">{item.sampleName || item.commonName || "-"}</div>
                          <div className="text-xs text-muted-foreground">Batch: {item.batchNo || "-"}</div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{petitionDepartmentLabel(p)}</div>
                    <div className="text-muted-foreground">{p.submittedBy?.name || "-"}</div>
                  </td>
                  <td className="hidden px-3 py-2 lg:table-cell">{fullThaiTitle(p.labCompletedBy) || "-"}</td>
                  <td className="hidden px-3 py-2 lg:table-cell">{resultItems(p).length} รายการ</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </AppLayout>
  );
}
