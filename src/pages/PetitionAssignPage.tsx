import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ClipboardCheck,
  Cog,
  GripVertical,
  Hand,
  Inbox,
  QrCode,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/lis/AppLayout';
import LabScanAcceptModal from '@/components/petition/LabScanAcceptModal';
import PageHeader from '@/components/lis/PageHeader';
import PageToolbar from '@/components/lis/PageToolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import LabFreeAssignControl from '@/components/petition/LabFreeAssignControl';
import { isFreeAssignActive, type LabFreeAssignState } from '@/lib/labFreeAssign';
import { useAuth } from '@/hooks/useAuth';
import { usePetitionList } from '@/hooks/usePetition';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import { api, type MachineItem } from '@/lib/api';
import { hasAssignableLabParameter } from '@/lib/petitionTestItems';
import { hasLabTrack } from '@/lib/statusBadge';
import { isLabRecheckPending, labAssignBoardStatusBadge, labReceivedAt } from '@/lib/receiveStatus';

const createdTime = (p: Petition) => Date.parse(p.createdAt) || 0;

/** คิวรอมอบหมาย: งาน Re-check ขึ้นก่อนทั้งหมด แล้วเรียงตามวันที่สร้างคำขอ (เก่า → ใหม่) */
function sortAssignQueue(petitions: Petition[]): Petition[] {
  return [...petitions].sort((a, b) => {
    const urgent = Number(isUrgentPetition(b)) - Number(isUrgentPetition(a));
    if (urgent !== 0) return urgent;
    const recheck = Number(isLabRecheckPending(b)) - Number(isLabRecheckPending(a));
    if (recheck !== 0) return recheck;
    const time = createdTime(a) - createdTime(b);
    if (time !== 0) return time;
    return a._id.localeCompare(b._id);
  });
}

const formatThaiDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(iso));
import { isVisibleInAssignQueue } from '@/lib/petitionQueueVisibility';
import { getMachineSuggestions, type MachineSuggestion } from '@/lib/aiApi';
import { DEV_MODE, synthesizeDevAssignees } from '@/config/dev';
import { parseSubstances } from '@/lib/substances';
import { readSlotMethods, machineMatchesMethod, type MethodDoc } from '@/lib/methodRegistry';
import { groupMachineMethods } from '@/lib/assignMachineGrouping';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { rankSearchResults } from '@/lib/searchRanking';
import { requestPetitionNotificationsRefresh } from '@/lib/petitionFlowWatcher';
import { cn } from '@/lib/utils';
import {
  type Petition,
  type PetitionAssignee,
  type PetitionAssignedMachine,
  type PetitionItem,
} from '@/types/petition.types';
import { isUrgentPetition, prioritizeUrgentPetitions } from '@/lib/urgentPetition';
import UrgentBadge from '@/components/lis/UrgentBadge';

// One substance within a commonName (split by "+"), with the AND-set of method
// codes the simple-method config assigned to it. `methods.length === 0` means
// "not yet configured" → that slot blocks Assign.
type SubstanceSlot = {
  name: string;
  methods: string[];   // AND-set of method codes required for this substance
};

type SubstanceGroup = {
  groupKey: string;       // `${sampleName.lower}||${commonName.lower}`
  sampleName: string;
  commonName: string;
  items: PetitionItem[];
  slots: SubstanceSlot[];  // per-substance, positional — aligned to parseSubstances(commonName)
};

// Master-items lookup
type MasterItemRaw = Record<string, unknown>;
const MASTER_COMMON_NAME_KEYS = ['common_name', 'commonname', 'commonName', 'item_name2', 'itemType'];
const MASTER_ITEM_NO_KEYS = ['item_no', 'itemCode', 'item_code', 'code', 'Code', 'ITEM_CODE'];

function pickField(item: MasterItemRaw, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function groupKeyOf(sampleName: string, commonName: string): string {
  return `${(sampleName || '').trim().toLowerCase()}||${(commonName || '').trim().toLowerCase()}`;
}

// Sample-number label for a substance group, e.g. items with seq 1 and 2 → "1+2".
function sampleSeqLabel(group: SubstanceGroup): string {
  return group.items
    .map((item) => item.seq)
    .filter((seq) => seq !== undefined && seq !== null)
    .sort((a, b) => a - b)
    .join('+');
}

interface EmployeeAssignee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  empType: string;
  isActive: boolean;
}

function employeeLabel(employee: EmployeeAssignee) {
  return `${employee.name} (${employee.employeeId})`;
}

function machineLabel(machine: MachineItem) {
  return machine.code ? `${machine.code} - ${machine.name}` : machine.name;
}

function toAssignedMachine(
  machine: MachineItem,
  group: SubstanceGroup,
): PetitionAssignedMachine {
  return {
    machineId: machine._id || machine.code,
    code: machine.code,
    name: machine.name,
    location: machine.location,
    sampleName: group.sampleName || undefined,
    commonName: group.commonName || undefined,
  };
}

// commonName (lowercased) → positional method-code AND-sets, index i = parseSubstances()[i].
// An empty inner array means that substance has no configured method.
type SlotMethods = string[][];

function buildSubstanceGroups(
  petition: Petition,
  commonNameToSlots: Map<string, SlotMethods>,
): SubstanceGroup[] {
  const groups = new Map<string, SubstanceGroup>();
  petition.items.forEach((item) => {
    const sampleName = (item.sampleName ?? '').trim();
    const commonName = (item.commonName ?? '').trim();
    const key = groupKeyOf(sampleName, commonName);
    let group = groups.get(key);
    if (!group) {
      const substances = parseSubstances(commonName);
      const slotMethods = commonNameToSlots.get(commonName.toLowerCase()) ?? [];
      group = {
        groupKey: key,
        sampleName,
        commonName,
        items: [],
        slots: substances.map((name, idx) => ({
          name,
          methods: slotMethods[idx] ?? [],
        })),
      };
      groups.set(key, group);
    }
    group.items.push(item);
  });
  return Array.from(groups.values());
}

