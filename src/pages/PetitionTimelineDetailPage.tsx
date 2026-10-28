import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Activity, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, FileCheck2, FileText, FlaskConical, ImageIcon, ListTodo, Printer, RefreshCw, UserRound } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import PrintPreviewDialog from "@/components/lis/PrintPreviewDialog";
import LabResultReportTemplate, { LAB_REPORT_CSS } from "@/components/petition/LabResultReportTemplate";
import PetitionPrintTemplate from "@/components/petition/PetitionPrintTemplate";
import ResultReportPrintTemplate from "@/components/petition/ResultReportPrintTemplate";
import SampleLabelPrintTemplate from "@/components/petition/SampleLabelPrintTemplate";
import AdditionalSampleRequests from "@/components/petition/AdditionalSampleRequests";
import { canPrintAdditionalSamples } from "@/lib/additionalSampleQr";
import GoodsReceiptPrintTemplate, { GOODS_RECEIPT_CSS } from "@/components/warehouse/GoodsReceiptPrintTemplate";
import GoodsReceiptView from "@/components/warehouse/GoodsReceiptView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useItemGroupMembership } from "@/hooks/useItemGroupMembership";
import { useLabRequestsByPetition, usePetition, usePetitionAuditLog } from "@/hooks/usePetition";
import { api, type ParameterItem, type QCProgressEntry } from "@/lib/api";
import type { GoodsReceipt } from "@/types/goodsReceipt.types";
import { findSgParameter } from "@/lib/formSpecificGravity";
import { buildTimelineDetailModel, type TimelineDetailActivity, type TimelineDetailDayRow, type TimelineDetailRow, type TimelineDetailTick } from "@/lib/petitionTimelineDetail";
import { timelineBarClass, timelineDotClass } from "@/lib/petitionTimelineColors";
import { crosshairAt, formatCrosshairTime } from "@/lib/petitionTimelineCrosshair";
import { estimateMetric, formatDateTime, type TimelineMetricTone } from "@/lib/petitionTimelineMetric";
import { canPrintPreReport, canPrintSampleLabel, canPrintLabResult } from "@/lib/petitionPrintability";
import { buildLabResultReportPages } from "@/lib/labResultReport";
import { isResearchAndDevelopmentPetition } from "@/lib/petitionRouting";
import { canSeePetition, isLabRole, petitionHasLabReadableItem } from "@/lib/petitionVisibility";
import { normalizeRoles } from "@/lib/roles";
import { hasLabTrack, petitionStatusBadge } from "@/lib/statusBadge";
import { serviceLabRequestFor } from "@/lib/serviceLabRequest";
import { cn } from "@/lib/utils";

function timelinePercent(value: string | null, startAt: string, endAt: string): number | null {
  if (!value) return null;
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const at = new Date(value).getTime();
  if ([start, end, at].some(Number.isNaN) || end <= start) return null;
  return Math.max(0, Math.min(100, ((at - start) / (end - start)) * 100));
}

function taskStateLabel(state: "pending" | "inProgress" | "recorded" | "approved") {
  if (state === "approved") return "อนุมัติแล้ว";
  if (state === "recorded") return "บันทึกครบ";
  if (state === "inProgress") return "กำลังบันทึก";
  return "รอดำเนินการ";
}

function taskStateClass(state: "pending" | "inProgress" | "recorded" | "approved") {
  if (state === "approved") return "bg-green-100 text-green-700";
  if (state === "recorded") return "bg-blue-100 text-blue-700";
  if (state === "inProgress") return "bg-amber-100 text-amber-700";
  return "bg-grey-100 text-grey-700";
}

function progressFillClass(percent: number) {
  if (percent <= 33) return "bg-red-500";
  if (percent <= 66) return "bg-gradient-to-r from-red-500 to-amber-400";
  return "bg-gradient-to-r from-red-500 via-amber-400 to-green-500";
}

function timelineTickVisibilityClass(index: number, total: number, overview: boolean) {
  if (overview && total > 12) {
    const compactVisible = index === 0 || index === total - 1 || (index % 6 === 0 && index < total - 2);
    return compactVisible ? "" : "hidden";
  }
  if (total <= 7) return "";
  const compactVisible = index === 0 || index === total - 1 || (index % 2 === 0 && index < total - 2);
  return compactVisible ? "" : "hidden 2xl:block";
}

function timelineTickLineClass(index: number, total: number, overview: boolean) {
  if (overview && total > 12 && timelineTickVisibilityClass(index, total, overview) === "hidden") return "hidden";
  return "border-l border-grey-200";
}

function timelineTickPositionClass(left: number, overview: boolean) {
  return left > (overview ? 80 : 92) ? "right-1" : "left-1";
}

function localWorkdayStart(value: Date) {
  const result = new Date(value);
  result.setHours(8, 0, 0, 0);
  return result;
}

function formatOverviewDayTick(value: Date) {
  return value.toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
}

function validTimelineDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// แกนภาพรวมมาร์กเฉพาะ "วันที่" ที่มีกิจกรรมจริง (anchor ที่ 08:00 ตามหลักการเดิม) — ไม่โชว์เวลา
function buildOverviewTicks(rows: TimelineDetailRow[]): TimelineDetailTick[] {
  const actionTimes: Date[] = [];
  for (const row of rows) {
    if (row.kind === "milestone") {
      const at = validTimelineDate(row.at);
      if (at) actionTimes.push(at);
      continue;
    }
    const startAt = validTimelineDate(row.startAt);
    const endAt = row.done ? validTimelineDate(row.endAt) : null;
    if (startAt) actionTimes.push(startAt);
    if (endAt) actionTimes.push(endAt);
  }

  const ticks = new Map<string, TimelineDetailTick>();
  for (const actionTime of actionTimes) {
    const dayStart = localWorkdayStart(actionTime);
    const key = dayStart.toISOString();
    ticks.set(key, { key, at: key, label: formatOverviewDayTick(dayStart) });
  }

  return [...ticks.values()].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

// แท่งที่ "กำลังทำอยู่" เท่านั้นที่วิ่ง shimmer — เงาเป็นสีกลาง ไม่ย้อมทับสีประจำแถวของแต่ละด่าน
const ACTIVE_BAR_CLASS = "overflow-hidden shadow-[0_0_10px_rgba(0,0,0,0.18)] after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-1/2 after:rounded-full after:bg-gradient-to-r after:from-transparent after:via-white/70 after:to-transparent after:content-[''] after:animate-[timeline-shimmer_1.4s_linear_infinite]";

// ป้ายกว้างสุดราว 110px — ถ้าเหลือที่ทางขวาไม่พอ ให้พลิกไปโผล่ฝั่งซ้ายของเมาส์แทน
const CROSSHAIR_LABEL_SPACE = 120;

function isSameCalendarDay(left: Date, right: Date) {
  return left.toDateString() === right.toDateString();
}

// แท่งถูกตัดที่ขอบหน้าต่างของวัน ซึ่งอาจเป็นแค่ขอบเวลาทำการ (17:00) ของวันเดียวกัน —
// จะบอกว่า "ต่อเนื่องข้ามวัน" ได้ต่อเมื่อปลายจริงของแท่งอยู่คนละวันปฏิทินกับแท็บที่กำลังดู
function continuesAcrossCalendarDay(row: TimelineDetailDayRow, dayStartAt: string) {
  const day = validTimelineDate(dayStartAt);
  if (!day) return false;
  const start = validTimelineDate(row.startAt);
  const end = validTimelineDate(row.endAt);
  return (row.continuesBefore && !!start && !isSameCalendarDay(start, day))
    || (row.continuesAfter && !!end && !isSameCalendarDay(end, day));
}

function earliestIso(values: string[]) {
  return values.reduce((earliest, value) => (new Date(value).getTime() < new Date(earliest).getTime() ? value : earliest));
}

function metricHintClass(tone: TimelineMetricTone = "default") {
  if (tone === "danger") return "text-base font-bold text-red-600";
  if (tone === "warning") return "text-base font-bold text-orange-600";
  return "text-xs text-grey-500";
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: TimelineMetricTone }) {
  const visibleHint = label === "Progress" ? undefined : hint;
  return <div className="min-w-0 border-l border-black-50 pl-4 first:border-l-0 first:pl-0"><p className="text-xs text-grey-500">{label}</p><p className="mt-1 truncate text-sm font-semibold text-black-500" title={value}>{value}</p>{visibleHint && <p className={cn("mt-1", metricHintClass(tone))}>{visibleHint}</p>}</div>;
}

function ActivityEntries({ activities }: { activities: TimelineDetailActivity[] }) {
  return <div className="space-y-3">{activities.map((activity) => <div key={activity.key} className="border-b border-black-50 pb-3 last:border-b-0 last:pb-0"><p className="text-sm font-medium text-black-500">{activity.label}</p><div className="mt-1 flex items-center gap-2 text-xs text-grey-500"><UserRound className="h-3.5 w-3.5" /><span>{activity.actor || "ระบบ"}</span><span>{formatDateTime(activity.at)}</span></div></div>)}</div>;
}

const documentButtonClass = "w-full justify-start";
const activityPreviewLimit = 5;
const activityPageSize = 6;
const documentButtonColors = {
  sampleLabel: "border-primary-500 text-primary-500 hover:bg-primary-50",
  serviceRequest: "border-yellow-500 text-yellow-500 hover:bg-yellow-50",
  preReport: "border-green-500 text-green-500 hover:bg-green-50",
  finalReport: "border-red-500 text-red-500 hover:bg-red-50",
  labResult: "border-sky-500 text-sky-500 hover:bg-sky-50",
} as const;

