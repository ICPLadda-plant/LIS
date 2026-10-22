import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, QrCode, AlertTriangle, RotateCcw } from 'lucide-react';
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


export default function QCTestingPage() {
  const navigate = useNavigate();
  const flashId = useArrivalFlashId();
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState<PetitionDept | ''>('');
  const [scanOpen, setScanOpen] = useState(false);

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
        description={`${petitions.length} รายการ`}
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
        }
      />

      <DataTable
        columns={columns}
        data={petitions}
        rowKey={(p) => p._id}
        isLoading={loading || staleReceivedLoading}
        rowClassName={(p) => (p._id === flashId ? 'animate-flash-bg' : undefined)}
        onRowClick={(p) => {
          if (qcReceivedAt(p)) navigate(`/qc-testing/${p._id}`);
        }}
        emptyTitle="ไม่มีคำร้องที่รอตรวจ"
      />
    </div>
    <QrReceiveModal
      open={scanOpen}
      onClose={() => setScanOpen(false)}
      onReceived={() => {
        refresh();
        refreshStaleReceived();
      }}
    />
    </AppLayout>
  );
}
