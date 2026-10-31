import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FlaskConical, AlertTriangle, RotateCcw, QrCode, PackageOpen } from 'lucide-react';
import { isVisibleInAssignQueue } from '@/lib/petitionQueueVisibility';
import LabScanAcceptModal from '@/components/petition/LabScanAcceptModal';
import { isFreeAssignActive, type LabFreeAssignState } from '@/lib/labFreeAssign';
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
import { isLabWorkAccepted, labReceivedAt, labReceivedBy, labTrackStatusBadge } from '@/lib/receiveStatus';
import { normalizeRoles } from '@/lib/roles';
import { assigneeNamesForUser, isAssignedTo } from '@/lib/assignment';
import { useArrivalFlashId } from '@/hooks/useArrivalFlash';
import { isResearchAndDevelopmentPetition, shouldSendItemToLab } from '@/lib/petitionRouting';
import { isLabAwaitingSgConfirmation } from '@/lib/sgConfirmation';
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
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const canClaimRole = normalizeRoles(user).some((r) => ['admin', 'lab-head', 'lab-analyze'].includes(r));
  const [freeAssign, setFreeAssign] = useState<LabFreeAssignState | null>(null);
  useEffect(() => {
    if (!canClaimRole) return;
    let alive = true;
    const load = () => {
      Promise.resolve()
        .then(() => api.get<LabFreeAssignState>('/petitions/lab-free-assign'))
        .then((res) => { if (alive) setFreeAssign(res.data.data ?? null); })
        .catch(() => { /* ปิดปุ่มไว้ถ้าโหลดสถานะไม่ได้ */ });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', load); };
  }, [canClaimRole]);
  const canReceiveAndClaim = canClaimRole && isFreeAssignActive(freeAssign, new Date());
  const [scanCode, setScanCode] = useState<string | undefined>(undefined);
  // ช่วงมอบหมายอิสระ: โชว์คำร้องที่ส่งตัวอย่างแล้วแต่ Lab ยังไม่รับ ให้ทุกคนกดรับได้
  const { data: awaitingData, refresh: refreshAwaiting } = usePetitionList(
    { page: 1, limit: 100, status: 'sampleSent,pendingReview', search, dept: dept || undefined },
    { enabled: canReceiveAndClaim, refetchOnFocus: true, pollMs: 30_000 },
  );
  const awaitingReceive = canReceiveAndClaim
    ? prioritizeUrgentPetitions((awaitingData?.items ?? []).filter(
      (p) => isVisibleInAssignQueue(p) && !p.assignedTo && !labReceivedAt(p),
    ))
    : [];

  useEffect(() => {
    api.getParameters()
      .then(setLabParameters)
      .catch(() => setParametersError(true))
      .finally(() => setParametersLoaded(true));
  }, []);

  const { data, loading, refresh } = usePetitionList({
    status: 'sampleSent,pendingReview,inProgress,success',
    search,
    dept: dept || undefined,
    assignedToEmployeeId,
    assignedToNames,
    labPending: true,
    limit: 50,
  });

  // หัวหน้า assign แล้ว เจ้าหน้าที่ต้องกดรับงานก่อน จึงเริ่มนับเวลาวิเคราะห์
  const needsAccept = (p: Petition) =>
    !!labReceivedAt(p) && !!p.assignedTo && !isLabWorkAccepted(p)
    && (isFullAccess || isAssignedTo(p.assignedTo, user));

  async function acceptPetition(p: Petition) {
    if (acceptingId) return;
    setAcceptingId(p._id);
    try {
      await api.post<Petition>(`/petitions/${p._id}/accept`, { employeeId: user?.employeeId });
      toast.success(`เริ่มงาน ${p.petitionNo} แล้ว`);
      refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'เริ่มงานไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setAcceptingId(null);
    }
  }

  const petitions: Petition[] = prioritizeUrgentPetitions((data?.items ?? [])
    .filter((p) => !p.labApprovedAt)
    // ตัวอย่างกลุ่มน้ำที่ QC ยังไม่ยืนยันค่า ถพ. ยังไม่ปล่อยมาให้ Lab
    .filter((p) => !isLabAwaitingSgConfirmation(p))
    .filter((p) => hasAssignableLabParameter(p, labParameters, groupMembership))
    .filter((p) => isFullAccess || isAssignedTo(p.assignedTo, user))
    // ช่วงมอบหมายอิสระ งานที่ยังไม่รับตัวอย่างไปอยู่ในกล่อง "รอรับตัวอย่าง" แล้ว
    .filter((p) => !canReceiveAndClaim || p.assignedTo || labReceivedAt(p)));

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
        needsAccept(p) ? (
          <Button
            size="sm"
            disabled={acceptingId === p._id}
            onClick={(e) => {
              e.stopPropagation();
              void acceptPetition(p);
            }}
          >
            {acceptingId === p._id ? 'กำลังเริ่มงาน...' : 'เริ่มงาน'}
          </Button>
        ) : labReceivedAt(p) ? (
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
          actions={canReceiveAndClaim ? (
            <Button variant="primary" onClick={() => { setScanCode(undefined); setScanOpen(true); }}>
              <QrCode className="h-4 w-4" />
              รับตัวอย่าง
            </Button>
          ) : undefined}
        />

        <LabScanAcceptModal
          open={scanOpen}
          claimOnReceive
          initialCode={scanCode}
          onClose={() => setScanOpen(false)}
          onAccepted={() => { refresh(); refreshAwaiting(); }}
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

        {awaitingReceive.length > 0 && (
          <section className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <PackageOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">รอรับตัวอย่าง</h2>
              <Badge variant="gray-soft" className="font-normal">{awaitingReceive.length}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">กดการ์ดเพื่อรับตัวอย่าง งานจะมอบหมายให้คุณทันที</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {awaitingReceive.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => { setScanCode(p.petitionNo); setScanOpen(true); }}
                  className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-primary">{p.petitionNo}</span>
                    <UrgentBadge petition={p} />
                    <Badge variant={labTrackStatusBadge(p).variant} className="ml-auto shrink-0">{labTrackStatusBadge(p).label}</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {p.submittedBy?.name ?? '-'} · {petitionDepartmentLabel(p)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {labItemsFor(p).map((it) => (
                      <span key={it.seq} className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                        {it.commonName || it.sampleName} #{it.seq}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {parametersError && <p role="alert" className="text-sm text-destructive">โหลดพารามิเตอร์ Lab ไม่สำเร็จ กรุณารีเฟรชหน้า</p>}

        <DataTable
          columns={columns}
          data={petitions}
          rowKey={(p) => p._id}
          isLoading={loading || !parametersLoaded}
          rowClassName={(p) => (p._id === flashId ? 'animate-flash-bg' : undefined)}
          onRowClick={(p) => {
            if (labReceivedAt(p) && !needsAccept(p)) navigate(`/lab-testing/${p._id}`);
          }}
          emptyTitle="ไม่มีคำร้อง Lab ที่รอตรวจ"
        />
      </div>
    </AppLayout>
  );
}
