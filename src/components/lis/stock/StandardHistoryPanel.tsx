import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/dateTime";
import type { StockStandardItem, StockTransactionItem } from "@/types/stock";

const ACTION_LABEL: Record<string, string> = {
  create: "สร้าง", update: "แก้ไข", delete: "ลบ", deduct: "เบิกใช้",
  receive: "รับเข้า", withdraw: "เบิก", discard: "ทิ้งขวด",
};

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function qtyText(tx: StockTransactionItem): string {
  if (tx.volumeDelta != null) return `${tx.volumeDelta > 0 ? "+" : ""}${tx.volumeDelta} ${tx.volumeUnit || tx.unit || ""}`.trim();
  if (tx.delta != null) return `${tx.delta > 0 ? "+" : ""}${tx.delta} ${tx.unit || ""}`.trim();
  return "-";
}

/** ประวัติทั้งหมดของสาร Standard พร้อมกรองช่วงวันที่ */
export default function StandardHistoryPanel({ standard }: { standard: StockStandardItem }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock", "transactions", "standard", standard._id, from, to],
    queryFn: () => api.getStockTransactions({
      itemType: "standard",
      itemId: standard._id,
      limit: 1000,
      ...(from ? { createdFrom: new Date(`${from}T00:00:00`).toISOString() } : {}),
      ...(to ? { createdTo: nextDay(to) } : {}),
    }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">ตั้งแต่วันที่</span>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">ถึงวันที่</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>ล้างตัวกรอง</Button>}
        <span className="ml-auto text-sm text-muted-foreground">{data.length} รายการ</span>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">ไม่มีประวัติในช่วงนี้</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">วันที่</th>
                <th className="px-3 py-2 text-left font-medium">รายการ</th>
                <th className="px-3 py-2 text-left font-medium">ขวด</th>
                <th className="px-3 py-2 text-right font-medium">จำนวน</th>
                <th className="px-3 py-2 text-left font-medium">ผู้ทำ / หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {data.map((tx) => (
                <tr key={tx._id} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(tx.createdAt)}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{ACTION_LABEL[tx.action] || tx.action}</Badge></td>
                  <td className="px-3 py-2 whitespace-nowrap">{tx.qrId || "-"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{qtyText(tx)}</td>
                  <td className="px-3 py-2">
                    <div>{tx.userName || tx.userEmail || "-"}</div>
                    {tx.note && <div className="text-xs text-muted-foreground break-words">{tx.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
