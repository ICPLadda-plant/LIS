import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Cog,
  GripVertical,
  Hand,
  Inbox,
  QrCode,
  Search,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/lis/AppLayout';
import LabScanAcceptModal from '@/components/petition/LabScanAcceptModal';
import PageHeader from '@/components/lis/PageHeader';
import PageToolbar from '@/components/lis/PageToolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import LabFreeAssignControl from '@/components/petition/LabFreeAssignControl';
import { isFreeAssignActive, type LabFreeAssignState } from '@/lib/labFreeAssign';
import { useAuth } from '@/hooks/useAuth';
import { usePetitionList } from '@/hooks/usePetition';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import { api } from '@/lib/api';
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
import { DEV_MODE, synthesizeDevAssignees } from '@/config/dev';
import { isAssignedTo } from '@/lib/assignment';
import { type MethodDoc } from '@/lib/methodRegistry';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { rankSearchResults } from '@/lib/searchRanking';
import { requestPetitionNotificationsRefresh } from '@/lib/petitionFlowWatcher';
import { cn } from '@/lib/utils';
import {
  type Petition,
  type PetitionAssignee,
} from '@/types/petition.types';
import { isUrgentPetition, prioritizeUrgentPetitions } from '@/lib/urgentPetition';
import UrgentBadge from '@/components/lis/UrgentBadge';

import {
  buildSubstanceGroups,
  groupHasUnassignable,
  sampleSeqLabel,
  type SubstanceGroup,
} from '@/lib/labSubstanceGroups';
import { useLabMethodSlots } from '@/hooks/useLabMethodSlots';

