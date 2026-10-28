import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { api, type LabelToleranceRule, type ParameterValueField } from "@/lib/api";
import { getItemNo, getPackSize, getRawCommonName, getSampleName, getTradeName, itemNoKeys } from "@/lib/masterItemFields";
import { productTypeLabels } from "@/lib/productClassification";
import { formatLabelToleranceNumber } from "@/lib/standardOperators";
import { parseLabelPercent } from "@/lib/substances";
import { rankSearchResults } from "@/lib/searchRanking";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { normalizeRoles } from "@/lib/roles";
import { cn } from "@/lib/utils";

const PRODUCT_TYPE_OPTIONS = [
  { value: "water", label: productTypeLabels.water },
  { value: "sand", label: productTypeLabels.sand },
  { value: "powder", label: productTypeLabels.powder },
] as const;

type BandModeOption = "none" | "percent" | "abs" | "range";
type MasterItemRow = Record<string, unknown>;

function emptyRule(): LabelToleranceRule {
  return {
    mode: "percent",
    autoMode: "percent",
    headMode: "percent",
    substance: "",
    labelPercent: null,
    productTypes: [],
    autoPct: null,
    headPct: null,
  };
}

function standardKey(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function masterRuleIdentity(rule: Pick<LabelToleranceRule, "substance" | "itemNo" | "packSize">): string {
  return [rule.substance, rule.itemNo ?? "", rule.packSize ?? ""].map(standardKey).join("|");
}

function buildMasterItemContext(row: MasterItemRow) {
  const commonName = getRawCommonName(row);
  const itemNo = getItemNo(row);
  const packSize = getPackSize(row);
  const itemName = getSampleName(row) || getTradeName(row);
  return { commonName, itemNo, packSize, itemName };
}

function normalizeRuleModes(rule: LabelToleranceRule) {
  if ((rule.mode ?? "percent") === "range") {
    return { layoutMode: "range" as const, autoMode: "range" as const, headMode: "range" as const, legacy: false };
  }
  if (rule.autoMode || rule.headMode) {
    return {
      layoutMode: "split" as const,
      autoMode: (rule.autoMode ?? (rule.passLow != null || rule.passHigh != null ? "range" : "abs")) as BandModeOption,
      headMode: (rule.headMode ?? (rule.failLow != null || rule.failHigh != null ? "range" : rule.headAbs != null || rule.headPct != null ? "abs" : "percent")) as BandModeOption,
      legacy: false,
    };
  }
  const mode = rule.mode ?? "percent";
  return {
    layoutMode: "split" as const,
    autoMode: (mode === "abs" ? "abs" : "percent") as BandModeOption,
    headMode: (mode === "abs" ? "abs" : "percent") as BandModeOption,
    legacy: true,
  };
}

function toggleValue(list: string[] | undefined, value: string): string[] {
  const set = new Set((list ?? []).filter(Boolean));
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

function hasSelector(rule: LabelToleranceRule): boolean {
  return Boolean(String(rule.substance ?? "").trim())
    || rule.labelPercent != null
    || (rule.productTypes?.length ?? 0) > 0;
}

function validRange(low: number | null | undefined, high: number | null | undefined): boolean {
  return low != null && high != null && low <= high;
}

function isRuleInvalid(rule: LabelToleranceRule): boolean {
  if (!hasSelector(rule)) return true;
  if (rule.labelPercent != null && rule.labelPercent <= 0) return true;
  const normalized = normalizeRuleModes(rule);
  const headConfigured = normalized.headMode === "none"
    ? false
    : normalized.headMode === "percent"
      ? rule.headPct != null && rule.headPct > 0
      : normalized.headMode === "abs"
        ? rule.headAbs != null && rule.headAbs > 0
        : validRange(rule.failLow, rule.failHigh);
  const comparableHeadAbs = normalized.headMode === "abs"
    ? (rule.headAbs == null || rule.headAbs <= 0 ? null : rule.headAbs)
    : null;

  if (normalized.autoMode === "none" && normalized.headMode === "none") return true;
  if (normalized.headMode === "range" && !headConfigured) return true;

  if (normalized.autoMode === "none") {
    return !headConfigured;
  } else if (normalized.autoMode === "percent") {
    if (rule.autoPct == null || rule.autoPct <= 0) return true;
    if (!normalized.legacy && !headConfigured) return true;
    if (headConfigured && rule.autoPct > 100) return true;
  } else if (normalized.autoMode === "abs") {
    if (rule.autoAbs == null || rule.autoAbs <= 0) return true;
    if (comparableHeadAbs != null && rule.autoAbs > comparableHeadAbs) return true;
  } else {
    if (!validRange(rule.passLow, rule.passHigh)) return true;
    if (
      normalized.headMode === "range"
      && validRange(rule.failLow, rule.failHigh)
      && (rule.passLow! < rule.failLow! || rule.passHigh! > rule.failHigh!)
    ) return true;
  }
  return false;
}

function previewLine(rule: LabelToleranceRule): string {
  const selectors = [
    rule.substance?.trim() || "",
    rule.labelPercent != null ? `${rule.labelPercent}%` : "",
    (rule.productTypes ?? []).map((pt) => productTypeLabels[pt] ?? pt).join("/"),
  ].filter(Boolean).join(" ");

  const normalized = normalizeRuleModes(rule);
  const center = rule.labelPercent ?? 1;
  const rangeText = (low: number, high: number) =>
    `${formatLabelToleranceNumber(low, center)}-${formatLabelToleranceNumber(high, center)}`;
  const insetRangeFromHead = (
    headRange: readonly [number, number] | null,
    pct: number | null | undefined,
  ): readonly [number, number] | null => {
    if (pct == null || pct <= 0 || headRange == null) return null;
    if (center < headRange[0] || center > headRange[1]) return null;
    const low = headRange[0] + ((center - headRange[0]) * pct / 100);
    const high = headRange[1] - ((headRange[1] - center) * pct / 100);
    return low <= high ? [low, high] as const : null;
  };
  if (normalized.layoutMode === "range") {
    if ([rule.failLow, rule.passLow, rule.passHigh, rule.failHigh].some((v) => v == null)) return "";
    return `${selectors || "กฎ"} -> fail < ${rule.failLow} | review ${rule.failLow}-${rule.passLow} และ ${rule.passHigh}-${rule.failHigh} | pass ${rule.passLow}-${rule.passHigh}`;
  }

  if (normalized.autoMode === "range" || normalized.headMode === "range") {
    const headAbs = normalized.headMode === "percent"
      ? (rule.headPct == null || rule.headPct <= 0 ? null : center * (rule.headPct / 100))
      : normalized.headMode === "abs"
        ? (rule.headAbs == null || rule.headAbs <= 0 ? null : rule.headAbs)
        : null;
    const headRange = normalized.headMode === "range" && validRange(rule.failLow, rule.failHigh)
      ? [rule.failLow!, rule.failHigh!] as const
      : headAbs != null
        ? [center - headAbs, center + headAbs] as const
        : null;
    const autoAbs = normalized.autoMode === "percent"
      ? normalized.legacy
        ? (rule.autoPct == null || rule.autoPct <= 0 ? null : center * (rule.autoPct / 100))
        : null
      : normalized.autoMode === "abs"
        ? (rule.autoAbs == null || rule.autoAbs <= 0 ? null : rule.autoAbs)
        : null;
    const autoRange = normalized.autoMode === "range" && validRange(rule.passLow, rule.passHigh)
      ? [rule.passLow!, rule.passHigh!] as const
      : normalized.autoMode === "percent" && !normalized.legacy
        ? insetRangeFromHead(headRange, rule.autoPct)
      : autoAbs != null
        ? [center - autoAbs, center + autoAbs] as const
        : null;
    if (autoRange == null && headRange == null) return "";
    const auto = autoRange != null ? `ผ่าน ${rangeText(autoRange[0], autoRange[1])}` : "";
    const head = headRange != null ? `เกณฑ์กรม ${rangeText(headRange[0], headRange[1])}` : "";
    return `${selectors || "กฎ"} -> ${[auto, head].filter(Boolean).join(" | ")}`;
  }

  const headAbs = normalized.headMode === "percent"
    ? (rule.headPct == null || rule.headPct <= 0 ? null : center * (rule.headPct / 100))
    : (rule.headAbs == null || rule.headAbs <= 0 ? null : rule.headAbs);
  const headRange = headAbs != null ? [center - headAbs, center + headAbs] as const : null;
  const autoAbs = normalized.autoMode === "percent"
    ? normalized.legacy
      ? (rule.autoPct == null || rule.autoPct <= 0 ? null : center * (rule.autoPct / 100))
      : null
    : (rule.autoAbs == null || rule.autoAbs <= 0 ? null : rule.autoAbs);
  const autoRange = normalized.autoMode === "percent" && !normalized.legacy
    ? insetRangeFromHead(headRange, rule.autoPct)
    : autoAbs != null
      ? [center - autoAbs, center + autoAbs] as const
      : null;
  if (autoRange == null && headRange == null) return "";

  const auto = autoRange != null ? `ผ่าน ${rangeText(autoRange[0], autoRange[1])}` : "";
  const head = headRange != null ? `เกณฑ์กรม ${rangeText(headRange[0], headRange[1])}` : "";
  return `${selectors || "กฎ"} -> ${[auto, head].filter(Boolean).join(" | ")}`;
}

function patchAutoMode(
  patchAt: (index: number, patch: Partial<LabelToleranceRule>) => void,
  index: number,
  next: BandModeOption,
) {
  patchAt(index, {
    mode: next === "abs" ? "abs" : "percent",
    autoMode: next,
    ...(next === "none" ? { autoPct: null, autoAbs: null, passLow: null, passHigh: null } : {}),
  });
}

function patchHeadMode(
  patchAt: (index: number, patch: Partial<LabelToleranceRule>) => void,
  index: number,
  next: BandModeOption,
) {
  patchAt(index, {
    mode: next === "abs" ? "abs" : "percent",
    headMode: next,
    ...(next === "none" ? { headPct: null, headAbs: null, failLow: null, failHigh: null } : {}),
  });
}

type Props = {
  open: boolean;
  field: ParameterValueField;
  onClose: () => void;
  onSave: (next: LabelToleranceRule[]) => void;
  focusRuleIndex?: number | null;
};

export function LabelToleranceDialog({ open, field, onClose, onSave, focusRuleIndex = null }: Props) {
  const [list, setList] = useState<LabelToleranceRule[]>(field.labelToleranceStandards ?? []);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [focusSet, setFocusSet] = useState<Set<number> | null>(null);
  const ruleRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pendingScrollIndex = useRef<number | null>(null);
  const { user } = useAuth();

  const canEditHeadFields = useMemo(() => {
    const roles = normalizeRoles(user);
    return roles.includes("admin") || roles.includes("qc-head");
  }, [user]);

  useEffect(() => {
    if (open) {
      const initialList = field.labelToleranceStandards ?? [];
      setList(initialList);
      const focused = focusRuleIndex != null && focusRuleIndex < initialList.length ? focusRuleIndex : null;
      setCollapsed(Object.fromEntries(initialList.map((_, index) => [index, index !== focused])));
      setFocusSet(focused != null ? new Set([focused]) : null);
      pendingScrollIndex.current = null;
    }
  }, [field.labelToleranceStandards, open, focusRuleIndex]);

  const hasInvalid = useMemo(() => list.some(isRuleInvalid), [list]);
  const { data: masterRows = [] } = useQuery<MasterItemRow[]>({
    queryKey: ["master-items"],
    queryFn: async () => {
      const res = await api.get<MasterItemRow[]>("/master-items");
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
    enabled: open,
  });
  const masterOptions = useMemo(() => {
    const seen = new Set<string>();
    return (Array.isArray(masterRows) ? masterRows : [])
      .filter((row) => buildMasterItemContext(row).commonName)
      .sort((a, b) => {
        const aCtx = buildMasterItemContext(a);
        const bCtx = buildMasterItemContext(b);
        return (
          aCtx.commonName.localeCompare(bCtx.commonName, ["th", "en"]) ||
          aCtx.itemNo.localeCompare(bCtx.itemNo, ["th", "en"], { numeric: true }) ||
          aCtx.packSize.localeCompare(bCtx.packSize, ["th", "en"], { numeric: true })
        );
      })
      .flatMap((row) => {
        const context = buildMasterItemContext(row);
        const key = masterRuleIdentity({
          substance: context.commonName,
          itemNo: context.itemNo,
          packSize: context.packSize,
        });
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ row, ...context, key }];
      });
  }, [masterRows]);

  useEffect(() => {
    if (pendingScrollIndex.current == null) return;
    const node = ruleRefs.current[pendingScrollIndex.current];
    pendingScrollIndex.current = null;
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [list.length]);

  const patchAt = (index: number, patch: Partial<LabelToleranceRule>) => {
    setList((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => setList((prev) => {
    pendingScrollIndex.current = 0;
    setFocusSet((current) => (current ? new Set([0, ...[...current].map((n) => n + 1)]) : current));
    setCollapsed((current) => {
      const next: Record<number, boolean> = { 0: false };
      for (const [key, value] of Object.entries(current)) {
        next[Number(key) + 1] = value;
      }
      return next;
    });
    return [emptyRule(), ...prev];
  });

  const applyMasterItemAt = (index: number, value: string) => {
    const picked = masterOptions.find((option) => standardKey(option.commonName) === standardKey(value));
    setList((prev) => prev.map((rule, i) => {
      if (i !== index) return rule;
      if (!picked) {
        return {
          ...rule,
          substance: value,
          itemNo: "",
          packSize: "",
          masterItemName: "",
          masterCommonName: "",
          masterRaw: undefined,
        };
      }
      return {
        ...rule,
        substance: picked.commonName,
        labelPercent: rule.labelPercent ?? parseLabelPercent(picked.commonName),
        itemNo: picked.itemNo,
        packSize: picked.packSize,
        masterItemName: picked.itemName,
        masterCommonName: picked.commonName,
        masterRaw: picked.row,
      };
    }));
  };

  const removeRule = (index: number) => {
    setList((prev) => prev.filter((_, i) => i !== index));
    setFocusSet((current) => (current
      ? new Set([...current].filter((n) => n !== index).map((n) => (n > index ? n - 1 : n)))
      : current));
    setCollapsed((prev) => {
      const next: Record<number, boolean> = {};
      for (const [key, value] of Object.entries(prev)) {
        const n = Number(key);
        if (n < index) next[n] = value;
        else if (n > index) next[n - 1] = value;
      }
      return next;
    });
  };

  const toggleCollapsed = (index: number) => {
    setCollapsed((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="z-[10000] max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>ตั้งเกณฑ์ตาม % และประเภทสินค้า - {field.label}</DialogTitle>
          <DialogDescription className="text-xs">
            ตั้ง rule ได้จาก %ฉลาก, ประเภทสินค้า, และสารแบบไม่บังคับ ระบบจะเลือกกฎที่ตรงที่สุดให้อัตโนมัติ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pr-1">
          {/*
          <div>
            <Label className="mb-2 block text-sm">เลือกสารจาก master item</Label>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={masterSearch}
                onChange={(event) => setMasterSearch(event.target.value)}
                placeholder="ค้นหาสาร / item code / pack"
                className="h-9 pl-8"
              />
            </div>
            <div className="max-h-44 overflow-y-auto rounded border bg-background">
              {visibleMasterRows.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">ไม่พบ master item</p>
              ) : (
                visibleMasterRows.slice(0, 80).map((row) => {
                  const { commonName, itemNo, packSize, itemName } = buildMasterItemContext(row);
                  const key = masterRuleIdentity({ substance: commonName, itemNo, packSize });
                  const picked = selectedMasterKeys.has(key);
                  const title = [commonName, itemNo, packSize, itemName].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={picked}
                      onClick={() => addRuleFromMasterItem(row)}
                      className="flex w-full items-start justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted disabled:opacity-40"
                      title={title}
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-medium text-foreground">{commonName}</span>
                        {[itemNo, packSize, itemName].filter(Boolean).length > 0 ? (
                          <span className="mt-1 block break-words text-xs text-muted-foreground">
                            {[itemNo, packSize, itemName].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      {!picked ? <Plus className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          */}
          <div className="flex items-center justify-between">
            <Label className="text-sm">{focusSet ? `กฎที่เลือก (${focusSet.size} จาก ${list.length})` : `กฎ (${list.length})`}</Label>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addRule}>
              <Plus className="h-4 w-4" />
              เพิ่มกฎ
            </Button>
          </div>

          {list.length === 0 ? (
            <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">ยังกำหนดเกณฑ์ไว้</p>
          ) : null}

          {list.map((rule, index) => {
            if (focusSet && !focusSet.has(index)) return null;
            const normalized = normalizeRuleModes(rule);
            const autoMode = normalized.autoMode as BandModeOption;
            const headMode = normalized.headMode as BandModeOption;

            return (
              <div
                key={index}
                ref={(node) => { ruleRefs.current[index] = node; }}
                className="space-y-3 rounded-lg border p-3"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(index)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={!collapsed[index]}
                  >
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${collapsed[index] ? "-rotate-90" : ""}`} />
                    <span className="text-sm font-medium">กฎที่ {index + 1}</span>
                  </button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRule(index)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>

                {collapsed[index] ? (
                  <p className="text-xs text-emerald-700">{previewLine(rule) || "ยังไม่ได้ตั้งค่าเกณฑ์"}</p>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-sm">สาร (ไม่บังคับ)</Label>
                        <Input
                          list={`label-tolerance-master-substances-${index}`}
                          value={rule.substance ?? ""}
                          onChange={(e) => patchAt(index, { substance: e.target.value })}
                          onBlur={(e) => applyMasterItemAt(index, e.target.value)}
                          placeholder="เช่น ABAMECTIN"
                        />
                        <datalist id={`label-tolerance-master-substances-${index}`}>
                          {rankSearchResults(masterOptions, rule.substance ?? "", (option) => ({
                            primary: [option.itemNo || option.commonName, ...itemNoKeys.map((key) => option.row[key])],
                            secondary: [option.commonName, option.packSize, option.itemName],
                          })).slice(0, 300).map((option) => (
                            <option
                              key={option.key}
                              value={option.commonName}
                              label={[option.itemNo, option.packSize, option.itemName].filter(Boolean).join(" ยท ")}
                            />
                          ))}
                        </datalist>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">% ฉลาก (ไม่บังคับ)</Label>
                        <Input
                          type="number"
                          value={rule.labelPercent ?? ""}
                          onChange={(e) => patchAt(index, { labelPercent: e.target.value === "" ? null : Number(e.target.value) })}
                          placeholder="เช่น 1 หรือ 0.3"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">ประเภทสินค้า (ไม่บังคับ)</Label>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {PRODUCT_TYPE_OPTIONS.map((opt) => {
                          const checked = (rule.productTypes ?? []).includes(opt.value);
                          const id = `label-tolerance-product-${index}-${opt.value}`;
                          return (
                            <div
                              key={opt.value}
                              className={cn(
                                "flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors",
                                checked && "border-primary/60 bg-primary/5 text-primary",
                              )}
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                onCheckedChange={() => patchAt(index, { productTypes: toggleValue(rule.productTypes, opt.value) as LabelToleranceRule["productTypes"] })}
                              />
                              <Label htmlFor={id} className="flex-1 cursor-pointer text-sm font-normal">
                                {opt.label}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {normalized.layoutMode === "range" ? (
                      <div className="space-y-1.5">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-sm">ค่าต่ำสุดรอตรวจสอบ</Label>
                            <Input type="number" value={rule.failLow ?? ""} onChange={(e) => patchAt(index, { failLow: e.target.value === "" ? null : Number(e.target.value) })} />
                          </div>
                          {canEditHeadFields && (
                            <div className="space-y-1.5">
                              <Label className="text-sm">ต่ำสุดที่ผ่าน</Label>
                              <Input type="number" value={rule.passLow ?? ""} onChange={(e) => patchAt(index, { passLow: e.target.value === "" ? null : Number(e.target.value) })} />
                            </div>
                          )}
                          <div className="space-y-1.5 order-3 md:order-3">
                            <Label className="text-sm">ค่าสูงสุดรอตรวจสอบ</Label>
                            <Input type="number" value={rule.failHigh ?? ""} onChange={(e) => patchAt(index, { failHigh: e.target.value === "" ? null : Number(e.target.value) })} />
                          </div>
                          {canEditHeadFields && (
                            <div className="space-y-1.5 order-4 md:order-4">
                              <Label className="text-sm">สูงสุดที่ผ่าน</Label>
                              <Input type="number" value={rule.passHigh ?? ""} onChange={(e) => patchAt(index, { passHigh: e.target.value === "" ? null : Number(e.target.value) })} />
                            </div>
                          )}
                        </div>
                        {!canEditHeadFields && (
                          <p className="text-xs text-muted-foreground">ช่วง "ที่ผ่าน" กำหนดโดย ADMIN / QC Head</p>
                        )}
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                          <Label className="text-sm">ช่วงผ่านอัตโนมัติ</Label>
                          <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
                            <Select
                              value={autoMode}
                              onValueChange={(value) => patchAutoMode(patchAt, index, value as BandModeOption)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="z-[10001]">
                                <SelectItem value="none">ไม่มี</SelectItem>
                                <SelectItem value="percent">% ของเกณฑ์กรม</SelectItem>
                                <SelectItem value="abs">± ค่าคงที่</SelectItem>
                                <SelectItem value="range">ค่าระหว่าง</SelectItem>
                              </SelectContent>
                            </Select>
                            {autoMode === "none" ? (
                              <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                                ไม่มีช่วงผ่านอัตโนมัติ
                              </p>
                            ) : autoMode === "range" ? (
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  type="number"
                                  value={rule.passLow ?? ""}
                                  onChange={(e) => patchAt(index, { passLow: e.target.value === "" ? null : Number(e.target.value) })}
                                  placeholder="ต่ำสุด"
                                />
                                <Input
                                  type="number"
                                  value={rule.passHigh ?? ""}
                                  onChange={(e) => patchAt(index, { passHigh: e.target.value === "" ? null : Number(e.target.value) })}
                                  placeholder="สูงสุด"
                                />
                              </div>
                            ) : (
                              <Input
                                type="number"
                                value={autoMode === "percent" ? (rule.autoPct ?? "") : (rule.autoAbs ?? "")}
                                onChange={(e) => patchAt(
                                  index,
                                  autoMode === "percent"
                                    ? { autoPct: e.target.value === "" ? null : Number(e.target.value) }
                                    : { autoAbs: e.target.value === "" ? null : Number(e.target.value) },
                                )}
                                placeholder={autoMode === "percent" ? "เช่น 80" : "เช่น 0.05"}
                              />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {autoMode === "none"
                              ? "ไม่มีช่วงผ่านอัตโนมัติ"
                              : autoMode === "range"
                                ? "กรอกช่วงต่ำสุด-สูงสุดที่ผ่านอัตโนมัติ"
                                : autoMode === "percent"
                                  ? 'ถ้าเลือก % จะคิดจากช่วง "เกณฑ์กรม"'
                                  : "กรอกเป็นค่า ± จริงตามหน่วยของช่อง"}
                          </p>
                        </div>

                        {canEditHeadFields && (
                          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                            <Label className="text-sm">เกณฑ์กรม</Label>
                            <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
                              <Select
                                value={headMode}
                                onValueChange={(value) => patchHeadMode(patchAt, index, value as BandModeOption)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="z-[10001]">
                                  <SelectItem value="none">ไม่มี</SelectItem>
                                  <SelectItem value="percent">% ฉลาก</SelectItem>
                                  <SelectItem value="abs">± ค่าคงที่</SelectItem>
                                  <SelectItem value="range">ค่าระหว่าง</SelectItem>
                                </SelectContent>
                              </Select>
                              {headMode === "none" ? (
                                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                                  ไม่มีช่วงเกณฑ์กรม
                                </p>
                              ) : headMode === "range" ? (
                                <div className="grid grid-cols-2 gap-2">
                                  <Input
                                    type="number"
                                    value={rule.failLow ?? ""}
                                    onChange={(e) => patchAt(index, { failLow: e.target.value === "" ? null : Number(e.target.value) })}
                                    placeholder="ต่ำสุด"
                                  />
                                  <Input
                                    type="number"
                                    value={rule.failHigh ?? ""}
                                    onChange={(e) => patchAt(index, { failHigh: e.target.value === "" ? null : Number(e.target.value) })}
                                    placeholder="สูงสุด"
                                  />
                                </div>
                              ) : null}
                              <Input
                                className={headMode === "none" ? "hidden" : headMode === "range" ? "hidden" : undefined}
                                type="number"
                                value={headMode === "percent" ? (rule.headPct ?? "") : headMode === "abs" ? (rule.headAbs ?? "") : ""}
                                onChange={(e) => patchAt(
                                  index,
                                  headMode === "percent"
                                    ? { headPct: e.target.value === "" ? null : Number(e.target.value) }
                                    : { headAbs: e.target.value === "" ? null : Number(e.target.value) },
                                )}
                                placeholder={headMode === "percent" ? "เช่น 15" : "เช่น 0.1"}
                              />
                            </div>
                          </div>
                        )}

                        <p className="text-xs text-muted-foreground md:col-span-2">
                          ค่ากลางมาจาก %ฉลากในชื่อสาร
                        </p>
                      </div>
                    )}

                    <p className="text-xs text-emerald-700">{previewLine(rule)}</p>
                    {isRuleInvalid(rule) ? (
                      <p className="text-xs text-red-600">ต้องกรอกตัวเลือกอย่างน้อย 1 อย่าง และกรอกค่าให้ครบตามรูปแบบที่เลือก</p>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button
            type="button"
            variant="primary"
            disabled={hasInvalid}
            onClick={() => {
              onSave(list.map((rule) => ({
                ...rule,
                substance: String(rule.substance ?? "").trim(),
                productTypes: (rule.productTypes ?? []).filter(Boolean),
              })));
              onClose();
            }}
          >
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
