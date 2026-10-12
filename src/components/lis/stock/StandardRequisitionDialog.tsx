import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/context/ConfirmDialog";
import { api } from "@/lib/api";
import { isUsableBottle } from "@/lib/stockStatus";
import { formatStockQuantityWithUnit } from "@/lib/stockQuantity";
import { formatDate } from "@/lib/dateTime";
import {
  defaultWeightCount,
  findStandardBottleBySearch,
  requisitionUser,
  standardMatchesRequisitionSearch,
  standardRequisitionSearchScore,
  standardRequisitionUnitLabelCode,
  sumWeights,
  validateWeights,
} from "@/lib/standardRequisition";
import { buildSubstanceGroups, resolveGroups, type InstrumentGroup } from "@/lib/standardInstrumentGroups";
import { cn } from "@/lib/utils";
import type { StockUnitItem } from "@/types/stock";

const TYPES = ["primary", "working", "supplier"] as const;
type BottleType = (typeof TYPES)[number];
type MasterItemRaw = Record<string, unknown>;
const GROUP_LABEL: Record<InstrumentGroup, string> = { gc: "GC", hplc: "HPLC" };

function stockUnitBottleType(unit: Pick<StockUnitItem, "type" | "kind" | "source"> | null | undefined): BottleType {
  const value = unit?.type || (unit?.kind === "working" ? "working" : unit?.source === "supply" ? "supplier" : "primary");
  return TYPES.includes(value as BottleType) ? (value as BottleType) : "primary";
}

