import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, AlertTriangle, Calendar as CalendarIcon, Clock, Plus, Pencil, ArrowDownToLine, History, Search, Trash2, ChevronDown, Download } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { api } from "@/lib/api";
import { rankSearchResults } from "@/lib/searchRanking";
import { formatDate, formatDateTime, formatMonth } from "@/lib/dateTime";
import { useAuth } from "@/context/AuthContext";
import { normalizeRoles, type RoleHolder } from "@/lib/roles";
import { requisitionUser } from "@/lib/standardRequisition";
import {
  summarizeStandard, standardLevel, solventLevel, glasswareLevel, isUsableBottle,
  standardMatchesStatuses, getStandardAlertSummary, type StandardStatus,
} from "@/lib/stockStatus";
import {
  FREQUENCY_UNITS, FREQUENCY_PRESETS, parseFrequency, formatFrequency, isPreset,
  type FrequencyUnit,
} from "@/lib/standardFrequency";
import StandardDetailDrawer from "@/components/lis/stock/StandardDetailDrawer";
import StandardUnitsPanel from "@/components/lis/stock/StandardUnitsPanel";
import SolventUnitsPanel from "@/components/lis/stock/SolventUnitsPanel";
import StockQrScanner from "@/components/lis/StockQrScanner";
import DiscardDialog from "@/components/lis/stock/DiscardDialog";
import StockRawLabelPreviewDialog from "@/components/lis/StockRawLabelPreviewDialog";
import { buildStockLabelHtml } from "@/lib/stockLabel";
import { formatStockQuantity, formatStockQuantityWithUnit } from "@/lib/stockQuantity";
import { visibleBottles } from "@/lib/stockUnit";
import type {
  StockStandardItem, StockSolventItem, StockGlasswareItem,
  StockTransactionItem, StockUnitItem,
} from "@/types/stock";
import { useAccessibleTabs } from "@/hooks/useAccessibleTabs";

const STANDARD_STATUS_OPTIONS: { value: StandardStatus; label: string }[] = [
  { value: "ok", label: "ปกติ" },
  { value: "out", label: "หมด" },
  { value: "low", label: "ใกล้หมด" },
  { value: "expired", label: "หมดอายุ" },
  { value: "soon", label: "ใกล้หมดอายุ" },
];

function canDeleteStockItems(user: RoleHolder | null | undefined) {
  const roles = normalizeRoles(user);
  return roles.includes("admin") || !roles.includes("lab-inventory");
}

type StockExportKind = "standard" | "solvent";
type StockExportFormat = "xlsx" | "pdf";

function localDateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateFromInputValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatExportDateRangeLabel(startDate: string, endDate: string) {
  const start = dateFromInputValue(startDate);
  const end = dateFromInputValue(endDate);
  if (start && end) {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }
  if (start) return `${formatDate(start)} – เลือกวันสิ้นสุด`;
  return "เลือกช่วงวันที่ export";
}

function safeDownloadSegment(value: string | undefined) {
  return (value || "stock").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_") || "stock";
}

function formatStockDate(value: string) {
  return formatDate(value);
}

function formatStockMonth(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return formatMonth(date);
}

