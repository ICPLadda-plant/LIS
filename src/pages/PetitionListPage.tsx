import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FlaskConical,
  ShieldCheck,
  X,
} from 'lucide-react';
import AppLayout from '@/components/lis/AppLayout';
import PageHeader from '@/components/lis/PageHeader';
import PageToolbar from '@/components/lis/PageToolbar';
import PetitionStatusTimeline from '@/components/lis/PetitionStatusTimeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNotifications } from '@/context/NotificationContext';
import { useAuth } from '@/hooks/useAuth';
import { useCanAccessPath } from '@/hooks/useCanAccessPath';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import { createPetition, usePetitionList } from '@/hooks/usePetition';
import { api, type ParameterItem } from '@/lib/api';
import { getItemNo, getRawCommonName, getSampleName } from '@/lib/masterItemFields';
import { normalizeMasterItemPayload } from '@/lib/petitionMasterItem';
import { parameterNamesForPetition } from '@/lib/petitionTestItems';
import {
  canSeePetition,
  canUserCreatePetition as canUserCreatePetitionShared,
  isLabRole,
  petitionHasLabReadableItem,
} from '@/lib/petitionVisibility';
import { normalizeRoles } from '@/lib/roles';
import { petitionStatusBadge } from '@/lib/statusBadge';
import { formatStockQuantityWithUnit } from '@/lib/stockQuantity';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { rankSearchResults } from '@/lib/searchRanking';
import { formatDate, formatDateTime, formatMonth } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { isQualityControlDepartment } from '@/lib/petitionRouting';
import {
  PETITION_STATUS_CONFIG,
  PETITION_STATUSES,
  type Petition,
  type PetitionRouteTarget,
} from '@/types/petition.types';
import type { SixMonthMedicineStockItem } from '@/types/stock';
import { prioritizeUrgentPetitions } from '@/lib/urgentPetition';
import UrgentBadge from '@/components/lis/UrgentBadge';
import PetitionBatchStatus from '@/components/lis/PetitionBatchStatus';
import { findSgParameter, resolveSpecificGravity } from '@/lib/formSpecificGravity';

const PAGE_SIZE = 20;
const NEW_PETITION_PATH = '/petitions/new';
const FG_WAREHOUSE_DEPARTMENT = 'คลังสินค้า FG';
const QUALITY_RESUBMISSION_WAIT_MONTHS = 6;

// How long a petition arriving from a dashboard drill-down stays visually marked
// before it settles back into an ordinary list card.
const HIGHLIGHT_GLOW_MS = 5000;
const PULL_TO_REFRESH_DEVICE_QUERY = '(max-width: 1023px), (pointer: coarse), (any-pointer: coarse)';
const PULL_TO_REFRESH_THRESHOLD_PX = 72;

const SUMMARY_STATUS_GROUPS: Array<{
  key: string;
  label: string;
  hint: string;
  statuses: Petition['status'][];
}> = [
  { key: '', label: 'ทั้งหมด', hint: 'คำร้องทั้งหมดในมุมมองนี้', statuses: [] },
  { key: 'sampleSent', label: 'รอตรวจรับ', hint: 'งานที่ต้องรับเข้ากระบวนการ', statuses: ['sampleSent'] },
  {
    key: 'pendingReview,inProgress',
    label: 'กำลังดำเนินการ',
    hint: 'งานที่กำลังตรวจวิเคราะห์',
    statuses: ['pendingReview', 'inProgress'],
  },
  { key: 'rejected', label: 'ส่งกลับแก้ไข', hint: 'คำร้องที่รอผู้ยื่นแก้ไข', statuses: ['rejected'] },
];

export function canUserCreatePetition(
  user: { role?: string; roles?: string[] } | null | undefined,
  canAccessNewPetition: boolean,
): boolean {
  return canUserCreatePetitionShared(user, canAccessNewPetition);
}

export type PetitionListPageProps = {
  petitionDetailPath?: (petition: Petition) => string;
  title?: string;
  description?: string;
};

function petitionMetaLine(petition: Petition) {
  return [
    petition.submittedBy?.name,
    petitionDepartmentLabel(petition),
    formatDateTime(petition.createdAt),
  ]
    .filter(Boolean)
    .join(' • ');
}

function formatSixMonthStockDate(value: string) {
  return formatDate(value);
}

function formatSixMonthReferenceMonth(value?: string) {
  if (!value) return '-';
  const date = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return formatMonth(date);
}

function sixMonthStockRowKey(item: SixMonthMedicineStockItem) {
  return `${item.itemNo}-${item.lotNo}-${item.locationCode}-${item.binCode}-${item.registeringDate}`;
}

function sixMonthStockItemNoKey(value?: string | null) {
  return String(value ?? '').trim().toUpperCase();
}

function sixMonthStockValue(value?: string | number | null) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function preferMasterText(masterValue?: string, fallbackValue?: string) {
  return String(masterValue ?? '').trim() || String(fallbackValue ?? '').trim();
}

function sixMonthStockLocation(item: SixMonthMedicineStockItem) {
  return [item.locationCode, item.binCode].map(sixMonthStockValue).join(' / ');
}

