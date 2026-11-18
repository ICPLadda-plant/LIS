import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/dateTime";
import { formatStockQuantityWithUnit } from "@/lib/stockQuantity";
import { unitDerivedStatus } from "@/lib/stockUnit";
import type { StockStandardItem, StockTransactionItem, StockUnitItem } from "@/types/stock";

const ACTION_LABEL: Record<string, string> = {
  create: "สร้าง", update: "แก้ไข", delete: "ลบ", deduct: "เบิกใช้",
  receive: "รับเข้า", withdraw: "เบิก", discard: "ทิ้งขวด",
};

const STATUS_LABEL: Record<string, string> = {
  active: "ใช้งานได้", empty: "หมด", discarded: "ทิ้งแล้ว", expired: "หมดอายุ",
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

function HistoryTable({ txs }: { txs: StockTransactionItem[] }) {
  if (!txs.length) return <p className="py-4 text-center text-sm text-muted-foreground">ไม่มีประวัติในช่วงนี้</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">วันที่</th>
            <th className="px-3 py-2 text-left font-medium">รายการ</th>
            <th className="px-3 py-2 text-right font-medium">จำนวน</th>
            <th className="px-3 py-2 text-left font-medium">ผู้ทำ / หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {txs.map((tx) => (
            <tr key={tx._id} className="border-t border-border align-top">
              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(tx.createdAt)}</td>
              <td className="px-3 py-2"><Badge variant="outline">{ACTION_LABEL[tx.action] || tx.action}</Badge></td>
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
  );
}

function BottleCard({ unit, txs, open, onOpenChange }: {
  unit: StockUnitItem; txs: StockTransactionItem[]; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const status = unitDerivedStatus(unit);
  const usage = unit.petitionUsage;
  const petitions = usage?.petitions || [];
  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="w-full text-left">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{unit.labelCode || unit.qrId}</span>
                <Badge variant="outline">{unit.type || "primary"}</Badge>
                <Badge variant={status === "active" ? "secondary" : "outline"}>{STATUS_LABEL[status] || status}</Badge>
                {usage?.start && !usage.end && <Badge>กำลังใช้งาน</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>Lot {unit.lotNo || "-"}</span>
                <span>Purity {unit.purity ?? "-"}</span>
                <span>เหลือ {formatStockQuantityWithUnit(unit.volume?.remaining, unit.volume?.unit)}</span>
                <span>รับเข้า {formatDate(unit.receivedDate || unit.createdAt)}</span>
                <span>EXP {formatDate(unit.exp)}</span>
                <span>
                  {usage?.start
                    ? `ใช้ ${formatDate(usage.start)} – ${usage.end ? formatDate(usage.end) : "ปัจจุบัน"}`
                    : "ยังไม่เคยเบิกใช้"}
                </span>
              </div>
              <div className="text-sm">ใบนำส่ง {petitions.length} ใบ · ประวัติ {txs.length} รายการ</div>
            </div>
            <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </CardContent>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border p-4">
            {petitions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium">ใบนำส่งที่ใช้ขวดนี้</div>
                <div className="flex flex-wrap gap-1">
                  {petitions.map((p) => (
                    <Badge key={p.petitionNo} variant={p.source === "withdraw" ? "default" : "secondary"}>{p.petitionNo}</Badge>
                  ))}
                </div>
              </div>
            )}
            <HistoryTable txs={txs} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** ประวัติของสาร Standard แยกเป็นการ์ดรายขวด กดยุบ/ขยายได้ พร้อมกรองช่วงวันที่ */
export default function StandardHistoryPanel({ standard }: { standard: StockStandardItem }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const filtering = !!(from || to);

  const { data: units = [], isLoading: loadingUnits } = useQuery({
    queryKey: ["stock", "units", "standard", standard.code],
    queryFn: () => api.getStockUnits({ itemCode: standard.code, itemType: "standard" }),
  });
  const { data: txs = [], isLoading: loadingTxs } = useQuery({
    queryKey: ["stock", "transactions", "standard", standard._id, from, to],
    queryFn: () => api.getStockTransactions({
      itemType: "standard",
      itemId: standard._id,
      limit: 1000,
      ...(from ? { createdFrom: new Date(`${from}T00:00:00`).toISOString() } : {}),
      ...(to ? { createdTo: nextDay(to) } : {}),
    }),
  });

  const cards = useMemo(() => {
    const byQr = new Map<string, StockTransactionItem[]>();
    for (const tx of txs) {
      if (!tx.qrId) continue;
      byQr.set(tx.qrId, [...(byQr.get(tx.qrId) || []), tx]);
    }
    return units
      .map((unit) => ({ unit, txs: byQr.get(unit.qrId) || [] }))
      .filter((c) => !filtering || c.txs.length > 0)
      .sort((a, b) => String(b.unit.receivedDate || b.unit.createdAt || "").localeCompare(String(a.unit.receivedDate || a.unit.createdAt || "")));
  }, [units, txs, filtering]);

  const setOpen = (id: string, open: boolean) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (open) next.add(id); else next.delete(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">ตั้งแต่วันที่</span>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">ถึงวันที่</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        {filtering && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>ล้างตัวกรอง</Button>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{cards.length} ขวด</span>
          <Button variant="outline" size="sm" onClick={() => setOpenIds(new Set(cards.map((c) => c.unit._id)))}>ขยายทั้งหมด</Button>
          <Button variant="outline" size="sm" onClick={() => setOpenIds(new Set())}>ยุบทั้งหมด</Button>
        </div>
      </div>
      {loadingUnits || loadingTxs ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : cards.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{filtering ? "ไม่มีขวดที่มีประวัติในช่วงนี้" : "ยังไม่มีขวด"}</p>
      ) : (
        <div className="space-y-3">
          {cards.map((c) => (
            <BottleCard key={c.unit._id} unit={c.unit} txs={c.txs} open={openIds.has(c.unit._id)} onOpenChange={(o) => setOpen(c.unit._id, o)} />
          ))}
        </div>
      )}
    </div>
  );
}