function downloadStockExport(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ============================================================
// Standards Tab
// ============================================================
function StandardsTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canDelete = canDeleteStockItems(user);
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock", "standards"],
    queryFn: api.getStandards,
  });

  const { data: allUnits = [] } = useQuery({
    queryKey: ["stock", "units"],
    queryFn: () => api.getStockUnits(),
  });
  const unitsByCode = useMemo(() => {
    const m = new Map<string, StockUnitItem[]>();
    for (const u of allUnits) {
      const arr = m.get(u.itemCode) ?? [];
      arr.push(u);
      m.set(u.itemCode, arr);
    }
    return m;
  }, [allUnits]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawerItem = drawerId ? data.find(s => s._id === drawerId) ?? null : null;

  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<Set<StandardStatus>>(new Set());
  const toggleStatus = (value: StandardStatus) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };
  const [editing, setEditing] = useState<StockStandardItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StockStandardItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [standardListExporting, setStandardListExporting] = useState<StockExportFormat | null>(null);
  const [standardAlertsOpen, setStandardAlertsOpen] = useState(false);

  const now = Date.now();

  // per-bottle summary per standard (counts derived from StockUnit, not stale tier qty)
  const sumOf = (s: StockStandardItem) => summarizeStandard(unitsByCode.get(s.code) ?? [], new Date(now));

  // usable-bottle breakdown by tier (primary/working/supplier) per standard code — small UX line in the table row
  const usableByCode = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const [code, units] of unitsByCode) {
      const counts: Record<string, number> = {};
      for (const u of units) {
        if (!isUsableBottle(u, new Date(now))) continue;
        const t = u.type || "primary";
        counts[t] = (counts[t] ?? 0) + 1;
      }
      m.set(code, counts);
    }
    return m;
  }, [unitsByCode, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = data.filter(s => {
      const sum = summarizeStandard(unitsByCode.get(s.code) ?? [], new Date(now));
      if (q && !s.name.toLowerCase().includes(q) && !s.code.toLowerCase().includes(q)) return false;
      if (statusFilters.size === 0) return true;
      return standardMatchesStatuses(sum, statusFilters);
    }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return rankSearchResults(matches, search, (standard) => ({ primary: [standard.code], secondary: [standard.name] }));
  }, [data, search, statusFilters, now, unitsByCode]);

  const visibleStandards = data;
  const standardAlerts = visibleStandards.flatMap(s => {
    const units = unitsByCode.get(s.code) ?? [];
    const summary = summarizeStandard(units, new Date(now));
    const alert = getStandardAlertSummary(summary, { units, now: new Date(now) });
    return alert ? [{ standard: s, alert }] : [];
  });

  const statusLabel =
    statusFilters.size === 0 ? "ทุกสถานะ"
    : statusFilters.size === 1 ? STANDARD_STATUS_OPTIONS.find(o => statusFilters.has(o.value))!.label
    : `สถานะ (${statusFilters.size})`;

  const deleteItem = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteStandard(deleting._id);
      toast.success("ลบรายการสำเร็จ");
      qc.invalidateQueries({ queryKey: ["stock", "standards"] });
      qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
      setDeleting(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const buildStandardListExportRows = () => filtered.map((item) => {
    const units = unitsByCode.get(item.code) ?? [];
    const summary = summarizeStandard(units, new Date(now));
    const counts = usableByCode.get(item.code) ?? {};
    const statusParts = [];
    if (summary.usable === 0) statusParts.push("หมด");
    if (summary.usable === 1) statusParts.push("ใกล้หมด");
    if (summary.expired > 0) statusParts.push(`หมดอายุ ${summary.expired}`);
    if (summary.expiringSoon > 0) statusParts.push(`ใกล้หมดอายุ ${summary.expiringSoon}`);
    return {
      Code: item.code,
      Name: item.name,
      "คงเหลือใช้งานได้": summary.usable,
      Primary: counts.primary ?? 0,
      Working: counts.working ?? 0,
      Supplier: counts.supplier ?? 0,
      Frequency: item.frequency || "",
      "Storage Temp": item.storageTemp || "",
      Status: statusParts.join(" · ") || "ปกติ",
    };
  });

  const exportStandards = async (format: StockExportFormat) => {
    const rows = buildStandardListExportRows();
    if (rows.length === 0) {
      toast.error("ไม่มีข้อมูล Standard สำหรับ export");
      return;
    }

    setStandardListExporting(format);
    try {
      const blob = await api.exportMasterItems(format, rows, "Standards");
      downloadStockExport(blob, `standards-${localDateInputValue()}.${format}`);
      toast.success("Export Standards สำเร็จ");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStandardListExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      {standardAlerts.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                <span className="font-semibold text-destructive">
                  แจ้งเตือน Standard ({standardAlerts.length} รายการ)
                </span>
              </div>
              {standardAlerts.length > 8 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 w-fit border-destructive/30 text-destructive hover:text-destructive"
                  onClick={() => setStandardAlertsOpen(true)}
                >
                  ดูทั้งหมด
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {standardAlerts.slice(0, 8).map(({ standard: s, alert }) => {
                const Icon = alert.lowStock ? Package : Clock;
                return (
                  <div key={`std-alert-${s._id}`} className={`flex items-center gap-2 ${alert.severity === "destructive" ? "text-destructive" : "text-amber-600"}`}>
                    <Icon className="w-3.5 h-3.5" />
                    <span>
                      <strong>{s.name}</strong> {alert.message}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
      <Dialog open={standardAlertsOpen} onOpenChange={setStandardAlertsOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>แจ้งเตือน Standard ทั้งหมด</DialogTitle>
            <DialogDescription>
              แสดง Standard ที่ต้องติดตามทั้งหมด {standardAlerts.length} รายการ
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              {standardAlerts.map(({ standard: s, alert }) => {
                const Icon = alert.lowStock ? Package : Clock;
                return (
                  <div
                    key={`std-alert-dialog-${s._id}`}
                    className={`rounded-md border p-3 ${alert.severity === "destructive" ? "border-destructive/30 text-destructive" : "border-amber-300 text-amber-600"}`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="break-words text-foreground">{s.name}</strong>
                          <Badge variant="outline" className="text-[10px]">{s.code}</Badge>
                        </div>
                        <div>{alert.message}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:space-y-0 space-y-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-5 h-5" /> Standards (สาร Standard)
            <Badge variant="outline">{visibleStandards.length}</Badge>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหา code หรือชื่อ" className="pl-8 h-9 w-full sm:w-64"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 w-full sm:w-40 justify-between font-normal">
                  {statusLabel}
                  <ChevronDown className="w-4 h-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {STANDARD_STATUS_OPTIONS.map(o => (
                  <DropdownMenuCheckboxItem
                    key={o.value}
                    checked={statusFilters.has(o.value)}
                    onCheckedChange={() => toggleStatus(o.value)}
                    onSelect={e => e.preventDefault()}
                  >
                    {o.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5"
                  disabled={standardListExporting !== null}
                >
                  <Download className="w-4 h-4" /> Export
                  <ChevronDown className="w-4 h-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onClick={() => exportStandards("xlsx")}>
                  Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportStandards("pdf")}>
                  PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="w-4 h-4 mr-1" /> เพิ่มรายการ
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Code</TableHead>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead className="text-center">คงคลัง (ขวด)</TableHead>
                  <TableHead className="hidden xl:table-cell">ความถี่/1 ครั้ง</TableHead>
                  <TableHead className="hidden xl:table-cell">อุณหภูมิ</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="w-12"><span className="sr-only">ลบ</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">กำลังโหลด...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">ไม่มีข้อมูล</TableCell></TableRow>
                ) : filtered.map(item => {
                  return (
                    <TableRow
                      key={item._id}
                      className="cursor-pointer"
                      onClick={() => setDrawerId(item._id)}
                      onDoubleClick={() => setDrawerId(item._id)}
                      title="คลิกเพื่อดูรายละเอียด"
                    >
                      <TableCell className="font-semibold text-primary">{item.code}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      {(() => {
                        const sum = summarizeStandard(unitsByCode.get(item.code) ?? [], new Date(now));
                        const counts = usableByCode.get(item.code) ?? {};
                        const parts = (["primary", "working", "supplier"] as const)
                          .filter(t => (counts[t] ?? 0) > 0)
                          .map(t => `${t} ${counts[t]}`);
                        return (
                          <TableCell className="text-center">
                            <div>{sum.usable}</div>
                            {parts.length > 0 && (
                              <div className="text-xs text-muted-foreground">{parts.join(" · ")}</div>
                            )}
                          </TableCell>
                        );
                      })()}
                      <TableCell className="hidden xl:table-cell text-xs">{item.frequency || "-"}</TableCell>
                      <TableCell className="hidden xl:table-cell text-xs">{item.storageTemp || "-"}</TableCell>
                      <TableCell>
                        {(() => {
                          const sum = summarizeStandard(unitsByCode.get(item.code) ?? [], new Date(now));
                          return (
                            <div className="flex flex-wrap gap-1">
                              {sum.usable === 0 && <Badge className="bg-destructive/15 text-destructive text-xs">หมด</Badge>}
                              {sum.expired > 0 && <Badge className="bg-destructive/15 text-destructive text-xs">หมดอายุ {sum.expired}</Badge>}
                              {sum.expiringSoon > 0 && <Badge className="bg-amber-100 text-amber-700 text-xs">ใกล้หมดอายุ {sum.expiringSoon}</Badge>}
                              {sum.usable === 1 && sum.expired === 0 && sum.expiringSoon === 0 && <Badge className="bg-amber-100 text-amber-700 text-xs">ใกล้หมด</Badge>}
                              {sum.usable >= 2 && sum.expired === 0 && sum.expiringSoon === 0 && <Badge className="bg-emerald-100 text-emerald-700 text-xs">ปกติ</Badge>}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex justify-end"
                          onClick={e => e.stopPropagation()}
                          onDoubleClick={e => e.stopPropagation()}
                        >
                          {canDelete && (
                            <Button
                              size="icon" variant="ghost"
                              title={`ลบ Standard ${item.name}`} aria-label={`ลบ Standard ${item.name}`}
                              onClick={() => setDeleting(item)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {(creating || editing) && (
        <StandardDialog
          item={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["stock", "standards"] });
            qc.invalidateQueries({ queryKey: ["stock", "units"] });
          }}
        />
      )}
      {drawerItem && (
        <StandardDetailDrawer
          standard={drawerItem}
          units={unitsByCode.get(drawerItem.code) ?? []}
          onEdit={() => setEditing(drawerItem)}
          onClose={() => setDrawerId(null)}
        />
      )}
      <DeleteConfirmDialog
        open={!!deleting}
        title="ลบ Standard?"
        itemName={deleting?.name}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={deleteItem}
      />
    </div>
  );
}

function SolventDetailDrawer({
  item, onClose, onEdit,
}: {
  item: StockSolventItem;
  onClose: () => void;
  onEdit: () => void;
}) {
  const fields: [string, string][] = [
    ["ขนาดล่าสุด/ขวด (ลิตร)", item.sizeLiter != null ? String(item.sizeLiter) : "-"],
    ["จำนวนคงเหลือ (ขวด)", String(item.qty ?? 0)],
    ["ราคาล่าสุด (บาท)", item.price != null ? item.price.toLocaleString() : "-"],
    ["หมายเหตุ", item.note || "-"],
  ];

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <SheetHeader className="space-y-2 border-b border-border p-5 pr-16 text-left">
          <SheetTitle className="text-xl font-bold">{item.name}</SheetTitle>
          <SheetDescription>Solvent</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-sm">
            {fields.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">{label}:</dt>
                <dd className="font-medium break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
          <SolventUnitsPanel solvent={item} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function GlasswareDetailDrawer({
  item, onClose, onReceive, onEdit,
}: {
  item: StockGlasswareItem;
  onClose: () => void;
  onReceive: () => void;
  onEdit: () => void;
}) {
  const fields: [string, string][] = [
    ["Quantity (pieces)", String(item.qty ?? 0)],
    ["Price / piece (THB)", item.pricePerPiece != null ? item.pricePerPiece.toLocaleString() : "-"],
    ["Note", item.note || "-"],
  ];

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="space-y-2 border-b border-border p-5 pr-16 text-left">
          <SheetTitle className="text-xl font-bold">{item.name}</SheetTitle>
          <SheetDescription>Glassware</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onReceive}>
              <ArrowDownToLine className="w-4 h-4 mr-1" /> Receive
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-sm">
            {fields.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">{label}:</dt>
                <dd className="font-medium break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// Solvents Tab
// ============================================================
function SolventsTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canDelete = canDeleteStockItems(user);
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock", "solvents"],
    queryFn: api.getSolvents,
  });

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StockSolventItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StockSolventItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailItem = detailId ? data.find(s => s._id === detailId) ?? null : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rankSearchResults(q ? data.filter(s => s.name.toLowerCase().includes(q)) : data, search, (solvent) => ({ primary: [solvent.name] }));
  }, [data, search]);

  const visibleSolvents = data;
  const lowList = visibleSolvents.filter(s => solventLevel(s.qty) !== "ok");

  const deleteItem = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteSolvent(deleting._id);
      toast.success("ลบรายการสำเร็จ");
      qc.invalidateQueries({ queryKey: ["stock", "solvents"] });
      qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
      setDeleting(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {lowList.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <span className="font-semibold text-destructive">แจ้งเตือนสารเคมี ({lowList.length} รายการ)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm text-destructive">
              {lowList.map(s => (
                <div key={s._id}>
                  {s.qty === 0
                    ? <>• {s.name} หมดแล้ว</>
                    : <>• {s.name} เหลือ {s.qty} ขวด</>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:space-y-0 space-y-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-5 h-5" /> สารเคมี / Solvents
            <Badge variant="outline">{visibleSolvents.length}</Badge>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา" className="pl-8 h-9 w-full sm:w-64" />
            </div>
            <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" /> เพิ่มรายการ</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>รายการ</TableHead>
                <TableHead className="text-right">ขนาดล่าสุด (ลิตร)</TableHead>
                <TableHead className="text-right">จำนวน (ขวด)</TableHead>
                <TableHead className="text-right">ราคาล่าสุด (บาท)</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-6">กำลังโหลด...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">ไม่มีข้อมูล</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow
                  key={item._id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(item._id)}
                  onDoubleClick={() => setDetailId(item._id)}
                  title="Open details"
                >
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-right">{item.sizeLiter}</TableCell>
                  <TableCell className="text-right">
                    <Badge className={solventLevel(item.qty) === "ok" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}>
                      {item.qty}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{item.price.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.note}</TableCell>
                  <TableCell>
                    <div
                      className="flex justify-end gap-1"
                      onClick={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                    >
                      <Button size="icon" variant="ghost" onClick={() => setEditing(item)}><Pencil className="w-4 h-4" /></Button>
                      {canDelete && (
                        <Button size="icon" variant="ghost" title={`ลบสารเคมี ${item.name}`} aria-label={`ลบสารเคมี ${item.name}`} onClick={() => setDeleting(item)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {detailItem && (
        <SolventDetailDrawer
          item={detailItem}
          onClose={() => setDetailId(null)}
          onEdit={() => setEditing(detailItem)}
        />
      )}
      {(creating || editing) && (
        <SimpleItemDialog
          title="สารเคมี"
          item={editing}
          fields={[
            { key: "name", label: "ชื่อรายการ", type: "text", required: true },
            { key: "sizeLiter", label: "ขนาด (ลิตร)", type: "number" },
            { key: "price", label: "ราคา (บาท)", type: "number" },
            { key: "note", label: "หมายเหตุ", type: "text" },
          ]}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (payload) => {
            const { qty: _ignoredQty, ...safePayload } = payload;
            void _ignoredQty;
            if (editing) await api.updateSolvent(editing._id, safePayload);
            else await api.createSolvent({ ...safePayload, qty: 0 });
            qc.invalidateQueries({ queryKey: ["stock", "solvents"] });
            qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
          }}
        />
      )}
      <DeleteConfirmDialog
        open={!!deleting}
        title="ลบสารเคมี?"
        itemName={deleting?.name}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={deleteItem}
      />
    </div>
  );
}

// ============================================================
// Glassware Tab
// ============================================================
function GlasswareTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canDelete = canDeleteStockItems(user);
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock", "glassware"],
    queryFn: api.getGlassware,
  });

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StockGlasswareItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<{ item: StockGlasswareItem; mode: "deduct" | "receive" } | null>(null);
  const [deleting, setDeleting] = useState<StockGlasswareItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailItem = detailId ? data.find(s => s._id === detailId) ?? null : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rankSearchResults(q ? data.filter(s => s.name.toLowerCase().includes(q)) : data, search, (glassware) => ({ primary: [glassware.name] }));
  }, [data, search]);

  // เครื่องแก้ว: แจ้งเฉพาะตอนหมดจริง (ไม่เตือนตอนใกล้หมด)
  const visibleGlassware = data;
  const outList = visibleGlassware.filter(s => glasswareLevel(s.qty) === "out");

  const deleteItem = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteGlassware(deleting._id);
      toast.success("ลบรายการสำเร็จ");
      qc.invalidateQueries({ queryKey: ["stock", "glassware"] });
      qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
      setDeleting(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {outList.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <span className="font-semibold text-destructive">เครื่องแก้วหมด ({outList.length} รายการ)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm text-destructive">
              {outList.map(s => <div key={s._id}>• {s.name} หมดแล้ว</div>)}
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:space-y-0 space-y-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-5 h-5" /> เครื่องแก้ว / Glassware
            <Badge variant="outline">{visibleGlassware.length}</Badge>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา" className="pl-8 h-9 w-full sm:w-64" />
            </div>
            <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" /> เพิ่มรายการ</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>รายการ</TableHead>
                <TableHead className="text-right">จำนวน (ชิ้น)</TableHead>
                <TableHead className="text-right">ราคา/ชิ้น (บาท)</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6">กำลังโหลด...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">ไม่มีข้อมูล</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow
                  key={item._id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(item._id)}
                  onDoubleClick={() => setDetailId(item._id)}
                  title="Open details"
                >
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-right">
                    <Badge className={glasswareLevel(item.qty) === "out" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}>
                      {item.qty}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{item.pricePerPiece.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.note}</TableCell>
                  <TableCell>
                    <div
                      className="flex justify-end gap-1"
                      onClick={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                    >
                      <Button size="icon" variant="ghost" onClick={() => setMoving({ item, mode: "receive" })}><ArrowDownToLine className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditing(item)}><Pencil className="w-4 h-4" /></Button>
                      {canDelete && (
                        <Button size="icon" variant="ghost" title={`ลบเครื่องแก้ว ${item.name}`} aria-label={`ลบเครื่องแก้ว ${item.name}`} onClick={() => setDeleting(item)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {(creating || editing) && (
        <SimpleItemDialog
          title="เครื่องแก้ว"
          item={editing}
          fields={[
            { key: "name", label: "ชื่อรายการ", type: "text", required: true },
            { key: "qty", label: "จำนวนคงเหลือ (ชิ้น)", type: "number" },
            { key: "pricePerPiece", label: "ราคา/ชิ้น (บาท)", type: "number" },
            { key: "note", label: "หมายเหตุ", type: "text" },
          ]}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (payload) => {
            if (editing) await api.updateGlassware(editing._id, payload);
            else await api.createGlassware(payload);
            qc.invalidateQueries({ queryKey: ["stock", "glassware"] });
            qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
          }}
        />
      )}
      {moving && (
        <SimpleMoveDialog
          title={moving.mode === "deduct" ? "ตัด stock เครื่องแก้ว" : "รับเข้าเครื่องแก้ว"}
          mode={moving.mode}
          itemName={moving.item.name}
          currentQty={moving.item.qty}
          unit="ชิ้น"
          onClose={() => setMoving(null)}
          onSubmit={async (qty, note) => {
            const _user = requisitionUser(user);
            if (moving.mode === "deduct") await api.deductGlassware(moving.item._id, { qty, note, _user });
            else await api.receiveGlassware(moving.item._id, { qty, note, _user });
            qc.invalidateQueries({ queryKey: ["stock", "glassware"] });
            qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
          }}
        />
      )}
      {detailItem && (
        <GlasswareDetailDrawer
          item={detailItem}
          onClose={() => setDetailId(null)}
          onReceive={() => {
            setDetailId(null);
            setMoving({ item: detailItem, mode: "receive" });
          }}
          onEdit={() => {
            setDetailId(null);
            setEditing(detailItem);
          }}
        />
      )}
      <DeleteConfirmDialog
        open={!!deleting}
        title="ลบเครื่องแก้ว?"
        itemName={deleting?.name}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={deleteItem}
      />
    </div>
  );
}

// ============================================================
// History Tab
// ============================================================
function HistoryTab() {
  const [type, setType] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportKind, setExportKind] = useState<StockExportKind>("standard");
  const [exportStandardFormat, setExportStandardFormat] = useState<StockExportFormat>("xlsx");
  const [exportStandardId, setExportStandardId] = useState("");
  const [exportStandardStartDate, setExportStandardStartDate] = useState("");
  const [exportStandardEndDate, setExportStandardEndDate] = useState("");
  const [exportSolventId, setExportSolventId] = useState("");
  const [exportDate, setExportDate] = useState(() => localDateInputValue());
  const [exporting, setExporting] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock", "transactions", type, action],
    queryFn: () => api.getStockTransactions({ itemType: type || undefined, action: action || undefined, limit: 300 }),
  });
  const { data: standards = [] } = useQuery({
    queryKey: ["stock", "standards"],
    queryFn: api.getStandards,
  });
  const { data: solvents = [] } = useQuery({
    queryKey: ["stock", "solvents"],
    queryFn: api.getSolvents,
  });

  const selectedStandard = standards.find((item) => item._id === exportStandardId);
  const selectedSolvent = solvents.find((item) => item._id === exportSolventId);
  const selectedStandardDateRange: DateRange | undefined = exportStandardStartDate || exportStandardEndDate
    ? {
      from: dateFromInputValue(exportStandardStartDate),
      to: dateFromInputValue(exportStandardEndDate),
    }
    : undefined;

  const handleStandardDateRangeSelect = (range: DateRange | undefined) => {
    setExportStandardStartDate(range?.from ? localDateInputValue(range.from) : "");
    setExportStandardEndDate(range?.to ? localDateInputValue(range.to) : "");
  };

  const handleOpenExport = () => {
    setExportOpen(true);
  };

  const handleExport = async () => {
    if (exportKind === "standard" && !exportStandardId) {
      toast.error("กรุณาเลือก standard");
      return;
    }
    if (exportKind === "standard" && !exportStandardStartDate) {
      toast.error("กรุณาเลือกวันที่เริ่มต้น");
      return;
    }
    if (exportKind === "standard" && !exportStandardEndDate) {
      toast.error("กรุณาเลือกวันที่สิ้นสุด");
      return;
    }
    if (exportKind === "standard" && exportStandardStartDate > exportStandardEndDate) {
      toast.error("วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด");
      return;
    }
    if (exportKind === "solvent" && !exportSolventId) {
      toast.error("กรุณาเลือกสารเคมี");
      return;
    }
    if (exportKind === "solvent" && !exportDate) {
      toast.error("กรุณาเลือกวันที่");
      return;
    }

    setExporting(true);
    try {
      if (exportKind === "standard") {
        const blob = await api.exportStockStandardHistory({
          itemId: exportStandardId,
          startDate: exportStandardStartDate,
          endDate: exportStandardEndDate,
          format: exportStandardFormat,
        });
        const baseName = safeDownloadSegment(selectedStandard?.code || selectedStandard?.name || "standard");
        const extension = exportStandardFormat === "pdf" ? "pdf" : "xlsx";
        downloadStockExport(blob, `${baseName}-standard-history-${exportStandardStartDate}_to_${exportStandardEndDate}.${extension}`);
      } else {
        const blob = await api.exportStockSolventHistory({ solventId: exportSolventId, date: exportDate });
        const baseName = safeDownloadSegment(selectedSolvent?.name || "solvent");
        downloadStockExport(blob, `${baseName}-requisition-${exportDate}.doc`);
      }
      toast.success("Export stock สำเร็จ");
      setExportOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:space-y-0 space-y-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-5 h-5" /> ประวัติการใช้ / รับเข้า
            <Badge variant="outline">{data.length}</Badge>
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={handleOpenExport}>
              <Download className="h-4 w-4" /> Export stock
            </Button>
            <Select value={type || "all"} onValueChange={v => setType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue placeholder="ทุกหมวด" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกหมวด</SelectItem>
                <SelectItem value="standard">Standards</SelectItem>
                <SelectItem value="solvent">สารเคมี</SelectItem>
                <SelectItem value="glassware">เครื่องแก้ว</SelectItem>
              </SelectContent>
            </Select>
            <Select value={action || "all"} onValueChange={v => setAction(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue placeholder="ทุก action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุก action</SelectItem>
                <SelectItem value="deduct">ตัด stock</SelectItem>
                <SelectItem value="receive">รับเข้า</SelectItem>
                <SelectItem value="create">สร้างใหม่</SelectItem>
                <SelectItem value="update">แก้ไข</SelectItem>
                <SelectItem value="delete">ลบ</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="text-right">Δ qty</TableHead>
                <TableHead>คงเหลือ</TableHead>
                <TableHead>โดย</TableHead>
                <TableHead>หมายเหตุ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6">กำลังโหลด...</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">ไม่มีประวัติ</TableCell></TableRow>
              ) : data.map(t => (
                <TableRow key={t._id}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDateTime(t.createdAt)}</TableCell>
                  <TableCell><Badge variant="outline">{t.itemType}</Badge></TableCell>
                  <TableCell>
                    <div className="font-medium">{t.itemName || t.itemId}</div>
                    {t.itemCode && <div className="text-xs text-muted-foreground">{t.itemCode}</div>}
                    {t.tier && <Badge className="text-xs mt-1" variant="outline">{t.tier}</Badge>}
                  </TableCell>
                  <TableCell><ActionBadge action={t.action} /></TableCell>
                  <TableCell className={`text-right font-mono ${t.delta != null && t.delta < 0 ? "text-destructive" : t.delta != null && t.delta > 0 ? "text-emerald-600" : ""}`}>
                    {t.delta != null ? `${t.delta > 0 ? "+" : ""}${formatStockQuantity(t.delta)}` : "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatStockQuantity(t.beforeQty)} → <strong>{formatStockQuantity(t.afterQty)}</strong> {t.unit || ""}
                  </TableCell>
                  <TableCell className="text-xs">{t.userName || t.userEmail || "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.note || ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Export stock</DialogTitle>
            <DialogDescription>
              เลือกชนิดเอกสารและรายการที่ต้องการ export จากประวัติ stock
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>ประเภท export</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={exportKind === "standard" ? "default" : "outline"}
                  onClick={() => setExportKind("standard")}
                >
                  Standard
                </Button>
                <Button
                  type="button"
                  variant={exportKind === "solvent" ? "default" : "outline"}
                  onClick={() => setExportKind("solvent")}
                >
                  สารเคมี
                </Button>
              </div>
            </div>

            {exportKind === "standard" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="stock-export-standard">เลือก standard</Label>
                  <select
                    id="stock-export-standard"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={exportStandardId}
                    onChange={(event) => setExportStandardId(event.target.value)}
                  >
                    <option value="">เลือก standard</option>
                    {standards.map((item) => (
                      <option key={item._id} value={item._id}>{item.code ? `${item.code} ${item.name}` : item.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>รูปแบบไฟล์</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={exportStandardFormat === "xlsx" ? "default" : "outline"}
                      onClick={() => setExportStandardFormat("xlsx")}
                    >
                      Excel
                    </Button>
                    <Button
                      type="button"
                      variant={exportStandardFormat === "pdf" ? "default" : "outline"}
                      onClick={() => setExportStandardFormat("pdf")}
                    >
                      PDF
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>ช่วงวันที่</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label="เลือกช่วงวันที่ export"
                        className="h-11 w-full justify-start gap-2 rounded-xl border-primary/40 bg-background text-left font-semibold shadow-sm hover:bg-accent"
                      >
                        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                        <span>{formatExportDateRangeLabel(exportStandardStartDate, exportStandardEndDate)}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto rounded-2xl p-0" align="start">
                      <Calendar
                        mode="range"
                        selected={selectedStandardDateRange}
                        onSelect={handleStandardDateRangeSelect}
                        defaultMonth={selectedStandardDateRange?.from ?? new Date()}
                        numberOfMonths={1}
                        initialFocus
                        className="rounded-2xl border bg-background p-3 shadow-lg"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <p className="text-xs text-muted-foreground">
                  ระบบจะ export เฉพาะประวัติในช่วงวันที่ที่เลือก โดย Excel จะแยก Lot No. เป็นคนละ sheet และ PDF จะแยกเป็นคนละหน้า
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stock-export-solvent">เลือกสารเคมี</Label>
                  <select
                    id="stock-export-solvent"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={exportSolventId}
                    onChange={(event) => setExportSolventId(event.target.value)}
                  >
                    <option value="">เลือกสารเคมี</option>
                    {solvents.map((item) => (
                      <option key={item._id} value={item._id}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stock-export-date">วันที่</Label>
                  <Input
                    id="stock-export-date"
                    type="date"
                    value={exportDate}
                    onChange={(event) => setExportDate(event.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setExportOpen(false)} disabled={exporting}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleExport} disabled={exporting}>
              {exporting ? "กำลัง Export..." : "Export"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    create: "bg-blue-100 text-blue-700",
    update: "bg-slate-100 text-slate-700",
    delete: "bg-destructive/10 text-destructive",
    deduct: "bg-amber-100 text-amber-700",
    receive: "bg-emerald-100 text-emerald-700",
  };
  return <Badge className={`text-xs ${map[action] || ""}`}>{action}</Badge>;
}

// ============================================================
// Reusable dialogs
// ============================================================
function DeleteConfirmDialog({
  open, title, itemName, busy, onCancel, onConfirm,
}: {
  open: boolean;
  title: string;
  itemName?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) onCancel(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {itemName ? `รายการ "${itemName}" จะถูกลบออกจากหน้ารายการ และบันทึกประวัติไว้ใน MongoDB` : "ยืนยันการลบรายการนี้"}
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

interface SimpleField {
  key: string;
  label: string;
  type: "text" | "number";
  required?: boolean;
}
function SimpleItemDialog<T extends { _id?: string }>({
  title, item, fields, onClose, onSubmit,
}: {
  title: string;
  item: T | null;
  fields: SimpleField[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) init[f.key] = (item as Record<string, unknown> | null)?.[f.key] ?? (f.type === "number" ? 0 : "");
    return init;
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      for (const f of fields) if (f.type === "number") payload[f.key] = Number(payload[f.key]) || 0;
      await onSubmit(payload);
      toast.success(item ? "แก้ไขสำเร็จ" : "เพิ่มรายการสำเร็จ");
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{item ? `แก้ไข${title}` : `เพิ่ม${title}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {fields.map(f => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={f.key}>{f.label}{f.required && <span className="text-destructive ml-1">*</span>}</Label>
                <Input
                  id={f.key} type={f.type} required={f.required}
                  value={String(form[f.key] ?? "")}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SimpleMoveReceiveMeta = { lotNo: string; exp: string; sizeLiter?: number; price?: number };

function SimpleMoveDialog({
  title, mode, itemName, currentQty, unit, requireLotExp = false, requireSolventReceiveDetails = false,
  initialSizeLiter = 0, initialPrice = 0, onClose, onSubmit,
}: {
  title: string;
  mode: "deduct" | "receive";
  itemName: string;
  currentQty: number;
  unit: string;
  requireLotExp?: boolean;
  requireSolventReceiveDetails?: boolean;
  initialSizeLiter?: number;
  initialPrice?: number;
  onClose: () => void;
  onSubmit: (qty: number, note?: string, receiveMeta?: SimpleMoveReceiveMeta) => Promise<void>;
}) {
  const [qty, setQty] = useState<string>("1");
  const [lotNo, setLotNo] = useState("");
  const [exp, setExp] = useState("");
  const [sizeLiter, setSizeLiter] = useState(initialSizeLiter > 0 ? String(initialSizeLiter) : "");
  const [price, setPrice] = useState(initialPrice > 0 ? String(initialPrice) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!n || n <= 0) { toast.error("กรุณาระบุจำนวน"); return; }
    if (mode === "deduct" && n > currentQty) { toast.error("จำนวนไม่พอ"); return; }
    if (mode === "receive" && requireLotExp) {
      if (!lotNo.trim()) { toast.error("กรุณาระบุ Lot No"); return; }
      if (!exp) { toast.error("กรุณาระบุ EXP"); return; }
    }
    if (mode === "receive" && requireSolventReceiveDetails) {
      if (!sizeLiter.trim()) { toast.error("กรุณาระบุขนาด/ขวด"); return; }
      if (!(Number(sizeLiter) > 0)) { toast.error("ขนาด/ขวดไม่ถูกต้อง"); return; }
      if (!price.trim()) { toast.error("กรุณาระบุราคา"); return; }
      const priceValue = Number(price);
      if (!Number.isFinite(priceValue) || priceValue < 0) { toast.error("ราคาไม่ถูกต้อง"); return; }
    }
    const receiveMeta: SimpleMoveReceiveMeta | undefined = requireLotExp
      ? {
        lotNo: lotNo.trim(),
        exp,
        ...(requireSolventReceiveDetails ? { sizeLiter: Number(sizeLiter), price: Number(price) } : {}),
      }
      : undefined;
    setBusy(true);
    try {
      await onSubmit(n, note || undefined, receiveMeta);
      toast.success(mode === "deduct" ? "ตัด stock สำเร็จ" : "รับเข้าสำเร็จ");
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{itemName} — คงเหลือ {currentQty} {unit}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div>
              <Label>จำนวน ({unit})</Label>
              <Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} required />
            </div>
            {mode === "receive" && requireLotExp && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Lot No</Label>
                  <Input value={lotNo} onChange={e => setLotNo(e.target.value)} placeholder="required" required />
                </div>
                <div>
                  <Label>EXP</Label>
                  <Input type="date" value={exp} onChange={e => setExp(e.target.value)} required />
                </div>
              </div>
            )}
            {mode === "receive" && requireSolventReceiveDetails && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="move-solvent-size">ขนาด/ขวด (ลิตร)</Label>
                  <Input id="move-solvent-size" type="number" min="0.001" step="any" value={sizeLiter} onChange={e => setSizeLiter(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="move-solvent-price">ราคา (บาท)</Label>
                  <Input id="move-solvent-price" type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)} required />
                </div>
              </div>
            )}
            <div>
              <Label>หมายเหตุ</Label>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={busy}>{busy ? "กำลังบันทึก..." : "ยืนยัน"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// "ความถี่/1 ครั้ง" picker — 6 presets + กำหนดเอง (count + day/week/month).
// Emits the canonical "1/N unit" string upstream; empty stays empty. Local state is
// seeded once from the incoming value (the dialog remounts per open, so this is safe).
function FrequencyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const initial = parseFrequency(value);
  const initialIsPreset = isPreset(value);
  const [mode, setMode] = useState<string>(
    initialIsPreset ? formatFrequency(initial!.count, initial!.unit) : initial ? "custom" : "",
  );
  const [count, setCount] = useState<number>(initial && !initialIsPreset ? initial.count : 1);
  const [unit, setUnit] = useState<FrequencyUnit>(initial && !initialIsPreset ? initial.unit : "day");

  const emit = (m: string, c: number, u: FrequencyUnit) => {
    if (m === "custom") onChange(formatFrequency(Math.max(1, Math.floor(c) || 1), u));
    else onChange(m); // preset string ("" never reachable from the UI)
  };

  return (
    <div className="space-y-2">
      <Select value={mode || undefined} onValueChange={v => { setMode(v); emit(v, count, unit); }}>
        <SelectTrigger><SelectValue placeholder="เลือกความถี่" /></SelectTrigger>
        <SelectContent>
          {FREQUENCY_PRESETS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          <SelectItem value="custom">กำหนดเอง</SelectItem>
        </SelectContent>
      </Select>
      {mode === "custom" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">1 /</span>
          <Input
            type="number" min={1} className="w-20" aria-label="จำนวน"
            value={String(count)}
            onChange={e => { const n = Number(e.target.value); setCount(n); emit("custom", n, unit); }}
          />
          <Select value={unit} onValueChange={v => { setUnit(v as FrequencyUnit); emit("custom", count, v as FrequencyUnit); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FREQUENCY_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function StandardDialog({
  item, onClose, onSaved,
}: {
  item: StockStandardItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [form, setForm] = useState<StockStandardItem>(() => item ?? {
    _id: "",
    code: "",
    name: "",
    primary: { qty: 0, ordered: 0, sizeMg: null, exp: "", usesPerBottle: null, pricePerUnit: 0, totalPrice: 0 },
    supplier: { qty: 0, sizeMg: null, exp: "" },
    working: { qty: 0, sizeMg: null, exp: "" },
    usagePerUseMg: null,
    frequency: "",
    storageTemp: "",
    status: "",
    expiryStatus: "",
  });
  const [busy, setBusy] = useState(false);
  const [pendingLabels, setPendingLabels] = useState<string[]>([]);
  const [labelPreviewOpen, setLabelPreviewOpen] = useState(false);
  const [autoPrintLabels, setAutoPrintLabels] = useState(false);
  const [labelPrintJobId, setLabelPrintJobId] = useState(0);
  const [closeAfterLabels, setCloseAfterLabels] = useState(false);

  const setField = (path: string, value: unknown) => {
    setForm(prev => {
      const copy: StockStandardItem = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let target: Record<string, unknown> = copy as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]] as Record<string, unknown>;
      target[keys[keys.length - 1]] = value;
      return copy;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form };
      const shouldReprintStockLabels = Boolean(
        isEdit && item && (
          String(payload.code || "").trim() !== String(item.code || "").trim()
          || String(payload.name || "").trim() !== String(item.name || "").trim()
        ),
      );
      // strip _id from payload (it's url param for updates)
      const { _id: _stripId, createdAt: _stripCa, updatedAt: _stripUa, ...body } = payload;
      void _stripId; void _stripCa; void _stripUa;
      // numeric coercion
      body.primary.qty = Number(body.primary.qty) || 0;
      body.primary.ordered = Number(body.primary.ordered) || 0;
      body.primary.pricePerUnit = Number(body.primary.pricePerUnit) || 0;
      body.supplier.qty = Number(body.supplier.qty) || 0;
      body.working.qty = Number(body.working.qty) || 0;
      const saved = isEdit ? await api.updateStandard(item!._id, body) : await api.createStandard(body);
      toast.success(isEdit ? "แก้ไขสำเร็จ" : "เพิ่มรายการสำเร็จ");
      onSaved();
      if (shouldReprintStockLabels) {
        const units = visibleBottles(await api.getStockUnits({ itemCode: saved.code }));
        const labels = await Promise.all(units.map((unit) => buildStockLabelHtml(unit)));
        if (labels.length > 0) {
          setPendingLabels(labels);
          setAutoPrintLabels(true);
          setLabelPrintJobId((id) => id + 1);
          setCloseAfterLabels(true);
          setLabelPreviewOpen(true);
          toast.success(`กำลังปริ้นฉลาก stock ${labels.length} ใบ`);
          return;
        }
      }
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? `แก้ไข Standard: ${item?.name}` : "เพิ่ม Standard ใหม่"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Code <span className="text-destructive">*</span></Label>
                <Input required value={form.code} onChange={e => setField("code", e.target.value)} />
              </div>
              <div>
                <Label>ชื่อ <span className="text-destructive">*</span></Label>
                <Input required value={form.name} onChange={e => setField("name", e.target.value)} />
              </div>
            </div>

            {isEdit && item && (
              <div className="border rounded-md p-3 bg-muted/30">
                <div className="font-semibold mb-2">รายขวด (per-bottle)</div>
                <StandardUnitsPanel standard={item} />
              </div>
            )}

            <details className="border rounded-md p-3">
              <summary className="font-semibold cursor-pointer text-muted-foreground">ข้อมูล stock เดิม (tier) — เพื่ออ้างอิง</summary>
              <div className="mt-3 space-y-4">
            {(["primary", "supplier", "working"] as const).map(tier => (
              <div key={tier} className="border rounded-md p-3">
                <div className="font-semibold mb-2 capitalize">{tier} stock</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <Label>จำนวน (ขวด)</Label>
                    <Input type="number" value={String(form[tier]?.qty ?? 0)} onChange={e => setField(`${tier}.qty`, e.target.value)} />
                  </div>
                  <div>
                    <Label>ขนาด (mg)</Label>
                    <Input value={String(form[tier]?.sizeMg ?? "")} onChange={e => setField(`${tier}.sizeMg`, e.target.value)} placeholder="เช่น 100 หรือ -" />
                  </div>
                  <div>
                    <Label>EXP</Label>
                    <Input value={String(form[tier]?.exp ?? "")} onChange={e => setField(`${tier}.exp`, e.target.value)} placeholder="dd/mm/yyyy" />
                  </div>
                </div>
                {tier === "primary" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                    <div>
                      <Label>สั่งแล้ว (ขวด)</Label>
                      <Input type="number" value={String(form.primary?.ordered ?? 0)} onChange={e => setField("primary.ordered", e.target.value)} />
                    </div>
                    <div>
                      <Label>ครั้งที่ใช้/ขวด</Label>
                      <Input value={String(form.primary?.usesPerBottle ?? "")} onChange={e => setField("primary.usesPerBottle", e.target.value)} />
                    </div>
                    <div>
                      <Label>ราคา/หน่วย (บาท)</Label>
                      <Input type="number" value={String(form.primary?.pricePerUnit ?? 0)} onChange={e => setField("primary.pricePerUnit", e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            ))}
              </div>
            </details>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>อัตราการใช้/ครั้ง (mg)</Label>
                <Input value={String(form.usagePerUseMg ?? "")} onChange={e => setField("usagePerUseMg", e.target.value)} />
              </div>
              <div>
                <Label>ความถี่/1 ครั้ง</Label>
                <FrequencyField value={form.frequency} onChange={v => setField("frequency", v)} />
              </div>
              <div>
                <Label>อุณหภูมิที่เก็บ (°C)</Label>
                <Input value={form.storageTemp} onChange={e => setField("storageTemp", e.target.value)} placeholder="เช่น 20 ± 4" />
              </div>
              <div>
                <Label>หมายเหตุ</Label>
                <Input value={form.status} onChange={e => setField("status", e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
            if (closeAfterLabels) onClose();
          }
        }}
        onPrinted={() => {
          setPendingLabels([]);
          setAutoPrintLabels(false);
          if (closeAfterLabels) onClose();
        }}
      />
    </Dialog>
  );
}

// ============================================================
// Page
// ============================================================
const StockPage = () => {
  const [scanOpen, setScanOpen] = useState(false);
  const [scannedQr, setScannedQr] = useState<string | null>(null);
  const [scannedUnit, setScannedUnit] = useState<StockUnitItem | null>(null);
  const [action, setAction] = useState<"discard" | null>(null);
  const qc = useQueryClient();
  const { tabs, defaultKey } = useAccessibleTabs("/stock");
  const stockDefaultKey = tabs.some((tab) => tab.key === defaultKey) ? defaultKey : tabs[0]?.key;

  const onScanned = async (qrId: string) => {
    setScanOpen(false);
    setScannedQr(qrId);
    try {
      const u = await api.getStockUnit(qrId);
      setScannedUnit(u);
    } catch (err) {
      toast.error((err as Error).message);
      setScannedQr(null);
    }
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["stock", "units"] });
    qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
  };
  const closeScanned = () => { setScannedQr(null); setScannedUnit(null); setAction(null); };

  return (
    <AppLayout>
      <PageHeader
        className="mb-6"
        title={<span className="inline-flex items-center gap-2"><Package className="w-6 h-6" /> Stock Management</span>}
        description="จัดการ inventory: Standards, สารเคมี, เครื่องแก้ว — บันทึกข้อมูลใน MongoDB"
      />
      <Tabs key={stockDefaultKey} defaultValue={stockDefaultKey}>
        <TabsList className="mb-4 flex-wrap h-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              {t.icon && <t.icon className="h-4 w-4" />}
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="standard"><StandardsTab /></TabsContent>
        <TabsContent value="solvent"><SolventsTab /></TabsContent>
        <TabsContent value="glassware"><GlasswareTab /></TabsContent>
        <TabsContent value="history"><HistoryTab /></TabsContent>
      </Tabs>

      <StockQrScanner open={scanOpen} onClose={() => setScanOpen(false)} onScanned={onScanned} />

      {scannedQr && scannedUnit && !action && (
        <Dialog open onOpenChange={(o) => { if (!o) closeScanned(); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{scannedUnit.itemName}</DialogTitle>
              <DialogDescription>
                {scannedUnit.itemCode} · {scannedUnit.type || "primary"} · เหลือ {formatStockQuantityWithUnit(scannedUnit.volume?.remaining, scannedUnit.volume?.unit)}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              {scannedUnit.status === "discarded" ? (
                <p className="text-destructive font-medium text-center">ขวดนี้ถูกทิ้งแล้ว ใช้งานต่อไม่ได้</p>
              ) : (
                <Button variant="destructive" onClick={() => setAction("discard")}>ทิ้งขวด</Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {scannedQr && action === "discard" && (
        <DiscardDialog qrId={scannedQr} onClose={closeScanned} onSaved={refresh} />
      )}
    </AppLayout>
  );
};

export default StockPage;