function buildSixMonthMasterItemLookup(payload: unknown) {
  const lookup = new Map<string, { commonName: string; itemName: string }>();
  normalizeMasterItemPayload(payload).forEach((item) => {
    const key = sixMonthStockItemNoKey(getItemNo(item));
    if (!key) return;
    lookup.set(key, {
      commonName: getRawCommonName(item),
      itemName: getSampleName(item),
    });
  });
  return lookup;
}

function enrichSixMonthStockItem(
  item: SixMonthMedicineStockItem,
  masterItemLookup: Map<string, { commonName: string; itemName: string }>,
): SixMonthMedicineStockItem {
  const masterItem = masterItemLookup.get(sixMonthStockItemNoKey(item.itemNo));
  if (!masterItem) return item;
  return {
    ...item,
    commonName: preferMasterText(masterItem.commonName, item.commonName),
    itemName: preferMasterText(masterItem.itemName, item.itemName),
  };
}

function sixMonthStockSampleName(item: SixMonthMedicineStockItem) {
  return [item.itemName, item.commonName, item.itemNo].map(sixMonthStockValue).find((value) => value !== '-') || 'รายการยา';
}

function firstPetitionItem(petition: Petition) {
  return petition.items[0];
}

function petitionItemCountLabel(petition: Petition) {
  return petition.items.length > 1 ? ` +${petition.items.length - 1} รายการ` : '';
}

function petitionBatchLotLabel(petition: Petition) {
  const firstItem = firstPetitionItem(petition);
  return [firstItem?.batchNo, firstItem?.lotNo].filter(Boolean).join(' / ') || '-';
}

function sixMonthStockLotKey(value?: string | null) {
  return String(value ?? '').trim().toUpperCase();
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function parseValidDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildRecentQualityLotKeys(petitions: Petition[], currentDate: Date) {
  const lotKeys = new Set<string>();
  petitions.forEach((petition) => {
    const submittedAt = parseValidDate(petition.submittedBy?.submittedAt) ?? parseValidDate(petition.createdAt);
    if (!submittedAt) return;
    if (currentDate >= addMonths(submittedAt, QUALITY_RESUBMISSION_WAIT_MONTHS)) return;

    petition.items.forEach((item) => {
      const lotKey = sixMonthStockLotKey(item.lotNo || item.batchNo);
      if (lotKey) lotKeys.add(lotKey);
    });
  });
  return lotKeys;
}

type SixMonthMedicineTabProps = {
  showFgQualityAlerts: boolean;
};

type SixMonthMedicineStockTabProps = {
  onQualitySubmissionCreated?: () => void;
};

function canUseTouchPullToRefresh() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PULL_TO_REFRESH_DEVICE_QUERY).matches;
}

function findScrollableParent(element: HTMLElement | null) {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

function isAtPullRefreshTop(element: HTMLElement | null) {
  const scrollableParent = findScrollableParent(element);
  if (scrollableParent) return scrollableParent.scrollTop <= 0;
  return window.scrollY <= 0 && document.documentElement.scrollTop <= 0 && document.body.scrollTop <= 0;
}

function useTouchPullToRefresh(onRefresh: () => Promise<unknown>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const armedRef = useRef(false);
  const refreshingRef = useRef(false);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');

  const resetPull = useCallback(() => {
    startYRef.current = null;
    armedRef.current = false;
    if (!refreshingRef.current) setPullState('idle');
  }, []);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1 || refreshingRef.current || !canUseTouchPullToRefresh()) {
      resetPull();
      return;
    }
    if (!isAtPullRefreshTop(rootRef.current)) {
      resetPull();
      return;
    }
    startYRef.current = touch.clientY;
    startXRef.current = touch.clientX;
    armedRef.current = false;
  }, [resetPull]);

  const handleTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const startY = startYRef.current;
    const touch = event.touches[0];
    if (startY === null || !touch) return;
    const deltaY = touch.clientY - startY;
    const deltaX = Math.abs(touch.clientX - startXRef.current);
    if (deltaY <= 0 || deltaX > deltaY || !isAtPullRefreshTop(rootRef.current)) {
      armedRef.current = false;
      setPullState('idle');
      return;
    }
    if (deltaY > 8) event.preventDefault();
    armedRef.current = deltaY >= PULL_TO_REFRESH_THRESHOLD_PX;
    setPullState(armedRef.current ? 'ready' : 'pulling');
  }, []);

  const handleTouchEnd = useCallback(() => {
    const shouldRefresh = armedRef.current && !refreshingRef.current;
    startYRef.current = null;
    armedRef.current = false;
    if (!shouldRefresh) {
      setPullState('idle');
      return;
    }
    refreshingRef.current = true;
    setPullState('refreshing');
    void onRefresh().finally(() => {
      refreshingRef.current = false;
      setPullState('idle');
    });
  }, [onRefresh]);

  return {
    rootRef,
    pullState,
    pullMessage:
      pullState === 'refreshing'
        ? 'กำลังรีเฟรช...'
        : pullState === 'ready'
          ? 'ปล่อยเพื่อรีเฟรช'
          : 'ดึงลงเพื่อรีเฟรช',
    pullHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: resetPull,
    },
  };
}

