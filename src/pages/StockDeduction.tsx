import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowDownToLine, Calendar as CalendarIcon, History, Filter, Pencil, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/lis/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/context/ConfirmDialog";
import { api } from "@/lib/api";
import { readStockLabelCodeFromImage } from "@/lib/aiApi";
import PageHeader from "@/components/lis/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/lis/DataTable";
import StockRequisitionButton from "@/components/lis/stock/StockRequisitionButton";
import ReceiveCart from "@/components/lis/stock/ReceiveCart";
import StockQrScanner from "@/components/lis/StockQrScanner";
import { ANALYSIS_ROOM_SLUG } from "@/lib/analysisInstruments";
import { DEDUCTION_RESOLUTION_LABELS } from "@/lib/deductionResolution";
import { requisitionUser, standardRequisitionUnitLabelCode } from "@/lib/standardRequisition";
import { canManageStockDeduction, deductionAmount } from "@/lib/stockDeduction";
import { formatStockQuantity } from "@/lib/stockQuantity";
import { isLikelyHardwareStockScan, parseScannedQrId } from "@/lib/stockUnit";
import { getRoomCatalog } from "@/lib/roomEquipment";
import { normalizeRoles } from "@/lib/roles";
import { formatDate, formatDateTime } from "@/lib/dateTime";
import type { StockTransactionItem } from "@/types/stock";

const analysisInstruments =
  getRoomCatalog(ANALYSIS_ROOM_SLUG)?.instruments.map((i) => ({ id: i.id, name: i.name, group: i.group })) ?? [];

const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function localDateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateFromInputValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function bangkokDayWindow(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return {
    createdFrom: new Date(Date.UTC(year, monthIndex, day) - BANGKOK_UTC_OFFSET_MS).toISOString(),
    createdTo: new Date(Date.UTC(year, monthIndex, day + 1) - BANGKOK_UTC_OFFSET_MS).toISOString(),
  };
}

function formatSelectedDate(value: string) {
  const date = dateFromInputValue(value);
  if (!date) return "เลือกวันที่ดูยอดเบิก";
  return formatDate(date);
}

