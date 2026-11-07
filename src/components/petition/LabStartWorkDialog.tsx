import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cog, PlayCircle, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLabMethodSlots } from '@/hooks/useLabMethodSlots';
import { api, type MachineItem } from '@/lib/api';
import { getMachineSuggestions, type MachineSuggestion } from '@/lib/aiApi';
import { groupMachineMethods } from '@/lib/assignMachineGrouping';
import {
  buildSubstanceGroups,
  groupHasUnassignable,
  groupKeyOf,
  sampleSeqLabel,
  type SubstanceGroup,
} from '@/lib/labSubstanceGroups';
import { machineMatchesMethod } from '@/lib/methodRegistry';
import { rankSearchResults } from '@/lib/searchRanking';
import type { Petition, PetitionAssignedMachine } from '@/types/petition.types';

function machineLabel(machine: MachineItem) {
  return machine.code ? `${machine.code} - ${machine.name}` : machine.name;
}

function toAssignedMachine(machine: MachineItem, group: SubstanceGroup): PetitionAssignedMachine {
  return {
    machineId: machine._id || machine.code,
    code: machine.code,
    name: machine.name,
    location: machine.location,
    sampleName: group.sampleName || undefined,
    commonName: group.commonName || undefined,
  };
}

interface Props {
  /** คำร้องที่กำลังจะเริ่มงาน; null = ปิด dialog */
  petition: Petition | null;
  saving: boolean;
  onConfirm: (machines: PetitionAssignedMachine[]) => void;
  onClose: () => void;
}

/**
 * Dialog ตอนเจ้าหน้าที่กด "เริ่มงาน": เลือกเครื่องที่จะใช้ของแต่ละสาร
 * (สารในกลุ่มที่ใช้ method ประเภทเดียวกันใช้เครื่องร่วมกัน 1 เครื่อง)
 */
