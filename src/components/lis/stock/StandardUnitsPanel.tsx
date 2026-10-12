import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Pencil, Plus, TriangleAlert, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import StockRawLabelPreviewDialog from "@/components/lis/StockRawLabelPreviewDialog";
import { api } from "@/lib/api";
import { standardLabelCodeFromStockUnit } from "@/lib/standardLabelCode";
import { formatStockQuantityWithUnit } from "@/lib/stockQuantity";
import { buildStockLabelHtml } from "@/lib/stockLabel";
import { formatDate } from "@/lib/dateTime";
import { unitDerivedStatus, visibleBottles } from "@/lib/stockUnit";
import type { StockStandardItem, StockUnitItem } from "@/types/stock";
import EditUnitDialog from "./EditUnitDialog";
import ReceiveBottlesDialog from "./ReceiveBottlesDialog";
import PerformanceDropDialog from "./PerformanceDropDialog";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  empty: "bg-slate-100 text-slate-600",
  discarded: "bg-destructive/15 text-destructive",
  expired: "bg-amber-100 text-amber-700",
};
const STATUS_LABEL: Record<string, string> = {
  active: "ใช้งานได้", empty: "หมด", discarded: "ทิ้งแล้ว", expired: "หมดอายุ",
};
const COMPACT_ACTION_BUTTON_CLASS = "h-8 w-8 sm:h-8 sm:w-8";

function unitLabelCode(unit: StockUnitItem): string {
  return standardLabelCodeFromStockUnit(unit) || "-";
}

