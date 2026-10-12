import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import StockRawLabelPreviewDialog from "@/components/lis/StockRawLabelPreviewDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { buildSolventLabelHtml } from "@/lib/stockLabel";
import { formatDate as formatDisplayDate } from "@/lib/dateTime";
import { unitDerivedStatus, visibleBottles, type UnitDerivedStatus } from "@/lib/stockUnit";
import type { StockSolventItem, StockTransactionItem, StockUnitItem } from "@/types/stock";

const STATUS_BADGE: Record<UnitDerivedStatus, string> = {
  active: "bg-emerald-100 text-emerald-700",
  empty: "bg-slate-100 text-slate-600",
  discarded: "bg-destructive/15 text-destructive",
  expired: "bg-amber-100 text-amber-700",
};

const STATUS_LABEL: Record<UnitDerivedStatus, string> = {
  active: "ใช้งานได้",
  empty: "หมด",
  discarded: "ทิ้งแล้ว",
  expired: "หมดอายุ",
};

type SolventBottleRow = {
  id: string;
  qrId?: string;
  lotNo?: string;
  bottleNo?: number | null;
  exp?: string | null;
  receivedDate?: string | null;
  sizeLiter?: number | null;
  status: UnitDerivedStatus;
  source: "unit" | "history" | "summary";
};

function positiveInteger(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return 0;
  return Math.floor(number);
}

function parseSolventReceiveNote(note = "") {
  const parts = note.split(" · ").map((part) => part.trim()).filter(Boolean);
  const result: { lotNo?: string; exp?: string; sizeLiter?: number } = {};
  for (const part of parts) {
    if (/^lot\s+/i.test(part)) result.lotNo = part.replace(/^lot\s+/i, "").trim();
    else if (/^exp\s+/i.test(part)) result.exp = part.replace(/^exp\s+/i, "").trim();
    else {
      const size = part.match(/^ขนาด\s+([\d,.]+)\s*L$/i);
      if (size) {
        const parsed = Number(size[1].replace(/,/g, ""));
        if (Number.isFinite(parsed) && parsed > 0) result.sizeLiter = parsed;
      }
    }
  }
  return result;
}

function formatDate(value?: string | null): string {
  return formatDisplayDate(value);
}

