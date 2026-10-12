// ตาราง "กำลังใช้งานอยู่" — standard ที่เบิกไปแล้วยังไม่ปิด พร้อมนาฬิกาตามความถี่/1 ครั้ง
// ปิดแถวได้ 2 ทาง: กดรับทราบตอนหมดอายุ (เฉพาะคนเบิก) หรือปุ่ม "แจ้งหมด/ทิ้ง" ท้ายแถว
// (เปิด DeductionResolutionDialog ตรงในตารางนี้เอง — ทาง "ใช้หมด/ทิ้ง" ของ R3)
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/lis/DataTable";
import DeductionResolutionDialog from "@/components/lis/stock/DeductionResolutionDialog";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { requisitionUser } from "@/lib/standardRequisition";
import { formatDate, formatDateTime } from "@/lib/dateTime";
import {
  canAcknowledge,
  dueDistanceLabel,
  inUseStatus,
  sortInUse,
  type InUseStatus,
} from "@/lib/standardInUse";
import type { StandardInUseItem, StockTransactionItem } from "@/types/stock";

/**
 * StandardInUseItem ไม่มีฟิลด์ครบเท่า StockTransactionItem (ไม่มี beforeQty/afterQty/unit
 * ฯลฯ เพราะ endpoint in-use ไม่ select มา) — DeductionResolutionDialog อ่านแค่ _id กับชื่อ
 * แสดงผล จึงพอ adapt เท่าที่มันใช้จริงโดยไม่ต้องปลอมค่าที่ไม่รู้
 */
function toResolutionTransaction(row: StandardInUseItem): StockTransactionItem {
  return {
    _id: row._id,
    itemType: "standard",
    itemId: row.itemCode,
    itemCode: row.itemCode,
    itemName: row.itemName,
    action: "deduct",
    qrId: row.qrId,
    createdAt: row.withdrawnAt,
  };
}

const STATUS_LABEL: Record<InUseStatus, string> = {
  expired: "หมดอายุ",
  dueSoon: "ใกล้ครบกำหนด",
  active: "กำลังใช้งาน",
  noFrequency: "ยังไม่ได้ตั้งความถี่",
};

const STATUS_CLASS: Record<InUseStatus, string> = {
  expired: "border-destructive/40 bg-destructive/10 text-destructive",
  dueSoon: "border-amber-400/50 bg-amber-50 text-amber-700",
  active: "",
  noFrequency: "text-muted-foreground",
};

export default function StandardsInUseTable() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // ชุด id ที่กำลังยิง resolve อยู่ (ไม่ใช่ scalar เดียว) — กันแถวอื่นที่กดพร้อมกันไปเคลียร์สถานะ pending ของแถวนี้ทับกัน
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // แถวที่กำลังเปิด DeductionResolutionDialog อยู่ (ทาง "แจ้งหมด/ทิ้ง")
  const [resolving, setResolving] = useState<StandardInUseItem | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["stock", "in-use"],
    queryFn: api.getStandardsInUse,
    refetchInterval: 60_000,
  });

  const ack = useMutation({
    mutationFn: (row: StandardInUseItem) =>
      api.resolveStockDeduction(row._id, {
        reason: "expired",
        _user: requisitionUser(user),
      }),
    onMutate: (row: StandardInUseItem) =>
      setPendingIds((prev) => new Set(prev).add(row._id)),
    onSettled: (_data, _error, row: StandardInUseItem) =>
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(row._id);
        return next;
      }),
    onSuccess: () => {
      toast.success("รับทราบแล้ว");
      qc.invalidateQueries({ queryKey: ["stock", "in-use"] });
      qc.invalidateQueries({ queryKey: ["stock-deductions"] });
      qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const now = new Date(data?.serverTime || Date.now());
  const rows = sortInUse(data?.items ?? [], now);

  const columns: DataTableColumn<StandardInUseItem>[] = [
    {
      key: "item",
      header: "สาร",
      cell: (r) => (
        <>
          <div className="font-medium">{r.itemName || r.itemCode}</div>
          <div className="text-xs text-muted-foreground">{r.totalMg} mg · {r.weights.length} น้ำหนัก</div>
        </>
      ),
    },
    {
      key: "instrument",
      header: "เครื่อง",
      className: "text-xs",
      cell: (r) => (r.instrumentGroup ? r.instrumentGroup.toUpperCase() : "-"),
    },
    {
      key: "withdrawn",
      header: "เบิกเมื่อ",
      className: "text-xs whitespace-nowrap",
      cell: (r) => formatDateTime(r.withdrawnAt),
    },
    {
      key: "due",
      header: "ครบกำหนด",
      className: "text-xs whitespace-nowrap",
      cell: (r) => (
        <>
          <div>{formatDate(r.dueAt)}</div>
          <div className="text-muted-foreground">{dueDistanceLabel(r.dueAt, now)}</div>
        </>
      ),
    },
    {
      key: "status",
      header: "สถานะ",
      cell: (r) => {
        const status = inUseStatus(r, now);
        return <Badge variant="outline" className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</Badge>;
      },
    },
    {
      key: "user",
      header: "ผู้เบิก",
      className: "text-xs",
      cell: (r) => r.userName || r.userEmail || "-",
    },
    {
      key: "action",
      header: "",
      className: "text-right",
      cell: (r) => {
        const isPending = pendingIds.has(r._id);
        return (
          <div className="flex flex-col items-end gap-1">
            {canAcknowledge(r, user, now) ? (
              <Button
                size="sm"
                disabled={isPending}
                onClick={(e) => { e.stopPropagation(); ack.mutate(r); }}
              >
                {isPending ? "กำลังบันทึก..." : "รับทราบ"}
              </Button>
            ) : inUseStatus(r, now) === "expired" ? (
              <span className="text-xs text-muted-foreground">
                รอ {r.userName || r.userEmail || "ผู้เบิก"} รับทราบ
              </span>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); setResolving(r); }}
            >
              แจ้งหมด/ทิ้ง
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r._id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyTitle="ยังไม่มี standard ที่กำลังใช้งาน"
        emptyDescription="รายการที่เบิกแล้วยังไม่ปิดจะมาอยู่ที่นี่"
        tableClassName="min-w-[880px]"
      />
      {resolving && (
        <DeductionResolutionDialog
          transaction={toResolutionTransaction(resolving)}
          onClose={() => setResolving(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["stock", "in-use"] });
            qc.invalidateQueries({ queryKey: ["stock-deductions"] });
            qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
            qc.invalidateQueries({ queryKey: ["stock", "units"] });
          }}
        />
      )}
    </>
  );
}