interface Props {
  initialQrId?: string | null;
  initialUnit?: StockUnitItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function StandardRequisitionDialog({ initialQrId, initialUnit, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [pickOpen, setPickOpen] = useState(false);
  const [standardSearch, setStandardSearch] = useState("");
  const [bottleType, setBottleType] = useState<BottleType>("primary");
  const [qrId, setQrId] = useState(initialQrId ?? "");
  const [pickedGroup, setPickedGroup] = useState<InstrumentGroup | null>(null);
  const [customCount, setCustomCount] = useState(false);
  const [weights, setWeights] = useState<string[]>([""]);
  const [countText, setCountText] = useState("1"); // buffer ช่องจำนวนน้ำหนัก — ให้ว่างชั่วคราวได้ตอนแก้
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [countCustomized, setCountCustomized] = useState(false);
  const appliedInitialQrRef = useRef<string | null>(null);

  const { data: standards = [] } = useQuery({ queryKey: ["stock", "standards"], queryFn: api.getStandards });
  const { data: allUnits = [] } = useQuery({ queryKey: ["stock", "units"], queryFn: () => api.getStockUnits() });

  // สาร → กลุ่มเครื่อง (gc/hplc) จาก simple method (reuse pattern PetitionAssign)
  const { data: masterItems = [] } = useQuery<MasterItemRaw[]>({
    queryKey: ["master-items-for-standard-requisition"],
    queryFn: async () => {
      const res = await api.get<unknown>("/master-items");
      const payload = res.data.data;
      if (Array.isArray(payload)) return payload as MasterItemRaw[];
      if (payload && typeof payload === "object") {
        const arr = (payload as { data?: unknown }).data ?? (payload as { items?: unknown }).items;
        if (Array.isArray(arr)) return arr as MasterItemRaw[];
      }
      return [];
    },
    staleTime: 5 * 60_000,
  });
  const { data: simpleMethods = [] } = useQuery<Array<{ itemNo: string; methods?: string[][]; instruments?: string[] }>>({
    queryKey: ["simple-methods"],
    queryFn: async () => {
      const res = await api.get<Array<{ itemNo: string; methods?: string[][]; instruments?: string[] }>>("/simple-methods");
      return (res.data.data ?? []).map((e) => ({ itemNo: e.itemNo, methods: e.methods, instruments: e.instruments }));
    },
    staleTime: 5 * 60_000,
  });
  const { data: registryMethods = [] } = useQuery({ queryKey: ["methods"], queryFn: () => api.getMethods(), staleTime: 5 * 60_000 });
  const methodByCode = useMemo(() => new Map(registryMethods.map((m) => [m.code, m])), [registryMethods]);
  const substanceGroups = useMemo(
    () => buildSubstanceGroups(masterItems, simpleMethods, methodByCode),
    [masterItems, simpleMethods, methodByCode],
  );

  const unitsWithInitialSelection = useMemo(() => {
    if (!initialUnit?.qrId) return allUnits;
    return [initialUnit, ...allUnits.filter((unit) => unit.qrId !== initialUnit.qrId)];
  }, [allUnits, initialUnit]);

  // สารที่มีขวดใช้ได้จริง ≥ 1 (ทุก type)
  const usableByCode = useMemo(() => {
    const m = new Map<string, StockUnitItem[]>();
    for (const u of unitsWithInitialSelection) {
      if (!isUsableBottle(u)) continue;
      const list = m.get(u.itemCode);
      if (list) list.push(u);
      else m.set(u.itemCode, [u]);
    }
    return m;
  }, [unitsWithInitialSelection]);

  const inStock = useMemo(
    () => standards.filter((s) => (usableByCode.get(s.code)?.length ?? 0) > 0),
    [standards, usableByCode],
  );
  const visibleStandards = useMemo(
    () => inStock.filter((stockStandard) => standardMatchesRequisitionSearch(stockStandard, usableByCode.get(stockStandard.code) ?? [], standardSearch))
      .map((stockStandard) => ({ stockStandard, score: standardRequisitionSearchScore(stockStandard, usableByCode.get(stockStandard.code) ?? [], standardSearch) }))
      .sort((left, right) => right.score - left.score)
      .map(({ stockStandard }) => stockStandard),
    [inStock, standardSearch, usableByCode],
  );
  const standard = standards.find((s) => s.code === code) ?? null;

  const resolvedGroups = useMemo(
    () => (standard ? resolveGroups(standard.name, substanceGroups) : []),
    [standard, substanceGroups],
  );
  const needsGroupPick = resolvedGroups.length >= 2;
  const effectiveGroup: InstrumentGroup | null = resolvedGroups.length === 1 ? resolvedGroups[0] : pickedGroup;

  const bottlesOfType = useMemo(
    () => (usableByCode.get(code) ?? []).filter((u) => stockUnitBottleType(u) === bottleType)
      .sort((a, b) => (a.exp ? +new Date(a.exp) : Infinity) - (b.exp ? +new Date(b.exp) : Infinity)),
    [usableByCode, code, bottleType],
  );
  const typeCounts = useMemo(() => {
    const c: Record<BottleType, number> = { primary: 0, working: 0, supplier: 0 };
    for (const u of usableByCode.get(code) ?? []) c[stockUnitBottleType(u)] += 1;
    return c;
  }, [usableByCode, code]);

  const bottle = bottlesOfType.find((b) => b.qrId === qrId) ?? bottlesOfType[0] ?? null;
  const remainingMg = bottle?.volume?.remaining ?? 0;
  const nums = weights.map((w) => Number(w));
  const total = sumWeights(nums);
  const weightError = bottle ? validateWeights(nums, remainingMg) : "";

  const defaultCount = defaultWeightCount(effectiveGroup ?? undefined);
  const isCustom = customCount || (!!effectiveGroup && weights.length !== defaultCount);
  const submitGroup: InstrumentGroup | undefined = customCount
    ? (resolvedGroups.length === 1 ? resolvedGroups[0] : undefined)
    : (effectiveGroup ?? undefined);

  const canSave = !!(bottle && !weightError && user?.name && (!needsGroupPick || pickedGroup || customCount));

  useEffect(() => {
    const qrIdToApply = initialQrId?.trim();
    if (!qrIdToApply || appliedInitialQrRef.current === qrIdToApply) return;

    const selectedUnit = unitsWithInitialSelection.find((row) => row.qrId === qrIdToApply);
    if (!selectedUnit) return;

    appliedInitialQrRef.current = qrIdToApply;
    const selectedCode = selectedUnit.itemCode;
    setCode(selectedCode);
    setPickOpen(false);
    setQrId(selectedUnit.qrId);
    setBottleType(stockUnitBottleType(selectedUnit));
    setPickedGroup(null);
    setCustomCount(false);

    const selectedStandard = standards.find((row) => row.code === selectedCode) ?? null;
    const selectedGroups = selectedStandard ? resolveGroups(selectedStandard.name, substanceGroups) : [];
    const weightCount = selectedGroups.length === 1 ? defaultWeightCount(selectedGroups[0]) : 1;
    setWeights(Array.from({ length: weightCount }, () => ""));
    setCountCustomized(false);
  }, [initialQrId, standards, substanceGroups, unitsWithInitialSelection]);

  // ถ้า group index (master-items/simple-methods) โหลดเสร็จหลังเลือกสารแล้ว → resync
  // จำนวนน้ำหนัก default ให้ตรงกลุ่มที่ resolve ได้ (ไม่ทับถ้าผู้ใช้ปรับเอง). loop-safe: set เฉพาะเมื่อ length ต่าง.
  useEffect(() => {
    if (!code || countCustomized || customCount || resolvedGroups.length !== 1) return;
    const n = defaultWeightCount(resolvedGroups[0]);
    setWeights((prev) => (prev.length === n ? prev : Array.from({ length: n }, (_, i) => prev[i] ?? "")));
  }, [code, countCustomized, customCount, resolvedGroups]);

  // sync buffer ช่องจำนวนน้ำหนักให้ตรง weights.length เมื่อจำนวนถูกเปลี่ยนโดยระบบ (เลือกกลุ่ม/custom/resync)
  useEffect(() => { setCountText(String(weights.length)); }, [weights.length]);

  const handlePickOpenChange = (open: boolean) => {
    setPickOpen(open);
    if (!open) setStandardSearch("");
  };

  const pickStandard = (selectedCode: string, preferredQrId?: string | null) => {
    const availableUnits = usableByCode.get(selectedCode) ?? [];
    const searchedBottle = preferredQrId
      ? availableUnits.find((unit) => unit.qrId === preferredQrId) ?? null
      : findStandardBottleBySearch(availableUnits, standardSearch);

    setCode(selectedCode);
    setPickOpen(false);
    setStandardSearch("");
    setQrId(searchedBottle?.qrId ?? "");
    setPickedGroup(null);
    setCustomCount(false);
    const counts = { primary: 0, working: 0, supplier: 0 } as Record<BottleType, number>;
    for (const unit of availableUnits) counts[stockUnitBottleType(unit)] += 1;
    setBottleType(searchedBottle ? stockUnitBottleType(searchedBottle) : TYPES.find((type) => counts[type] > 0) ?? "primary");
    const selectedStandard = standards.find((stockStandard) => stockStandard.code === selectedCode) ?? null;
    const groups = selectedStandard ? resolveGroups(selectedStandard.name, substanceGroups) : [];
    const n = groups.length === 1 ? defaultWeightCount(groups[0]) : 1;
    setWeights(Array.from({ length: n }, () => ""));
    setCountCustomized(false);
  };
  const pickGroup = (g: InstrumentGroup) => {
    setPickedGroup(g);
    setCustomCount(false);
    setWeights(Array.from({ length: defaultWeightCount(g) }, () => ""));
    setCountCustomized(false);
  };
  // "Custom" = กำหนดจำนวนน้ำหนักเอง: รีเซ็ตเป็น 1 แล้วปรับต่อได้ (instrumentGroup ยึดที่ resolve ได้ ดู submitGroup)
  const selectCustom = () => {
    setCustomCount(true);
    setPickedGroup(null);
    setWeights([""]);
    setCountCustomized(true);
  };
  const setWeightAt = (i: number, v: string) => setWeights((prev) => { const x = [...prev]; x[i] = v; return x; });
  const setCount = (n: number) => {
    setCountCustomized(true);
    setWeights((prev) => {
      const x = prev.slice(0, Math.max(1, n));
      while (x.length < n) x.push("");
      return x;
    });
  };

  const submit = async () => {
    if (!bottle) return;
    setBusy(true);
    try {
      await api.deductStockUnitMg(bottle.qrId, {
        weights: nums,
        instrumentGroup: submitGroup,
        note: note || undefined,
        _user: requisitionUser(user),
      });
      toast.success(`เบิก ${standard?.name ?? "standard"} ${nums.length} น้ำหนัก (${total} mg)`);
      qc.invalidateQueries({ queryKey: ["stock", "pending-deductions"] });
      qc.invalidateQueries({ queryKey: ["stock", "units"] });
      qc.invalidateQueries({ queryKey: ["stock", "transactions"] });
      onSaved(); onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally { setBusy(false); }
  };

  // ปุ่มกลุ่มที่โชว์: resolve ได้ = โชว์กลุ่มนั้นๆ, resolve ไม่ได้ = ให้เลือก gc/hplc เอง
  const groupButtons: InstrumentGroup[] =
    resolvedGroups.length >= 1 ? resolvedGroups : (["gc", "hplc"] as InstrumentGroup[]);
  // ปุ่มที่กำลัง active (ไฮไลต์): custom ชนะ, ไม่งั้นตามกลุ่มที่ resolve/เลือก
  const activeSel: InstrumentGroup | "custom" | null = customCount ? "custom" : effectiveGroup;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>เบิก Standard</DialogTitle>
          <DialogDescription>เลือกสาร ประเภทขวด แล้วกรอก mg แต่ละน้ำหนัก (กลุ่มเครื่องมาจาก simple method)</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* สาร (เฉพาะที่มีขวด) */}
          <div>
            <Label className="mb-1.5 block">Standard (มีของในสต็อก)</Label>
            <Popover open={pickOpen} onOpenChange={handlePickOpenChange}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
                  <span className="truncate">{standard ? `${standard.name} (${standard.code})` : "เลือก standard..."}</span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(calc(100vw-2rem),32rem)] p-0 sm:w-96" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    type="search"
                    placeholder="ค้นหาชื่อ/code/เลขขวด"
                    value={standardSearch}
                    onValueChange={setStandardSearch}
                    inputMode="search"
                    enterKeyHint="search"
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <CommandList>
                    {visibleStandards.length === 0 && <CommandEmpty>ไม่พบ standard หรือเลขขวด</CommandEmpty>}
                    {visibleStandards.map((stockStandard) => {
                      const units = usableByCode.get(stockStandard.code) ?? [];
                      const matchedBottle = findStandardBottleBySearch(units, standardSearch);
                      const labelPreview = matchedBottle
                        ? standardRequisitionUnitLabelCode(matchedBottle) || matchedBottle.qrId
                        : units.map((unit) => standardRequisitionUnitLabelCode(unit)).filter(Boolean).slice(0, 2).join(", ");

                      return (
                        <CommandItem key={stockStandard.code} value={`${stockStandard.name} ${stockStandard.code}`} onSelect={() => pickStandard(stockStandard.code, matchedBottle?.qrId)}>
                          <Check className={cn("mr-2 h-4 w-4", code === stockStandard.code ? "opacity-100" : "opacity-0")} />
                          <span className="min-w-0 flex-1 truncate">{stockStandard.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {units.length} ขวด{labelPreview ? ` · เลขขวด ${labelPreview}` : ""}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {code && (
            <>
              {/* วิธี / กลุ่มเครื่อง (จาก simple method) + Custom = กำหนดจำนวนน้ำหนักเอง */}
              <div>
                <Label className="mb-1.5 block">วิธี / กลุ่มเครื่อง</Label>
                <div className="flex flex-wrap gap-1.5">
                  {groupButtons.map((g) => (
                    <Button key={g} type="button" size="sm" variant={activeSel === g ? "default" : "outline"}
                      className="h-8 text-xs" onClick={() => pickGroup(g)}>
                      {GROUP_LABEL[g]} <span className="ml-1 opacity-70">({defaultWeightCount(g)})</span>
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant={activeSel === "custom" ? "default" : "outline"}
                    className="h-8 text-xs" onClick={selectCustom}>
                    Custom
                  </Button>
                </div>
                {resolvedGroups.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    สารนี้ยังไม่มี simple method ระบุเครื่อง — ไปตั้งที่ Simple Method (เลือกเองชั่วคราวได้)
                  </p>
                )}
                {activeSel === "custom" && (
                  <p className="mt-1 text-xs text-muted-foreground">กำหนดจำนวนน้ำหนักเอง</p>
                )}
              </div>

              {/* ประเภทขวด (ซ้าย) + ขวด (ขวา) — คนละกล่อง */}
              <div className="grid grid-cols-1 gap-4 items-start sm:grid-cols-[minmax(7rem,auto)_1fr]">
                {/* ประเภทขวด */}
                <div className="rounded-lg border p-3">
                  <Label className="mb-1.5 block">ประเภทขวด</Label>
                  <div className="flex flex-col gap-1.5">
                    {TYPES.map((t) => (
                      <Button key={t} type="button" size="sm" disabled={typeCounts[t] === 0}
                        variant={bottleType === t ? "default" : "outline"} className="h-8 justify-start text-xs"
                        onClick={() => { setBottleType(t); setQrId(""); }}>
                        {t} ({typeCounts[t]})
                      </Button>
                    ))}
                  </div>
                </div>

                {/* ขวด */}
                <div className="min-w-0 rounded-lg border p-3">
                  <Label className="mb-1.5 block">ขวด (EXP ใกล้สุดก่อน)</Label>
                  {bottlesOfType.length === 0 ? (
                    <p className="text-sm text-muted-foreground">ไม่มีขวดประเภทนี้</p>
                  ) : (
                    <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                      {bottlesOfType.map((u) => {
                        const labelCode = standardRequisitionUnitLabelCode(u);

                        return (
                          <label key={u.qrId} className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm",
                            (bottle?.qrId === u.qrId) ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                            <input type="radio" name="bottle" className="mt-0.5" checked={bottle?.qrId === u.qrId} onChange={() => setQrId(u.qrId)} />
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-foreground">เลขขวด {labelCode || u.qrId}</span>
                              <span className="block text-xs text-muted-foreground">
                                Lot {u.lotNo || "-"} · เหลือ {formatStockQuantityWithUnit(u.volume?.remaining, u.volume?.unit)} · EXP {formatDate(u.exp)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* จำนวนน้ำหนัก + mg */}
              {bottle && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      จำนวนน้ำหนัก
                      {isCustom && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">custom</span>}
                    </Label>
                    <Input type="number" min={1} max={20} value={countText} disabled={!customCount} className="h-8 w-20"
                      onChange={(e) => {
                        if (!customCount) return;
                        const raw = e.target.value;
                        setCountText(raw); // ปล่อยว่าง/ค่ากลางๆ ได้ระหว่างพิมพ์
                        const n = Number(raw);
                        if (raw !== "" && Number.isInteger(n) && n >= 1 && n <= 20) setCount(n);
                      }}
                      onBlur={() => {
                        if (!customCount) return;
                        const n = Number(countText);
                        if (!(Number.isInteger(n) && n >= 1 && n <= 20)) setCountText(String(weights.length));
                      }} />
                  </div>
                  <div className="space-y-1.5">
                    {weights.map((w, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-16 text-xs text-muted-foreground">น้ำหนัก {i + 1}</span>
                        <Input type="number" step="0.0001" min="0" placeholder="mg" value={w}
                          onChange={(e) => setWeightAt(i, e.target.value)} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    รวม {total} mg · คงเหลือหลังหัก {formatStockQuantityWithUnit(Math.max(0, remainingMg - total), bottle?.volume?.unit ?? "mg")}
                  </p>
                  {weightError && <p className="mt-1 text-sm text-destructive">{weightError}</p>}
                </div>
              )}

              <div>
                <Label className="mb-1.5 block">หมายเหตุ</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button type="button" disabled={!canSave || busy} onClick={async () => {
            const ok = await confirm({
              title: "ยืนยันการเบิก Standard",
              description: "ต้องการนำรายการนี้ออกจาก Stock ใช่หรือไม่?",
              confirmText: "ยืนยันการเบิก",
              cancelText: "ยกเลิก",
            });
            if (ok) submit();
          }}>
            {busy ? "กำลังบันทึก..." : "เบิก"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