function deductionAmountNumber(transaction: StockTransactionItem) {
  const value = transaction.delta ?? transaction.volumeDelta;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

function deductionUnitLabel(transaction: StockTransactionItem) {
  return transaction.unit || transaction.volumeUnit || (transaction.weights?.length ? "mg" : "");
}

const HARDWARE_SCAN_MAX_GAP_MS = 80;
const HARDWARE_SCAN_MAX_DURATION_MS = 1200;
const HARDWARE_SCAN_MIN_LENGTH = 6;

type EditableScanTarget = HTMLInputElement | HTMLTextAreaElement;

interface EditableSnapshot {
  target: EditableScanTarget;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

interface HardwareScanBuffer {
  text: string;
  firstAt: number;
  lastAt: number;
  snapshot: EditableSnapshot | null;
}

function editableScanTarget(target: EventTarget | null): EditableScanTarget | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target;
  return null;
}

function editableSnapshot(target: EditableScanTarget): EditableSnapshot {
  return {
    target,
    value: target.value,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd,
  };
}

function setEditableValue(target: EditableScanTarget, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")?.set;
  if (valueSetter) valueSetter.call(target, value);
  else target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function restoreEditableSnapshot(snapshot: EditableSnapshot | null) {
  if (!snapshot || !document.contains(snapshot.target)) return;
  setEditableValue(snapshot.target, snapshot.value);
  if (snapshot.selectionStart == null || snapshot.selectionEnd == null) return;
  try {
    snapshot.target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  } catch {
    return;
  }
}

function normalizeStockLabelCandidate(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 5 ? digits : "";
}

const StockDeduction = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [type, setType] = useState<string>("");
  const [selected, setSelected] = useState<StockTransactionItem | null>(null);
  const [editing, setEditing] = useState<StockTransactionItem | null>(null);
  const [deleting, setDeleting] = useState<StockTransactionItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [scannedQrId, setScannedQrId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [search, setSearch] = useState("");
  const canReceiveStock = normalizeRoles(user).some((role) => role === "admin" || role === "lab-inventory");
  const hardwareScanRef = useRef<HardwareScanBuffer>({ text: "", firstAt: 0, lastAt: 0, snapshot: null });
  const queryQrId = searchParams.get("qrId")?.trim() || null;
  const initialQrId = scannedQrId ?? queryQrId;
  const clearInitialQrId = useCallback(() => {
    if (scannedQrId) {
      setScannedQrId(null);
      return;
    }
    if (!queryQrId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("qrId");
    setSearchParams(next, { replace: true });
  }, [queryQrId, scannedQrId, searchParams, setSearchParams]);

  const applyScannedQrId = useCallback((qrId: string) => {
    setScannedQrId(qrId);
    setScannerOpen(false);
    if (queryQrId) {
      const next = new URLSearchParams(searchParams);
      next.delete("qrId");
      setSearchParams(next, { replace: true });
    }
  }, [queryQrId, searchParams, setSearchParams]);

  const openCameraScanner = useCallback(() => {
    setScannerOpen(true);
  }, []);

  const applyHardwareScan = useCallback((rawInput: string) => {
    const raw = rawInput.trim();
    const qrId = parseScannedQrId(raw);
    if (!qrId) {
      toast.error("กรุณายิง QR ข้างขวดด้วยเครื่อง scanner");
      return;
    }
    applyScannedQrId(qrId);
  }, [applyScannedQrId]);

  const handleCaptureImage = useCallback(async (imageDataUrl: string) => {
    const ocr = await readStockLabelCodeFromImage(imageDataUrl);
    const candidates = [...new Set([ocr.labelCode, ...ocr.candidates].map(normalizeStockLabelCandidate).filter(Boolean))];
    if (candidates.length === 0) {
      toast.error(ocr.error || "อ่านเลขใต้ QR ไม่ได้ กรุณาถ่ายให้เห็นเลขชัดขึ้น");
      return;
    }

    try {
      const [standards, ...unitGroups] = await Promise.all([
        queryClient.fetchQuery({ queryKey: ["stock", "standards"], queryFn: api.getStandards }),
        ...candidates.map((candidate) => api.getStockUnits({ labelCode: candidate })),
      ]);
      const standardCodes = new Set(standards.map((standard) => String(standard.code)));
      const findMatches = (units: Awaited<ReturnType<typeof api.getStockUnits>>) => units.filter((unit) => (
        standardCodes.has(String(unit.itemCode))
        && candidates.includes(normalizeStockLabelCandidate(standardRequisitionUnitLabelCode(unit)))
      ));

      const units = unitGroups.flat();
      let matches = findMatches(units);
      if (matches.length === 0) {
        const pickerUnits = await queryClient.fetchQuery({ queryKey: ["stock", "units"], queryFn: () => api.getStockUnits() });
        matches = findMatches(pickerUnits);
      }
      const matchedUnit = matches.find((unit) => unit.status === "active") ?? matches[0];
      if (!matchedUnit) {
        toast.error(`ไม่พบขวด stock ที่มีเลข ${candidates.join(", ")}`);
        return;
      }

      applyScannedQrId(matchedUnit.qrId);
    } catch (err) {
      toast.error((err as Error).message || "ค้นหาเลขใต้ QR ไม่สำเร็จ");
    }
  }, [applyScannedQrId, queryClient]);

  useEffect(() => {
    const resetBuffer = () => {
      hardwareScanRef.current = { text: "", firstAt: 0, lastAt: 0, snapshot: null };
    };

    const handleHardwareScannerKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      const now = performance.now();
      const buffer = hardwareScanRef.current;

      if (event.key === "Enter") {
        const raw = buffer.text.trim();
        const elapsedMs = buffer.firstAt ? now - buffer.firstAt : Number.POSITIVE_INFINITY;
        const shouldApply = isLikelyHardwareStockScan(raw, elapsedMs, {
          minLength: HARDWARE_SCAN_MIN_LENGTH,
          maxDurationMs: HARDWARE_SCAN_MAX_DURATION_MS,
        });
        const snapshot = buffer.snapshot;
        resetBuffer();
        if (!shouldApply) return;

        event.preventDefault();
        event.stopPropagation();
        restoreEditableSnapshot(snapshot);
        applyHardwareScan(raw);
        return;
      }

      if (event.key.length !== 1) {
        if (buffer.lastAt && now - buffer.lastAt > HARDWARE_SCAN_MAX_GAP_MS) resetBuffer();
        return;
      }

      const isContinuation = Boolean(buffer.text) && now - buffer.lastAt <= HARDWARE_SCAN_MAX_GAP_MS;
      if (!isContinuation) {
        const target = editableScanTarget(event.target);
        hardwareScanRef.current = {
          text: event.key,
          firstAt: now,
          lastAt: now,
          snapshot: target ? editableSnapshot(target) : null,
        };
        return;
      }

      hardwareScanRef.current = {
        ...buffer,
        text: buffer.text + event.key,
        lastAt: now,
      };
    };

    window.addEventListener("keydown", handleHardwareScannerKeyDown, true);
    return () => window.removeEventListener("keydown", handleHardwareScannerKeyDown, true);
  }, [applyHardwareScan]);

  const refreshStockDeductions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["stock-deductions"] });
    queryClient.invalidateQueries({ queryKey: ["stock", "transactions"] });
    queryClient.invalidateQueries({ queryKey: ["stock", "units"] });
    queryClient.invalidateQueries({ queryKey: ["stock", "standards"] });
    queryClient.invalidateQueries({ queryKey: ["stock", "solvents"] });
    queryClient.invalidateQueries({ queryKey: ["stock", "glassware"] });
  }, [queryClient]);

  const selectedDayWindow = selectedDate ? bangkokDayWindow(selectedDate) : undefined;
  const selectedCalendarDate = selectedDate ? dateFromInputValue(selectedDate) : undefined;
  const searchText = search.trim();
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock-deductions", type, selectedDate, searchText],
    queryFn: () =>
      api.getStockTransactions({
        action: "deduct",
        itemType: type || undefined,
        ...(searchText ? { search: searchText } : {}),
        ...(selectedDayWindow || {}),
        limit: selectedDayWindow ? 1000 : 200,
      }),
  });

  const dailySummary = useMemo(() => {
    const rows = new Map<string, { key: string; itemType: string; itemName: string; unit: string; total: number; count: number }>();
    data.forEach((transaction) => {
      const total = deductionAmountNumber(transaction);
      if (!total) return;
      const unit = deductionUnitLabel(transaction);
      const key = [transaction.itemType, transaction.itemId, transaction.itemCode || "", transaction.itemName || "", unit].join("|");
      const current = rows.get(key) || {
        key,
        itemType: transaction.itemType,
        itemName: transaction.itemName || transaction.itemCode || transaction.itemId || "-",
        unit,
        total: 0,
        count: 0,
      };
      current.total += total;
      current.count += 1;
      rows.set(key, current);
    });
    const summary = Array.from(rows.values());
    return searchText ? summary : summary.sort((a, b) => a.itemName.localeCompare(b.itemName, "th"));
  }, [data, searchText]);

  const columns: DataTableColumn<StockTransactionItem>[] = [
    {
      key: "time",
      header: "เวลา",
      className: "text-xs whitespace-nowrap",
      cell: (t) => formatDateTime(t.createdAt),
    },
    { key: "type", header: "หมวด", cell: (t) => <Badge variant="outline">{t.itemType}</Badge> },
    {
      key: "item",
      header: "รายการ",
      cell: (t) => <div className="font-medium">{t.itemName}</div>,
    },
    {
      key: "delta",
      header: "จำนวนที่ตัด",
      className: "text-right font-mono",
      cell: (t) => {
        const { text, sub } = deductionAmount(t);
        return (
          <>
            <div className="text-destructive">{text}</div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
          </>
        );
      },
    },
    {
      key: "remaining",
      header: "คงเหลือ",
      className: "text-sm",
      cell: (t) => (
        <>
          {formatStockQuantity(t.beforeQty)} → <strong>{formatStockQuantity(t.afterQty)}</strong>
          {t.unit ? <span className="text-xs text-muted-foreground"> {t.unit}</span> : null}
        </>
      ),
    },
    { key: "user", header: "ผู้ดำเนินการ", className: "text-xs", cell: (t) => t.userName || t.userEmail || "-" },
    { key: "note", header: "หมายเหตุ", className: "text-xs text-muted-foreground", cell: (t) => t.note || "" },
    {
      key: "actions",
      header: "จัดการ",
      className: "text-right",
      cell: (t) => canManageStockDeduction(t, user) ? (
        <div
          className="flex justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`แก้ไขการเบิก ${t.itemName || t.itemCode || t._id}`}
            onClick={() => setEditing(t)}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" /> แก้ไข
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            aria-label={`ลบการเบิก ${t.itemName || t.itemCode || t._id}`}
            onClick={() => setDeleting(t)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> ลบ
          </Button>
        </div>
      ) : null,
    },
  ];

  const handleEdited = (updated: StockTransactionItem) => {
    setSelected((current) => (current?._id === updated._id ? updated : current));
    setEditing(null);
    refreshStockDeductions();
  };

  const deleteDeduction = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteStockDeduction(deleting._id, { _user: requisitionUser(user) });
      toast.success("ลบการเบิกแล้ว");
      setSelected((current) => (current?._id === deleting._id ? null : current));
      setDeleting(null);
      refreshStockDeductions();
    } catch (err) {
      toast.error((err as Error).message || "ลบการเบิกไม่สำเร็จ");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <AppLayout>
      <PageHeader
        className="mb-6"
        title={
          <span className="inline-flex items-center gap-2">
            <History className="w-6 h-6" />
            การเบิก stock
          </span>
        }
        description="เบิกสารเคมีให้เครื่อง และดูประวัติการตัด stock"
        actions={
          <>
            <Button type="button" variant="outline" onClick={openCameraScanner}>
              <ScanLine className="mr-1 h-4 w-4" /> สแกน QR ข้างขวด
            </Button>
            {canReceiveStock ? (
              <Button type="button" onClick={() => setReceiveOpen(true)}>
                <ArrowDownToLine className="mr-1 h-4 w-4" /> รับเข้า Stock
              </Button>
            ) : null}
            <StockRequisitionButton
              roomSlug={ANALYSIS_ROOM_SLUG}
              instruments={analysisInstruments}
              initialQrId={initialQrId}
              onInitialQrConsumed={clearInitialQrId}
            />
          </>
        }
      />

      <div className="mb-3 grid gap-2 lg:grid-cols-[minmax(240px,1fr)_auto_auto_auto] lg:items-end">
        <div className="space-y-1">
          <Label htmlFor="stock-deduction-search" className="text-xs">ค้นหาชื่อสารหรือคนเบิก</Label>
          <Input
            id="stock-deduction-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ชื่อสาร รหัส stock ชื่อ หรืออีเมล"
            className="h-9"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label="เลือกวันที่ดูยอดเบิก"
              className="h-9 w-full justify-start gap-2 sm:w-auto"
            >
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              {formatSelectedDate(selectedDate)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto rounded-2xl p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedCalendarDate}
              onSelect={(date) => setSelectedDate(date ? localDateInputValue(date) : "")}
              defaultMonth={selectedCalendarDate ?? new Date()}
              initialFocus
              className="rounded-2xl border bg-background p-3 shadow-lg"
            />
          </PopoverContent>
        </Popover>
        {selectedDate ? (
          <Button type="button" variant="ghost" className="h-9" onClick={() => setSelectedDate("")}>ล้างวันที่</Button>
        ) : null}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full lg:w-44">
              <SelectValue placeholder="ทุกหมวด" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกหมวด</SelectItem>
              <SelectItem value="standard">Standards</SelectItem>
              <SelectItem value="solvent">สารเคมี</SelectItem>
              <SelectItem value="glassware">เครื่องแก้ว</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {selectedDate ? (
        <div aria-label="สรุปยอดเบิกตามวันที่" className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">ยอดเบิกวันที่ {formatSelectedDate(selectedDate)}</div>
              <div className="text-xs text-muted-foreground">รวมจากรายการตัด stock ที่เกิดในวันปฏิทินนี้</div>
            </div>
            <Badge variant="outline">{data.length} รายการ</Badge>
          </div>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">กำลังโหลดสรุป...</div>
          ) : dailySummary.length === 0 ? (
            <div className="text-sm text-muted-foreground">วันที่นี้ไม่มี stock ออก</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {dailySummary.map((row) => (
                <div key={row.key} className="rounded-lg border bg-background p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{row.itemName}</div>
                      <Badge variant="outline" className="mt-1 text-[11px]">{row.itemType}</Badge>
                    </div>
                    <div className="text-right font-mono text-sm font-semibold text-destructive">
                      {formatStockQuantity(row.total)}{row.unit ? ` ${row.unit}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{row.count} ครั้ง</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={data}
        rowKey={(t) => t._id}
        isLoading={isLoading}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="ยังไม่มีรายการตัด stock"
        tableClassName="min-w-[980px]"
      />
      <StockQrScanner
        open={scannerOpen}
        title="สแกน QR หรือถ่าย Code บนสติ๊กเกอร์เพื่อเบิก"
        showManualEntry={false}
        onClose={() => setScannerOpen(false)}
        onScanned={applyScannedQrId}
        onCaptureImage={handleCaptureImage}
      />

      <Dialog open={receiveOpen} onOpenChange={(open) => {
        if (open) {
          setReceiveOpen(true);
          return;
        }
        void confirm({
          title: "ปิดหน้ารับเข้า Stock?",
          description: "รายการที่ยังไม่บันทึกจะถูกเก็บไว้ และนำกลับมาใช้ต่อได้ในครั้งหน้า",
          confirmText: "ปิดและเก็บไว้",
          cancelText: "ทำรายการต่อ",
        }).then((ok) => { if (ok) setReceiveOpen(false); });
      }}>
        <DialogContent className="max-h-[92vh] max-w-[98vw] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>รับเข้า Stock</DialogTitle>
            <DialogDescription>เพิ่มรายการที่นำเข้า ตรวจสอบรายละเอียด แล้วกดรับเข้าเพื่อบันทึก</DialogDescription>
          </DialogHeader>
          <ReceiveCart onSaved={() => {
            refreshStockDeductions();
            setReceiveOpen(false);
          }} />
        </DialogContent>
      </Dialog>

      <DeductionDetailSheet
        transaction={selected}
        onClose={() => setSelected(null)}
      />
      {editing && (
        <DeductionEditDialog
          transaction={editing}
          user={user}
          onClose={() => setEditing(null)}
          onSaved={handleEdited}
        />
      )}
      <DeductionDeleteDialog
        transaction={deleting}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={deleteDeduction}
      />
    </AppLayout>
  );
};

export default StockDeduction;

function deductionAmountValue(transaction: StockTransactionItem): number {
  const value = transaction.volumeDelta ?? transaction.delta;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

function formatAmountInput(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(value) : "";
}

function unitLabel(transaction: StockTransactionItem): string {
  return transaction.unit || transaction.volumeUnit || (transaction.weights?.length ? "mg" : "");
}

function DeductionEditDialog({
  transaction,
  user,
  onClose,
  onSaved,
}: {
  transaction: StockTransactionItem;
  user: { email?: string; name?: string } | null;
  onClose: () => void;
  onSaved: (transaction: StockTransactionItem) => void;
}) {
  const initialWeights = transaction.weights?.length ? transaction.weights : [];
  const [amount, setAmount] = useState(formatAmountInput(deductionAmountValue(transaction)));
  const [weights, setWeights] = useState(initialWeights.map((weight) => formatAmountInput(weight)));
  const [note, setNote] = useState(transaction.note || "");
  const [busy, setBusy] = useState(false);
  const isWeightMode = weights.length > 0;
  const weightNumbers = weights.map((weight) => Number(weight));
  const parsedAmount = isWeightMode
    ? weightNumbers.reduce((total, weight) => total + (Number.isFinite(weight) ? weight : 0), 0)
    : Number(amount);
  const hasInvalidWeights = isWeightMode && weightNumbers.some((weight) => !Number.isFinite(weight) || weight <= 0);
  const canSave = Number.isFinite(parsedAmount) && parsedAmount > 0 && !hasInvalidWeights;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const updated = await api.updateStockDeduction(transaction._id, {
        ...(isWeightMode ? { weights: weightNumbers } : { amount: parsedAmount }),
        note,
        _user: requisitionUser(user),
      });
      toast.success("แก้ไขการเบิกแล้ว");
      onSaved(updated);
    } catch (err) {
      toast.error((err as Error).message || "แก้ไขการเบิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>แก้ไขการเบิก</DialogTitle>
          <DialogDescription>
            {transaction.itemName || transaction.itemCode || transaction._id}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isWeightMode ? (
            <div className="space-y-2">
              <Label>น้ำหนักที่ตัด ({unitLabel(transaction) || "mg"})</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {weights.map((weight, index) => (
                  <Input
                    key={`${transaction._id}-weight-${index}`}
                    type="number"
                    min="0"
                    step="any"
                    value={weight}
                    aria-label={`น้ำหนักที่ ${index + 1}`}
                    onChange={(event) => setWeights((current) => current.map((value, valueIndex) => (
                      valueIndex === index ? event.target.value : value
                    )))}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">รวม {formatStockQuantity(parsedAmount)} {unitLabel(transaction) || "mg"}</p>
              {hasInvalidWeights && <p className="text-sm text-destructive">กรุณากรอกน้ำหนักทุกช่องให้มากกว่า 0</p>}
            </div>
          ) : (
            <div>
              <Label className="mb-1.5 block">จำนวนที่ตัด {unitLabel(transaction) ? `(${unitLabel(transaction)})` : ""}</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          )}
          <div>
            <Label className="mb-1.5 block">หมายเหตุ</Label>
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button type="button" onClick={save} disabled={!canSave || busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeductionDeleteDialog({
  transaction,
  busy,
  onCancel,
  onConfirm,
}: {
  transaction: StockTransactionItem | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(transaction)} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ลบการเบิก?</DialogTitle>
          <DialogDescription>
            {transaction
              ? `รายการ "${transaction.itemName || transaction.itemCode || transaction._id}" จะถูกลบ และคืนจำนวนกลับเข้า stock`
              : "ยืนยันการลบการเบิก"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>ยกเลิก</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "กำลังลบ..." : "ลบ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeductionDetailSheet({
  transaction,
  onClose,
}: {
  transaction: StockTransactionItem | null;
  onClose: () => void;
}) {
  const amount = transaction ? deductionAmount(transaction) : null;
  const resolution = transaction?.deductionResolution;

  return (
    <Sheet open={Boolean(transaction)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-16 text-left">
          <SheetTitle>รายละเอียดการเบิก</SheetTitle>
          <SheetDescription>
            {transaction?.itemName || transaction?.itemCode || transaction?.itemId || "-"}
          </SheetDescription>
        </SheetHeader>

        {transaction && amount ? (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{transaction.itemType}</Badge>
              {transaction.qrId ? <Badge variant="secondary">QR {transaction.qrId}</Badge> : null}
              {resolution ? (
                <Badge variant="secondary">แจ้งแล้ว: {DEDUCTION_RESOLUTION_LABELS[resolution.reason]}</Badge>
              ) : transaction.itemType !== "glassware" ? (
                <Badge variant="outline">ยังไม่ได้แจ้ง</Badge>
              ) : null}
            </div>

            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <DetailItem label="รายการ" value={transaction.itemName || "-"} />
              <DetailItem label="รหัส" value={transaction.itemCode || "-"} />
              <DetailItem label="เวลา" value={formatDateTime(transaction.createdAt)} />
              <DetailItem label="จำนวนที่ตัด" value={amount.sub ? `${amount.text} (${amount.sub})` : amount.text} />
              <DetailItem
                label="คงเหลือ"
                value={`${formatStockQuantity(transaction.beforeQty)} → ${formatStockQuantity(transaction.afterQty)}${transaction.unit ? ` ${transaction.unit}` : ""}`}
              />
              <DetailItem label="เครื่อง" value={transaction.instrumentName || transaction.instrumentGroup?.toUpperCase() || "-"} />
              <DetailItem label="ผู้ดำเนินการ" value={transaction.userName || transaction.userEmail || "-"} />
              <DetailItem label="หมายเหตุ" value={transaction.note || "-"} />
            </dl>

            {resolution ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="font-medium">แจ้งหมด/ปัญหาแล้ว</div>
                <div className="mt-1 text-muted-foreground">
                  {DEDUCTION_RESOLUTION_LABELS[resolution.reason]}
                  {resolution.note ? ` — ${resolution.note}` : ""}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}
