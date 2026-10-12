import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FileText,
  FlaskConical,
  Pencil,
  Printer,
  RotateCcw,
  Sparkles,
  Trash2,
  UserCheck,
} from 'lucide-react';
import AppLayout from '@/components/lis/AppLayout';
import PageHeader from '@/components/lis/PageHeader';
import PetitionStatusTimeline from '@/components/lis/PetitionStatusTimeline';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { petitionStatusBadge } from '@/lib/statusBadge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import PetitionView from '@/components/petition/PetitionView';
import { DevStatusStepper } from '@/components/petition/DevStatusStepper';
import PetitionPrintTemplate from '@/components/petition/PetitionPrintTemplate';
import ResultReportPrintTemplate from '@/components/petition/ResultReportPrintTemplate';
import PrintPreviewDialog from '@/components/lis/PrintPreviewDialog';
import SampleLabelPrintTemplate from '@/components/petition/SampleLabelPrintTemplate';
import AdditionalSampleRequests from '@/components/petition/AdditionalSampleRequests';
import LabResultReportTemplate, { LAB_REPORT_CSS } from '@/components/petition/LabResultReportTemplate';
import {
  usePetition,
  deletePetition,
  useLabRequestsByPetition,
} from '@/hooks/usePetition';
import { PETITION_DEPT_LABELS, type Petition } from '@/types/petition.types';
import { useAuth } from '@/hooks/useAuth';
import { useSamples } from '@/context/SampleContext';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import { normalizeRoles } from "@/lib/roles";
import { api, type ParameterItem } from '@/lib/api';
import type { QCTestResult } from '@/types/petition.types';
import { findSgParameter, type SgParameter } from '@/lib/formSpecificGravity';
import { buildApprovalGroups } from '@/lib/qcApprovalRows';
import { buildLaLisAssistant, type LaLisIssue } from '@/lib/laLisAssistant';
import { buildLabResultReportPages } from '@/lib/labResultReport';
import { canPrintSampleLabel, canPrintPreReport, canPrintLabResult } from '@/lib/petitionPrintability';
import { isVisibleInAssignQueue, isWaitingForAssignment } from '@/lib/petitionQueueVisibility';
import { labReceivedAt } from '@/lib/receiveStatus';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { cn } from '@/lib/utils';

function detailBannerText(petition: Petition) {
  if (petition.status === 'rejected') return 'คำร้องนี้ถูกส่งกลับเพื่อแก้ไข';
  if (isVisibleInAssignQueue(petition) && !labReceivedAt(petition)) return 'คำร้องนี้รอ Lab รับตัวอย่างก่อนมอบหมายผู้รับงาน';
  if (isWaitingForAssignment(petition)) {
    return 'คำร้องนี้รอการมอบหมายผู้รับงาน';
  }
  if (petition.qcReceivedBy || petition.labReceivedBy) {
    return 'คำร้องนี้มีผู้รับผิดชอบแยกตามฝั่ง QC และ Lab แล้ว';
  }
  if (petition.status === 'inProgress') return 'คำร้องนี้อยู่ระหว่างดำเนินการ';
  if (petition.status === 'approved' || petition.status === 'success') return 'คำร้องนี้เสร็จสิ้นแล้ว';
  return 'ตรวจสอบข้อมูลคำร้องและดำเนินการขั้นถัดไป';
}

function detailBannerTone(petition: Petition) {
  if (petition.status === 'rejected') return 'border-orange-200 bg-orange-50 text-orange-800';
  if (isWaitingForAssignment(petition)) {
    return 'border-primary-200 bg-primary-50 text-primary-700';
  }
  if (petition.status === 'approved' || petition.status === 'success') {
    return 'border-green-200 bg-green-50 text-green-700';
  }
  return 'border-grey-200 bg-grey-50 text-grey-700';
}

function displayPerson(name?: string | null) {
  const value = (name ?? '').trim();
  return value || 'ยังไม่มี';
}