function formatLiter(value?: number | null): string {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "-";
  return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 })} L`;
}

function sizeLiterFromUnit(unit: StockUnitItem, fallback: number): number | null {
  const initial = Number(unit.volume?.initial);
  if (Number.isFinite(initial) && initial > 0 && unit.volume?.unit === "ml") return initial / 1000;
  if (Number.isFinite(initial) && initial > 0 && unit.volume?.unit === "g") return initial / 1000;
  return Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : null;
}

function rowsFromStoredUnits(solvent: StockSolventItem, units: StockUnitItem[]): SolventBottleRow[] {
  return visibleBottles(units)
    .map((unit, index) => ({
      id: unit._id || unit.qrId || `${solvent._id}-unit-${index}`,
      qrId: unit.qrId,
      lotNo: unit.lotNo || "",
      bottleNo: unit.lotBottleNo ?? index + 1,
      exp: unit.exp ?? null,
      receivedDate: unit.receivedDate ?? unit.createdAt ?? null,
      sizeLiter: sizeLiterFromUnit(unit, solvent.sizeLiter),
      status: unitDerivedStatus(unit),
      source: "unit" as const,
    }));
}

function rowsFromReceiveHistory(solvent: StockSolventItem, transactions: StockTransactionItem[]): SolventBottleRow[] {
  const targetCount = positiveInteger(solvent.qty);
  if (targetCount === 0) return [];

  const rows: SolventBottleRow[] = [];
  for (const transaction of transactions) {
    const count = positiveInteger(transaction.delta);
    if (count === 0) continue;
    const parsed = parseSolventReceiveNote(transaction.note || "");
    for (let index = 0; index < count && rows.length < targetCount; index += 1) {
      rows.push({
        id: `history-${transaction._id}-${index + 1}`,
        lotNo: parsed.lotNo || "",
        bottleNo: index + 1,
        exp: parsed.exp || null,
        receivedDate: transaction.createdAt,
        sizeLiter: parsed.sizeLiter ?? solvent.sizeLiter,
        status: "active",
        source: "history",
      });
    }
    if (rows.length >= targetCount) break;
  }

  while (rows.length < targetCount) {
    const index = rows.length;
    rows.push({
      id: `summary-${solvent._id}-${index + 1}`,
      lotNo: "",
      bottleNo: index + 1,
      exp: null,
      receivedDate: solvent.updatedAt ?? solvent.createdAt ?? null,
      sizeLiter: solvent.sizeLiter,
      status: "active",
      source: "summary",
    });
  }

  return rows;
}

function sourceLabel(source: SolventBottleRow["source"]): string {
  if (source === "unit") return "รายขวด";
  if (source === "history") return "จากประวัติรับเข้า";
  return "ข้อมูลเดิม";
}

export default function SolventUnitsPanel({ solvent }: { solvent: StockSolventItem }) {
  const [pendingLabels, setPendingLabels] = useState<string[]>([]);
  const [labelPreviewOpen, setLabelPreviewOpen] = useState(false);
  const [labelPrintJobId, setLabelPrintJobId] = useState(0);

  const { data: storedUnits = [], isLoading: unitsLoading, isFetched: unitsFetched } = useQuery({
    queryKey: ["stock", "units", "solvent", solvent._id],
    queryFn: () => api.getStockUnits({ itemType: "solvent", itemId: solvent._id }),
  });

  const shouldUseHistory = unitsFetched && storedUnits.length === 0 && positiveInteger(solvent.qty) > 0;
  const { data: receiveTransactions = [], isLoading: historyLoading } = useQuery({
    queryKey: ["stock", "transactions", "solvent-receive", solvent._id],
    queryFn: () => api.getStockTransactions({ itemType: "solvent", itemId: solvent._id, action: "receive", limit: 1000 }),
    enabled: shouldUseHistory,
  });

  const rows = useMemo(() => {
    const storedRows = rowsFromStoredUnits(solvent, storedUnits);
    if (storedRows.length > 0) return storedRows;
    return rowsFromReceiveHistory(solvent, receiveTransactions);
  }, [receiveTransactions, solvent, storedUnits]);

  const isLoading = unitsLoading || (shouldUseHistory && historyLoading);

  const previewLabels = (labels: string[]) => {
    setPendingLabels(labels);
    setLabelPrintJobId((id) => id + 1);
    setLabelPreviewOpen(true);
  };

  const buildLabel = (row: SolventBottleRow) => buildSolventLabelHtml({
    name: solvent.name,
    idForQr: row.qrId || solvent._id,
    lotNo: row.lotNo || undefined,
    receivedDate: row.receivedDate || null,
    exp: row.exp || null,
    bottleNo: row.bottleNo ?? undefined,
    sizeLabel: formatLiter(row.sizeLiter),
  });

  const reprint = async (row: SolventBottleRow) => {
    try {
      previewLabels([await buildLabel(row)]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const printAll = async () => {
    if (rows.length === 0) return;
    try {
      previewLabels(await Promise.all(rows.map((row) => buildLabel(row))));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="rounded-lg border">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold">รายละเอียดรายขวด</div>
          <div className="text-xs text-muted-foreground">ดู lot, EXP, วันที่รับเข้า และพิมพ์ sticker ซ้ำได้</div>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={rows.length === 0} onClick={printAll}>
          <Printer className="mr-1 h-4 w-4" /> ปริ้น sticker ทุกขวด
        </Button>
      </div>
      <Table containerClassName="overflow-x-auto" className="min-w-[720px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-center">#</TableHead>
            <TableHead className="w-32">Lot</TableHead>
            <TableHead className="w-20">ขวดที่</TableHead>
            <TableHead className="w-24 text-right">ขนาด</TableHead>
            <TableHead className="w-28">EXP</TableHead>
            <TableHead className="w-28">รับเข้า</TableHead>
            <TableHead className="w-32">สถานะ</TableHead>
            <TableHead className="w-28 text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={8} className="py-6 text-center">กำลังโหลด...</TableCell></TableRow>
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">ยังไม่มีข้อมูลรายขวด</TableCell></TableRow>
          ) : rows.map((row, index) => (
            <TableRow key={row.id}>
              <TableCell className="text-center text-muted-foreground">{index + 1}</TableCell>
              <TableCell className="font-mono text-xs">{row.lotNo || "-"}</TableCell>
              <TableCell>{row.bottleNo ?? "-"}</TableCell>
              <TableCell className="text-right whitespace-nowrap">{formatLiter(row.sizeLiter)}</TableCell>
              <TableCell className="whitespace-nowrap text-xs">{formatDate(row.exp)}</TableCell>
              <TableCell className="whitespace-nowrap text-xs">{formatDate(row.receivedDate)}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <Badge className={`w-fit text-xs ${STATUS_BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</Badge>
                  {row.source !== "unit" && <span className="text-[11px] text-muted-foreground">{sourceLabel(row.source)}</span>}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`ปริ้น sticker ขวดที่ ${row.bottleNo ?? index + 1}`}
                    title="ปริ้น sticker"
                    onClick={() => reprint(row)}
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(labelPreviewOpen || pendingLabels.length > 0) && (
        <StockRawLabelPreviewDialog
          open={labelPreviewOpen}
          labels={pendingLabels}
          autoPrintKey={labelPrintJobId}
          onOpenChange={(open) => {
            setLabelPreviewOpen(open);
            if (!open) setPendingLabels([]);
          }}
          onPrinted={() => setPendingLabels([])}
        />
      )}
    </div>
  );
}
