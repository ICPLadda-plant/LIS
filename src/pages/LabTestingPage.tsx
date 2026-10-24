import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, AlertTriangle, RotateCcw } from 'lucide-react';
import AppLayout from '@/components/lis/AppLayout';
import { usePetitionList } from '@/hooks/usePetition';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { hasAssignableLabParameter } from '@/lib/petitionTestItems';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import {
  PETITION_DEPT_LABELS,
  type Petition,
  type PetitionDept,
} from '@/types/petition.types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { labReceivedAt, labReceivedBy, labTrackStatusBadge } from '@/lib/receiveStatus';
import { normalizeRoles } from '@/lib/roles';
import { assigneeNamesForUser, isAssignedTo } from '@/lib/assignment';
import { useArrivalFlashId } from '@/hooks/useArrivalFlash';
import { isResearchAndDevelopmentPetition, shouldSendItemToLab } from '@/lib/petitionRouting';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { prioritizeUrgentPetitions } from '@/lib/urgentPetition';
import UrgentBadge from '@/components/lis/UrgentBadge';

const FULL_ACCESS_ROLES = new Set(['admin', 'lab-head']);

const labItemsFor = (petition: Petition) => (petition.items ?? []).filter(
  (item) => isResearchAndDevelopmentPetition(petition) || shouldSendItemToLab(item),
);

export default function LabTestingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const flashId = useArrivalFlashId();
  const isFullAccess = normalizeRoles(user).some((r) => FULL_ACCESS_ROLES.has(r));
  const assignedToEmployeeId = !isFullAccess ? user?.employeeId?.trim() || undefined : undefined;
  const assignedToNames = !isFullAccess ? assigneeNamesForUser(user) : undefined;
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState<PetitionDept | ''>('');
  const [labParameters, setLabParameters] = useState<Awaited<ReturnType<typeof api.getParameters>>>([]);
  const [parametersLoaded, setParametersLoaded] = useState(false);
  const [parametersError, setParametersError] = useState(false);
  const groupMembership = useItemGroupMembership();

  useEffect(() => {
    api.getParameters()
      .then(setLabParameters)
      .catch(() => setParametersError(true))
      .finally(() => setParametersLoaded(true));
  }, []);

  const { data, loading } = usePetitionList({
    status: 'sampleSent,pendingReview,inProgress,success',
    search,
    dept: dept || undefined,
    assignedToEmployeeId,
    assignedToNames,
    labPending: true,
    limit: 50,
  });

  const petitions: Petition[] = prioritizeUrgentPetitions((data?.items ?? [])
    .filter((p) => !p.labApprovedAt)
    .filter((p) => hasAssignableLabParameter(p, labParameters, groupMembership))
    .filter((p) => isFullAccess || isAssignedTo(p.assignedTo, user)));

  const [abnormalMap, setAbnormalMap] = useState<Record<string, boolean>>({});
  const [returnedMap, setReturnedMap] = useState<Record<string, boolean>>({});
  const flaggablePetitionIds = petitions
    .filter((p) => !!labReceivedAt(p))
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
        const labItems = labItemsFor(p);
        return (
          <>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sky-600">{p.petitionNo}</span>
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
            <div className="text-xs text-grey-500 mt-0.5">{labItems.length} รายการ Lab</div>
            {labReceivedBy(p) && (
              <div className="text-xs text-grey-400 mt-0.5">รับโดย {labReceivedBy(p)}</div>
            )}
          </>
        );
      },
    },
    {
      key: 'items',
      header: 'รายการตัวอย่าง (Lab)',
      className: 'max-w-[280px] text-sm text-grey-600 align-top',
      cell: (p) => {
        const labItems = labItemsFor(p);
        return labItems.length > 0 ? (
          <div className="space-y-1">
            {labItems.map((it) => (
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
        const b = labTrackStatusBadge(p);
        return (
          <div className="space-y-1">
            <Badge variant={b.variant}>{b.label}</Badge>
            <PetitionStatusTimeline petition={p} compact track="lab" />
          </div>
        );
      },
    },
    {
      key: 'action',
      header: 'การดำเนินการ',
      className: 'text-right align-top',
      cell: (p) =>
        labReceivedAt(p) ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/lab-testing/${p._id}`);
            }}
          >
            {p.labCompletedAt ? 'ดูรายละเอียด' : 'เข้าตรวจ'}
          </Button>
        ) : (
          <span className="text-xs text-grey-400">รอสแกนรับ</span>
        ),
    },
  ];

  return (
    <AppLayout title="การทดสอบ Lab">
      <div className="space-y-6">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="h-6 w-6 text-sky-500" />
              การทดสอบ Lab
            </span>
          }
          description={`${petitions.length} รายการ`}
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

        {parametersError && <p role="alert" className="text-sm text-destructive">โหลดพารามิเตอร์ Lab ไม่สำเร็จ กรุณารีเฟรชหน้า</p>}

        <DataTable
          columns={columns}
          data={petitions}
          rowKey={(p) => p._id}
          isLoading={loading || !parametersLoaded}
          rowClassName={(p) => (p._id === flashId ? 'animate-flash-bg' : undefined)}
          onRowClick={(p) => {
            if (labReceivedAt(p)) navigate(`/lab-testing/${p._id}`);
          }}
          emptyTitle="ไม่มีคำร้อง Lab ที่รอตรวจ"
        />
      </div>
    </AppLayout>
  );
}
