import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, QrCode, AlertTriangle, RotateCcw, CalendarIcon } from 'lucide-react';
import AppLayout from '@/components/lis/AppLayout';
import { usePetitionList } from '@/hooks/usePetition';
import { api } from '@/lib/api';
import {
  PETITION_DEPT_LABELS,
  type Petition,
  type PetitionDept,
} from '@/types/petition.types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/dateTime';
import QrReceiveModal from '@/components/petition/QrReceiveModal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import PageHeader from '@/components/lis/PageHeader';
import PageToolbar from '@/components/lis/PageToolbar';
import { DataTable, type DataTableColumn } from '@/components/lis/DataTable';
import PetitionStatusTimeline from '@/components/lis/PetitionStatusTimeline';
import { qcReceivedAt, qcReceivedBy, qcTrackStatusBadge } from '@/lib/receiveStatus';
import { useArrivalFlashId } from '@/hooks/useArrivalFlash';
import { isVisibleInQcTestingQueue } from '@/lib/petitionQueueVisibility';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { rankSearchResults } from '@/lib/searchRanking';
import { prioritizeUrgentPetitions } from '@/lib/urgentPetition';
import UrgentBadge from '@/components/lis/UrgentBadge';

type QcTab = 'pending' | 'done';

/** คีย์วันที่ตามเวลาเครื่อง (YYYY-MM-DD) ใช้เทียบกับวันที่ที่เลือก */
function localDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateFromKey(key: string): Date | undefined {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * วันที่ใช้กรองของแต่ละ tab:
 *   เสร็จแล้ว → วันที่ QC บันทึกผลเสร็จ
 *   รอทำ     → วันที่ QC รับตัวอย่าง (ถ้ายังไม่รับ ใช้วันที่ส่งตัวอย่าง/วันที่สร้างคำร้อง)
 */
function qcFilterDateKey(p: Petition): string | null {
  if (p.qcCompletedAt) return localDateKey(p.qcCompletedAt);
  return localDateKey(qcReceivedAt(p) ?? p.sampleSentAt ?? p.createdAt);
}

export default function QCTestingPage() {
  const navigate = useNavigate();
  const flashId = useArrivalFlashId();
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState<PetitionDept | ''>('');
  const [scanOpen, setScanOpen] = useState(false);
  const [tab, setTab] = useState<QcTab>('pending');
  const [selectedDate, setSelectedDate] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const selectedCalendarDate = selectedDate ? dateFromKey(selectedDate) : undefined;

  const { data, loading, refresh } = usePetitionList({
    status: 'sampleSent,pendingReview,inProgress,success',
    search,
    dept: dept || undefined,
    limit: 50,
  });
  const {
    data: staleReceivedData,
    loading: staleReceivedLoading,
    refresh: refreshStaleReceived,
  } = usePetitionList({
    status: 'deliveringQC',
    search,
    dept: dept || undefined,
    limit: 50,
  });

  const visiblePetitions: Petition[] = [
    ...(data?.items ?? []),
    ...(staleReceivedData?.items ?? []),
  ].filter(isVisibleInQcTestingQueue);
  const petitions = prioritizeUrgentPetitions(rankSearchResults(visiblePetitions, search, (petition) => {
    const items = petition.items ?? [];
    const itemNos = items.map((item) => item.itemNo).filter((itemNo) => itemNo?.trim());
    return {
      primary: itemNos.length ? itemNos : [petition.petitionNo],
      secondary: [
        petition.petitionNo,
        ...(petition.prodOrderNos ?? []),
        petition.productionWorkflow?.requestNo,
        petition.productionWorkflow?.lisPetitionNo,
        petition.submittedBy?.name,
        ...items.flatMap((item) => [item.sampleName, item.commonName, item.batchNo, item.lotNo]),
      ],
    };
  }));
  // คำร้องที่ QC ยังไม่รับ → ใช้เป็นตัวเลือกใน Dropdown ของ popup รับตัวอย่าง
  const pendingQcReceive = petitions.filter(
    (p) => !qcReceivedAt(p) && !['success', 'approved', 'rejected'].includes(p.status),
  );

  const datedPetitions = selectedDate
    ? petitions.filter((p) => qcFilterDateKey(p) === selectedDate)
    : petitions;
  const donePetitions = datedPetitions.filter((p) => !!p.qcCompletedAt);
  const waitingPetitions = datedPetitions.filter((p) => !p.qcCompletedAt);
  const shownPetitions = tab === 'done' ? donePetitions : waitingPetitions;

  // Bulk-fetch abnormal flag for petitions that may have results
  // (sampleSent has no results yet, so skip it)
  const [abnormalMap, setAbnormalMap] = useState<Record<string, boolean>>({});
  const [returnedMap, setReturnedMap] = useState<Record<string, boolean>>({});
  const flaggablePetitionIds = petitions
    .filter((p) => !!qcReceivedAt(p))
    .map((p) => p._id);
  const flaggableKey = flaggablePetitionIds.join(',');
  useEffect(() => {
    if (flaggablePetitionIds.length === 0) {
      setAbnormalMap({});
      setReturnedMap({});
      return;
    }
    let alive = true;
    api.getAbnormalFlags(flaggablePetitionIds, { includeRestricted: false })
      .then((map) => { if (alive) setAbnormalMap(map || {}); })
      .catch(() => { if (alive) setAbnormalMap({}); });
    api.getReturnedFlags(flaggablePetitionIds)
      .then((map) => { if (alive) setReturnedMap(map || {}); })
      .catch(() => { if (alive) setReturnedMap({}); });
    return () => { alive = false; };
  }, [flaggableKey]);

  const columns: DataTableColumn<Petition>[] = [
    {
      key: 'petition',
      header: 'คำร้อง',
      className: 'align-top',
      cell: (p) => {
        const items = p.items ?? [];
        return (
          <>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-primary-500">{p.petitionNo}</span>
              <UrgentBadge petition={p} />
              {returnedMap[p._id] && (
                <RotateCcw className="h-4 w-4 text-orange-500 shrink-0" aria-label="ส่งกลับมาบันทึกผลใหม่" />
              )}
              {abnormalMap[p._id] && (
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" aria-label="พบค่าผิดปกติในผลทดสอบ" />
              )}
            </div>
            <div className="text-xs text-grey-500 mt-0.5">
              โดย {p.submittedBy?.name ?? '-'} จาก {petitionDepartmentLabel(p)}
            </div>
            <div className="text-xs text-grey-500 mt-0.5">{items.length} รายการ</div>
          </>
        );
      },
    },
    {
      key: 'items',
      header: 'รายการตัวอย่าง',
      className: 'max-w-[280px] text-sm text-grey-600 align-top',
      cell: (p) => {
        const items = p.items ?? [];
        return items.length > 0 ? (
          <div className="space-y-1">
            {items.map((it) => (
              <div key={it.seq} className="flex items-center gap-1.5 flex-wrap">
                <span>{it.commonName || '-'}</span>
                {it.batchNo && (
                  <Badge variant="blue-soft" className="font-normal text-[11px] px-1.5 py-0">
                    {it.batchNo}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          '-'
        );
      },
    },
    {
      key: 'status',
      header: 'สถานะ',
      className: 'align-top',
      cell: (p) => {
        const b = qcTrackStatusBadge(p);
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={b.variant}>{b.label}</Badge>
            <PetitionStatusTimeline petition={p} compact track="qc" />
            {qcReceivedAt(p) ? (
              <Badge variant="green-soft" className="font-normal">
                รับโดย {qcReceivedBy(p) ?? '-'}
              </Badge>
            ) : (
              <Badge variant="gray-soft" className="font-normal">QC ยังไม่รับ</Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'action',
      header: 'การดำเนินการ',
      className: 'text-right align-top',
      cell: (p) =>
        qcReceivedAt(p) ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/qc-testing/${p._id}`);
            }}
            >
            {p.qcCompletedAt ? 'แก้ไขผล QC' : 'เข้าตรวจ'}
          </Button>
        ) : (
          <span className="text-xs text-grey-400">รอสแกนรับ</span>
        ),
    },
  ];

  return (
    <AppLayout title="การทดสอบ QC">
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary-500" />
            การทดสอบ QC
          </span>
        }
        description={`${shownPetitions.length} รายการ`}
        actions={
          <Button variant="primary" className="gap-2" onClick={() => setScanOpen(true)}>
            <QrCode className="h-4 w-4" />
            รับตัวอย่าง
          </Button>
        }
      />

      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'ค้นหาเลขที่คำร้อง / ชื่อตัวอย่าง...',
        }}
        filters={
          <>
            <Select value={dept || 'all'} onValueChange={(v) => setDept(v === 'all' ? '' : (v as PetitionDept))}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="ทุกแผนก" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกแผนก</SelectItem>
                <SelectItem value="production">{PETITION_DEPT_LABELS.production}</SelectItem>
                <SelectItem value="rm">{PETITION_DEPT_LABELS.rm}</SelectItem>
                <SelectItem value="fg">{PETITION_DEPT_LABELS.fg}</SelectItem>
              </SelectContent>
            </Select>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-label="กรองตามวันที่"
                  className="w-44 justify-start gap-2 font-normal"
                >
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">วันที่:</span>
                  {selectedCalendarDate ? formatDate(selectedCalendarDate) : '-'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedCalendarDate}
                  onSelect={(date) => {
                    setSelectedDate(date ? localDateKey(date) ?? '' : '');
                    setDateOpen(false);
                  }}
                  defaultMonth={selectedCalendarDate ?? new Date()}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {selectedDate ? (
              <Button type="button" variant="ghost" onClick={() => setSelectedDate('')}>
                ล้างวันที่
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as QcTab)}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            รอทำ
            <Badge variant="gray-soft" className="px-1.5 py-0 font-normal">{waitingPetitions.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="done" className="gap-1.5">
            เสร็จแล้ว
            <Badge variant="gray-soft" className="px-1.5 py-0 font-normal">{donePetitions.length}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        data={shownPetitions}
        rowKey={(p) => p._id}
        isLoading={loading || staleReceivedLoading}
        rowClassName={(p) => (p._id === flashId ? 'animate-flash-bg' : undefined)}
        onRowClick={(p) => {
          if (qcReceivedAt(p)) navigate(`/qc-testing/${p._id}`);
        }}
        emptyTitle={tab === 'done' ? 'ไม่มีคำร้องที่ตรวจเสร็จแล้ว' : 'ไม่มีคำร้องที่รอตรวจ'}
      />
    </div>
    <QrReceiveModal
      open={scanOpen}
      pendingPetitions={pendingQcReceive}
      onClose={() => setScanOpen(false)}
      onReceived={() => {
        refresh();
        refreshStaleReceived();
      }}
    />
    </AppLayout>
  );
}