export default function PetitionTimelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const groupMembership = useItemGroupMembership();
  const { data: petition, loading, error, refresh } = usePetition(id);
  const { data: auditLogs, loading: activityLoading, error: activityError, refresh: refreshActivity } = usePetitionAuditLog(petition?._id, 0);
  const { data: labRequests } = useLabRequestsByPetition(petition?._id);
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [progressEntries, setProgressEntries] = useState<QCProgressEntry[]>([]);
  const [parametersLoaded, setParametersLoaded] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskReloadKey, setTaskReloadKey] = useState(0);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [activityPage, setActivityPage] = useState(1);
  const [qcResults, setQcResults] = useState<import("@/types/petition.types").QCTestResult[]>([]);
  const [requestValues, setRequestValues] = useState<Record<string, unknown>>({});
  const [goodsReceipt, setGoodsReceipt] = useState<GoodsReceipt | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [labelPrintOpen, setLabelPrintOpen] = useState(false);
  const [servicePrintOpen, setServicePrintOpen] = useState(false);
  const [preReportOpen, setPreReportOpen] = useState(false);
  const [finalReportOpen, setFinalReportOpen] = useState(false);
  const [labResultOpen, setLabResultOpen] = useState(false);
  const [grPrintOpen, setGrPrintOpen] = useState(false);
  const [activeTimelineDayKey, setActiveTimelineDayKey] = useState<string | null>(null);
  const [activeItemSeq, setActiveItemSeq] = useState<number | null>(null);
  const [crosshair, setCrosshair] = useState<{ percent: number; label: string; x: number; y: number; flip: boolean } | null>(null);
  const timelineAreaRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const documentLoadVersion = useRef(0);
  const documentLoadState = useRef<{ loaded: boolean; promise: Promise<boolean> | null }>({ loaded: false, promise: null });
  const petitionId = petition?._id;
  const roles = normalizeRoles(user);
  const isAdmin = roles.includes("admin");
  const isLabUser = roles.some(isLabRole);

  useEffect(() => {
    if (!petition?._id) {
      setParameters([]);
      setProgressEntries([]);
      setParametersLoaded(false);
      return;
    }
    let alive = true;
    setParametersLoaded(false);
    setTaskError(null);
    setParameters([]);
    setProgressEntries([]);
    Promise.all([api.getParameters(), api.getQCProgress([petition._id])])
      .then(([nextParameters, progress]) => {
        if (!alive) return;
        setParameters(nextParameters ?? []);
        setProgressEntries(progress[petition._id] ?? []);
      })
      .catch((loadError: Error) => {
        if (alive) setTaskError(loadError.message || "โหลดข้อมูล parameter ไม่สำเร็จ");
      })
      .finally(() => {
        if (alive) setParametersLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [petition?._id, taskReloadKey]);

  useEffect(() => {
    if (!petition?._id || !parameters.length) { setRequestValues({}); return; }
    let alive = true;
    const sources = parameters.flatMap((param) => (param.valueFields ?? []).map((field) => ({ label: field.label, source: field.requestValueSource })))
      .filter((entry) => entry.source?.mode === 'collection' && entry.source.collectionName && entry.source.collectionMatchField && entry.source.petitionMatchField && entry.source.valueField);
    (async () => {
      const values: Record<string, unknown> = {};
      for (const { label, source } of sources) {
        const petitionKey = source!.petitionMatchField || 'items.batchNo';
        const readRef = (item: Record<string, unknown>, path: string) => path.replace(/^items\.?/, '').replace(/\[\]/g, '').replace(/^\./, '').split('.').filter(Boolean).reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key], item);
        const refs = (petition.items ?? []).map((item) => ({ value: String(readRef(item as Record<string, unknown>, petitionKey) ?? '') }));
        const result = await api.getRequestValues({ collectionName: source!.collectionName!, collectionMatchField: source!.collectionMatchField!, valueField: source!.valueField!, refs });
        for (const [key, value] of Object.entries(result.values ?? {})) values[`${label}\u0000${key}`] = value;
      }
      if (alive) setRequestValues(values);
    })().catch(() => { if (alive) setRequestValues({}); });
    return () => { alive = false; };
  }, [petition, parameters]);

  // ใบรับสินค้า/ใบตรวจสอบวัตถุดิบ (F-WAR-03-01,02) มีเฉพาะคำร้องแผนก RM — ไม่ยิง fetch เลยสำหรับแผนกอื่น
  useEffect(() => {
    setGoodsReceipt(null);
    if (!petition?._id || petition.dept !== "rm") {
      return;
    }
    let alive = true;
    api.getGoodsReceiptsByPetition(petition._id)
      .then((list) => {
        if (!alive) return;
        setGoodsReceipt(list[0] ?? null);
      })
      .catch(() => {
        if (alive) setGoodsReceipt(null);
      });
    return () => {
      alive = false;
    };
  }, [petition?._id, petition?.dept]);

  useEffect(() => {
    setLabelPrintOpen(false);
    setServicePrintOpen(false);
    setPreReportOpen(false);
    setFinalReportOpen(false);
    setLabResultOpen(false);
    setActiveTimelineDayKey(null);
    setActiveItemSeq(null);
    setActivityDialogOpen(false);
    setActivityPage(1);
    setCrosshair(null);
  }, [id]);

  const visibleParameters = useMemo(() => {
    if (petition && isResearchAndDevelopmentPetition(petition)) {
      return parameters.filter((parameter) => parameter.scope === "lab");
    }
    return !isAdmin && isLabUser
      ? parameters.filter((parameter) => parameter.scope === "lab" || (parameter.scope === "qc" && parameter.shareWithLab === true))
      : parameters;
  }, [isAdmin, isLabUser, parameters, petition]);

  const canViewPetition = useMemo(() => {
    if (!petition || !parametersLoaded) return false;
    if (isAdmin) return true;
    if (!canSeePetition(petition, user)) return false;
    return !isLabUser || petitionHasLabReadableItem(petition, visibleParameters, groupMembership);
  }, [groupMembership, isAdmin, isLabUser, parametersLoaded, petition, user, visibleParameters]);

  const itemSeqs = useMemo(() => (petition?.items ?? []).map((item) => item.seq), [petition]);
  // seq ที่ค้างอยู่อาจหายไปหลังรีเฟรช → ถอยไปตัวแรกเสมอ
  const selectedItemSeq = activeItemSeq != null && itemSeqs.includes(activeItemSeq) ? activeItemSeq : itemSeqs[0] ?? null;

  const model = useMemo(
    () => petition && canViewPetition
      ? buildTimelineDetailModel({ petition, parameters: visibleParameters, progressEntries, auditLogs, itemGroupIds: groupMembership, itemSeq: selectedItemSeq })
      : null,
    [auditLogs, canViewPetition, groupMembership, petition, progressEntries, selectedItemSeq, visibleParameters],
  );

  const serviceLabRequest = useMemo(() => serviceLabRequestFor(petition, labRequests), [petition, labRequests]);
  const labReportPages = useMemo(
    () => (petition ? buildLabResultReportPages({ petition, labRequests: labRequests ?? [], parameters, qcResults, groupMembership }) : []),
    [petition, labRequests, parameters, qcResults, groupMembership],
  );

  const loadDocumentData = useCallback(async (): Promise<boolean> => {
    if (!petitionId) return false;
    if (documentLoadState.current.loaded) return true;
    if (documentLoadState.current.promise) return documentLoadState.current.promise;

    const loadVersion = documentLoadVersion.current;
    setDocumentLoading(true);
    setDocumentError(null);
    const promise = api.getQCResults(petitionId)
      .then((results) => {
        if (documentLoadVersion.current !== loadVersion) return false;
        documentLoadState.current.loaded = true;
        setQcResults(results);
        return true;
      })
      .catch((loadError: unknown) => {
        if (documentLoadVersion.current !== loadVersion) return false;
        setDocumentError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลเอกสารไม่สำเร็จ");
        return false;
      })
      .finally(() => {
        documentLoadState.current.promise = null;
        if (documentLoadVersion.current === loadVersion) setDocumentLoading(false);
      });

    documentLoadState.current.promise = promise;
    return promise;
  }, [petitionId]);

  useEffect(() => {
    documentLoadVersion.current += 1;
    documentLoadState.current = { loaded: false, promise: null };
    setQcResults([]);
    setDocumentLoading(false);
    setDocumentError(null);
    void loadDocumentData();
  }, [loadDocumentData, taskReloadKey]);

  if (loading || (petition && !parametersLoaded)) {
    return <AppLayout><div className="rounded-[8px] border border-dashed border-grey-200 py-12 text-center text-sm text-grey-500">กำลังโหลดข้อมูล Timeline...</div></AppLayout>;
  }

  if (error || !petition) {
    return <AppLayout><div className="flex items-center justify-between gap-3 rounded-[8px] border border-red-200 bg-red-50 p-4 text-sm text-red-600"><span>โหลด Timeline ไม่สำเร็จ: {error ?? "ไม่พบคำร้อง"}</span><Button variant="danger-outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" />ลองใหม่</Button></div></AppLayout>;
  }

  if (!canViewPetition || !model) {
    if (petition.additionalSampleRequests?.length && canPrintAdditionalSamples(petition, user)) {
      return <AppLayout><div className="space-y-4">
        <PageHeader title={petition.petitionNo} onBack={() => navigate('/petition')} />
        <AdditionalSampleRequests petition={petition} />
      </div></AppLayout>;
    }
    return <AppLayout><div className="rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">คุณไม่มีสิทธิ์ดูข้อมูล Timeline ของคำร้องนี้</div></AppLayout>;
  }

  const statusBadge = petitionStatusBadge(petition);
  // คำร้องที่ปิดแล้ว: แท่งที่ไม่มีเวลาจบคือ "รูข้อมูล" ไม่ใช่งานที่ยังวิ่งอยู่ — ห้ามเรืองแสง/วิ่ง shimmer
  const petitionClosed = petition.status === "approved" || petition.status === "rejected";
  const activities = model.activities.slice(0, activityPreviewLimit);
  const activityTotalPages = Math.max(1, Math.ceil(model.activities.length / activityPageSize));
  const currentActivityPage = Math.min(activityPage, activityTotalPages);
  const activityPageStart = (currentActivityPage - 1) * activityPageSize;
  const pagedActivities = model.activities.slice(activityPageStart, activityPageStart + activityPageSize);
  const progressLabel = model.progress.percent == null ? "-" : `${model.progress.percent}%`;
  const progressComplete = model.progress.percent === 100;
  const sgParameter = findSgParameter(parameters);
  // Pre Report ต้องมีผลบันทึกครบทุก track ที่คำร้องนี้มีจริง
  // - มี Lab track: ต้องมีทั้ง qcCompletedAt และ labCompletedAt
  // - ไม่มี Lab track: labCompletedAt ไม่มีวันถูกเขียน (server เขียนเฉพาะตอน Lab บันทึกผล) —
  //   สัญญาณ "ครบ" ของคำร้องแบบนี้คือ qcCompletedAt แล้ว server flip status เป็น success ทันที (isPetitionComplete)
  const canShowPreReport = canPrintPreReport(petition)
    && Boolean(petition.qcCompletedAt)
    && (hasLabTrack(petition) ? Boolean(petition.labCompletedAt) : petition.status === "success");
  const activeItem = model.items.find((item) => item.seq === selectedItemSeq) ?? null;
  const responsibleName = petition.assignedTo?.name || "ยังไม่มอบหมาย";
  const timelineDays = model.timeline.days.length
    ? model.timeline.days
    : [{
        key: "timeline",
        label: "Timeline",
        startAt: model.timeline.startAt,
        endAt: model.timeline.endAt,
        ticks: model.timeline.ticks,
        rows: model.timeline.rows.map((row) => ({
          ...row,
          visible: true,
          segmentStartAt: row.startAt ?? row.at,
          segmentEndAt: row.endAt ?? row.at,
          continuesBefore: false,
          continuesAfter: false,
        })),
      }];
  // แกนของแท็บภาพรวมต้องขยายแบบเดียวกับหน้าต่างของแต่ละวัน — ไม่งั้นกิจกรรมก่อน 08:00
  // (เช่นเริ่ม 06:30) จะถูกหนีบเป็น 0% ไปกองที่ขอบซ้าย
  const overviewStartAt = earliestIso([model.timeline.startAt, ...timelineDays.map((day) => day.startAt)]);
  const timelineTabs = timelineDays.length > 1
    ? [{
        key: "overview",
        label: "ภาพรวม",
        startAt: overviewStartAt,
        endAt: model.timeline.endAt,
        ticks: buildOverviewTicks(model.timeline.rows),
        rows: model.timeline.rows.map((row) => ({
          ...row,
          visible: true,
          segmentStartAt: row.startAt ?? row.at,
          segmentEndAt: row.endAt ?? row.at,
          continuesBefore: false,
          continuesAfter: false,
        })),
      }, ...timelineDays]
    : timelineDays;
  const activeTimelineDay = timelineTabs.find((day) => day.key === activeTimelineDayKey) ?? timelineTabs[0];
  const activeTimelineRows = activeTimelineDay.key === "overview"
    ? activeTimelineDay.rows
    : activeTimelineDay.rows.filter((row) => row.visible);
  const latestTimelineDayKey = timelineDays[timelineDays.length - 1]?.key ?? null;

  const refreshTasks = () => setTaskReloadKey((value) => value + 1);

  function refreshTimeline() {
    refresh();
    refreshActivity();
    refreshTasks();
  }

  function handleTimelineMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const area = timelineAreaRef.current;
    const track = timelineTrackRef.current;
    if (!area || !track) return;

    const point = crosshairAt(event.clientX, track.getBoundingClientRect(), activeTimelineDay.startAt, activeTimelineDay.endAt);
    if (!point) {
      setCrosshair(null);
      return;
    }

    const areaRect = area.getBoundingClientRect();
    setCrosshair({
      percent: point.percent,
      label: formatCrosshairTime(point.at),
      x: event.clientX - areaRect.left,
      y: event.clientY - areaRect.top,
      flip: event.clientX + CROSSHAIR_LABEL_SPACE > areaRect.right,
    });
  }

  async function openDocument(setOpen: (open: boolean) => void) {
    if (await loadDocumentData()) setOpen(true);
  }

  return <AppLayout title={`Timeline ${petition.petitionNo}`}><div className="space-y-4">
    <style>{`@keyframes timeline-shimmer{0%{transform:translateX(-120%)}100%{transform:translateX(220%)}}`}</style>
    <PageHeader title="" onBack={() => navigate("/petition")} actions={<Button variant="primary-outline" size="sm" onClick={refreshTimeline}><RefreshCw className="h-4 w-4" />รีเฟรช</Button>} />

    <Card className="border-black-50 shadow-none"><CardContent className="grid gap-4 p-4 sm:gap-5 sm:p-5 xl:grid-cols-[112px_minmax(0,1fr)]">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center justify-self-start rounded-[8px] border border-dashed border-grey-300 bg-grey-50 text-grey-400 sm:h-24 sm:w-24 xl:h-28 xl:w-28" aria-label="พื้นที่รูปตัวอย่าง"><ImageIcon className="h-8 w-8" /></div>
      <div className="min-w-0 space-y-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            <div aria-label="เลขคำขอ" className="min-w-0">
              <h2 className="truncate text-2xl font-bold leading-tight text-black-500 sm:text-3xl">{petition.petitionNo}</h2>
            </div>
          </div>
          <p className="text-xs text-grey-400">คำร้องโดย {petition.submittedBy?.name || "-"} · ผู้รับผิดชอบ {responsibleName}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Common name" value={activeItem?.commonName || "-"} />
          <Metric label="เลข Batch" value={activeItem?.batchNo || "-"} />
          <Metric label={model.header.startKind === "received" ? "Start time" : "เวลายื่นคำร้อง"} value={formatDateTime(model.header.startAt)} />
          <Metric {...estimateMetric(model.header)} />
          <Metric label="Progress" value={progressLabel} />
        </div>
        {model.progress.percent != null && <div className={cn("relative", progressComplete && "pt-5")}>
          {progressComplete && <span role="status" aria-label="Progress complete" className="absolute right-0 top-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold leading-none text-green-700 shadow-sm after:absolute after:-bottom-1 after:right-3 after:h-2 after:w-2 after:rotate-45 after:border-b after:border-r after:border-green-200 after:bg-green-50 after:content-['']">Complete</span>}
          <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={model.progress.percent} className="h-2 overflow-hidden rounded-full bg-grey-100"><div className={cn("h-full transition-[width]", progressFillClass(model.progress.percent))} style={{ width: `${model.progress.percent}%` }} /></div>
        </div>}
      </div>
    </CardContent></Card>

    <AdditionalSampleRequests petition={petition} />

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {model.items.length > 1 && <div role="tablist" aria-label="ตัวอย่างในคำขอ" className="flex flex-wrap gap-2">
          {model.items.map((item) => <button key={item.seq} type="button" role="tab" aria-selected={item.seq === selectedItemSeq} title={item.label} className={cn("max-w-[240px] truncate rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors", item.seq === selectedItemSeq ? "border-primary-500 bg-primary-50 text-primary-600" : "border-black-50 bg-white text-grey-600 hover:bg-grey-50")} onClick={() => setActiveItemSeq(item.seq)}>{item.label}</button>)}
        </div>}
        <Card aria-label="petition timeline" className="border-black-50 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-primary-500" />Petition Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {timelineTabs.length > 1 && <div role="tablist" aria-label="Timeline days" className="mb-3 flex flex-wrap gap-2">{timelineTabs.map((day) => <button key={day.key} type="button" role="tab" aria-selected={day.key === activeTimelineDay.key} className={cn("rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors", day.key === activeTimelineDay.key ? "border-primary-500 bg-primary-50 text-primary-600" : "border-black-50 bg-white text-grey-600 hover:bg-grey-50")} onClick={() => setActiveTimelineDayKey(day.key)}>{day.label}</button>)}</div>}
            <div
              ref={timelineAreaRef}
              data-testid="timeline-area"
              className="relative"
              onMouseMove={handleTimelineMouseMove}
              onMouseLeave={() => setCrosshair(null)}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-[minmax(5.75rem,7rem)_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                  <div aria-hidden="true" />
                  <div
                    ref={timelineTrackRef}
                    data-testid="timeline-axis"
                    className="relative min-w-0 border-b border-black-50 text-xs text-grey-500 pb-5"
                  >
                    {activeTimelineDay.ticks.map((tick, index) => {
                      const left = timelinePercent(tick.at, activeTimelineDay.startAt, activeTimelineDay.endAt);
                      const isOverview = activeTimelineDay.key === "overview";
                      return left == null ? null : <div key={tick.key} className={cn("absolute top-0 h-full", timelineTickLineClass(index, activeTimelineDay.ticks.length, isOverview))} style={{ left: `${left}%` }}><span className={cn("absolute top-0 whitespace-nowrap", timelineTickPositionClass(left, isOverview), timelineTickVisibilityClass(index, activeTimelineDay.ticks.length, isOverview))}>{tick.label}</span></div>;
                    })}
                  </div>
                </div>
                {activeTimelineRows.map((row) => {
                  const progress = row.visible && row.kind === "milestone" ? timelinePercent(row.at, activeTimelineDay.startAt, activeTimelineDay.endAt) : null;
                  const start = row.visible && row.kind === "bar" ? timelinePercent(row.segmentStartAt, activeTimelineDay.startAt, activeTimelineDay.endAt) : null;
                  const end = row.visible && row.kind === "bar" ? timelinePercent(row.segmentEndAt, activeTimelineDay.startAt, activeTimelineDay.endAt) : null;
                  const width = start != null && end != null ? Math.max(1, end - start) : null;
                  // แท่งจะ "กำลังทำอยู่" ได้ก็ต่อเมื่อคำร้องยังไม่ปิด — ปลายขวาตรง/สีอ่อนยังคงอยู่ทุกกรณีที่ไม่มีเวลาจบ
                  const active = !row.done && !petitionClosed;
                  const activeBubbleLeft = active
                    && row.visible
                    && row.kind === "bar"
                    && end != null
                    && (!row.continuesAfter || activeTimelineDay.key === "overview" || activeTimelineDay.key === latestTimelineDayKey)
                    ? end
                    : null;
                  return <div key={row.key} className="grid grid-cols-[minmax(5.75rem,7rem)_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3"><span className="min-w-0 truncate text-sm text-grey-700" title={row.label}>{row.label}</span><div className="relative min-w-0 h-14 rounded bg-grey-50">{row.visible && row.kind === "milestone" && progress != null && <span aria-label={`${row.label} (จุด)`} className={cn("absolute top-6 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-white", timelineDotClass(row.key, { done: row.done, rejected: petition.status === "rejected" }))} style={{ left: `${progress}%` }} />}{row.visible && row.kind === "bar" && start != null && width != null && <div aria-label={`${row.label} (ช่วงเวลา)`} title={continuesAcrossCalendarDay(row, activeTimelineDay.startAt) ? "ต่อเนื่องข้ามวัน" : undefined} className={cn("absolute top-7 h-5 rounded-full", timelineBarClass(row.key, { done: row.done, rejected: petition.status === "rejected" }), row.continuesBefore && "rounded-l-none", !row.done && "rounded-r-none", active && ACTIVE_BAR_CLASS)} style={{ left: `${start}%`, width: `${width}%` }} />}{activeBubbleLeft != null && <span role="status" aria-label={`กำลังดำเนินการ: ${row.label}`} className={cn("absolute top-0 z-[1] whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-700 shadow-sm after:absolute after:top-full after:h-2 after:w-2 after:rotate-45 after:border-b after:border-r after:border-amber-200 after:bg-amber-50 after:content-['']", activeBubbleLeft > 82 ? "-translate-x-full after:right-3" : activeBubbleLeft < 18 ? "after:left-3" : "-translate-x-1/2 after:left-1/2 after:-translate-x-1/2")} style={{ left: `${activeBubbleLeft}%` }}>กำลังดำเนินการ</span>}</div></div>;
                })}
              </div>
              {crosshair && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
                <div className="grid h-full grid-cols-[minmax(5.75rem,7rem)_minmax(0,1fr)] gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                  <div />
                  <div className="relative h-full">
                    <span data-testid="timeline-crosshair-line" className="absolute inset-y-0 w-px -translate-x-1/2 bg-primary-500/60" style={{ left: `${crosshair.percent}%` }} />
                  </div>
                </div>
                <span
                  data-testid="timeline-crosshair-label"
                  className={cn("absolute whitespace-nowrap rounded bg-black-500 px-1.5 py-0.5 text-[11px] font-medium text-white shadow", crosshair.flip && "-translate-x-full")}
                  style={{ left: `${crosshair.x + (crosshair.flip ? -12 : 12)}px`, top: `${crosshair.y + 12}px` }}
                >{crosshair.label}</span>
              </div>}
            </div>
          </CardContent>
        </Card>

        <Card aria-label="Parameter ที่ต้องตรวจสอบ" className="border-black-50 shadow-none"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ListTodo className="h-4 w-4 text-primary-500" />Parameter ที่ต้องตรวจสอบ</CardTitle></CardHeader><CardContent className="space-y-3">
          {taskError ? <div className="flex items-center justify-between gap-3 rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-600"><span>โหลดข้อมูล parameter ไม่สำเร็จ: {taskError}</span><Button variant="danger-outline" size="sm" onClick={refreshTasks}>ลองใหม่</Button></div> : model.tasks.length === 0 ? <p className="py-4 text-center text-sm text-grey-500">ไม่มี parameter ที่ require สำหรับคำร้องนี้</p> : model.tasks.map((task) => <div key={task.key} className="grid gap-2 border-b border-black-50 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_110px_100px]"><div className="min-w-0"><p className="truncate text-sm font-medium text-black-500">{task.parameterName}</p><p className="mt-1 text-xs text-grey-500">{task.sampleName}</p></div><div className="self-center"><div className="h-2 overflow-hidden rounded-full bg-grey-100"><div className="h-full bg-primary-500" style={{ width: `${(task.filled / task.total) * 100}%` }} /></div><p className="mt-1 text-xs text-grey-500">{task.filled}/{task.total}</p></div><span className={cn("self-center justify-self-start rounded px-2 py-1 text-xs font-medium", taskStateClass(task.state))}>{taskStateLabel(task.state)}</span></div>)}
        </CardContent></Card>

        {petition.dept === "rm" && goodsReceipt && (
          <Card aria-label="ใบรับสินค้า / ใบตรวจสอบวัตถุดิบ" className="border-black-50 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-primary-500" />ใบรับสินค้า / ใบตรวจสอบวัตถุดิบ</CardTitle>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setGrPrintOpen(true)}>
                <Printer className="h-3.5 w-3.5" />พิมพ์ฟอร์ม
              </Button>
            </CardHeader>
            <CardContent><GoodsReceiptView doc={goodsReceipt} /></CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-4">
      <Card aria-label="Recent Activity" className="border-black-50 shadow-none"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary-500" />Recent Activity</CardTitle></CardHeader><CardContent className="space-y-3">
        {activityError ? <div className="space-y-2 rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-600"><p>โหลดกิจกรรมไม่สำเร็จ: {activityError}</p><Button variant="danger-outline" size="sm" onClick={refreshActivity}>ลองใหม่</Button></div> : activityLoading ? <p className="py-4 text-center text-sm text-grey-500">กำลังโหลดกิจกรรม...</p> : activities.length === 0 ? <p className="py-4 text-center text-sm text-grey-500">ยังไม่มีกิจกรรมของคำร้องนี้</p> : <div className="space-y-3">{activities.map((activity) => <div key={activity.key} className="border-b border-black-50 pb-3 last:border-b-0 last:pb-0"><p className="text-sm font-medium text-black-500">{activity.label}</p><div className="mt-1 flex items-center gap-2 text-xs text-grey-500"><UserRound className="h-3.5 w-3.5" /><span>{activity.actor || "ระบบ"}</span><span>{formatDateTime(activity.at)}</span></div></div>)}</div>}
        {model.activities.length > activityPreviewLimit && !activityError && <Button variant="ghost" size="sm" className="w-full" onClick={() => { setActivityPage(1); setActivityDialogOpen(true); }}><ChevronDown className="h-4 w-4" />ดูทั้งหมด</Button>}
      </CardContent></Card>

      <Dialog open={activityDialogOpen} onOpenChange={(open) => { setActivityDialogOpen(open); if (!open) setActivityPage(1); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary-500" />Recent Activity</DialogTitle>
            <DialogDescription>แสดงสูงสุด {activityPageSize} รายการต่อหน้า จากทั้งหมด {model.activities.length} รายการ</DialogDescription>
          </DialogHeader>
          {pagedActivities.length === 0 ? <p className="py-4 text-center text-sm text-grey-500">ยังไม่มีกิจกรรมของคำร้องนี้</p> : <ActivityEntries activities={pagedActivities} />}
          <DialogFooter className="items-center gap-3 sm:justify-between sm:space-x-0">
            <p className="text-xs text-grey-500">หน้า {currentActivityPage} / {activityTotalPages}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentActivityPage <= 1} onClick={() => setActivityPage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4" />ก่อนหน้า</Button>
              <Button variant="outline" size="sm" disabled={currentActivityPage >= activityTotalPages} onClick={() => setActivityPage((page) => Math.min(activityTotalPages, page + 1))}>ถัดไป<ChevronRight className="h-4 w-4" /></Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card aria-label="Documents" className="border-black-50 shadow-none"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-primary-500" />Documents</CardTitle></CardHeader><CardContent className="space-y-2">
        {canPrintSampleLabel(petition) && <Button variant="primary-outline" className={cn(documentButtonClass, documentButtonColors.sampleLabel)} disabled={documentLoading} onClick={() => { void openDocument(setLabelPrintOpen); }}><Printer className="h-4 w-4" />ป้ายนำส่งตัวอย่าง</Button>}
        {serviceLabRequest && <Button variant="primary-outline" className={cn(documentButtonClass, documentButtonColors.serviceRequest)} disabled={documentLoading} onClick={() => { void openDocument(setServicePrintOpen); }}><FileText className="h-4 w-4" />ใบคำขอรับบริการ</Button>}
        {canShowPreReport && <Button variant="primary-outline" className={cn(documentButtonClass, documentButtonColors.preReport)} disabled={documentLoading} onClick={() => { void openDocument(setPreReportOpen); }}><FileText className="h-4 w-4" />Pre Report</Button>}
        {canPrintLabResult(petition) && labReportPages.length > 0 && <Button variant="primary-outline" className={cn(documentButtonClass, documentButtonColors.labResult)} disabled={documentLoading} onClick={() => { void openDocument(setLabResultOpen); }}><FlaskConical className="h-4 w-4" />พิมพ์ผลวิเคราะห์ Lab</Button>}
        {petition.status === "approved" && <Button variant="primary-outline" className={cn(documentButtonClass, documentButtonColors.finalReport)} disabled={documentLoading} onClick={() => { void openDocument(setFinalReportOpen); }}><FileCheck2 className="h-4 w-4" />Final Report</Button>}
        {documentLoading && <p className="text-xs text-grey-500">กำลังโหลดข้อมูลเอกสาร...</p>}
        {documentError && <p className="text-xs text-red-600">โหลดข้อมูลเอกสารไม่สำเร็จ: {documentError}</p>}
      </CardContent></Card>
      </div>
    </div>

    {labelPrintOpen && <PrintPreviewDialog open={labelPrintOpen} onOpenChange={setLabelPrintOpen} docType="sample-label"><SampleLabelPrintTemplate petition={petition} /></PrintPreviewDialog>}
    {servicePrintOpen && serviceLabRequest && <PrintPreviewDialog open={servicePrintOpen} onOpenChange={setServicePrintOpen} docType="service-request"><PetitionPrintTemplate labRequest={serviceLabRequest} petition={petition} qcResults={qcResults} sgParam={sgParameter} requestValues={requestValues} labReportPages={labReportPages} /></PrintPreviewDialog>}
    {preReportOpen && <PrintPreviewDialog open={preReportOpen} onOpenChange={setPreReportOpen} docType="coa"><ResultReportPrintTemplate kind="pre" petition={petition} labRequests={labRequests ?? []} qcResults={qcResults} /></PrintPreviewDialog>}
    {finalReportOpen && <PrintPreviewDialog open={finalReportOpen} onOpenChange={setFinalReportOpen} docType="coa"><ResultReportPrintTemplate kind="final" petition={petition} labRequests={labRequests ?? []} qcResults={qcResults} /></PrintPreviewDialog>}
    {labResultOpen && <PrintPreviewDialog open={labResultOpen} onOpenChange={setLabResultOpen} docType="coa" css={LAB_REPORT_CSS}><LabResultReportTemplate pages={labReportPages} /></PrintPreviewDialog>}
    {grPrintOpen && goodsReceipt && (
      <PrintPreviewDialog open={grPrintOpen} onOpenChange={setGrPrintOpen} docType="goods-receipt" css={GOODS_RECEIPT_CSS}>
        <GoodsReceiptPrintTemplate doc={goodsReceipt} />
      </PrintPreviewDialog>
    )}
  </div></AppLayout>;
}