function IssueList({ items }: { items: LaLisIssue[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className="flex gap-2 text-sm">
          {item.level === 'danger' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          ) : item.level === 'warn' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          )}
          <span className={item.level === 'danger' ? 'text-red-700' : item.level === 'warn' ? 'text-amber-700' : 'text-grey-600'}>
            {item.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function LaLisAssistantPanel({
  summary,
}: {
  summary: ReturnType<typeof buildLaLisAssistant>;
}) {
  return (
    <Card className="border-primary-100 bg-primary-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary-500" />
          La-LIS Assistant
          <Badge variant={summary.abnormalCount ? 'red-soft' : 'green-soft'}>
            OOS {summary.abnormalCount}
          </Badge>
          <Badge variant={summary.missingResultCount ? 'yellow-soft' : 'green-soft'}>
            Missing {summary.missingResultCount}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-sm font-semibold text-black-700">Report Completeness</p>
          <IssueList items={summary.readiness} />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-black-700">OOS / Deviation</p>
          <IssueList items={summary.oos} />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-black-700">COA Draft Assistant</p>
          <p className="rounded-md border border-primary-100 bg-white/70 p-3 text-sm text-grey-700">
            {summary.draft}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

type PetitionDetailPageProps = {
  mode?: 'petition' | 'result';
};

export default function PetitionDetailPage({ mode = 'petition' }: PetitionDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, error, refresh } = usePetition(id);
  const { user } = useAuth();
  const { refetch: refetchSamples } = useSamples();
  const groupMembership = useItemGroupMembership();
  const { data: labRequests } = useLabRequestsByPetition(data?._id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editReasonOpen, setEditReasonOpen] = useState(false);
  const [editReasonType, setEditReasonType] = useState('กรอกผลผิด');
  const [editReasonOther, setEditReasonOther] = useState('');
  const [deleting, setDeleting] = useState(false);
  const autoPrintDone = useRef(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [labelPrintOpen, setLabelPrintOpen] = useState(false);
  const [preReportOpen, setPreReportOpen] = useState(false);
  const [finalReportOpen, setFinalReportOpen] = useState(false);
  const [labResultOpen, setLabResultOpen] = useState(false);
  // ค่า ถ.พ. บนใบคำขอรับบริการ ดึงจากผล QC + พารามิเตอร์ ถพ. — โหลดแบบ lazy ตอนเปิดพิมพ์
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [qcResults, setQcResults] = useState<QCTestResult[]>([]);
  const [sgParam, setSgParam] = useState<SgParameter | null>(null);
  const [requestValues, setRequestValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!data?._id) return;
    let cancelled = false;
    (async () => {
      try {
        const [results, params] = await Promise.all([
          api.getQCResults(data._id),
          api.getParameters(),
        ]);
        if (cancelled) return;
        setQcResults(results ?? []);
        setParameters(params ?? []);
        const nextSg = findSgParameter(params);
        setSgParam(nextSg);
        const nextValues: Record<string, unknown> = {};
        const sources = params.flatMap((param) => (param.valueFields ?? []).map((field) => ({ label: field.label, source: field.requestValueSource })))
          .filter((entry) => entry.source?.mode === 'collection' && entry.source.collectionName && entry.source.collectionMatchField && entry.source.petitionMatchField && entry.source.valueField);
        for (const { label, source } of sources) {
          const petitionKey = source!.petitionMatchField || 'items.batchNo';
          const readRef = (item: Record<string, unknown>, path: string) => path.replace(/^items\.?/, '').replace(/\[\]/g, '').replace(/^\./, '').split('.').filter(Boolean).reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key], item);
          const refs = (data.items ?? []).map((item) => ({ value: String(readRef(item as Record<string, unknown>, petitionKey) ?? '') }));
          const result = await api.getRequestValues({ collectionName: source!.collectionName!, collectionMatchField: source!.collectionMatchField!, valueField: source!.valueField!, refs });
          for (const [key, value] of Object.entries(result.values ?? {})) nextValues[`${label}\u0000${key}`] = value;
        }
        if (!cancelled) setRequestValues(nextValues);
      } catch {
        /* คอลัมน์ ค่า ถ.พ. ปล่อยว่างถ้าโหลดไม่สำเร็จ */
      }
    })();
    return () => { cancelled = true; };
  }, [data?._id]);

  const assistantGroups = useMemo(
    () => data ? buildApprovalGroups(data, parameters, qcResults, groupMembership) : [],
    [data, parameters, qcResults, groupMembership],
  );
  const laLisSummary = useMemo(
    () => data ? buildLaLisAssistant(data, labRequests, assistantGroups) : null,
    [data, labRequests, assistantGroups],
  );
  const labReportPages = useMemo(
    () => data ? buildLabResultReportPages({ petition: data, labRequests: labRequests ?? [], parameters, qcResults, groupMembership }) : [],
    [data, labRequests, parameters, qcResults, groupMembership],
  );

  useEffect(() => {
    const state = location.state as { autoPrint?: boolean } | null;
    if (state?.autoPrint && data && !loading && !autoPrintDone.current) {
      autoPrintDone.current = true;
      navigate(location.pathname, { replace: true, state: {} });
      setTimeout(() => setLabelPrintOpen(true), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading]);

  async function handleDelete() {
    if (!data) return;
    setDeleting(true);
    try {
      await deletePetition(data._id, user?.name || user?.email);
      refetchSamples();
      navigate('/petition', { replace: true });
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <AppLayout
      className="print:block print:min-h-0 print:bg-white"
      mainClassName="p-4 sm:p-6 overflow-auto print:block print:w-full print:p-0 print:overflow-visible"
    >
      {loading ? (
        <p className="text-grey-500">กำลังโหลดข้อมูล...</p>
      ) : error || !data ? (
        <div className="rounded-[10px] border border-red-500 bg-red-50 p-4 text-sm text-red-500">
          โหลดข้อมูลไม่สำเร็จ: {error ?? 'ไม่พบคำร้อง'}
        </div>
      ) : (
        (() => {
          const statusCfg = petitionStatusBadge(data);
          const isAdmin = normalizeRoles(user).includes('admin');
          const isQcHead = normalizeRoles(user).includes('qc-head');
          const isRequester = user?.name === data.submittedBy?.name;
          const canEdit = data.status === 'deliveringQC' && isRequester;
          const canDelete = isAdmin || (data.status === 'deliveringQC' && isRequester);
          const hasLabRequests = (labRequests?.length ?? 0) > 0;
          const isResultMode = mode === 'result';

          return (
            <div className="space-y-6">
              <div className="print:hidden space-y-6">
                {data.status === 'rejected' && (() => {
                  const rejectEntry = [...(data.reviewHistory ?? [])].reverse().find((e) => e.action === 'reject');
                  const isSubmitter =
                    !!user?.employeeId &&
                    !!data.submittedBy?.employeeId &&
                    user.employeeId === data.submittedBy.employeeId;
                  return (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <RotateCcw className="h-5 w-5 text-orange-500" />
                        <p className="text-sm font-semibold text-orange-800">คำร้องนี้ถูกส่งกลับให้แก้ไข</p>
                      </div>
                      {rejectEntry && (
                        <>
                          <p className="text-xs text-orange-700">
                            ผู้ตรวจสอบ: {rejectEntry.reviewedBy} · เมื่อ{' '}
                            {new Date(rejectEntry.reviewedAt).toLocaleString('th-TH', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </p>
                          {rejectEntry.note && (
                            <p className="text-sm text-black-700 whitespace-pre-wrap rounded border border-orange-200 bg-white px-3 py-2">
                              {rejectEntry.note}
                            </p>
                          )}
                        </>
                      )}
                      {isSubmitter && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => navigate(`/petitions-old/new?revisionOf=${data._id}`)}
                          className="gap-2"
                        >
                          <RotateCcw className="h-4 w-4" />
                          ยื่นแก้ไขใหม่
                        </Button>
                      )}
                    </div>
                  );
                })()}
                <PageHeader
                  onBack={() => navigate(isResultMode ? '/record-results' : '/petition')}
                  title={isResultMode ? `ผลวิเคราะห์ ${data.petitionNo}` : data.petitionNo}
                  actions={
                    <>
                      {!isResultMode && canPrintSampleLabel(data) && (
                        <Button variant="primary-outline" size="sm" onClick={() => setLabelPrintOpen(true)}>
                          <Printer className="h-4 w-4" />
                          พิมพ์ฉลาก
                        </Button>
                      )}
                      {!isResultMode && hasLabRequests && (
                        <Button
                          variant="primary-outline"
                          size="sm"
                          onClick={() => setPrintOpen(true)}
                        >
                          <FileText className="h-4 w-4" />
                          พิมพ์ใบคำขอรับบริการ
                        </Button>
                      )}
                      {canPrintPreReport(data) && (
                        <Button
                          variant="primary-outline"
                          size="sm"
                          onClick={() => setPreReportOpen(true)}
                        >
                          <FileText className="h-4 w-4" />
                          Pre Report
                        </Button>
                      )}
                      {canPrintLabResult(data) && labReportPages.length > 0 && (
                        <Button variant="primary-outline" size="sm" onClick={() => setLabResultOpen(true)}>
                          <FlaskConical className="h-4 w-4" />
                          พิมพ์ผลวิเคราะห์ Lab
                        </Button>
                      )}
                      {data.status === 'approved' && (
                        <Button
                          variant="primary-outline"
                          size="sm"
                          onClick={() => setFinalReportOpen(true)}
                        >
                          <FileCheck2 className="h-4 w-4" />
                          Final Report
                        </Button>
                      )}
                      {!isResultMode && canEdit && (
                        <Button
                          variant="primary-outline"
                          size="sm"
                          onClick={() => navigate(`/petitions-old/${data._id}/edit`)}
                        >
                          <Pencil className="h-4 w-4" />
                          แก้ไข
                        </Button>
                      )}
                      {isResultMode && (isQcHead || isAdmin) && (
                        <Button variant="primary-outline" size="sm" onClick={() => setEditReasonOpen(true)}>
                          <Pencil className="h-4 w-4" />
                          แก้ไขผล (QC Head)
                        </Button>
                      )}
                      {!isResultMode && canDelete && (
                        <Button
                          variant="danger-outline"
                          size="sm"
                          onClick={() => setConfirmDelete(true)}
                        >
                          <Trash2 className="h-4 w-4" />
                          ลบคำร้อง
                        </Button>
                      )}
                    </>
                  }
                />

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <Card className="border-black-50 shadow-none">
                    <CardContent className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">เลขคำร้อง</p>
                        <p className="mt-1 text-lg font-semibold text-black-500">{data.petitionNo}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">สถานะ</p>
                        <div className="mt-1">
                          <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">ผู้ยื่นคำร้อง</p>
                        <p className="mt-1 text-sm text-black-500">{data.submittedBy?.name ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">แผนกผู้ยื่น</p>
                        <p className="mt-1 text-sm text-black-500">{data.submittedBy?.department ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">วัน-เวลาที่ส่งคำร้อง</p>
                        <p className="mt-1 text-sm text-black-500">
                          {new Date(data.submittedBy?.submittedAt ?? data.createdAt).toLocaleString('th-TH', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">แผนก</p>
                        <div className="mt-1">
                          <Badge variant="blue-soft">{petitionDepartmentLabel(data)}</Badge>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">ผู้นำส่ง</p>
                        <p className="mt-1 text-sm text-black-500">
                          {data.deliveredBy?.name ?? data.submittedBy?.name ?? '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-grey-500">วันที่นำส่ง</p>
                        <p className="mt-1 text-sm text-black-500">
                          {data.sampleSentAt
                            ? new Date(data.sampleSentAt).toLocaleString('th-TH', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })
                            : '-'}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-black-50 shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">การดำเนินการต่อ</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className={cn('rounded-xl border px-3 py-2', detailBannerTone(data))}>
                        {detailBannerText(data)}
                      </div>
                      <div className="space-y-1 text-grey-600">
                        <p>แผนกคำร้อง: <span className="font-medium text-black-500">{PETITION_DEPT_LABELS[data.dept]}</span></p>
                        <p>ผู้รับผิดชอบ QC: <span className="font-medium text-black-500">{displayPerson(data.qcReceivedBy)}</span></p>
                        <p>ผู้รับผิดชอบ Lab: <span className="font-medium text-black-500">{displayPerson(data.labReceivedBy)}</span></p>
                      </div>
                      {!isResultMode && !data.assignedTo && isVisibleInAssignQueue(data) && (
                        <Button className="w-full" onClick={() => navigate('/petition/assign')}>
                          <UserCheck className="h-4 w-4" />
                          {labReceivedAt(data) ? 'Assign ผู้รับงาน' : 'รับตัวอย่าง Lab'}
                        </Button>
                      )}
                      {!isResultMode && canEdit && (
                        <Button
                          variant="primary-outline"
                          className="w-full"
                          onClick={() => navigate(`/petitions-old/${data._id}/edit`)}
                        >
                          <Pencil className="h-4 w-4" />
                          แก้ไขคำร้อง
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <AlertDialog
                  open={confirmDelete}
                  onOpenChange={(open) => {
                    if (!open && !deleting) setConfirmDelete(false);
                  }}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>ยืนยันการลบคำร้องนี้?</AlertDialogTitle>
                      <AlertDialogDescription>
                        กำลังจะลบคำร้อง "{data.petitionNo}" — การลบไม่สามารถย้อนกลับได้
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={deleting}
                        onClick={(e) => {
                          e.preventDefault();
                          handleDelete();
                        }}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        {deleting ? 'กำลังลบ...' : 'ยืนยัน'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={editReasonOpen} onOpenChange={setEditReasonOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>ระบุเหตุผลการแก้ไขผล</AlertDialogTitle>
                      <AlertDialogDescription>เหตุผลจะถูกบันทึกในประวัติและแจ้งเตือน QC Head / Admin</AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-3">
                      <label className="space-y-1 text-sm font-medium">
                        เหตุผล
                        <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editReasonType} onChange={(e) => setEditReasonType(e.target.value)}>
                          <option>กรอกผลผิด</option>
                          <option>ทบทวนตามเอกสารต้นฉบับ</option>
                          <option>แก้ไขตามผลการตรวจสอบซ้ำ</option>
                          <option value="อื่นๆ">อื่นๆ</option>
                        </select>
                      </label>
                      {editReasonType === 'อื่นๆ' && <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="ระบุเหตุผลเพิ่มเติม" value={editReasonOther} onChange={(e) => setEditReasonOther(e.target.value)} />}
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                      <AlertDialogAction disabled={editReasonType === 'อื่นๆ' && !editReasonOther.trim()} onClick={() => {
                        const reason = editReasonType === 'อื่นๆ' ? editReasonOther.trim() : editReasonType;
                        setEditReasonOpen(false);
                        navigate(`/record-results/${data._id}?edit=1&reason=${encodeURIComponent(reason)}`);
                      }}>ดำเนินการแก้ไข</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <div className="flex flex-wrap items-baseline gap-3">
                  <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                  <Badge variant="blue-soft">{petitionDepartmentLabel(data)}</Badge>
                  <span className="text-xs text-grey-500">
                    ยื่นเมื่อ{' '}
                    {new Date(data.createdAt).toLocaleString('th-TH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                <PetitionStatusTimeline petition={data} />

                <AdditionalSampleRequests petition={data} />

                <DevStatusStepper petitionId={data._id} status={data.status} onChanged={refresh} />

                {laLisSummary && <LaLisAssistantPanel summary={laLisSummary} />}

                <PetitionView petition={data} />

              </div>

              {hasLabRequests && (
                <PrintPreviewDialog open={printOpen} onOpenChange={setPrintOpen} docType="service-request">
                  <PetitionPrintTemplate labRequest={labRequests![0]} petition={data} qcResults={qcResults} sgParam={sgParam} requestValues={requestValues} />
                </PrintPreviewDialog>
              )}
              {data && (
                <PrintPreviewDialog open={labelPrintOpen} onOpenChange={setLabelPrintOpen} docType="sample-label">
                  <SampleLabelPrintTemplate petition={data} />
                </PrintPreviewDialog>
              )}
              <PrintPreviewDialog open={preReportOpen} onOpenChange={setPreReportOpen} docType="coa">
                <ResultReportPrintTemplate kind="pre" petition={data} labRequests={labRequests ?? []} qcResults={qcResults} />
              </PrintPreviewDialog>
              <PrintPreviewDialog open={finalReportOpen} onOpenChange={setFinalReportOpen} docType="coa">
                <ResultReportPrintTemplate kind="final" petition={data} labRequests={labRequests ?? []} qcResults={qcResults} />
              </PrintPreviewDialog>
              <PrintPreviewDialog open={labResultOpen} onOpenChange={setLabResultOpen} docType="coa" css={LAB_REPORT_CSS}>
                <LabResultReportTemplate pages={labReportPages} />
              </PrintPreviewDialog>
            </div>
          );
        })()
      )}
    </AppLayout>
  );
}