interface EmployeeAssignee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  empType: string;
  isActive: boolean;
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
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

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

  const { data: labParameters = [], isPending: parametersLoading, error: parametersError } = useQuery({
    queryKey: ['assign-lab-parameters'],
    queryFn: () => api.getParameters(),
    staleTime: 5 * 60_000,
  });
  const groupMembership = useItemGroupMembership();
  // method ต่อสาร ใช้แสดงป้าย "ยังตั้ง method ไม่ครบ" บนการ์ด (เลือกเครื่องตอนเริ่มงาน)
  const { methodByCode, commonNameToSlots } = useLabMethodSlots();

  const loading = pendingLoading || inProgressLoading || staleReceivedLoading || recheckLoading || parametersLoading;
  const error = pendingError || inProgressError || staleReceivedError || recheckError || (parametersError instanceof Error ? parametersError.message : null);


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
  // คำร้องที่ Lab ยังไม่รับตัวอย่าง (ทั้งที่ assign แล้วและยังไม่ assign) ใช้เป็นรายการให้สแกนรับ
  const awaitingReceive = useMemo(
    () => visiblePetitions.filter((petition) => !labReceivedAt(petition)),
    [visiblePetitions],
  );

  // มอบหมาย/รับงานได้ทันทีแม้ Lab ยังไม่รับตัวอย่าง — เครื่องมือให้ผู้รับงานเลือกตอนกด "เริ่มงาน"
  async function assignPetition(petition: Petition, employeeId: string, claim = false): Promise<boolean> {
    if (!hasAssignableLabParameter(petition, labParameters, groupMembership)) {
      toast.error('คำร้องนี้ไม่มีพารามิเตอร์ Lab ที่ตรงกับตัวอย่าง');
      return false;
    }
    const employee = claim ? selfEmployee : resolveEmployee(employeeId);
    if (!employee) {
      toast.error('กรุณาเลือกเจ้าหน้าที่');
      return false;
    }
    if (!claim && petition.assignedTo?.employeeId === employee.employeeId) return true;

    setSavingId(petition._id);
    try {
      if (claim) {
        // server ใช้ตัวตนจาก session; employeeId ใช้เฉพาะ role จำลองตอน dev
        await api.post<Petition>('/petitions/' + petition._id + '/claim', { employeeId: employee.employeeId });
      } else {
        await api.patch<Petition>('/petitions/' + petition._id + '/assign', {
          employeeId: employee.employeeId,
          name: employee.name,
          department: employee.department,
          position: employee.position,
        } satisfies PetitionAssignee);
      }
      toast.success(claim
        ? 'รับงาน ' + petition.petitionNo + ' แล้ว กด "เริ่มงาน" ที่หน้าการทดสอบ Lab เพื่อเลือกเครื่อง'
        : 'Assign ' + petition.petitionNo + ' ให้ ' + employee.name + ' แล้ว');
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

  // ผู้รับงานที่ HR ไม่ส่งมาแล้วยังแสดงเป็นคอลัมน์อยู่ — ใช้ข้อมูลที่บันทึกไว้ในคำร้องแทน
  function resolveEmployee(employeeId: string): EmployeeAssignee | null {
    const known = employeeById.get(employeeId);
    if (known) return known;
    const saved = allPetitions.find((petition) => petition.assignedTo?.employeeId === employeeId)?.assignedTo;
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
  }

  function handleDropPetition(petitionId: string, employeeId: string) {
    if (savingId) return;
    const petition = allPetitions.find((p) => p._id === petitionId);
    if (petition) void assignPetition(petition, employeeId);
  }

  function handleClaimPetition(petitionId: string) {
    if (savingId) return;
    const petition = allPetitions.find((p) => p._id === petitionId);
    if (petition) void assignPetition(petition, selfEmployee?.employeeId ?? '', true);
  }

  async function unassignPetition(petitionId: string) {
    const petition = allPetitions.find((p) => p._id === petitionId);
    if (!petition?.assignedTo) return;
    if (petition.assignedTo.acceptedAt) {
      toast.error(`${petition.assignedTo.name} เริ่มงานแล้ว จึงย้ายกลับไปรอมอบหมายไม่ได้`);
      return;
    }
    setSavingId(petition._id);
    try {
      await api.delete<Petition>(`/petitions/${petition._id}/assign`);
      toast.success(`ย้าย ${petition.petitionNo} กลับไปรอมอบหมายแล้ว`);
      requestPetitionNotificationsRefresh();
      refreshPetitions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ยกเลิกการมอบหมายไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  }

  const boardLoading = loading || employeesLoading;

  return (
    <AppLayout>
        <LabScanAcceptModal
          open={scanOpen}
          pendingPetitions={awaitingReceive}
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
              ? 'ลากคำร้องไปวางบนการ์ดเจ้าหน้าที่เพื่อ assign ได้ทันที แม้ยังไม่ส่งหรือยังไม่รับตัวอย่าง เจ้าหน้าที่จะเลือกเครื่องตอนกดเริ่มงาน'
              : canClaim
                ? 'ช่วงมอบหมายอิสระ: กด "รับงาน" ที่คำร้องเพื่อรับงานนั้นเป็นของคุณ แล้วเลือกเครื่องตอนกดเริ่มงาน'
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
                  <p className="font-medium text-foreground">1. เลือกผู้รับงาน</p>
                  <p className="mt-1 text-xs">ลากคำร้องไปวางบนการ์ดเจ้าหน้าที่ได้ทันที แม้ยังไม่ส่งหรือยังไม่รับตัวอย่าง</p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-3">
                  <p className="font-medium text-foreground">2. รับตัวอย่าง Lab</p>
                  <p className="mt-1 text-xs">สแกน QR หรือกรอกเลขคำร้องเมื่อตัวอย่างมาถึง Lab</p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-3">
                  <p className="font-medium text-foreground">3. เริ่มงานและเลือกเครื่อง</p>
                  <p className="mt-1 text-xs">ผู้รับงานกด "เริ่มงาน" ที่หน้าการทดสอบ Lab แล้วเลือกเครื่องที่จะใช้เอง</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

          {(error || employeesError) && (
            <div className="rounded-[10px] border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error
                ? `โหลดคำร้องไม่สำเร็จ: ${error}`
                : `โหลดข้อมูลพนักงานไม่สำเร็จ: ${employeesError}`}
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
                      ? 'ลาก assign ได้ทุกใบ เครื่องมือเลือกตอนเริ่มงาน'
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
                canAssign={canManage}
                selfEmployee={canManage ? null : selfEmployee}
                canClaim={canClaim}
                onDropPetition={handleDropPetition}
                onUnassignPetition={unassignPetition}
                onClaimPetition={handleClaimPetition}
                onPetitionClick={(id) => navigate(`/petition/${id}`)}
                emptyPoolText="ไม่มีคำร้องที่รอ assign"
              />
            </div>
          </div>
        </div>

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
  canAssign: boolean;
  /** เจ้าหน้าที่ Lab ที่ไม่ใช่หัวหน้า: แสดงเฉพาะช่องงานของตัวเอง */
  selfEmployee?: EmployeeAssignee | null;
  canClaim: boolean;
  onDropPetition: (petitionId: string, employeeId: string) => void;
  onUnassignPetition: (petitionId: string) => void;
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
  canAssign,
  selfEmployee,
  canClaim,
  onDropPetition,
  onUnassignPetition,
  onClaimPetition,
  onPetitionClick,
  emptyPoolText,
}: AssignBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overEmployee, setOverEmployee] = useState<string | null>(null);
  const [overPool, setOverPool] = useState(false);

  const unassigned = useMemo(() => sortAssignQueue(petitions.filter((p) => !p.assignedTo)), [petitions]);
  // ลากมอบหมายได้ทุกใบ รวมใบที่ยังไม่ส่ง/ยังไม่รับตัวอย่าง (ป้ายสถานะบนการ์ดบอกว่ายังรอตัวอย่าง)
  const readyToAssign = unassigned;

  const renderPoolCard = (petition: Petition) => (
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
  );

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
    if (selfEmployee) {
      // ใช้ isAssignedTo (รหัสพนักงานก่อน แล้วชื่อ รวมชื่อแฝงของ dev role) เหมือนหน้า Lab
      const selfId = [...assignedByEmployee.entries()]
        .find(([, list]) => isAssignedTo(list[0].assignedTo, selfEmployee))?.[0]
        || selfEmployee.employeeId;
      return [{
        employeeId: selfId,
        name: selfEmployee.name,
        department: employees.find((e) => e.employeeId === selfId)?.department ?? selfEmployee.department,
      }];
    }
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
  }, [employees, assignedByEmployee, selfEmployee]);

  function handleDrop(employeeId: string) {
    if (draggingId) onDropPetition(draggingId, employeeId);
    setDraggingId(null);
    setOverEmployee(null);
  }

  // งานที่มอบหมายแล้วแต่เจ้าหน้าที่ยังไม่กดรับ ลากกลับมาที่ "งานรอมอบหมาย" ได้
  const draggingAssigned = draggingId
    ? petitions.find((p) => p._id === draggingId && p.assignedTo && !p.assignedTo.acceptedAt)
    : undefined;

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
      <div
        onDragOver={(e) => {
          if (!canAssign || !draggingAssigned) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!overPool) setOverPool(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverPool(false);
        }}
        onDrop={(e) => {
          if (!canAssign || !draggingAssigned) return;
          e.preventDefault();
          onUnassignPetition(draggingAssigned._id);
          setDraggingId(null);
          setOverPool(false);
        }}
        className={cn(
          'rounded-[10px] border bg-muted/50 p-3 transition-colors',
          overPool ? 'border-primary/60 bg-primary/10 ring-2 ring-primary/30' : 'border-border',
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">งานรอมอบหมาย</span>
          <Badge variant="gray-soft" className="ml-auto font-normal">
            {readyToAssign.length}
          </Badge>
        </div>
        <div className="max-h-[72vh] space-y-2 overflow-y-auto pr-0.5">
          {readyToAssign.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
              {emptyPoolText}
            </div>
          ) : (
            readyToAssign.map(renderPoolCard)
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
  // ลากได้ทุกใบ (รวมใบที่ยังไม่ส่ง/ยังไม่รับตัวอย่าง); เปลี่ยนผู้รับงานแล้วคนใหม่ต้องกดเริ่มงานเอง
  const canDrag = canDragRole;

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
        {onClaim && !assigned && (
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
