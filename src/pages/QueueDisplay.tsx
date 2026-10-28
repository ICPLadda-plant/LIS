import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, FlaskConical, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import { usePetitionList } from "@/hooks/usePetition";
import {
  PETITION_STATUS_CONFIG,
  type Petition,
  type PetitionStatus,
} from "@/types/petition.types";
import { api, type ParameterItem, type QCProgressMap } from "@/lib/api";
import {
  computePetitionProgress,
  isSameLocalDay,
  type PetitionProgress,
} from "@/lib/qcProgress";
import { shouldSendItemToLab } from "@/lib/petitionRouting";
import { isVisibleInQcTestingQueue } from "@/lib/petitionQueueVisibility";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { calculateQueueItemsPerColumn } from "@/lib/queueDisplayRows";
import { isNotificationSoundEnabled } from "@/lib/appPreferences";
import { previewNotificationSound } from "@/lib/notificationSoundPreview";
import { formatDate, formatTime } from "@/lib/dateTime";

type QueueMode = "lab" | "qc";

type QueueGroup = {
  id: string;
  title: string;
  subtitle: string;
  statuses: PetitionStatus[];
  icon: typeof Sparkles;
  tone: string;
};

type QueueConfig = {
  title: string;
  subtitle: string;
  accent: string;
  icon: typeof FlaskConical;
  groups: QueueGroup[];
};

const REFRESH_MS = 5_000;
const DEFAULT_ITEMS_PER_COLUMN = 3;
const QUEUE_PAGE_MS = 10_000;
const NEW_WORK_ALERT_MS = 10_000;
const NEW_SAMPLE_SOUND_URL = `${import.meta.env.BASE_URL}sound/new.mp3`;

const petitionHasLabItems = (petition: Petition) =>
  petition.items.some((item) => shouldSendItemToLab(item));

const queueStatusFor = (petition: Petition, mode: QueueMode): PetitionStatus => {
  if (mode === "qc" && petition.status === "deliveringQC" && isVisibleInQcTestingQueue(petition)) {
    return "inProgress";
  }
  return petition.status;
};

const QUEUE_CONFIG: Record<QueueMode, QueueConfig> = {
  lab: {
    title: "Lab Queue",
    subtitle: "รายการคำขอสำหรับรับตัวอย่าง ตรวจสอบ และวิเคราะห์ในห้องปฏิบัติการ",
    accent: "bg-primary text-primary-foreground",
    icon: FlaskConical,
    groups: [
      {
        id: "new",
        title: "ตัวอย่างใหม่",
        subtitle: "รอรับเข้าระบบ",
        statuses: ["sampleSent"],
        icon: Sparkles,
        tone: "border-sky-200 bg-sky-50 text-sky-700",
      },
      {
        id: "progress",
        title: "กำลังดำเนินการ",
        subtitle: "รับแล้ว / อยู่ระหว่างวิเคราะห์",
        statuses: ["pendingReview", "inProgress"],
        icon: Clock,
        tone: "border-amber-200 bg-amber-50 text-amber-700",
      },
      {
        id: "done",
        title: "เรียบร้อยแล้ว",
        subtitle: "ตรวจเสร็จแล้ว",
        statuses: ["success"],
        icon: CheckCircle2,
        tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      },
    ],
  },
  qc: {
    title: "QC Queue",
    subtitle: "รายการคำขอสำหรับติดตาม ตรวจสอบ และออก Final Result",
    accent: "bg-primary-600 text-white",
    icon: ShieldCheck,
    groups: [
      {
        id: "new",
        title: "ตัวอย่างใหม่",
        subtitle: "คำขอเข้า QC",
        statuses: ["sampleSent"],
        icon: Sparkles,
        tone: "border-sky-200 bg-sky-50 text-sky-700",
      },
      {
        id: "progress",
        title: "กำลังดำเนินการ",
        subtitle: "รอตรวจสอบ / กำลังตรวจ",
        statuses: ["pendingReview", "inProgress"],
        icon: Clock,
        tone: "border-amber-200 bg-amber-50 text-amber-700",
      },
      {
        id: "done",
        title: "เรียบร้อยแล้ว",
        subtitle: "ออกผลแล้ว",
        statuses: ["success"],
        icon: CheckCircle2,
        tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      },
    ],
  },
};