export default function LabStartWorkDialog({ petition, saving, onConfirm, onClose }: Props) {
  const { registryMethods, methodByCode, commonNameToSlots } = useLabMethodSlots();
  const { data: machines = [], isPending: machinesLoading, error: machinesError } = useQuery({
    queryKey: ['machines-active'],
    queryFn: async () => ((await api.getMachines()) ?? []).filter((m) => m.status !== 'retired'),
    staleTime: 60_000,
    enabled: !!petition,
  });
  const machineById = useMemo(
    () => new Map(machines.map((machine) => [machine._id || machine.code, machine])),
    [machines],
  );
  const groups = useMemo(
    () => (petition ? buildSubstanceGroups(petition, commonNameToSlots) : []),
    [petition, commonNameToSlots],
  );

  // selection[groupKey][methodCode] = machineId; undefined group = ยังไม่แตะ ใช้ค่าที่บันทึกไว้
  const [selection, setSelection] = useState<Record<string, Record<string, string>>>({});
  const [suggestions, setSuggestions] = useState<Record<string, MachineSuggestion[]>>({});
  const petitionId = petition?._id;
  useEffect(() => {
    setSelection({});
  }, [petitionId]);

  useEffect(() => {
    if (!petition) return;
    let alive = true;
    groups.forEach((g) => {
      getMachineSuggestions(g.commonName, petition.dept).then((items) => {
        if (alive && items.length > 0) setSuggestions((prev) => ({ ...prev, [g.groupKey]: items }));
      });
    });
    return () => { alive = false; };
  }, [petition, groups]);

  // ค่าตั้งต้นจากเครื่องที่บันทึกไว้แล้ว (เช่น Re-check): จับคู่แบบ first-fit กับ method ที่ต้องใช้เครื่อง
  function baselineForGroup(group: SubstanceGroup): Record<string, string> {
    const saved = (petition?.assignedMachines ?? []).filter(
      (m) => groupKeyOf(m.sampleName ?? '', m.commonName ?? '') === group.groupKey,
    );
    const result: Record<string, string> = {};
    const used = new Set<string>();
    groupMachineMethods(group.slots, methodByCode).forEach((gm) => {
      const match = saved.find((m) => {
        if (used.has(m.machineId)) return false;
        const machine = machineById.get(m.machineId);
        return !!machine && machineMatchesMethod(machine.name, gm.method, registryMethods);
      });
      if (match) {
        result[gm.code] = match.machineId;
        used.add(match.machineId);
      }
    });
    return result;
  }

  function selectedFor(group: SubstanceGroup): Record<string, string> {
    return selection[group.groupKey] ?? baselineForGroup(group);
  }

  function toggleMachine(group: SubstanceGroup, methodCode: string, machineKey: string) {
    setSelection((prev) => {
      const current = { ...(prev[group.groupKey] ?? baselineForGroup(group)) };
      if (current[methodCode] === machineKey) delete current[methodCode];
      else current[methodCode] = machineKey;
      return { ...prev, [group.groupKey]: current };
    });
  }

  function isGroupSatisfied(group: SubstanceGroup): boolean {
    if (groupHasUnassignable(group, methodByCode)) return false;
    const sel = selectedFor(group);
    return groupMachineMethods(group.slots, methodByCode).every((gm) => !!sel[gm.code]);
  }

  const hasUnassignableGroup = groups.length === 0 || groups.some((g) => groupHasUnassignable(g, methodByCode));
  const allSatisfied = groups.length > 0 && groups.every(isGroupSatisfied);
  const disabledReason = hasUnassignableGroup
    ? 'ยังไม่ได้กำหนด method ของสารใน simple method — เริ่มงานไม่ได้'
    : !allSatisfied
      ? 'เลือกเครื่องให้ครบทุกสารก่อน'
      : null;

  function handleConfirm() {
    if (disabledReason) return;
    const payload: PetitionAssignedMachine[] = [];
    const seen = new Set<string>();
    groups.forEach((group) => {
      Object.values(selectedFor(group)).forEach((id) => {
        const dedupeKey = `${group.groupKey}::${id}`;
        if (!id || seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        const machine = machineById.get(id);
        if (machine) payload.push(toAssignedMachine(machine, group));
      });
    });
    onConfirm(payload);
  }

  return (
    <Dialog open={!!petition} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        {petition && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <PlayCircle className="h-5 w-5 text-primary" />
                เริ่มงาน <span className="text-primary">{petition.petitionNo}</span>
              </DialogTitle>
              <DialogDescription>
                เลือกเครื่องที่จะใช้วิเคราะห์ของแต่ละสาร ระบบจะเริ่มนับเวลาวิเคราะห์เมื่อกดเริ่มงาน
              </DialogDescription>
            </DialogHeader>

            {machinesError && (
              <p role="alert" className="text-sm text-destructive">
                โหลดข้อมูลเครื่องไม่สำเร็จ: {machinesError instanceof Error ? machinesError.message : String(machinesError)}
              </p>
            )}

            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {machinesLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลเครื่อง...</div>
              ) : groups.length === 0 ? (
                <div className="rounded-md border border-border py-6 text-center text-sm text-muted-foreground">
                  ไม่มีตัวอย่างให้เลือกเครื่อง
                </div>
              ) : (
                groups.map((group) => {
                  const slotMachines = selectedFor(group);
                  const machineMethods = groupMachineMethods(group.slots, methodByCode);
                  const notSet: string[] = [];
                  const benchNotes: { key: string; label: string; substance: string }[] = [];
                  const unknownCodes: { key: string; code: string }[] = [];
                  group.slots.forEach((slot, sIdx) => {
                    if (slot.methods.length === 0) {
                      notSet.push(slot.name || `สารที่ ${sIdx + 1}`);
                      return;
                    }
                    slot.methods.forEach((code) => {
                      const method = methodByCode.get(code);
                      if (!method) unknownCodes.push({ key: `${sIdx}-${code}`, code });
                      else if (!method.requiresMachine) benchNotes.push({ key: `${sIdx}-${code}`, label: method.label, substance: slot.name });
                    });
                  });
                  const seqLabel = sampleSeqLabel(group);
                  const groupSuggestions = suggestions[group.groupKey] ?? [];
                  return (
                    <div key={group.groupKey} className="rounded-lg border border-border bg-card p-3 text-card-foreground">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {group.commonName || group.sampleName || '(ไม่มีชื่อ)'}
                        </span>
                        {seqLabel && <span className="text-xs text-muted-foreground">ตัวอย่าง #{seqLabel}</span>}
                      </div>

                      {groupSuggestions.length > 0 && (
                        <div className="mb-2 flex flex-wrap items-center gap-1">
                          <span className="text-[11px] text-muted-foreground">AI แนะนำ:</span>
                          {groupSuggestions.map((s) => (
                            <span
                              key={s.machineCode}
                              className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                              title={`ใช้ ${s.usageCount} ครั้งใน 10 batches ล่าสุด`}
                            >
                              {s.machineCode} ({s.usageCount}/10)
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-start gap-1.5">
                        {machineMethods.map((gm) => {
                          const filteredMachines = machines.filter((m) =>
                            machineMatchesMethod(m.name, gm.method, registryMethods),
                          );
                          return (
                            <div key={gm.code}>
                              <SingleMachinePicker
                                slotLabel={gm.substanceNames.length > 1 ? `ใช้ร่วม ${gm.substanceNames.length} สาร` : ''}
                                substanceName={gm.substanceNames.join(', ')}
                                methodLabel={gm.method.label}
                                machines={filteredMachines}
                                selectedId={slotMachines[gm.code] || null}
                                onSelect={(machineKey) => toggleMachine(group, gm.code, machineKey)}
                              />
                              {filteredMachines.length === 0 && (
                                <div className="mt-0.5 text-[11px] text-destructive">
                                  ไม่พบเครื่องสำหรับ {gm.method.label}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {notSet.length > 0 && (
                          <div className="w-[170px] shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                            <div className="truncate font-medium" title={notSet.join(', ')}>{notSet.join(', ')}</div>
                            ยังไม่ได้ตั้ง method ในซิมเปิลเมธอด
                          </div>
                        )}
                        {benchNotes.map((b) => (
                          <Badge key={b.key} variant="gray-soft" className="shrink-0 px-1.5 py-1 text-[10px] font-medium" title={b.substance}>
                            ทำที่โต๊ะ — {b.label}
                          </Badge>
                        ))}
                        {unknownCodes.map((u) => (
                          <Badge key={u.key} variant="red-soft" className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium">
                            method ไม่รู้จัก: {u.code}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                <X className="h-4 w-4" />
                ยกเลิก
              </Button>
              {disabledReason && !machinesLoading ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-block">
                      <Button variant="primary" disabled>
                        <PlayCircle className="h-4 w-4" />
                        เริ่มงาน
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{disabledReason}</TooltipContent>
                </Tooltip>
              ) : (
                <Button variant="primary" disabled={saving || machinesLoading} onClick={handleConfirm}>
                  <PlayCircle className="h-4 w-4" />
                  {saving ? 'กำลังเริ่มงาน...' : 'เริ่มงาน'}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SingleMachinePickerProps {
  machines: MachineItem[];
  selectedId: string | null;
  onSelect: (machineKey: string) => void;
  slotLabel: string;        // caption line, e.g. "ใช้ร่วม 2 สาร"; "" for a single substance
  substanceName: string;
  methodLabel: string;
}

// One box = one machine slot. Single-select: picking a machine replaces the slot,
// picking the already-selected one clears it.
function SingleMachinePicker({ machines, selectedId, onSelect, slotLabel, substanceName, methodLabel }: SingleMachinePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return machines;
    const matches = machines.filter((m) =>
      [m.code, m.name, m.location, m.model, m.manufacturer]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
    return rankSearchResults(matches, query, (machine) => ({
      primary: [machine.code],
      secondary: [machine.name, machine.location, machine.model, machine.manufacturer],
    }));
  }, [machines, query]);

  const selected = useMemo(
    () => machines.find((m) => (m._id || m.code) === selectedId) ?? null,
    [machines, selectedId],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={substanceName}
          className="w-[170px] shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-left text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 data-[state=open]:border-primary"
        >
          <div className="flex items-center gap-1">
            <span className="truncate text-[11px] font-medium text-foreground">{substanceName || slotLabel}</span>
            <Badge variant="blue-soft" className="ml-auto shrink-0 px-1 py-0 text-[9px] font-medium">
              {methodLabel}
            </Badge>
          </div>
          {slotLabel && <div className="text-[9px] text-muted-foreground">{slotLabel}</div>}
          <div className="mt-0.5 flex items-center gap-1">
            <Cog className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className={`truncate text-xs ${selected ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
              {selected ? machineLabel(selected) : 'เลือกเครื่อง'}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเครื่อง (รหัส/ชื่อ/ตำแหน่ง)"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">ไม่พบเครื่อง</div>
          ) : (
            filtered.map((machine) => {
              const key = machine._id || machine.code;
              const checked = key === selectedId;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => {
                    onSelect(key);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-accent ${checked ? 'bg-primary/10' : ''}`}
                >
                  <span
                    className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${checked ? 'border-primary' : 'border-border'}`}
                  >
                    {checked && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{machineLabel(machine)}</span>
                    {machine.location && (
                      <span className="block truncate text-[11px] text-muted-foreground">{machine.location}</span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