// A group cannot be assigned when it has no substances, or any slot has no
// configured method / an unknown / inactive method code.
function groupHasUnassignable(group: SubstanceGroup, methodByCode: Map<string, MethodDoc>): boolean {
  if (group.slots.length === 0) return true;
  return group.slots.some(
    (s) =>
      s.methods.length === 0 ||
      s.methods.some((code) => {
        const method = methodByCode.get(code);
        return !method || method.active === false;
      }),
  );
}

export default function PetitionAssignPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // หัวหน้า Lab / admin มอบหมายงานได้; เจ้าหน้าที่ Lab ดูได้อย่างเดียว ยกเว้นช่วง "มอบหมายอิสระ" ที่กดรับงานเองได้
  const userRoles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const canManage = userRoles.some((role) => role === 'admin' || role === 'lab-head');
  const canClaimRole = canManage || userRoles.includes('lab-analyze');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const { data: freeAssign = null, refetch: refetchFreeAssign } = useQuery({
    queryKey: ['lab-free-assign'],
    queryFn: async () => (await api.get<LabFreeAssignState>('/petitions/lab-free-assign')).data.data,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const freeAssignActive = isFreeAssignActive(freeAssign, now);
  const canClaim = canClaimRole && !canManage && freeAssignActive;
  const [freeAssignSaving, setFreeAssignSaving] = useState(false);
  const selfEmployee: EmployeeAssignee | null = user
    ? {
        id: 0,
        employeeId: user.employeeId ?? '',
        name: user.name || user.email || '',
        department: 'Lab',
        position: '',
        empType: 'self',
        isActive: true,
      }
    : null;

  async function changeFreeAssign(until: Date | null): Promise<boolean> {
    setFreeAssignSaving(true);
    try {
      await api.put('/petitions/lab-free-assign', { until: until ? until.toISOString() : null });
      await refetchFreeAssign();
      toast.success(until ? 'เปิดมอบหมายอิสระแล้ว' : 'ปิดมอบหมายอิสระแล้ว');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกมอบหมายอิสระไม่สำเร็จ');
      return false;
    } finally {
      setFreeAssignSaving(false);
    }
  }
  const {
    data: pendingData,
    loading: pendingLoading,
    error: pendingError,
    refresh: refreshPending,
  } = usePetitionList(
    { page: 1, limit: 100, status: 'sampleSent,pendingReview' },
    { refetchOnFocus: true, pollMs: 30_000 },
  );
  const {
    data: inProgressData,
    loading: inProgressLoading,
    error: inProgressError,
    refresh: refreshInProgress,
  } = usePetitionList(
    { page: 1, limit: 100, status: 'inProgress' },
    { refetchOnFocus: true, pollMs: 30_000 },
  );
  const {
    data: staleReceivedData,
    loading: staleReceivedLoading,
    error: staleReceivedError,
    refresh: refreshStaleReceived,
  } = usePetitionList(
    { page: 1, limit: 100, status: 'deliveringQC' },
    { refetchOnFocus: true, pollMs: 30_000 },
  );
  // Re-check อาจเป็นคนอื่นมาทำอีกวัน — ดึงงานเหล่านี้กลับมา (แม้สถานะ success แล้ว) ให้เปลี่ยนผู้รับงานได้
  const {
    data: recheckData,
    loading: recheckLoading,
    error: recheckError,
    refresh: refreshRecheck,
  } = usePetitionList(
    { page: 1, limit: 100, labRecheckPending: true },
    { refetchOnFocus: true, pollMs: 30_000 },
  );
  const [fetchedEmployees, setFetchedEmployees] = useState<EmployeeAssignee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [machines, setMachines] = useState<MachineItem[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(true);
  const [machinesError, setMachinesError] = useState<string | null>(null);
  // machinesByPetition[petitionId][groupKey][methodCode] = machineId.
  // Keyed per (group, machine-backed method code): substances in a group that
  // share an instrument type share one machine (one picker per type).
  const [machinesByPetition, setMachinesByPetition] =
    useState<Record<string, Record<string, Record<string, string>>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [machineSuggestions, setMachineSuggestions] = useState<Record<string, MachineSuggestion[]>>({});
  // A petition dragged onto a staff card (or "รับงาน" in free-assign mode) → open the machine-picking dialog.
  const [dropTarget, setDropTarget] = useState<{ petitionId: string; employeeId: string; claim?: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setEmployeesLoading(true);
    setEmployeesError(null);

    api.get<EmployeeAssignee[]>('/employees/assignees')
      .then((res) => {
        if (!alive) return;
        setFetchedEmployees(res.data.data);
      })
      .catch((err: Error) => {
        if (!alive) return;
        setEmployeesError(err.message);
      })
      .finally(() => {
        if (alive) setEmployeesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setMachinesLoading(true);
    setMachinesError(null);

    api.getMachines()
      .then((items) => {
        if (!alive) return;
        setMachines((items ?? []).filter((m) => m.status !== 'retired'));
      })
      .catch((err: Error) => {
        if (!alive) return;
        setMachinesError(err.message);
      })
      .finally(() => {
        if (alive) setMachinesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  // In dev mode prepend fake Lab dev users so a petition can be assigned and
  // then viewed on the lab pages by switching to that role (HR API has no dev
  // staff). Always shown, even if the HR fetch failed.
  const employees = useMemo(
    () => (DEV_MODE ? [...synthesizeDevAssignees(), ...fetchedEmployees] : fetchedEmployees),
    [fetchedEmployees],
  );

  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.employeeId, employee])),
    [employees],
  );
  const machineById = useMemo(
    () => new Map(machines.map((machine) => [machine._id || machine.code, machine])),
    [machines],
  );

  // Method registry — required-method lookups by code.
  const { data: registryMethods = [] } = useQuery({
    queryKey: ['methods'],
    queryFn: () => api.getMethods(),
    staleTime: 5 * 60_000,
  });
  const { data: labParameters = [], isPending: parametersLoading, error: parametersError } = useQuery({
    queryKey: ['assign-lab-parameters'],
    queryFn: () => api.getParameters(),
    staleTime: 5 * 60_000,
  });
  const groupMembership = useItemGroupMembership();
  const methodByCode = useMemo(
    () => new Map(registryMethods.map((m) => [m.code, m])),
    [registryMethods],
  );

  const loading = pendingLoading || inProgressLoading || staleReceivedLoading || recheckLoading || parametersLoading;
  const error = pendingError || inProgressError || staleReceivedError || recheckError || (parametersError instanceof Error ? parametersError.message : null);

  const { data: masterItems = [] } = useQuery<MasterItemRaw[]>({
    queryKey: ['master-items-for-petition-assign'],
    queryFn: async () => {
      const res = await api.get<unknown>('/master-items');
      const payload = res.data.data;
      if (Array.isArray(payload)) return payload as MasterItemRaw[];
      if (payload && typeof payload === 'object') {
        const arr =
          (payload as { data?: unknown }).data ??
          (payload as { items?: unknown }).items;
        if (Array.isArray(arr)) return arr as MasterItemRaw[];
      }
      return [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: simpleMethods = [] } = useQuery<Array<{ itemNo: string; methods?: string[][]; instruments?: string[] }>>({
    queryKey: ['simple-methods'],
    queryFn: async () => {
      const res = await api.get<Array<{ itemNo: string; methods?: string[][]; instruments?: string[] }>>('/simple-methods');
      // Keep raw entries — readSlotMethods (applied below with the per-commonName
      // substance count) normalises new `methods` and legacy `instruments`.
      return (res.data.data ?? []).map((entry) => ({
        itemNo: entry.itemNo,
        methods: entry.methods,
        instruments: entry.instruments,
      }));
    },
    staleTime: 5 * 60_000,
  });

  // commonName (lowercased) → positional method-code AND-sets per substance.
  // Master items sharing a commonName are merged slot-by-slot (first slot with
  // any configured method wins), preserving which methods belong to which substance.
  const commonNameToSlots = useMemo(() => {
    const itemNoToEntry = new Map<string, { methods?: string[][]; instruments?: string[] }>();
    simpleMethods.forEach((entry) => {
      if (entry.itemNo) itemNoToEntry.set(entry.itemNo.trim(), entry);
    });

    const map = new Map<string, SlotMethods>();
    masterItems.forEach((item) => {
      const commonName = pickField(item, MASTER_COMMON_NAME_KEYS);
      if (!commonName) return;
      const itemNo = pickField(item, MASTER_ITEM_NO_KEYS);
      const entry = itemNoToEntry.get(itemNo);
      if (!entry) return;
      const key = commonName.trim().toLowerCase();
      const count = parseSubstances(commonName).length;
      const slots = readSlotMethods(entry, count);
      if (slots.every((s) => s.length === 0)) return;
      const current = map.get(key) ?? (Array.from({ length: count }, () => [] as string[]) as SlotMethods);
      const merged = Array.from(
        { length: Math.max(count, current.length, slots.length) },
        (_, i) => (current[i] && current[i].length > 0 ? current[i] : (slots[i] ?? [])),
      ) as SlotMethods;
      map.set(key, merged);
    });

    return map;
  }, [masterItems, simpleMethods]);

  const queuePetitions = useMemo(() => {
    // งาน re-check ที่ยัง inProgress ซ้ำกับ inProgressData — กันการ์ดซ้ำด้วย _id
    const byId = new Map<string, Petition>();
    [
      ...(pendingData?.items ?? []),
      ...(inProgressData?.items ?? []),
      ...(staleReceivedData?.items ?? []),
      ...(recheckData?.items ?? []),
    ].forEach((petition) => {
      if (!byId.has(petition._id)) byId.set(petition._id, petition);
    });
    return [...byId.values()].filter(
      (petition) => isVisibleInAssignQueue(petition) && hasAssignableLabParameter(petition, labParameters, groupMembership),
    );
  }, [inProgressData?.items, pendingData?.items, staleReceivedData?.items, recheckData?.items, labParameters, groupMembership]);

  // Cache substance groups per petition
  const groupsByPetition = useMemo(() => {
    const out = new Map<string, SubstanceGroup[]>();
    queuePetitions.forEach((petition) => {
      out.set(petition._id, buildSubstanceGroups(petition, commonNameToSlots));
    });
    return out;
  }, [queuePetitions, commonNameToSlots]);

  useEffect(() => {
    const seen = new Set<string>();
    queuePetitions.forEach((petition) => {
      const groups = groupsByPetition.get(petition._id) ?? [];
      groups.forEach((g) => {
        if (seen.has(g.groupKey)) return;
        seen.add(g.groupKey);
        getMachineSuggestions(g.commonName, petition.dept).then((suggestions) => {
          if (suggestions.length > 0) {
            setMachineSuggestions((prev) => ({ ...prev, [g.groupKey]: suggestions }));
          }
        });
      });
    });
  }, [queuePetitions, groupsByPetition]);

  // Baseline (methodCode → machineId) mapping for a group, derived from saved
  // assignedMachines: each saved machine is first-fit matched to a distinct
  // machine-backed method it satisfies. assignedMachines carries no method tag,
  // so reload re-binds by first-fit — safe because GC/HPLC prefixes are mutually
  // exclusive and each group now holds at most one machine per method type.
  function baselineSlotsForGroup(petition: Petition, group: SubstanceGroup): Record<string, string> {
    const saved = (petition.assignedMachines ?? []).filter(
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

  // Selected machine ids per methodCode for a group.
  function getSelectedSlotMachines(petition: Petition, group: SubstanceGroup): Record<string, string> {
    const perGroup = machinesByPetition[petition._id];
    if (perGroup && perGroup[group.groupKey] !== undefined) {
      return perGroup[group.groupKey];
    }
    return baselineSlotsForGroup(petition, group);
  }

  // Single-select per (group, machine-backed method): picking a machine sets that
  // type's requirement; picking the already-selected machine clears it.
  function setMachineForMethod(
    petitionId: string,
    groupKey: string,
    methodCode: string,
    machineKey: string,
  ) {
    setMachinesByPetition((prev) => {
      const petition = allPetitions.find((p) => p._id === petitionId);
      const groups = petition ? buildSubstanceGroups(petition, commonNameToSlots) : [];
      const group = groups.find((g) => g.groupKey === groupKey);
      const baselineMap: Record<string, Record<string, string>> = { ...(prev[petitionId] ?? {}) };
      if (baselineMap[groupKey] === undefined) {
        baselineMap[groupKey] = petition && group ? baselineSlotsForGroup(petition, group) : {};
      }
      const current = { ...baselineMap[groupKey] };
      if (current[methodCode] === machineKey) delete current[methodCode];
      else current[methodCode] = machineKey;
      baselineMap[groupKey] = current;
      return { ...prev, [petitionId]: baselineMap };
    });
  }

  // A group is assignable iff it has substances, every slot has ≥1 configured
  // method that resolves to a known + active registry method, AND every distinct
  // machine-backed method type has a selected machine. Bench methods need no
  // selection; empty/unknown/inactive method codes keep Assign blocked.
  function isGroupSatisfied(petition: Petition, group: SubstanceGroup): boolean {
    if (group.slots.length === 0) return false;
    const allSlotsConfigured = group.slots.every((slot) => {
      if (slot.methods.length === 0) return false;
      return slot.methods.every((code) => {
        const method = methodByCode.get(code);
        return !!method && method.active !== false;
      });
    });
    if (!allSlotsConfigured) return false;
    const sel = getSelectedSlotMachines(petition, group);
    return groupMachineMethods(group.slots, methodByCode).every((gm) => !!sel[gm.code]);
  }

  function refreshPetitions() {
    refreshPending();
    refreshInProgress();
    refreshStaleReceived();
    refreshRecheck();
  }

  const allPetitions = useMemo(
    () => queuePetitions,
    [queuePetitions],
  );

  const visiblePetitions = useMemo(() => {
    const source = allPetitions;
    const query = search.trim().toLowerCase();
    if (!query) return prioritizeUrgentPetitions(source);
    const matches = source.filter((petition) =>
      [
        petition.petitionNo,
        petition.submittedBy?.name,
        petitionDepartmentLabel(petition),
        petition.assignedTo?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
    return prioritizeUrgentPetitions(rankSearchResults(matches, search, (petition) => {
      const itemNos = (petition.items ?? []).map((item) => item.itemNo).filter((itemNo) => itemNo?.trim());
      return {
        primary: itemNos.length ? itemNos : [petition.petitionNo],
        secondary: [petition.petitionNo, petition.submittedBy?.name, petitionDepartmentLabel(petition), petition.assignedTo?.name],
      };
    }));
  }, [allPetitions, search]);

  async function assignPetition(petition: Petition, employeeIdOverride?: string, claim = false): Promise<boolean> {
    if (!labReceivedAt(petition)) {
      toast.error('Lab ต้องรับตัวอย่างก่อนจึงจะ assign ได้');
      return false;
    }
    if (!hasAssignableLabParameter(petition, labParameters, groupMembership)) {
      toast.error('คำร้องนี้ไม่มีพารามิเตอร์ Lab ที่ตรงกับตัวอย่าง');
      return false;
    }
    const employeeId = employeeIdOverride || petition.assignedTo?.employeeId || '';
    const employee = claim ? selfEmployee : employeeById.get(employeeId);
    if (!employee) {
      toast.error('กรุณาเลือกเจ้าหน้าที่');
      return false;
    }

    const groups = groupsByPetition.get(petition._id) ?? buildSubstanceGroups(petition, commonNameToSlots);

    // every substance must have a configured method, and every machine-backed
    // method must have a machine picked
    const incomplete = groups.some((group) => !isGroupSatisfied(petition, group));
    if (incomplete) {
      toast.error('กรุณาเลือกเครื่องให้ครบทุกสารก่อน assign');
      return false;
    }

    const machinesPayload: PetitionAssignedMachine[] = [];
    const seen = new Set<string>();
    groups.forEach((group) => {
      Object.values(getSelectedSlotMachines(petition, group)).forEach((id) => {
        if (!id) return;
        const dedupeKey = `${group.groupKey}::${id}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        const machine = machineById.get(id);
        if (machine) machinesPayload.push(toAssignedMachine(machine, group));
      });
    });

    setSavingId(petition._id);
    try {
      if (claim) {
        // server ใช้ตัวตนจาก session; employeeId ใช้เฉพาะ role จำลองตอน dev
        await api.post<Petition>(`/petitions/${petition._id}/claim`, {
          employeeId: employee.employeeId,
          machines: machinesPayload,
        });
      } else {
        await api.patch<Petition>(`/petitions/${petition._id}/assign`, {
          ...({
            employeeId: employee.employeeId,
            name: employee.name,
            department: employee.department,
            position: employee.position,
          } satisfies PetitionAssignee),
          machines: machinesPayload,
        });
      }
      const machineSummary = machinesPayload.length
        ? ` (เครื่อง: ${machinesPayload.map((m) => m.code).join(', ')})`
        : '';
      toast.success(claim
        ? `รับงาน ${petition.petitionNo}${machineSummary} แล้ว`
        : `Assign ${petition.petitionNo} ให้ ${employee.name}${machineSummary} แล้ว`);
      requestPetitionNotificationsRefresh();
      refreshPetitions();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึก assignment ไม่สำเร็จ');
      if (claim) refreshPetitions();
      return false;
    } finally {
      setSavingId(null);
    }
  }

  const dropPetition = dropTarget
    ? allPetitions.find((p) => p._id === dropTarget.petitionId) ?? null
    : null;
  // Existing assignments remain visible even when HR no longer returns that
  // person in /employees/assignees. Reuse saved assignee data so dropping on
  // that fallback column still opens machine selection instead of doing nothing.
  const dropEmployee = dropTarget
    ? dropTarget.claim ? selfEmployee : employeeById.get(dropTarget.employeeId) ?? (() => {
        const saved = allPetitions.find(
          (petition) => petition.assignedTo?.employeeId === dropTarget.employeeId,
        )?.assignedTo;
        return saved
          ? {
              id: 0,
              employeeId: saved.employeeId,
              name: saved.name,
              department: saved.department ?? '',
              position: saved.position ?? '',
              empType: 'saved',
              isActive: true,
            }
          : null;
      })()
    : null;

  async function confirmDropAssign() {
    if (!dropTarget || !dropPetition) return;
    const ok = await assignPetition(dropPetition, dropTarget.employeeId, !!dropTarget.claim);
    if (ok) setDropTarget(null);
  }

  const boardLoading = loading || employeesLoading || machinesLoading;

  return (
    <AppLayout>
        <LabScanAcceptModal
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onAccepted={() => {
            setScanOpen(false);
            refreshPetitions();
          }}
        />
        <div className="space-y-5">
          <PageHeader
            title="Assign คำร้องให้เจ้าหน้าที่"
            description={canManage
              ? 'รับตัวอย่าง Lab ก่อน แล้วลากคำร้องไปวางบนการ์ดเจ้าหน้าที่เพื่อเลือกเครื่องและ assign'
              : canClaim
                ? 'ช่วงมอบหมายอิสระ: กด "รับงาน" ที่คำร้องเพื่อเลือกเครื่องและรับงานนั้นเป็นของคุณ'
                : 'ดูการมอบหมายงาน Lab ได้อย่างเดียว หัวหน้า Lab เป็นผู้มอบหมายงาน'}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {canManage && (
                  <Button variant="primary" className="gap-2" onClick={() => setScanOpen(true)}>
                    <QrCode className="h-4 w-4" />
                    รับตัวอย่าง
                  </Button>
                )}
                <LabFreeAssignControl
                  state={freeAssign}
                  active={freeAssignActive}
                  canManage={canManage}
                  saving={freeAssignSaving}
                  onChange={changeFreeAssign}
                />
              </div>
            }
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Flow การมอบหมาย</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
                <div className="rounded-xl bg-muted px-3 py-3">
                  <p className="font-medium text-foreground">1. รับตัวอย่าง Lab</p>
                  <p className="mt-1 text-xs">สแกน QR หรือกรอกเลขคำร้องเพื่อรับตัวอย่างก่อน</p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-3">
                  <p className="font-medium text-foreground">2. เลือกผู้รับงาน</p>
                  <p className="mt-1 text-xs">ลากคำร้องไปวางบนการ์ดเจ้าหน้าที่ของขั้นงานนั้น โดยผู้รับผิดชอบ QC และ Lab อาจเป็นคนละคนได้</p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-3">
                  <p className="font-medium text-foreground">3. ยืนยันเครื่องมือ</p>
                  <p className="mt-1 text-xs">ตรวจสอบเครื่องมือและบันทึกให้จบใน dialog เดียว</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">สรุปก่อน assign</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>งานรอ assign: <span className="font-medium text-foreground">{allPetitions.filter((petition) => !petition.assignedTo).length}</span></p>
                <p>คำร้องทั้งหมดในบอร์ด: <span className="font-medium text-foreground">{allPetitions.length}</span></p>
                <p>มอบหมายอิสระ: <span className="font-medium text-foreground">{freeAssignActive ? 'เปิดอยู่' : 'ปิด'}</span></p>
                <p>หลักการ assign: <span className="font-medium text-foreground">แยกผู้รับผิดชอบตามฝั่ง QC และ Lab</span></p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">รอรับตัวอย่าง</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {allPetitions.filter((petition) => !petition.assignedTo && !labReceivedAt(petition)).length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">คำร้องรอ assign</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {allPetitions.filter((petition) => !petition.assignedTo).length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">คำร้องที่มีผู้รับงานแล้ว</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {allPetitions.filter((petition) => petition.assignedTo).length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">เจ้าหน้าที่ที่เลือกได้</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">{employees.length}</div>
              </CardContent>
            </Card>
          </div>

          {(error || employeesError || machinesError) && (
            <div className="rounded-[10px] border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error
                ? `โหลดคำร้องไม่สำเร็จ: ${error}`
                : employeesError
                  ? `โหลดข้อมูลพนักงานไม่สำเร็จ: ${employeesError}`
                  : `โหลดข้อมูลเครื่องไม่สำเร็จ: ${machinesError}`}
            </div>
          )}

          <div>
            <div className="hidden mt-3 rounded-[10px] border border-border bg-card p-3 text-card-foreground">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ค้นหาเลขที่คำร้อง / ผู้ยื่น / แผนก / เจ้าหน้าที่..."
                  className="pl-9"
                />
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-border bg-card p-4 text-card-foreground">
              <PageToolbar
                search={{
                  value: search,
                  onChange: setSearch,
                  placeholder: 'ค้นหาเลขคำร้อง, ผู้ยื่น, แผนก, ผู้รับงาน',
                }}
                right={
                  <div className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {canManage
                      ? 'คำร้องที่ยังไม่รับตัวอย่างจะลากเพื่อ assign ไม่ได้'
                      : canClaim
                        ? 'กดรับงานได้เฉพาะคำร้องที่ยังไม่มีผู้รับ'
                        : 'โหมดดูอย่างเดียว'}
                  </div>
                }
              />
            </div>

            <div className="mt-3">
              <AssignBoard
                petitions={visiblePetitions}
                loading={boardLoading}
                employees={employees}
                groupsByPetition={groupsByPetition}
                methodByCode={methodByCode}
                machineById={machineById}
                canAssign={canManage}
                canClaim={canClaim}
                onDropPetition={(petitionId, employeeId) => setDropTarget({ petitionId, employeeId })}
                onClaimPetition={(petitionId) => setDropTarget({ petitionId, employeeId: selfEmployee?.employeeId ?? '', claim: true })}
                onPetitionClick={(id) => navigate(`/petition/${id}`)}
                emptyPoolText="ไม่มีคำร้องที่รอ assign"
              />
            </div>
          </div>
        </div>

        <MachineAssignDialog
          petition={dropPetition}
          employee={dropEmployee}
          groups={dropPetition ? groupsByPetition.get(dropPetition._id) ?? [] : []}
          machines={machines}
          registryMethods={registryMethods}
          methodByCode={methodByCode}
          getSelectedSlotMachines={getSelectedSlotMachines}
          onSelectMachine={setMachineForMethod}
          isGroupSatisfied={isGroupSatisfied}
          machineSuggestions={machineSuggestions}
          saving={!!dropPetition && savingId === dropPetition._id}
          confirmLabel={dropTarget?.claim ? 'รับงาน' : undefined}
          onConfirm={confirmDropAssign}
          onClose={() => setDropTarget(null)}
        />
    </AppLayout>
  );
}

// ————————————————————————————————————————————————————————————————
// Board
// ————————————————————————————————————————————————————————————————

interface AssignBoardProps {
  petitions: Petition[];
  loading: boolean;
  employees: EmployeeAssignee[];
  groupsByPetition: Map<string, SubstanceGroup[]>;
  methodByCode: Map<string, MethodDoc>;
  machineById: Map<string, MachineItem>;
  canAssign: boolean;
  canClaim: boolean;
  onDropPetition: (petitionId: string, employeeId: string) => void;
  onClaimPetition: (petitionId: string) => void;
  onPetitionClick: (id: string) => void;
  emptyPoolText: string;
}

interface BoardColumn {
  employeeId: string;
  name: string;
  department: string;
}

function AssignBoard({
  petitions,
  loading,
  employees,
  groupsByPetition,
  methodByCode,
  machineById,
  canAssign,
  canClaim,
  onDropPetition,
  onClaimPetition,
  onPetitionClick,
  emptyPoolText,
}: AssignBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overEmployee, setOverEmployee] = useState<string | null>(null);

  const unassigned = useMemo(() => sortAssignQueue(petitions.filter((p) => !p.assignedTo)), [petitions]);

  // employeeId → assigned petitions
  const assignedByEmployee = useMemo(() => {
    const map = new Map<string, Petition[]>();
    petitions.forEach((p) => {
      const id = p.assignedTo?.employeeId;
      if (!id) return;
      const list = map.get(id) ?? [];
      list.push(p);
      map.set(id, list);
    });
    return map;
  }, [petitions]);

  // Columns = every assignable employee, plus any employee that already has an
  // assignment here but is missing from the current staff list (kept visible).
  const columns = useMemo<BoardColumn[]>(() => {
    const known = new Set(employees.map((e) => e.employeeId));
    const cols: BoardColumn[] = employees.map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      department: e.department,
    }));
    assignedByEmployee.forEach((list, id) => {
      if (known.has(id)) return;
      const info = list[0].assignedTo;
      cols.push({ employeeId: id, name: info?.name ?? id, department: info?.department ?? '' });
    });
    return cols;
  }, [employees, assignedByEmployee]);

  function handleDrop(employeeId: string) {
    if (draggingId) onDropPetition(draggingId, employeeId);
    setDraggingId(null);
    setOverEmployee(null);
  }

  if (loading) {
    return (
      <div className="rounded-[10px] border border-border bg-card py-12 text-center text-muted-foreground">
        กำลังโหลดข้อมูล...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)] items-start">
      {/* Unassigned pool */}
      <div className="rounded-[10px] border border-border bg-muted/50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">งานรอมอบหมาย</span>
          <Badge variant="gray-soft" className="ml-auto font-normal">
            {unassigned.length}
          </Badge>
        </div>
        <div className="max-h-[72vh] space-y-2 overflow-y-auto pr-0.5">
          {unassigned.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
              {emptyPoolText}
            </div>
          ) : (
            unassigned.map((petition) => (
              <PetitionCard
                key={petition._id}
                petition={petition}
                groups={groupsByPetition.get(petition._id) ?? []}
                methodByCode={methodByCode}
                dragging={draggingId === petition._id}
                canDragRole={canAssign}
                onClaim={canClaim ? () => onClaimPetition(petition._id) : undefined}
                onDragStart={() => setDraggingId(petition._id)}
                onDragEnd={() => setDraggingId(null)}
                onClick={() => onPetitionClick(petition._id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Staff cards (drop zones) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {columns.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-border py-10 text-center text-sm text-muted-foreground sm:col-span-2 2xl:col-span-3">
            ไม่มีเจ้าหน้าที่ให้มอบหมาย
          </div>
        ) : (
          columns.map((col) => {
            const assigned = assignedByEmployee.get(col.employeeId) ?? [];
            const isOver = overEmployee === col.employeeId;
            return (
              <div
                key={col.employeeId}
                onDragOver={(e) => {
                  if (!canAssign) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overEmployee !== col.employeeId) setOverEmployee(col.employeeId);
                }}
                onDragLeave={(e) => {
                  // only clear when the pointer actually leaves the card
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setOverEmployee((cur) => (cur === col.employeeId ? null : cur));
                  }
                }}
                onDrop={(e) => {
                  if (!canAssign) return;
                  e.preventDefault();
                  handleDrop(col.employeeId);
                }}
                className={cn(
                  'flex flex-col rounded-[10px] border bg-card p-3 text-card-foreground transition-colors',
                  isOver ? 'border-primary/60 bg-primary/10 ring-2 ring-primary/30' : 'border-border',
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Users className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{col.name}</div>
                    {col.department && (
                      <div className="truncate text-[11px] text-muted-foreground">{col.department}</div>
                    )}
                  </div>
                  <Badge variant="gray-soft" className="ml-auto font-normal">
                    {assigned.length}
                  </Badge>
                </div>

                <div className="min-h-[64px] space-y-2">
                  {assigned.length === 0 ? (
                    <div
                      className={cn(
                        'flex h-16 items-center justify-center rounded-md border border-dashed text-xs',
                        isOver ? 'border-primary/50 text-primary' : 'border-border text-muted-foreground',
                      )}
                    >
                      {canAssign ? 'ลากงานมาวางที่นี่' : 'ยังไม่มีงาน'}
                    </div>
                  ) : (
                    assigned.map((petition) => (
                      <PetitionCard
                        key={petition._id}
                        petition={petition}
                        groups={groupsByPetition.get(petition._id) ?? []}
                        methodByCode={methodByCode}
                        machineById={machineById}
                        dragging={draggingId === petition._id}
                        canDragRole={canAssign}
                        onDragStart={() => setDraggingId(petition._id)}
                        onDragEnd={() => setDraggingId(null)}
                        onClick={() => onPetitionClick(petition._id)}
                        assigned
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface PetitionCardProps {
  petition: Petition;
  groups: SubstanceGroup[];
  methodByCode: Map<string, MethodDoc>;
  machineById?: Map<string, MachineItem>;
  dragging: boolean;
  /** หัวหน้า Lab / admin เท่านั้นที่ลากเพื่อมอบหมายได้ */
  canDragRole: boolean;
  /** มีค่าเมื่ออยู่ในช่วงมอบหมายอิสระ — แสดงปุ่ม "รับงาน" */
  onClaim?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  assigned?: boolean;
}

function PetitionCard({
  petition,
  groups,
  methodByCode,
  dragging,
  canDragRole,
  onClaim,
  onDragStart,
  onDragEnd,
  onClick,
  assigned,
}: PetitionCardProps) {
  const statusCfg = labAssignBoardStatusBadge(petition, assigned);
  const showStatusBadge = hasLabTrack(petition);
  const machineCodes = (petition.assignedMachines ?? [])
    .map((m) => m.code)
    .filter(Boolean) as string[];
  const blocked = groups.length === 0 || groups.some((g) => groupHasUnassignable(g, methodByCode));
  const received = !!labReceivedAt(petition);
  const canDrag = canDragRole && received;

  return (
    <Card
      onOpen={onClick}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', petition._id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-lg border-border bg-card p-2.5 text-card-foreground shadow-sm transition hover:border-primary/40 hover:bg-accent/40 hover:shadow',
        canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1.5">
        {canDragRole && (
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="truncate font-semibold text-primary-500 hover:underline"
              onClick={onClick}
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {petition.petitionNo}
            </button>
            <UrgentBadge petition={petition} />
            {showStatusBadge && (
              <Badge variant={statusCfg.variant} className="ml-auto shrink-0">
                {statusCfg.label}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {petition.submittedBy?.name ?? '-'} · {petitionDepartmentLabel(petition)}
          </div>
        </div>
      </div>

      {isLabRecheckPending(petition) && (
        <p className="mt-1 pl-[22px] text-[11px] font-medium text-destructive">
          *งาน Recheck ส่งคำร้องวันที่ {formatThaiDate(petition.createdAt)}
        </p>
      )}

      {groups.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-[22px]">
          {groups.map((group) => (
            <span
              key={group.groupKey}
              className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
              title={group.commonName || group.sampleName}
            >
              <span className="truncate">
                {group.commonName || group.sampleName || '(ไม่มีชื่อ)'}
              </span>
              {sampleSeqLabel(group) && (
                <span className="text-muted-foreground">#{sampleSeqLabel(group)}</span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[22px]">
        {assigned && machineCodes.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Cog className="h-3 w-3 text-muted-foreground" />
            {machineCodes.join(', ')}
          </span>
        )}
        {blocked && (
          <Badge variant="red-soft" className="font-normal">
            ยังตั้ง method ไม่ครบ
          </Badge>
        )}
        {onClaim && !assigned && received && !blocked && (
          <Button
            size="sm"
            variant="primary"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              onClaim();
            }}
          >
            <Hand className="h-3.5 w-3.5" />
            รับงาน
          </Button>
        )}
      </div>
    </Card>
  );
}

// ————————————————————————————————————————————————————————————————
// Machine-picking dialog (opened on drop)
// ————————————————————————————————————————————————————————————————

interface MachineAssignDialogProps {
  petition: Petition | null;
  employee: EmployeeAssignee | null;
  groups: SubstanceGroup[];
  machines: MachineItem[];
  registryMethods: MethodDoc[];
  methodByCode: Map<string, MethodDoc>;
  getSelectedSlotMachines: (petition: Petition, group: SubstanceGroup) => Record<string, string>;
  onSelectMachine: (petitionId: string, groupKey: string, methodCode: string, machineKey: string) => void;
  isGroupSatisfied: (petition: Petition, group: SubstanceGroup) => boolean;
  machineSuggestions: Record<string, MachineSuggestion[]>;
  saving: boolean;
  /** ข้อความปุ่มยืนยัน — ใช้ "รับงาน" ตอนเจ้าหน้าที่รับงานเอง */
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

function MachineAssignDialog({
  petition,
  employee,
  groups,
  machines,
  registryMethods,
  methodByCode,
  getSelectedSlotMachines,
  onSelectMachine,
  isGroupSatisfied,
  machineSuggestions,
  saving,
  confirmLabel,
  onConfirm,
  onClose,
}: MachineAssignDialogProps) {
  const open = !!petition && !!employee;

  const hasUnassignableGroup =
    !!petition && (groups.length === 0 || groups.some((g) => groupHasUnassignable(g, methodByCode)));
  const allSatisfied = !!petition && groups.length > 0 && groups.every((g) => isGroupSatisfied(petition, g));
  const isReassign = !!petition?.assignedTo;

  const disabledReason = hasUnassignableGroup
    ? 'ยังไม่ได้กำหนด method ของสารใน simple method — assign ไม่ได้'
    : !allSatisfied
      ? 'เลือกเครื่องให้ครบทุกสารก่อน'
      : null;
  const confirmDisabled = saving || hasUnassignableGroup || !allSatisfied;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        {petition && employee && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="text-primary-500">{petition.petitionNo}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="inline-flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-green-500" />
                  {employee.name}
                </span>
              </DialogTitle>
              <DialogDescription>
                {employeeLabel(employee)} · {employee.department} — เมื่อยืนยันแล้ว คนนี้จะเป็นผู้รับงานของขั้นนี้
                {isReassign && ' (กำลังเปลี่ยนผู้รับงาน/เครื่อง)'}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {groups.length === 0 ? (
                <div className="rounded-md border border-border py-6 text-center text-sm text-muted-foreground">
                  ไม่มีตัวอย่างให้ assign
                </div>
              ) : (
                groups.map((group) => {
                  const slotMachines = getSelectedSlotMachines(petition, group);
                  const machineMethods = groupMachineMethods(group.slots, methodByCode);
                  const notSet: string[] = [];
                  const benchNotes: { key: string; label: string; substance: string }[] = [];
                  const unknownCodes: { key: string; code: string }[] = [];
                  group.slots.forEach((slot, sIdx) => {
                    if (slot.methods.length === 0) {
                      notSet.push(slot.name || `เครื่องที่ ${sIdx + 1}`);
                      return;
                    }
                    slot.methods.forEach((code) => {
                      const method = methodByCode.get(code);
                      if (!method) {
                        unknownCodes.push({ key: `${sIdx}-${code}`, code });
                      } else if (!method.requiresMachine) {
                        benchNotes.push({ key: `${sIdx}-${code}`, label: method.label, substance: slot.name });
                      }
                    });
                  });
                  const seqLabel = sampleSeqLabel(group);
                  return (
                    <div key={group.groupKey} className="rounded-lg border border-border bg-card p-3 text-card-foreground">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {group.commonName || group.sampleName || '(ไม่มีชื่อ)'}
                        </span>
                        {seqLabel && (
                          <span className="text-xs text-muted-foreground">ตัวอย่าง #{seqLabel}</span>
                        )}
                      </div>

                      {(machineSuggestions[group.groupKey] ?? []).length > 0 && (
                        <div className="mb-2 flex flex-wrap items-center gap-1">
                          <span className="text-[11px] text-muted-foreground">AI แนะนำ:</span>
                          {machineSuggestions[group.groupKey].map((s) => (
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
                                slotLabel={
                                  gm.substanceNames.length > 1
                                    ? `ใช้ร่วม ${gm.substanceNames.length} สาร`
                                    : ''
                                }
                                substanceName={gm.substanceNames.join(', ')}
                                methodLabel={gm.method.label}
                                machines={filteredMachines}
                                selectedId={slotMachines[gm.code] || null}
                                onSelect={(machineKey: string) =>
                                  onSelectMachine(petition._id, group.groupKey, gm.code, machineKey)
                                }
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
                            <div className="truncate font-medium" title={notSet.join(', ')}>
                              {notSet.join(', ')}
                            </div>
                            ยังไม่ได้ตั้ง method ในซิมเปิลเมธอด
                          </div>
                        )}
                        {benchNotes.map((b) => (
                          <Badge
                            key={b.key}
                            variant="gray-soft"
                            className="shrink-0 px-1.5 py-1 text-[10px] font-medium"
                            title={b.substance}
                          >
                            ทำที่โต๊ะ — {b.label}
                          </Badge>
                        ))}
                        {unknownCodes.map((u) => (
                          <Badge
                            key={u.key}
                            variant="red-soft"
                            className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium"
                          >
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
              {disabledReason ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-block">
                      <Button variant="primary" disabled>
                        <ClipboardCheck className="h-4 w-4" />
                        {confirmLabel ?? (isReassign ? 'บันทึก' : 'Assign')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{disabledReason}</TooltipContent>
                </Tooltip>
              ) : (
                <Button variant="primary" disabled={confirmDisabled} onClick={onConfirm}>
                  <ClipboardCheck className="h-4 w-4" />
                  {saving ? 'กำลังบันทึก...' : confirmLabel ?? (isReassign ? 'บันทึก' : 'Assign')}
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
  substanceName: string;    // e.g. "PROPANIL 36%"
  methodLabel: string;      // required method label/code, e.g. "GC", "HPLC"
  readOnly?: boolean;       // locked view — show selection without the picker
}

// One box = one machine slot. Single-select: picking a machine replaces the slot,
// picking the already-selected one clears it.
function SingleMachinePicker({
  machines,
  selectedId,
  onSelect,
  slotLabel,
  substanceName,
  methodLabel,
  readOnly = false,
}: SingleMachinePickerProps) {
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

  if (readOnly) {
    return (
      <div
        title={substanceName}
        className="w-[170px] shrink-0 rounded-md border border-border bg-muted/60 px-2 py-1.5"
      >
        <div className="flex items-center gap-1">
          <span className="truncate text-[11px] font-medium text-foreground">
            {substanceName || slotLabel}
          </span>
          <Badge
            variant="blue-soft"
            className="ml-auto shrink-0 px-1 py-0 text-[9px] font-medium"
          >
            {methodLabel}
          </Badge>
        </div>
        {slotLabel && <div className="text-[9px] text-muted-foreground">{slotLabel}</div>}
        <div className="mt-0.5 flex items-center gap-1">
          <Cog className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span
            className={`truncate text-xs ${
              selected ? 'font-medium text-foreground' : 'text-muted-foreground'
            }`}
          >
            {selected ? machineLabel(selected) : 'ไม่ได้เลือก'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={substanceName}
          className="w-[170px] shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-left text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 data-[state=open]:border-primary"
        >
          <div className="flex items-center gap-1">
            <span className="truncate text-[11px] font-medium text-foreground">
              {substanceName || slotLabel}
            </span>
            <Badge
              variant="blue-soft"
              className="ml-auto shrink-0 px-1 py-0 text-[9px] font-medium"
            >
              {methodLabel}
            </Badge>
          </div>
          {slotLabel && <div className="text-[9px] text-muted-foreground">{slotLabel}</div>}
          <div className="mt-0.5 flex items-center gap-1">
            <Cog className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span
              className={`truncate text-xs ${
                selected ? 'font-medium text-foreground' : 'text-muted-foreground'
              }`}
            >
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
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
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
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-accent ${
                    checked ? 'bg-primary/10' : ''
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                      checked ? 'border-primary' : 'border-border'
                    }`}
                  >
                    {checked && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {machineLabel(machine)}
                    </span>
                    {machine.location && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {machine.location}
                      </span>
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