const QUEUE_STATUS_QUERIES: Record<QueueMode, Record<QueueGroup["id"], string>> = {
  lab: {
    new: "sampleSent",
    progress: "pendingReview,inProgress",
    done: "success",
  },
  qc: {
    new: "sampleSent",
    progress: "pendingReview,inProgress,deliveringQC",
    done: "success",
  },
};

function formatDateTime(value: string) {
  return {
    date: formatDate(value),
    time: formatTime(value),
  };
}

function getSampleSummary(petition: Petition) {
  const firstItem = petition.items[0];
  const name = firstItem
    ? [firstItem.sampleName, firstItem.commonName].filter(Boolean).join(" ")
    : "";

  if (!name) return `${petition.items.length} รายการตัวอย่าง`;
  if (petition.items.length <= 1) return name;
  return `${name} +${petition.items.length - 1}`;
}

function QueueCard({
  petition,
  displayStatus,
  progress,
  returned,
}: {
  petition: Petition;
  displayStatus?: PetitionStatus;
  progress?: PetitionProgress;
  returned?: boolean;
}) {
  const updated = formatDateTime(petition.updatedAt);
  const status = displayStatus ?? petition.status;
  const statusCfg = PETITION_STATUS_CONFIG[status] ?? {
    label: status,
    variant: "gray-soft" as const,
  };

  const showBar = progress && progress.total > 0;
  const barColor = showBar
    ? progress.percent >= 100
      ? "bg-emerald-500"
      : progress.percent > 0
        ? "bg-primary-500"
        : "bg-slate-300"
    : "";

  return (
    <article className="rounded-lg border border-primary-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-xl font-bold text-primary-700">{petition.petitionNo}</span>
            {returned && (
              <RotateCcw
                className="h-5 w-5 shrink-0 text-orange-500"
                aria-label="ส่งกลับมาบันทึกผลใหม่"
              />
            )}
          </div>
          <div className="mt-1 truncate text-sm font-medium text-slate-700">
            {getSampleSummary(petition)}
          </div>
        </div>
        <Badge variant={statusCfg.variant} className="shrink-0 px-3 py-1 text-sm">
          {statusCfg.label}
        </Badge>
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-slate-100 pt-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800">{petition.submittedBy?.name ?? '-'}</div>
          <div className="truncate text-sm text-slate-500">{petitionDepartmentLabel(petition)}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-primary-700">{updated.time}</div>
          <div className="text-xs text-slate-500">{updated.date}</div>
        </div>
      </div>

      {showBar && (
        <div className="mt-2 flex items-center gap-3 border-t border-slate-100 pt-2">
          <div
            className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn("h-full transition-all duration-500", barColor)}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span
            className={cn(
              "shrink-0 text-base font-bold tabular-nums",
              progress.percent >= 100 ? "text-emerald-600" : "text-primary-700",
            )}
          >
            {progress.percent}%
          </span>
        </div>
      )}
    </article>
  );
}