function compareUnitsByLabelCode(a: StockUnitItem, b: StockUnitItem): number {
  const byCode = unitLabelCode(a).localeCompare(unitLabelCode(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (byCode !== 0) return byCode;
  return String(a.qrId || "").localeCompare(String(b.qrId || ""), undefined, { numeric: true, sensitivity: "base" });
}

type PreviewLabelOptions = { autoPrint?: boolean };

export default function StandardUnitsPanel({ standard, onEdit }: { standard: StockStandardItem; onEdit?: () => void }) {
  const qc = useQueryClient();
  const [editUnit, setEditUnit] = useState<StockUnitItem | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [reportUnits, setReportUnits] = useState<StockUnitItem[] | null>(null);
  const [selectedQrIds, setSelectedQrIds] = useState<Set<string>>(() => new Set());
  const [pendingLabels, setPendingLabels] = useState<string[]>([]);
  const [labelPreviewOpen, setLabelPreviewOpen] = useState(false);
  const [autoPrintLabels, setAutoPrintLabels] = useState(false);
  const [labelPrintJobId, setLabelPrintJobId] = useState(0);

  const { data = [], isLoading } = useQuery({
    queryKey: ["stock", "units", standard.code],
    queryFn: () => api.getStockUnits({ itemCode: standard.code }),
  });

  const rows = visibleBottles(data).sort(compareUnitsByLabelCode);
  const selectedRows = rows.filter((row) => selectedQrIds.has(row.qrId));
  const selectedReportRows = selectedRows.filter((row) => {
    const status = unitDerivedStatus(row);
    return status !== "discarded" && status !== "empty";
  });
  const allSelected = rows.length > 0 && rows.every((row) => selectedQrIds.has(row.qrId));
  const selectionState = allSelected ? true : selectedRows.length > 0 ? "indeterminate" : false;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["stock", "units", standard.code] });
    qc.invalidateQueries({ queryKey: ["stock", "units"] });
    qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
  };

  const previewLabels = (labels: string[], options?: PreviewLabelOptions) => {
    setPendingLabels(labels);
    setAutoPrintLabels(options?.autoPrint === true);
    setLabelPrintJobId((id) => id + 1);
    setLabelPreviewOpen(true);
  };

  const reprint = async (unit: StockUnitItem) => {
    try {
      const html = await buildStockLabelHtml(unit);
      previewLabels([html]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const printSelected = async () => {
    if (selectedRows.length === 0) return;
    try {
      const labels = await Promise.all(selectedRows.map((unit) => buildStockLabelHtml(unit)));
      previewLabels(labels);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggleRow = (qrId: string, checked: boolean) => {
    setSelectedQrIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(qrId);
      else next.delete(qrId);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedQrIds(checked ? new Set(rows.map((row) => row.qrId)) : new Set());
  };

  const clearSelection = () => setSelectedQrIds(new Set());

  const closeReportDialog = () => setReportUnits(null);
  const handleReportSaved = () => {
    closeReportDialog();
    clearSelection();
    refresh();
  };

  return (
    <div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-9">
          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1.5 text-sm">
              <span className="font-medium">เลือกแล้ว {selectedRows.length} ขวด</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                aria-label="ปริ้นที่เลือก"
                title="ปริ้นที่เลือก"
                onClick={printSelected}
              >
                <Printer className="w-4 h-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                aria-label="แจ้งหมด/ปัญหาที่เลือก"
                title="แจ้งหมด/ปัญหาที่เลือก"
                disabled={selectedReportRows.length === 0}
                onClick={() => setReportUnits(selectedReportRows)}
              >
                <TriangleAlert className="w-4 h-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                aria-label="ล้างที่เลือก"
                title="ล้างที่เลือก"
                onClick={clearSelection}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {onEdit && (
            <Button type="button" size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="w-4 h-4 mr-1" /> แก้ไข
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setReceiving(true)}>
            <Plus className="w-4 h-4 mr-1" /> เพิ่มขวด (รับเข้า)
          </Button>
        </div>
      </div>
      <Table containerClassName="overflow-hidden" className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-9 px-2 text-center">
                <Checkbox
                  aria-label="เลือกขวดทั้งหมด"
                  checked={selectionState}
                  disabled={rows.length === 0}
                  onCheckedChange={(value) => toggleAll(value === true)}
                />
              </TableHead>
              <TableHead className="w-8 px-1 text-center">#</TableHead>
              <TableHead className="w-20 px-2">ประเภท</TableHead>
              <TableHead className="w-20 px-2">Code</TableHead>
              <TableHead className="w-24 px-2 text-right">คงเหลือ</TableHead>
              <TableHead className="w-20 px-2">EXP</TableHead>
              <TableHead className="w-24 px-2">สถานะ</TableHead>
              <TableHead className="w-[92px] px-1 text-right">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-6">กำลังโหลด...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">ยังไม่มีขวด — กดเพิ่มขวด</TableCell></TableRow>
            ) : rows.map((unit, index) => {
              const status = unitDerivedStatus(unit);
              return (
                <TableRow key={unit._id} data-state={selectedQrIds.has(unit.qrId) ? "selected" : undefined}>
                  <TableCell className="px-2 py-3 text-center">
                    <Checkbox
                      aria-label={`เลือกขวด ${index + 1}`}
                      checked={selectedQrIds.has(unit.qrId)}
                      onCheckedChange={(value) => toggleRow(unit.qrId, value === true)}
                    />
                  </TableCell>
                  <TableCell className="px-1 py-3 text-center text-muted-foreground">{index + 1}</TableCell>
                  <TableCell className="px-2 py-3"><Badge variant="outline">{unit.type || "primary"}</Badge></TableCell>
                  <TableCell className="px-2 py-3 font-mono text-xs">{unitLabelCode(unit)}</TableCell>
                  <TableCell className="whitespace-nowrap px-2 py-3 text-right">{formatStockQuantityWithUnit(unit.volume?.remaining, unit.volume?.unit)}</TableCell>
                  <TableCell className="whitespace-nowrap px-2 py-3 text-xs">{formatDate(unit.exp)}</TableCell>
                  <TableCell className="px-2 py-3"><Badge className={`text-xs ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</Badge></TableCell>
                  <TableCell className="px-1 py-2">
                    <div className="flex justify-end gap-0.5">
                      {status !== "discarded" && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className={COMPACT_ACTION_BUTTON_CLASS}
                          aria-label="แก้ไขข้อมูล"
                          title="แก้ไขข้อมูล"
                          onClick={() => setEditUnit(unit)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className={COMPACT_ACTION_BUTTON_CLASS}
                        aria-label="ปริ้นซ้ำ"
                        title="ปริ้นซ้ำ"
                        onClick={() => reprint(unit)}
                      >
                        <Printer className="w-4 h-4" />
                      </Button>
                      {status !== "discarded" && status !== "empty" && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className={COMPACT_ACTION_BUTTON_CLASS}
                          aria-label="แจ้งหมด/ปัญหา"
                          title="แจ้งหมด/ปัญหา"
                          onClick={() => setReportUnits([unit])}
                        >
                          <TriangleAlert className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

      {receiving && <ReceiveBottlesDialog standard={standard} onClose={() => setReceiving(false)} onSaved={refresh} onPreviewLabels={previewLabels} />}
      {editUnit && <EditUnitDialog unit={editUnit} onClose={() => setEditUnit(null)} onSaved={refresh} />}
      {reportUnits && <PerformanceDropDialog units={reportUnits} onClose={closeReportDialog} onSaved={handleReportSaved} />}
      <StockRawLabelPreviewDialog
        open={labelPreviewOpen}
        labels={pendingLabels}
        autoPrint={autoPrintLabels}
        autoPrintKey={labelPrintJobId}
        onOpenChange={(open) => {
          setLabelPreviewOpen(open);
          if (!open) {
            setPendingLabels([]);
            setAutoPrintLabels(false);
          }
        }}
        onPrinted={() => {
          setPendingLabels([]);
          setAutoPrintLabels(false);
        }}
      />
    </div>
  );
}