function SixMonthMedicineDetailDrawer({
  item,
  onClose,
}: {
  item: SixMonthMedicineStockItem;
  onClose: () => void;
}) {
  const itemName = sixMonthStockValue(item.itemName);
  const commonName = sixMonthStockValue(item.commonName);
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="break-words text-sm font-medium text-foreground">{value}</div>
    </div>
  );

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b border-border p-6 pr-12 text-left">
          <SheetTitle className="text-xl font-bold text-primary">{sixMonthStockValue(item.itemNo)}</SheetTitle>
          <SheetDescription className="sr-only">รายละเอียดสต๊อกยาเกิน 6 เดือน</SheetDescription>
          <p className="text-sm text-muted-foreground">{itemName}</p>
        </SheetHeader>

        <div className="flex-1 space-y-6 p-6">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ข้อมูลหลัก</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="commonname" value={commonName} />
              <Field label="Lot" value={sixMonthStockValue(item.lotNo)} />
              <Field label="Registering Date" value={formatSixMonthStockDate(item.registeringDate)} />
              <Field label="อายุ (เดือน)" value={<Badge variant="outline">{item.ageMonths}</Badge>} />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ข้อมูลคลัง</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Stock Qty" value={formatStockQuantityWithUnit(item.stockQty, item.unit)} />
              <Field label="Stock Qty Base" value={formatStockQuantityWithUnit(item.stockQtyBase, item.unit)} />
              <Field label="ตำแหน่ง" value={sixMonthStockLocation(item)} />
              <Field label="Company" value={sixMonthStockValue(item.companySource)} />
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SixMonthMedicineStockTab({ onQualitySubmissionCreated }: SixMonthMedicineStockTabProps = {}) {
  const { user } = useAuth();
  const [sixMonthSearch, setSixMonthSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'rm' | 'fg'>('all');
  const [selectedItem, setSelectedItem] = useState<SixMonthMedicineStockItem | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [localSubmittedQualityLotKeys, setLocalSubmittedQualityLotKeys] = useState<Set<string>>(() => new Set());
  const [isSubmittingQuality, setIsSubmittingQuality] = useState(false);
  const [qualitySubmitError, setQualitySubmitError] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['stock', 'medicine-six-months'],
    queryFn: api.getSixMonthMedicineStock,
    staleTime: 5 * 60 * 1000,
  });
  const { data: masterItemsPayload, refetch: refetchMasterItems } = useQuery({
    queryKey: ['master-items', 'six-month-medicine-commonname'],
    queryFn: async () => {
      const res = await api.get<unknown>('/master-items');
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const { data: fgQualityPetitionData } = usePetitionList({ dept: 'fg', limit: 100 });
  const pullToRefresh = useTouchPullToRefresh(async () => {
    await Promise.all([refetch(), refetchMasterItems()]);
  });
  const masterItemLookup = useMemo(
    () => buildSixMonthMasterItemLookup(masterItemsPayload),
    [masterItemsPayload],
  );
  const stockItems = useMemo(
    () => (data?.items ?? []).map((item) => enrichSixMonthStockItem(item, masterItemLookup)),
    [data?.items, masterItemLookup],
  );
  const qualityCooldownLotKeys = useMemo(() => {
    const serverDate = parseValidDate(data?.serverTime) ?? new Date();
    const recentLotKeys = buildRecentQualityLotKeys(fgQualityPetitionData?.items ?? [], serverDate);
    localSubmittedQualityLotKeys.forEach((lotKey) => recentLotKeys.add(lotKey));
    return recentLotKeys;
  }, [data?.serverTime, fgQualityPetitionData?.items, localSubmittedQualityLotKeys]);
  const availableStockItems = useMemo(
    () => stockItems.filter((item) => !qualityCooldownLotKeys.has(sixMonthStockLotKey(item.lotNo))),
    [qualityCooldownLotKeys, stockItems],
  );
  const filtered = useMemo(() => {
    const q = sixMonthSearch.trim().toLowerCase();
    const matches = availableStockItems.filter((item) => {
      const itemNo = item.itemNo.trim().toUpperCase();
      const matchesKind = kindFilter === 'all'
        || (kindFilter === 'rm' && itemNo.startsWith('R'))
        || (kindFilter === 'fg' && itemNo.startsWith('F'));
      if (!matchesKind) return false;
      if (!q) return true;
      return [
        item.itemNo,
        item.commonName,
        item.lotNo,
      ].some((value) => (value ?? '').toLowerCase().includes(q));
    });
    return rankSearchResults(matches, sixMonthSearch, (item) => ({
      primary: [item.itemNo],
      secondary: [item.commonName, item.lotNo],
    }));
  }, [availableStockItems, sixMonthSearch, kindFilter]);
  const filteredKeys = useMemo(() => filtered.map(sixMonthStockRowKey), [filtered]);
  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((key) => selectedRowKeys.has(key));
  const someFilteredSelected = filteredKeys.some((key) => selectedRowKeys.has(key));
  const selectedItems = useMemo(
    () => availableStockItems.filter((item) => selectedRowKeys.has(sixMonthStockRowKey(item))),
    [availableStockItems, selectedRowKeys],
  );
  const errorMessage = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ';

  const toggleRowSelection = useCallback((item: SixMonthMedicineStockItem, checked: boolean) => {
    const key = sixMonthStockRowKey(item);
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAllFiltered = useCallback((checked: boolean) => {
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      filteredKeys.forEach((key) => {
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }, [filteredKeys]);

  const handleCreateQualityPetition = useCallback(async () => {
    if (selectedItems.length === 0) return;
    setIsSubmittingQuality(true);
    setQualitySubmitError(null);
    const actorName = user?.name?.trim() || user?.email?.trim() || 'system';
    const actorDepartment = user?.department?.trim() || FG_WAREHOUSE_DEPARTMENT;

    try {
      await createPetition({
        dept: 'fg',
        submittedBy: {
          employeeId: user?.employeeId || undefined,
          name: actorName,
          department: actorDepartment,
        },
        deliveredBy: {
          employeeId: user?.employeeId || undefined,
          name: actorName,
        },
        items: selectedItems.map((item, index) => ({
          seq: index + 1,
          sampleName: sixMonthStockSampleName(item),
          commonName: item.commonName || '',
          batchNo: sixMonthStockValue(item.lotNo) !== '-' ? item.lotNo : item.itemNo,
          lotNo: item.lotNo || undefined,
          itemNo: item.itemNo || undefined,
          testItems: 'ส่งตรวจคุณภาพ',
          sendToLab: item.itemNo.trim().toUpperCase().startsWith('F'),
          note: 'ส่งตรวจคุณภาพจากรายการยาเกิน 6 เดือน',
          sampleQuantity: 1,
        })),
        cause: 'ส่งตรวจคุณภาพจากรายการยาเกิน 6 เดือน',
      } as Parameters<typeof createPetition>[0]);
      setLocalSubmittedQualityLotKeys((current) => {
        const next = new Set(current);
        selectedItems.forEach((item) => {
          const lotKey = sixMonthStockLotKey(item.lotNo);
          if (lotKey) next.add(lotKey);
        });
        return next;
      });
      setSelectedRowKeys(new Set());
      onQualitySubmissionCreated?.();
    } catch (submitError) {
      setQualitySubmitError(submitError instanceof Error ? submitError.message : 'ยื่นคำร้องไม่สำเร็จ');
    } finally {
      setIsSubmittingQuality(false);
    }
  }, [onQualitySubmissionCreated, selectedItems, user?.department, user?.email, user?.employeeId, user?.name]);

  return (
    <div ref={pullToRefresh.rootRef} className="space-y-3 overscroll-y-contain" {...pullToRefresh.pullHandlers}>
      <div
        aria-live="polite"
        className={cn(
          'overflow-hidden rounded-xl border border-primary/30 bg-primary/10 text-center text-sm font-medium text-primary transition-all',
          pullToRefresh.pullState === 'idle' ? 'h-0 border-transparent py-0 opacity-0' : 'py-2 opacity-100',
        )}
      >
        {pullToRefresh.pullMessage}
      </div>
      <Card className="border-border shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">รายการยาเกิน 6 เดือน</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onQualitySubmissionCreated && (
              <Button
                type="button"
                size="sm"
                onClick={handleCreateQualityPetition}
                disabled={selectedItems.length === 0 || isSubmittingQuality}
              >
                {isSubmittingQuality ? 'กำลังส่ง...' : `ส่งตรวจคุณภาพ (${selectedItems.length})`}
              </Button>
            )}
            <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as 'all' | 'rm' | 'fg')}>
              <SelectTrigger aria-label="ประเภทสินค้า" className="h-9 w-full sm:w-28"><SelectValue placeholder="ทั้งหมด" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทั้งหมด</SelectItem>
                <SelectItem value="rm">RM</SelectItem>
                <SelectItem value="fg">FG</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={sixMonthSearch}
              onChange={(event) => setSixMonthSearch(event.target.value)}
              placeholder="ค้นหา item / lot / commonname"
              className="h-9 w-full min-w-[220px] sm:w-72"
            />
          </div>
        </CardHeader>
        <CardContent>
          {qualitySubmitError && (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {qualitySubmitError}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  {onQualitySubmissionCreated && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="เลือกทั้งหมดในรายการยาเกิน 6 เดือน"
                        checked={allFilteredSelected ? true : someFilteredSelected ? 'indeterminate' : false}
                        disabled={filteredKeys.length === 0 || isSubmittingQuality}
                        onCheckedChange={(checked) => toggleAllFiltered(checked === true)}
                      />
                    </TableHead>
                  )}
                  <TableHead>Item No</TableHead>
                  <TableHead>commonname</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>Registering Date</TableHead>
                  <TableHead className="text-right">อายุ (เดือน)</TableHead>
                  <TableHead className="text-right">Stock Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={onQualitySubmissionCreated ? 7 : 6} className="py-8 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูล...</TableCell></TableRow>
                ) : isError ? (
                  <TableRow><TableCell colSpan={onQualitySubmissionCreated ? 7 : 6} className="py-8 text-center text-sm text-red-500">{errorMessage}</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={onQualitySubmissionCreated ? 7 : 6} className="py-8 text-center text-sm text-muted-foreground">ไม่มีข้อมูลที่อายุมากกว่า 6 เดือน</TableCell></TableRow>
                ) : filtered.map((item) => (
                  <TableRow
                    key={sixMonthStockRowKey(item)}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => setSelectedItem(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedItem(item);
                      }
                    }}
                  >
                    {onQualitySubmissionCreated && (
                      <TableCell onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`เลือก ${item.itemNo || '-'} ${item.lotNo || '-'}`}
                          checked={selectedRowKeys.has(sixMonthStockRowKey(item))}
                          disabled={isSubmittingQuality}
                          onCheckedChange={(checked) => toggleRowSelection(item, checked === true)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium text-foreground">{item.itemNo || '-'}</TableCell>
                    <TableCell>{item.commonName || '-'}</TableCell>
                    <TableCell>{item.lotNo || '-'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatSixMonthStockDate(item.registeringDate)}</TableCell>
                    <TableCell className="text-right"><Badge variant="outline">{item.ageMonths}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{formatStockQuantityWithUnit(item.stockQty, item.unit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {selectedItem && (
        <SixMonthMedicineDetailDrawer item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  );
}

function FgQualityAlertsTab() {
  const { data, loading, error } = usePetitionList({ dept: 'fg', status: 'deliveringQC', limit: 100 });
  const petitions = data?.items ?? [];

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">แจ้งเตือนส่งตรวจคุณภาพ</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">คำร้อง FG ที่อยู่สถานะกำลังส่งตัวอย่าง</p>
        </div>
        <Badge variant="outline">{petitions.length}</Badge>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>เลขคำร้อง</TableHead>
                <TableHead>ผู้ยื่น</TableHead>
                <TableHead>วันที่ยื่น</TableHead>
                <TableHead>สินค้า</TableHead>
                <TableHead>Batch / Lot</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">กำลังโหลดรายการแจ้งเตือน...</TableCell></TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-red-500">{error}</TableCell></TableRow>
              ) : petitions.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">ไม่มีรายการแจ้งเตือน</TableCell></TableRow>
              ) : petitions.map((petition) => {
                const firstItem = firstPetitionItem(petition);
                return (
                  <TableRow key={petition._id}>
                    <TableCell className="font-medium text-foreground">{petition.petitionNo || '-'}</TableCell>
                    <TableCell>{petition.submittedBy?.name || '-'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatSixMonthStockDate(petition.submittedBy?.submittedAt || petition.createdAt)}</TableCell>
                    <TableCell>{firstItem?.sampleName || '-'}{petitionItemCountLabel(petition)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{petitionBatchLotLabel(petition)}</TableCell>
                    <TableCell><Badge variant="primary-soft">ส่งตรวจคุณภาพ</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SixMonthMedicineTab({ showFgQualityAlerts }: SixMonthMedicineTabProps) {
  const [activeTab, setActiveTab] = useState('six-month-stock');
  if (!showFgQualityAlerts) return <SixMonthMedicineStockTab />;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <TabsList className="w-max">
          <TabsTrigger value="fg-quality-alerts">แจ้งเตือนส่งตรวจคุณภาพ</TabsTrigger>
          <TabsTrigger value="six-month-stock">รายการยาเกิน 6 เดือน</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="fg-quality-alerts" className="mt-0">
        <FgQualityAlertsTab />
      </TabsContent>
      <TabsContent value="six-month-stock" className="mt-0">
        <SixMonthMedicineStockTab onQualitySubmissionCreated={() => setActiveTab('fg-quality-alerts')} />
      </TabsContent>
    </Tabs>
  );
}

export default function PetitionListPage({
  petitionDetailPath = (petition) => `/petition/${petition._id}`,
  title = 'รายการคำร้อง',
  description = 'ดูคำร้องทั้งหมดและงานที่ต้องดำเนินการต่อ',
}: PetitionListPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canAccess = useCanAccessPath();
  const visibleStatuses = PETITION_STATUSES;
  const createdNo = (location.state as { createdNo?: string } | null)?.createdNo;
  const roles = normalizeRoles(user);
  const canViewAll = roles.includes('admin');
  const department = String(user?.department ?? '').trim();
  const canSeeSixMonthMedicineTab = roles.includes('admin') || roles.includes('qc-head') || department === FG_WAREHOUSE_DEPARTMENT;
  const canSeeFgQualityAlertsTab = roles.includes('admin') || department === FG_WAREHOUSE_DEPARTMENT;
  const canCreatePetition = canUserCreatePetition(user, canAccess(NEW_PETITION_PATH));
  const canSeeTestItems = roles.length > 0 && roles.some((r) => r !== 'viewer');
  const groupMembership = useItemGroupMembership();
  const [newPetitionRouteOpen, setNewPetitionRouteOpen] = useState(false);

  const openNewPetition = () => {
    if (isQualityControlDepartment(department)) {
      setNewPetitionRouteOpen(true);
      return;
    }
    navigate(NEW_PETITION_PATH);
  };

  const startNewPetition = (targets: PetitionRouteTarget[]) => {
    setNewPetitionRouteOpen(false);
    navigate(`${NEW_PETITION_PATH}?routeTargets=${targets.join(',')}`);
  };

  const status = searchParams.get('status') ?? '';
  const search =
    searchParams.get('search') ??
    searchParams.get('q') ??
    searchParams.get('petitionNo') ??
    searchParams.get('petition_no') ??
    searchParams.get('petitions_no') ??
    searchParams.get('requestNo') ??
    searchParams.get('request_no') ??
    '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const highlightIds = (searchParams.get('highlight') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const highlightKey = highlightIds.join(',');
  const highlightSet = new Set(highlightIds);

  const selectedStatuses = useMemo<Petition['status'][]>(() => {
    if (!status) return [];
    return status
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is Petition['status'] => visibleStatuses.includes(s as Petition['status']));
  }, [status, visibleStatuses]);

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => setSearchInput(search), [search]);

  const params = useMemo(
    () => ({
      page: canViewAll ? page : 1,
      limit: canViewAll ? PAGE_SIZE : 500,
      status: status || undefined,
      search: search || undefined,
    }),
    [page, status, search, canViewAll],
  );
  const { data, loading, error, refresh } = usePetitionList(params);
  const summaryParams = useMemo(
    () => ({
      page: 1,
      limit: canViewAll ? PAGE_SIZE : 500,
      search: search || undefined,
    }),
    [canViewAll, search],
  );
  const { data: summaryData } = usePetitionList(summaryParams);

  const { data: highlighted = [] } = useQuery({
    queryKey: ['petitions', 'highlight', highlightKey],
    enabled: highlightIds.length > 0,
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/petitions?ids=${encodeURIComponent(highlightKey)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return [];
      const body = await res.json();
      return (body.items ?? []) as Petition[];
    },
  });

  const { push } = useNotifications();
  useEffect(() => {
    if (!user?.employeeId || !data?.items) return;
    for (const petition of data.items) {
      if (petition.status !== 'rejected') continue;
      if (petition.submittedBy?.employeeId !== user.employeeId) continue;
      const rejectEntry = [...(petition.reviewHistory ?? [])].reverse().find((e) => e.action === 'reject');
      if (!rejectEntry) continue;
      push({
        id: `petition-rejected-${petition._id}`,
        title: `คำร้อง ${petition.petitionNo} ถูกส่งกลับให้แก้ไข`,
        message: rejectEntry.note,
        level: 'warning',
        link: `/petition/${petition._id}`,
        persistent: true,
      });
    }
  }, [data?.items, push, user?.employeeId]);

  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [paramsLoaded, setParamsLoaded] = useState(false);
  useEffect(() => {
    if (!canSeeTestItems) {
      setParamsLoaded(true);
      return;
    }
    api.getParameters()
      .then(setParameters)
      .catch(() => {})
      .finally(() => setParamsLoaded(true));
  }, [canSeeTestItems]);

  const isLabUser = normalizeRoles(user).some(isLabRole);
  const displayParameters = useMemo<ParameterItem[]>(
    () =>
      !canViewAll && isLabUser
        ? parameters.filter((p) => p.scope === 'lab' || (p.scope === 'qc' && p.shareWithLab === true))
        : parameters,
    [canViewAll, isLabUser, parameters],
  );

  // Single source of truth for "can this user see this petition" — reused for both
  // the paginated list AND the dashboard-highlight group below, so a shared/bookmarked
  // ?highlight= link can never show a non-admin user a petition outside their scope.
  const applyVisibilityFilter = useCallback(
    (items: Petition[]) => {
      let result = canViewAll ? items : items.filter((petition) => canSeePetition(petition, user));
      if (!canViewAll && isLabUser && paramsLoaded) {
        result = result.filter((petition) =>
          petitionHasLabReadableItem(petition, displayParameters, groupMembership),
        );
      }
      return result;
    },
    [canViewAll, displayParameters, groupMembership, isLabUser, paramsLoaded, user],
  );

  const ownedItems = useMemo(
    () => (data?.items ? prioritizeUrgentPetitions(applyVisibilityFilter(data.items)) : []),
    [applyVisibilityFilter, data?.items],
  );

  const summaryOwnedItems = useMemo(
    () => (summaryData?.items ? applyVisibilityFilter(summaryData.items) : ownedItems),
    [applyVisibilityFilter, ownedItems, summaryData?.items],
  );

  const visibleHighlighted = useMemo(
    () => applyVisibilityFilter(highlighted),
    [applyVisibilityFilter, highlighted],
  );

  const totalCount = canViewAll ? data?.total ?? 0 : ownedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const visibleItems = canViewAll
    ? ownedItems
    : ownedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // The list is server-paginated, so a petition drilled into from the dashboard may
  // well live on another page. Pull it in from the ?ids= fetch and render it at the
  // top of the list as an ordinary card — deduped against the page it may already be on.
  const listItems = useMemo(() => {
    if (visibleHighlighted.length === 0) return visibleItems;
    const pinnedIds = new Set(visibleHighlighted.map((petition) => petition._id));
    return [...visibleHighlighted, ...visibleItems.filter((petition) => !pinnedIds.has(petition._id))];
  }, [visibleHighlighted, visibleItems]);

  // ค่า ถพ. ต่อรายการ (บรรทัดล่างของสถานะราย batch) — ดึงเฉพาะ parameter ถพ. ของคำร้องที่แสดงอยู่
  const sgParameter = useMemo(() => findSgParameter(parameters), [parameters]);
  const listPetitionIds = useMemo(() => listItems.map((petition) => petition._id).join(','), [listItems]);
  const { data: sgResults = [] } = useQuery({
    queryKey: ['petition-list-sg', listPetitionIds, sgParameter?.parameterId],
    enabled: Boolean(sgParameter && listPetitionIds),
    queryFn: () => api.getQCResultsByPetitions(listPetitionIds.split(','), sgParameter ? [sgParameter.parameterId] : []),
    staleTime: 60 * 1000,
  });
  const specificGravityFor = useCallback(
    (petitionId: string) => (seq: number) =>
      resolveSpecificGravity(sgResults.filter((result) => result.petitionId === petitionId), seq, sgParameter),
    [sgParameter, sgResults],
  );

  const [glowing, setGlowing] = useState(true);
  useEffect(() => {
    if (!highlightKey) return;
    setGlowing(true);
    const timer = window.setTimeout(() => setGlowing(false), HIGHLIGHT_GLOW_MS);
    return () => window.clearTimeout(timer);
  }, [highlightKey]);

  const glowAnchorRef = useRef<HTMLDivElement | null>(null);
  const firstHighlightedId = visibleHighlighted[0]?._id;
  useEffect(() => {
    if (!firstHighlightedId) return;
    glowAnchorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [firstHighlightedId]);

  function updateParams(next: Record<string, string | undefined>, options?: { replace?: boolean }) {
    const sp = new URLSearchParams(searchParams);
    // Searching, filtering or paging is the user moving on from whatever the
    // dashboard sent them here to look at — the highlight goes with it.
    if (!('highlight' in next)) sp.delete('highlight');
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    setSearchParams(sp, { replace: options?.replace ?? false });
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    updateParams({ search: value.trim() || undefined, page: undefined }, { replace: true });
  }

  function clearFilters() {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: false });
  }

  const hasFilters = !!status || !!search;
  const emptyTitle = hasFilters
    ? 'ไม่พบคำร้องตามเงื่อนไขที่ค้นหา'
    : canViewAll
      ? 'ยังไม่มีคำร้องในระบบ'
      : 'ยังไม่มีคำร้องที่คุณยื่นหรือได้รับมอบหมาย';

  const summaryTotalCount = canViewAll
    ? summaryData?.summaryTotal ?? summaryData?.total ?? totalCount
    : summaryOwnedItems.length;

  const summaryCards = SUMMARY_STATUS_GROUPS.map((group) => {
    const count = group.statuses.length === 0
      ? summaryTotalCount
      : canViewAll && summaryData?.statusCounts
        ? group.statuses.reduce((sum, statusItem) => sum + (summaryData.statusCounts?.[statusItem] ?? 0), 0)
        : summaryOwnedItems.filter((petition) => group.statuses.includes(petition.status)).length;
    const active =
      (group.key === '' && selectedStatuses.length === 0) ||
      (group.statuses.length > 0 &&
        selectedStatuses.length === group.statuses.length &&
        group.statuses.every((statusItem) => selectedStatuses.includes(statusItem)));
    return { ...group, count, active };
  });

  const renderPetitionCard = (
    petition: Petition,
    isGlowing = false,
    ref?: React.Ref<HTMLDivElement>,
  ) => {
    const statusBadge = petitionStatusBadge(petition);
    const sampleNames = petition.items.map((item) => item.commonName?.trim() || '-');
    const primarySample = sampleNames[0] ?? '-';
    const extraSamples = Math.max(0, petition.items.length - 1);
    const testItems = canSeeTestItems
      ? parameterNamesForPetition(petition, displayParameters)
      : [];

    return (
      <Card
        key={petition._id}
        ref={ref}
        data-highlight={isGlowing ? 'on' : undefined}
        onOpen={() => navigate(petitionDetailPath(petition))}
        className={cn(
          'w-full rounded-2xl border-border p-4 text-left transition duration-700 hover:border-primary/40 hover:bg-accent/50',
          isGlowing && 'border-amber-300 bg-amber-50 ring-2 ring-amber-200 hover:bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10 dark:ring-amber-500/30 dark:hover:bg-amber-500/10',
        )}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-primary-500">{petition.petitionNo}</p>
              <UrgentBadge petition={petition} />
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              <Badge variant="blue-soft">{petitionDepartmentLabel(petition)}</Badge>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{primarySample}</p>
                {extraSamples > 0 && <Badge variant="gray-soft">+อีก {extraSamples}</Badge>}
                <span className="text-xs text-muted-foreground">{petition.items.length} รายการ</span>
              </div>
              {testItems.length > 0 && (
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {testItems.slice(0, 4).join(' • ')}
                  {testItems.length > 4 ? ` • +อีก ${testItems.length - 4}` : ''}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{petitionMetaLine(petition)}</p>
            </div>

            <PetitionStatusTimeline petition={petition} compact />
          </div>
          <PetitionBatchStatus petition={petition} specificGravityFor={specificGravityFor(petition._id)} />
        </div>
      </Card>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          title={title}
          description={description}
          actions={
            canCreatePetition ? (
              <Button onClick={openNewPetition}>
                <FilePlus2 className="h-4 w-4" />
                ยื่นคำร้องใหม่
              </Button>
            ) : undefined
          }
        />

        <Dialog open={newPetitionRouteOpen} onOpenChange={setNewPetitionRouteOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader className="border-b border-border pb-4">
              <DialogTitle>เลือกประเภทการส่งตรวจ</DialogTitle>
              <DialogDescription>เลือกปลายทางที่ต้องการส่งตัวอย่าง</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { targets: ['qc'] as PetitionRouteTarget[], label: 'ส่ง QC', icon: ShieldCheck },
                { targets: ['lab'] as PetitionRouteTarget[], label: 'ส่ง LAB', icon: FlaskConical },
                { targets: ['qc', 'lab'] as PetitionRouteTarget[], label: 'ส่งทั้ง 2', icon: CheckCircle2 },
              ].map(({ targets, label, icon: Icon }) => (
                <button key={label} type="button" onClick={() => startNewPetition(targets)} className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                  <Icon className="h-7 w-7 text-primary" />
                  <span className="font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {createdNo && (
          <div className="rounded-[10px] border border-green-500 bg-green-50 p-3 text-sm text-green-600">
            บันทึกคำร้องเลขที่ <strong>{createdNo}</strong> เรียบร้อยแล้ว
          </div>
        )}
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-red-500 bg-red-50 p-3 text-sm text-red-500">
            <span>โหลดรายการไม่สำเร็จ: {error}</span>
            <Button variant="danger-outline" size="sm" onClick={refresh}>
              ลองใหม่
            </Button>
          </div>
        )}

        <Tabs defaultValue="petitions" className="space-y-4">
          <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
            <TabsList className="w-max">
              <TabsTrigger value="petitions">รายการคำร้อง</TabsTrigger>
              {canSeeSixMonthMedicineTab && (
                <TabsTrigger value="six-month-medicine">List ยา 6 เดือน</TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="petitions" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <Card
              key={card.label}
              onOpen={() => updateParams({ status: card.key || undefined, page: undefined })}
              className={cn(
                "rounded-2xl p-4 text-left transition-all",
                card.active
                  ? "border-primary/50 bg-primary/10 shadow-sm ring-1 ring-primary/20"
                  : "border-border hover:border-primary/40 hover:bg-accent/50",
              )}
            >
              <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{card.count}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
            </Card>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 text-card-foreground">
          <PageToolbar
            search={{
              value: searchInput,
              onChange: handleSearchChange,
              placeholder: 'ค้นหาเลขคำร้อง, ผู้ยื่น, ชื่อตัวอย่าง',
            }}
            filters={
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex h-10 min-w-[210px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      selectedStatuses.length === 0 && 'text-muted-foreground',
                    )}
                  >
                    <span className="truncate text-left">
                      {selectedStatuses.length === 0
                        ? 'สถานะทั้งหมด'
                        : selectedStatuses.length === 1
                          ? PETITION_STATUS_CONFIG[selectedStatuses[0]].label
                          : `เลือก ${selectedStatuses.length} สถานะ`}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
                  <div className="mb-1 flex items-center justify-between border-b border-border px-1 pb-2">
                    <span className="text-xs font-medium text-foreground">เลือกสถานะ</span>
                    {selectedStatuses.length > 0 && (
                      <button
                        type="button"
                        className="text-xs text-primary-500 hover:underline"
                        onClick={() => updateParams({ status: undefined, page: undefined })}
                      >
                        ล้าง
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {visibleStatuses.map((statusItem) => {
                      const checked = selectedStatuses.includes(statusItem);
                      return (
                        <label
                          key={statusItem}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => {
                              const next = value
                                ? [...selectedStatuses, statusItem]
                                : selectedStatuses.filter((item) => item !== statusItem);
                              updateParams({
                                status: next.length ? next.join(',') : undefined,
                                page: undefined,
                              });
                            }}
                          />
                          <span>{PETITION_STATUS_CONFIG[statusItem].label}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            }
            right={
              <>
                {hasFilters && (
                  <Button type="button" variant="ghost" onClick={clearFilters}>
                    <X className="h-4 w-4" />
                    ล้างตัวกรอง
                  </Button>
                )}
              </>
            }
          />
        </div>

        <Card className="border-border shadow-none">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">รายการคำร้อง</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  เลือกคำร้องที่ต้องการดูต่อหรือดำเนินการขั้นถัดไป
                </p>
              </div>
              {data && totalCount > 0 && (
                <span className="text-sm text-muted-foreground">
                  แสดง {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, totalCount)} จาก {totalCount} รายการ
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="rounded-[10px] border border-dashed border-border py-12 text-center text-muted-foreground">
                กำลังโหลดรายการคำร้อง...
              </div>
            ) : listItems.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-border py-12 text-center">
                <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">ลองเปลี่ยนตัวกรองหรือค้นหาด้วยคำอื่น</p>
              </div>
            ) : (
              listItems.map((petition) => {
                const isHighlighted = highlightSet.has(petition._id);
                return renderPetitionCard(
                  petition,
                  isHighlighted && glowing,
                  petition._id === firstHighlightedId ? glowAnchorRef : undefined,
                );
              })
            )}
          </CardContent>
        </Card>

        {data && totalCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              แสดง {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, totalCount)} จาก {totalCount} รายการ
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="primary-outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateParams({ page: String(page - 1) })}
              >
                <ChevronLeft className="h-4 w-4" />
                ก่อนหน้า
              </Button>
              <span className="font-medium text-foreground">
                หน้า {page} / {totalPages}
              </span>
              <Button
                variant="primary-outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => updateParams({ page: String(page + 1) })}
              >
                ถัดไป
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
          </TabsContent>

          {canSeeSixMonthMedicineTab && (
            <TabsContent value="six-month-medicine">
              <SixMonthMedicineTab showFgQualityAlerts={canSeeFgQualityAlertsTab} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