export default function QueueDisplay({ mode }: { mode: QueueMode }) {
  const config = QUEUE_CONFIG[mode];
  const HeaderIcon = config.icon;
  const statusQueries = QUEUE_STATUS_QUERIES[mode];
  const {
    data: newQueueData,
    loading: newQueueLoading,
    error: newQueueError,
    refresh: refreshNewQueue,
  } = usePetitionList({ page: 1, limit: 200, status: statusQueries.new });
  const {
    data: progressQueueData,
    loading: progressQueueLoading,
    error: progressQueueError,
    refresh: refreshProgressQueue,
  } = usePetitionList({ page: 1, limit: 200, status: statusQueries.progress });
  const {
    data: doneQueueData,
    loading: doneQueueLoading,
    error: doneQueueError,
    refresh: refreshDoneQueue,
  } = usePetitionList({ page: 1, limit: 200, status: statusQueries.done });
  const loading = newQueueLoading || progressQueueLoading || doneQueueLoading;
  const error = newQueueError ?? progressQueueError ?? doneQueueError;
  const refresh = useCallback(() => {
    refreshNewQueue();
    refreshProgressQueue();
    refreshDoneQueue();
  }, [refreshDoneQueue, refreshNewQueue, refreshProgressQueue]);
  const [now, setNow] = useState(() => new Date());
  const [newWorkPopup, setNewWorkPopup] = useState<{ count: number; petitionNos: string[] } | null>(null);
  const [queuePageTick, setQueuePageTick] = useState(0);
  const [itemsPerColumn, setItemsPerColumn] = useState(DEFAULT_ITEMS_PER_COLUMN);
  const columnBodyRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousNewIdsRef = useRef<Set<string>>(new Set());
  const initializedNewIdsRef = useRef(false);
  const popupTimerRef = useRef<number | null>(null);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const [soundReady, setSoundReady] = useState(false);

  const activateNotificationSound = useCallback(async () => {
    if (!isNotificationSoundEnabled("queueNew")) return;

    const audio = alertAudioRef.current ?? new Audio(NEW_SAMPLE_SOUND_URL);
    audio.preload = "auto";
    audio.loop = true;
    alertAudioRef.current = audio;

    try {
      // ทดสอบแบบไม่ mute แต่ปิดความดัง เพราะเบราว์เซอร์ยอมให้เล่นแบบ mute เสมอ
      // ถ้าใช้ muted จะคิดว่าปลดล็อกแล้วทั้งที่เสียงจริงยังถูกบล็อก
      audio.muted = false;
      audio.volume = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      setSoundReady(true);
    } catch {
      audio.volume = 1;
      setSoundReady(false);
    }
  }, []);

  // เปิดเสียงอัตโนมัติ: ลองทันทีตอนโหลด (ผ่านถ้าเว็บได้รับอนุญาตเล่นเสียง)
  // ถ้ายังถูกบล็อก จะปลดล็อกเมื่อมีการคลิก/แตะ/กดคีย์ครั้งแรกที่ใดก็ได้บนหน้า
  useEffect(() => {
    if (soundReady) return;
    void activateNotificationSound();
    const unlock = () => void activateNotificationSound();
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, unlock, { capture: true }));
    return () => events.forEach((name) => window.removeEventListener(name, unlock, { capture: true }));
  }, [activateNotificationSound, soundReady]);

  const testNotificationSound = useCallback(async () => {
    // การกดปุ่มคือ user gesture จึงใช้ปลดล็อกเสียงอัตโนมัติไปพร้อมกัน
    await activateNotificationSound();
    const played = await previewNotificationSound("queueNew");
    if (played) setSoundReady(true);
  }, [activateNotificationSound]);

  // "Today" is bound at mount and refreshed at midnight so the board auto-clears
  // when the local day rolls over.
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const next = new Date(today);
    next.setHours(24, 0, 0, 5);
    const ms = Math.max(next.getTime() - Date.now(), 1000);
    const t = window.setTimeout(() => setToday(new Date()), ms);
    return () => window.clearTimeout(t);
  }, [today]);

  // Parameters drive the denominator for the QC progress bar.
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  useEffect(() => {
    if (mode !== "qc") return;
    api
      .getParameters()
      .then((all) => setParameters(all.filter((p) => (p.scope ?? "qc") === "qc")))
      .catch(() => {});
  }, [mode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
      refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const allItems = useMemo(() => {
    const groupStatuses = config.groups.flatMap((group) => group.statuses);
    const petitionsById = new Map<string, Petition>();
    for (const petition of [
      ...(newQueueData?.items ?? []),
      ...(progressQueueData?.items ?? []),
      ...(doneQueueData?.items ?? []),
    ]) {
      petitionsById.set(petition._id, petition);
    }

    return Array.from(petitionsById.values())
      .filter((petition) => groupStatuses.includes(queueStatusFor(petition, mode)))
      .filter((petition) => (mode === "lab" ? petitionHasLabItems(petition) : true))
      .filter((petition) =>
        // Only the "done" board resets per local day so finished samples don't
        // pile up across days. Waiting / in-progress rows stay visible regardless
        // of when they entered the queue.
        queueStatusFor(petition, mode) === "success"
          ? isSameLocalDay(petition.completedAt ?? petition.updatedAt, today)
          : true,
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [config.groups, doneQueueData?.items, mode, newQueueData?.items, progressQueueData?.items, today]);

  // Flag petitions that QC approval has sent back for re-entry. Re-fetches on
  // the same cadence as the petition list and keys off every visible petition
  // (any group can contain a returned row).
  const [returnedMap, setReturnedMap] = useState<Record<string, boolean>>({});
  const visibleReturnedIds = useMemo(
    () => allItems.map((p) => p._id).join(","),
    [allItems],
  );
  useEffect(() => {
    if (!visibleReturnedIds) {
      setReturnedMap({});
      return;
    }
    let cancelled = false;
    const fetchOnce = () =>
      api
        .getReturnedFlags(visibleReturnedIds.split(","))
        .then((map) => { if (!cancelled) setReturnedMap(map || {}); })
        .catch(() => {});
    fetchOnce();
    const interval = window.setInterval(fetchOnce, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [visibleReturnedIds]);

  // Fetch how many values each visible petition has filled so far. Re-fetches
  // on the same cadence as the petition list, plus when the visible set changes.
  const [progressMap, setProgressMap] = useState<QCProgressMap>({});
  const visibleProgressIds = useMemo(
    () =>
      mode === "qc"
        ? allItems
            .filter((p) => {
              const queueStatus = queueStatusFor(p, mode);
              return queueStatus === "pendingReview" || queueStatus === "inProgress" || queueStatus === "sampleSent";
            })
            .map((p) => p._id)
            .join(",")
        : "",
    [allItems, mode],
  );
  useEffect(() => {
    if (!visibleProgressIds) {
      setProgressMap({});
      return;
    }
    let cancelled = false;
    const fetchOnce = () =>
      api
        .getQCProgress(visibleProgressIds.split(","))
        .then((map) => { if (!cancelled) setProgressMap(map); })
        .catch(() => {});
    fetchOnce();
    const interval = window.setInterval(fetchOnce, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [visibleProgressIds]);

  const itemsByGroup = useMemo(() => {
    return config.groups.map((group) => ({
      ...group,
      items: allItems.filter((petition) => group.statuses.includes(queueStatusFor(petition, mode))),
    }));
  }, [allItems, config.groups, mode]);

  const queueResetKey = useMemo(
    () =>
      itemsByGroup
        .map((group) =>
          [
            group.id,
            group.items.map((petition) => `${petition._id}:${queueStatusFor(petition, mode)}:${petition.updatedAt}`).join("|"),
          ].join("="),
        )
        .join(";"),
    [itemsByGroup, mode],
  );

  const hasOverflowingGroup = useMemo(
    () => itemsByGroup.some((group) => group.items.length > itemsPerColumn),
    [itemsByGroup, itemsPerColumn],
  );

  const updateItemsPerColumn = useCallback(() => {
    const bodyHeights = config.groups
      .map((group) => columnBodyRefs.current[group.id]?.clientHeight ?? 0)
      .filter((height) => height > 0);
    if (bodyHeights.length === 0) return;

    const nextItemsPerColumn = Math.min(
      ...bodyHeights.map((height) => calculateQueueItemsPerColumn(height)),
    );
    setItemsPerColumn((current) => (current === nextItemsPerColumn ? current : nextItemsPerColumn));
  }, [config.groups]);

  useLayoutEffect(() => {
    updateItemsPerColumn();
  });

  useEffect(() => {
    updateItemsPerColumn();
    const bodyElements = config.groups
      .map((group) => columnBodyRefs.current[group.id])
      .filter((element): element is HTMLDivElement => Boolean(element));

    const handleResize = () => updateItemsPerColumn();
    window.addEventListener("resize", handleResize);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver(handleResize);
    bodyElements.forEach((element) => observer.observe(element));
    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [config.groups, updateItemsPerColumn]);

  useEffect(() => {
    setQueuePageTick(0);
  }, [itemsPerColumn, mode, queueResetKey]);

  useEffect(() => {
    if (!hasOverflowingGroup) {
      setQueuePageTick(0);
      return;
    }

    const timer = window.setInterval(() => {
      setQueuePageTick((tick) => tick + 1);
    }, QUEUE_PAGE_MS);
    return () => window.clearInterval(timer);
  }, [hasOverflowingGroup]);

  const newGroupItems = useMemo(() => {
    return itemsByGroup.find((group) => group.id === "new")?.items ?? [];
  }, [itemsByGroup]);

  useEffect(() => {
    if (loading || error) return;

    const currentNewIds = new Set(newGroupItems.map((petition) => petition._id));

    if (!initializedNewIdsRef.current) {
      previousNewIdsRef.current = currentNewIds;
      initializedNewIdsRef.current = true;
      return;
    }

    const incomingItems = newGroupItems.filter((petition) => !previousNewIdsRef.current.has(petition._id));
    previousNewIdsRef.current = currentNewIds;

    if (incomingItems.length === 0) return;

    if (alertAudioRef.current) {
      alertAudioRef.current.pause();
      alertAudioRef.current.currentTime = 0;
    }

    if (isNotificationSoundEnabled("queueNew")) {
      const audio = alertAudioRef.current ?? new Audio(NEW_SAMPLE_SOUND_URL);
      audio.loop = true;
      alertAudioRef.current = audio;
      audio.play().then(() => setSoundReady(true)).catch(() => setSoundReady(false));
    }

    setNewWorkPopup({
      count: incomingItems.length,
      petitionNos: incomingItems.slice(0, 3).map((petition) => petition.petitionNo),
    });

    if (popupTimerRef.current) {
      window.clearTimeout(popupTimerRef.current);
    }
    popupTimerRef.current = window.setTimeout(() => {
      if (alertAudioRef.current) {
        alertAudioRef.current.pause();
        alertAudioRef.current.currentTime = 0;
        alertAudioRef.current = null;
      }
      setNewWorkPopup(null);
      popupTimerRef.current = null;
    }, NEW_WORK_ALERT_MS);
  }, [error, loading, newGroupItems]);

  useEffect(() => {
    return () => {
      if (popupTimerRef.current) {
        window.clearTimeout(popupTimerRef.current);
      }
      if (alertAudioRef.current) {
        alertAudioRef.current.pause();
        alertAudioRef.current = null;
      }
    };
  }, []);

  const currentTime = formatTime(now);
  const currentDate = formatDate(now);

  const renderQueueCard = (petition: Petition) => {
    const queueStatus = queueStatusFor(petition, mode);
    const showProgress =
      mode === "qc" &&
      (queueStatus === "sampleSent" || queueStatus === "pendingReview" || queueStatus === "inProgress");
    const progress = showProgress
      ? computePetitionProgress(petition, parameters, progressMap[petition._id])
      : undefined;

    return (
      <QueueCard
        key={petition._id}
        petition={petition}
        displayStatus={queueStatus}
        progress={progress}
        returned={returnedMap[petition._id]}
      />
    );
  };

  return (
    <main className="flex min-h-screen flex-col overflow-x-hidden bg-primary-50 text-slate-800 lg:h-screen lg:overflow-hidden">
      {newWorkPopup && (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-3 sm:top-8 sm:px-6">
          <div className="flex w-full max-w-[720px] items-center gap-3 rounded-lg border border-primary-200 bg-white px-4 py-4 shadow-xl sm:w-auto sm:min-w-[420px] sm:gap-5 sm:px-7 sm:py-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:h-16 sm:w-16">
              <Sparkles className="h-7 w-7 sm:h-9 sm:w-9" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-bold text-primary-700 sm:text-3xl">มีงานใหม่</div>
              <div className="mt-1 truncate text-base text-slate-600 sm:text-xl">
                {config.title}: {newWorkPopup.count} รายการ
                {newWorkPopup.petitionNos.length > 0 ? ` (${newWorkPopup.petitionNos.join(", ")})` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="shrink-0 border-b border-primary-100 bg-white px-4 py-4 shadow-sm sm:px-6 lg:px-10 lg:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-white p-2 shadow-sm sm:h-20 sm:w-20">
            <img
              src={ICP_LADDA_LOGO_URL}
              alt="ICP Ladda"
              className="h-full w-full object-contain"
            />
          </div>
          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-lg sm:h-16 sm:w-16", config.accent)}>
            <HeaderIcon className="h-7 w-7 sm:h-9 sm:w-9" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-bold tracking-normal text-primary-700 sm:text-5xl">{config.title}</h1>
            <p className="mt-1 line-clamp-2 text-base text-slate-600 sm:mt-2 sm:truncate sm:text-2xl">{config.subtitle}</p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-4xl font-bold leading-none text-primary-700 sm:text-5xl">{currentTime}</div>
          <div className="mt-2 text-base text-slate-600 sm:text-xl">{currentDate}</div>
        </div>
        </div>
      </header>

      <section className="flex shrink-0 flex-col gap-4 border-b border-primary-100 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10 lg:py-5">
        <div className="rounded-lg bg-primary-50 px-5 py-3">
          <div className="text-lg text-slate-500">ในคิว</div>
          <div className="text-4xl font-bold text-primary-700">{allItems.length}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-base text-slate-600 sm:text-xl">
          {isNotificationSoundEnabled("queueNew") && !soundReady && (
            <button
              type="button"
              onClick={() => void activateNotificationSound()}
              className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Volume2 className="h-5 w-5" />
              เปิดเสียงแจ้งเตือน
            </button>
          )}
          <button
            type="button"
            onClick={() => void testNotificationSound()}
            className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-background px-4 py-2 font-semibold text-primary shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Volume2 className="h-5 w-5" />
            ทดสอบเสียง
          </button>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            อัปเดตอัตโนมัติทุก 5 วินาที
          </span>
        </div>
      </section>

      <section data-testid="queue-board" className="min-h-0 flex-1 px-3 py-4 sm:px-6 lg:overflow-hidden lg:px-10 lg:py-6">
        {loading ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-center text-xl text-slate-500 sm:flex-row sm:text-3xl lg:min-h-0">
            <Clock className="h-7 w-7 animate-pulse sm:h-8 sm:w-8" />
            กำลังโหลดรายการคิว...
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[260px] items-center justify-center rounded-lg border border-red-200 bg-white px-4 text-center text-xl font-semibold text-red-600 sm:text-3xl lg:min-h-0">
            โหลดรายการคิวไม่สำเร็จ: {error}
          </div>
        ) : (
          <div data-testid="queue-grid" className="grid min-h-0 grid-cols-1 gap-4 sm:gap-5 lg:h-full lg:grid-cols-3 lg:overflow-hidden">
            {itemsByGroup.map((group) => {
              const GroupIcon = group.icon;
              const totalPages = Math.ceil(group.items.length / itemsPerColumn);
              const currentPageIndex = totalPages > 1 ? queuePageTick % totalPages : 0;
              const firstVisibleIndex = currentPageIndex * itemsPerColumn;
              const currentPageItems = group.items.slice(firstVisibleIndex, firstVisibleIndex + itemsPerColumn);
              const itemPages = Array.from({ length: totalPages }, (_, pageIndex) => {
                const pageStartIndex = pageIndex * itemsPerColumn;
                return group.items.slice(pageStartIndex, pageStartIndex + itemsPerColumn);
              });
              const subtitle =
                totalPages > 1
                  ? `${group.subtitle} • หน้า ${currentPageIndex + 1}/${totalPages}`
                  : group.subtitle;

              return (
                <section key={group.id} className="flex min-h-[360px] flex-col overflow-hidden rounded-lg border border-primary-100 bg-white/70 lg:h-full lg:min-h-0">
                  <div className={cn("flex items-center justify-between border-b px-4 py-3 sm:px-5 sm:py-4", group.tone)}>
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <GroupIcon className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
                      <div className="min-w-0">
                        <h2 className="truncate text-2xl font-bold sm:text-3xl">{group.title}</h2>
                        <p className="truncate text-sm opacity-80 sm:text-base">{subtitle}</p>
                      </div>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/80 text-2xl font-bold sm:h-14 sm:w-14 sm:text-3xl">
                      {group.items.length}
                    </div>
                  </div>

                  <div
                    ref={(element) => { columnBodyRefs.current[group.id] = element; }}
                    data-testid={`queue-column-body-${group.id}`}
                    className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4"
                  >
                    {currentPageItems.length === 0 ? (
                      <div className="flex h-full min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/70 text-2xl font-semibold text-slate-400 lg:min-h-0">
                        ไม่มีรายการ
                      </div>
                    ) : (
                      <div className="overflow-hidden">
                        <div
                          className="flex flex-row-reverse transition-transform duration-1000 ease-in-out will-change-transform motion-reduce:transition-none"
                          style={{ transform: `translateX(${currentPageIndex * 100}%)` }}
                        >
                          {itemPages.map((pageItems, pageIndex) => (
                            <div
                              key={`${group.id}-${pageIndex}`}
                              role={pageIndex === currentPageIndex ? "group" : undefined}
                              aria-label={pageIndex === currentPageIndex ? `${group.title} หน้า ${pageIndex + 1}` : undefined}
                              aria-hidden={pageIndex !== currentPageIndex}
                              className="w-full shrink-0 space-y-3"
                            >
                              {pageItems.map(renderQueueCard)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
