import type { ParameterItem, ParameterScope, QCProgressEntry } from "@/lib/api";
import { expandFieldForItem } from "@/lib/parameterValidation";
import { estimatePetitionEnd, WORK_END_HOUR, WORK_START_HOUR } from "@/lib/petitionEstimate";
import { isResearchAndDevelopmentPetition } from "@/lib/petitionRouting";
import { getPetitionCategory, itemGroupKey, matchParametersForItem } from "@/lib/petitionTestItems";
import { hasLabTrack } from "@/lib/statusBadge";
import { PETITION_STATUS_CONFIG, type Petition, type PetitionAuditLogEntry, type PetitionStatus } from "@/types/petition.types";

export type TimelineDetailTaskState = "pending" | "inProgress" | "recorded" | "approved";
export type TimelineDetailTask = {
  key: string;
  parameterName: string;
  sampleName: string;
  itemSeq: number;
  filled: number;
  total: number;
  state: TimelineDetailTaskState;
  scope: ParameterScope;
};
export type TimelineDetailProgress = { filled: number; total: number; percent: number | null };
export type TimelineDetailActivity = { key: string; at: string; actor: string | null; label: string };
export type TimelineDetailTick = { key: string; at: string; label: string };
export type TimelineDetailRowKind = "milestone" | "bar";
export type TimelineDetailRowTrack = "qc" | "lab" | "stage";
export type TimelineDetailRow = {
  key: string;
  label: string;
  kind: TimelineDetailRowKind;
  track: TimelineDetailRowTrack;
  at: string | null;
  startAt: string | null;
  endAt: string | null;
  done: boolean;
};
export type TimelineDetailDayRow = TimelineDetailRow & {
  visible: boolean;
  segmentStartAt: string | null;
  segmentEndAt: string | null;
  continuesBefore: boolean;
  continuesAfter: boolean;
};
export type TimelineDetailDay = {
  key: string;
  label: string;
  startAt: string;
  endAt: string;
  ticks: TimelineDetailTick[];
  rows: TimelineDetailDayRow[];
};
export type TimelineDetailHeader = {
  startAt: string;
  startKind: "received" | "submitted";
  endAt: string;
  endKind: "actual" | "estimated" | "unreceived";
  overdue: boolean;
};
export type TimelineDetailItemTab = {
  seq: number;
  label: string;
  commonName: string;
  batchNo: string;
  sampleName: string;
};
export type TimelineDetailModel = {
  header: TimelineDetailHeader;
  items: TimelineDetailItemTab[];
  progress: TimelineDetailProgress;
  overallProgress: TimelineDetailProgress;
  tasks: TimelineDetailTask[];
  activities: TimelineDetailActivity[];
  timeline: { startAt: string; endAt: string; ticks: TimelineDetailTick[]; rows: TimelineDetailRow[]; days: TimelineDetailDay[] };
};
export type TimelineDetailInput = {
  petition: Petition;
  parameters: ParameterItem[];
  progressEntries: QCProgressEntry[];
  auditLogs: PetitionAuditLogEntry[];
  itemGroupIds?: Map<string, string[]>;
  itemSeq?: number | null;
};

const FINISHED_STATUSES = new Set<PetitionStatus>(["success", "approved", "rejected"]);

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstValidDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.map(validDate).filter((date): date is Date => !!date);
  return dates.length === 0 ? null : new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString();
}

function latestValidDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.map(validDate).filter((date): date is Date => !!date);
  return dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function atHour(value: Date, hour: number): Date {
  const result = new Date(value);
  result.setHours(hour, 0, 0, 0);
  return result;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatHour(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function formatDayBoundary(value: Date): string {
  return value.toLocaleDateString("th-TH", { day: "2-digit", month: "short" }) + " 08:00";
}

function formatDayLabel(value: Date): string {
  return value.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function localDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildHeaderTiming(
  petition: Petition,
  startAt: string,
  actualEndAt: string | null,
  qcTaskCount: number,
  now: Date,
): TimelineDetailHeader {
  if (actualEndAt && FINISHED_STATUSES.has(petition.status)) {
    return { startAt, startKind: "received", endAt: actualEndAt, endKind: "actual", overdue: false };
  }
  const estimate = estimatePetitionEnd({ petition, qcTaskCount, now });
  return {
    startAt,
    startKind: "received",
    endAt: estimate.at,
    endKind: estimate.kind,
    overdue: estimate.kind === "estimated" && new Date(estimate.at).getTime() < now.getTime(),
  };
}

function buildTicks(startAt: string, endAt: string): TimelineDetailTick[] {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (isSameLocalDay(start, end)) {
    const dayStart = atHour(start, WORK_START_HOUR);
    const finalHour = Math.max(WORK_END_HOUR, end.getHours());
    const ticks = Array.from({ length: finalHour - WORK_START_HOUR + 1 }, (_, index) => {
      const at = new Date(dayStart);
      at.setHours(WORK_START_HOUR + index, 0, 0, 0);
      return { key: at.toISOString(), at: at.toISOString(), label: formatHour(at) };
    });
    if (ticks[ticks.length - 1]?.at !== endAt && end.getMinutes() !== 0) {
      ticks.push({ key: endAt, at: endAt, label: formatHour(end) });
    }
    return ticks;
  }

  const ticks: TimelineDetailTick[] = [];
  for (let cursor = atHour(start, WORK_START_HOUR); cursor.getTime() <= end.getTime(); cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, WORK_START_HOUR)) {
    ticks.push({ key: cursor.toISOString(), at: cursor.toISOString(), label: formatDayBoundary(cursor) });
    const workEnd = atHour(cursor, WORK_END_HOUR);
    if (workEnd.getTime() <= end.getTime()) {
      ticks.push({ key: workEnd.toISOString(), at: workEnd.toISOString(), label: "20:00" });
    }
  }
  if (ticks[ticks.length - 1]?.at !== endAt) {
    ticks.push({ key: endAt, at: endAt, label: formatHour(end) });
  }
  return ticks;
}

function clipRowToDay(row: TimelineDetailRow, dayStartAt: string, dayEndAt: string): TimelineDetailDayRow {
  const dayStart = new Date(dayStartAt).getTime();
  const dayEnd = new Date(dayEndAt).getTime();
  const hidden: TimelineDetailDayRow = {
    ...row,
    visible: false,
    segmentStartAt: null,
    segmentEndAt: null,
    continuesBefore: false,
    continuesAfter: false,
  };

  if (row.kind === "milestone") {
    const at = validDate(row.at);
    if (!at || !isSameLocalDay(at, new Date(dayStartAt))) return hidden;
    return { ...hidden, visible: true };
  }

  const start = validDate(row.startAt)?.getTime();
  const end = validDate(row.endAt)?.getTime();
  if (start == null || end == null || end < dayStart || start > dayEnd) return hidden;

  return {
    ...row,
    visible: true,
    segmentStartAt: new Date(Math.max(start, dayStart)).toISOString(),
    segmentEndAt: new Date(Math.min(end, dayEnd)).toISOString(),
    continuesBefore: start < dayStart,
    continuesAfter: end > dayEnd,
  };
}

function floorToHour(value: Date): Date {
  const result = new Date(value);
  result.setMinutes(0, 0, 0);
  return result;
}

function ceilToHour(value: Date): Date {
  const floored = floorToHour(value);
  return floored.getTime() === value.getTime() ? floored : new Date(floored.getTime() + 60 * 60 * 1000);
}

// เก็บ timestamp ของแถวที่ตกวันปฏิทินเดียวกับ day (milestone.at, bar.startAt/endAt)
// ไม่นับ endAt ของแท่งที่ยังไม่จบ (done=false) ที่เท่ากับ "ตอนนี้" (nowAt) — มันคือตำแหน่งเคอร์เซอร์ตอนเปิดหน้า
// ไม่ใช่เหตุการณ์จริงที่บันทึกไว้ ถ้านับ จะทำให้หน้าต่างขยายเลื่อนตามเวลาจริงไปเรื่อย ๆ ทุกครั้งที่เปิดดูหลัง 17:00
function rowTimestampsOnDay(rows: TimelineDetailRow[], day: Date, nowAt: number): Date[] {
  const result: Date[] = [];
  for (const row of rows) {
    if (row.kind === "milestone") {
      const at = validDate(row.at);
      if (at && isSameLocalDay(at, day)) result.push(at);
      continue;
    }
    const rowStart = validDate(row.startAt);
    if (rowStart && isSameLocalDay(rowStart, day)) result.push(rowStart);
    const rowEnd = validDate(row.endAt);
    if (rowEnd && isSameLocalDay(rowEnd, day) && (row.done || rowEnd.getTime() !== nowAt)) result.push(rowEnd);
  }
  return result;
}

// วันที่มีกิจกรรมนอกเวลาทำการ (ก่อน 08:00 หรือหลัง 17:00) ต้องขยายหน้าต่างของวันนั้นให้ครอบคลุมกิจกรรมจริง
// ปัดเวลาเริ่มลง / เวลาจบขึ้น ให้ตรงชั่วโมง เพื่อให้ ticks (เดินทีละชั่วโมง) ยังคงลงตัวเป็นเลขกลม
function dayWindow(cursor: Date, rows: TimelineDetailRow[], timelineEnd: Date, nowAt: number): { start: Date; end: Date } {
  const defaultStart = atHour(cursor, WORK_START_HOUR);
  const defaultEnd = atHour(cursor, WORK_END_HOUR);
  const timestamps = rowTimestampsOnDay(rows, cursor, nowAt);

  const startCandidates = [defaultStart.getTime()];
  const endCandidates = [defaultEnd.getTime()];
  if (timestamps.length) {
    const earliest = new Date(Math.min(...timestamps.map((value) => value.getTime())));
    const latest = new Date(Math.max(...timestamps.map((value) => value.getTime())));
    startCandidates.push(floorToHour(earliest).getTime());
    endCandidates.push(ceilToHour(latest).getTime());
  }
  // วันสุดท้ายของกราฟ: ลากถึงเวลาจบจริงของ timeline
  // แต่ถ้าเวลาจบนั้นคือ "ตอนนี้" (คำร้องที่ยังไม่ปิด) ห้ามขยาย — กฎเดียวกับ rowTimestampsOnDay
  // มีแต่ timestamp ที่บันทึกไว้จริงเท่านั้นที่ขยายหน้าต่างวันได้
  if (isSameLocalDay(cursor, timelineEnd) && timelineEnd.getTime() !== nowAt) endCandidates.push(timelineEnd.getTime());

  // กันกรณีกิจกรรมท้ายวัน (23:xx) ที่ ceil ชั่วโมงแล้วเลยข้ามเที่ยงคืนไปวันถัดไป — ห้ามให้หน้าต่างของ "วันนี้" ทะลุออกนอกปฏิทินวันนี้
  // ไม่งั้น buildTicks จะเห็น start/end คนละวันปฏิทิน แล้วสลับไปใช้สูตร ticks ข้ามวัน (label ผิดรูปแบบ) ทั้งที่ยังเป็นแท็บวันเดียว
  const endOfDay = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 0, 0).getTime();
  const end = Math.min(Math.max(...endCandidates), endOfDay);

  return { start: new Date(Math.min(...startCandidates)), end: new Date(end) };
}

function buildTimelineDay(cursor: Date, rows: TimelineDetailRow[], timelineEnd: Date, nowAt: number): TimelineDetailDay {
  const { start: dayStart, end: dayEnd } = dayWindow(cursor, rows, timelineEnd, nowAt);
  return {
    key: localDayKey(cursor),
    label: formatDayLabel(cursor),
    startAt: dayStart.toISOString(),
    endAt: dayEnd.toISOString(),
    ticks: buildTicks(dayStart.toISOString(), dayEnd.toISOString()),
    rows: rows.map((row) => clipRowToDay(row, dayStart.toISOString(), dayEnd.toISOString())),
  };
}

function buildTimelineDays(startAt: string, endAt: string, rows: TimelineDetailRow[], now: Date): TimelineDetailDay[] {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const nowAt = now.getTime();
  const days: TimelineDetailDay[] = [];

  for (
    let cursor = atHour(start, WORK_START_HOUR);
    cursor.getTime() <= end.getTime();
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, WORK_START_HOUR)
  ) {
    days.push(buildTimelineDay(cursor, rows, end, nowAt));
  }

  return days.length ? days : [buildTimelineDay(start, rows, end, nowAt)];
}

function buildItemTabs(petition: Petition): TimelineDetailItemTab[] {
  return (petition.items ?? []).map((item) => {
    const commonName = item.commonName?.trim() ?? "";
    const sampleName = item.sampleName?.trim() ?? "";
    return {
      seq: item.seq,
      label: commonName || sampleName || `ตัวอย่างที่ ${item.seq}`,
      commonName,
      batchNo: item.batchNo?.trim() ?? "",
      sampleName,
    };
  });
}

function buildRequiredTasks(
  petition: Petition,
  parameters: ParameterItem[],
  progressEntries: QCProgressEntry[],
  itemGroupIds?: Map<string, string[]>,
): TimelineDetailTask[] {
  const filledByResult = new Map(progressEntries.map((entry) => [`${entry.itemSeq}::${entry.parameterId}`, new Set(entry.filledLabels)]));
  const category = getPetitionCategory(petition);
  const isResearchPetition = isResearchAndDevelopmentPetition(petition);
  const scopedParameters = isResearchPetition
    ? parameters.filter((parameter) => parameter.scope === "lab")
    : parameters;
  const finalApproved = petition.status === "approved";
  const tasks: TimelineDetailTask[] = [];

  for (const item of petition.items ?? []) {
    const groupIds = itemGroupIds?.get(itemGroupKey(item)) ?? [];
    for (const parameter of matchParametersForItem(item, scopedParameters, groupIds, { forceLabTrack: isResearchPetition, petitionCategory: category })) {
      const parameterId = parameter._id;
      if (!parameterId) continue;
      const requiredFields = (parameter.valueFields ?? []).filter((field) => field.required === true && field.type !== "photo");
      const requiredKeys = requiredFields.flatMap((field) => expandFieldForItem(field, item.commonName, { category }).map((unit) => unit.key));
      if (requiredKeys.length === 0) continue;
      const filledLabels = filledByResult.get(`${item.seq}::${parameterId}`) ?? new Set<string>();
      const filled = requiredKeys.filter((key) => filledLabels.has(key)).length;
      const state: TimelineDetailTaskState = finalApproved
        ? "approved"
        : filled === 0
          ? "pending"
          : filled === requiredKeys.length
            ? "recorded"
            : "inProgress";
      tasks.push({
        key: `${item.seq}::${parameterId}`,
        parameterName: parameter.name,
        sampleName: item.sampleName || "-",
        itemSeq: item.seq,
        filled,
        total: requiredKeys.length,
        state,
        scope: parameter.scope ?? "qc",
      });
    }
  }
  return tasks;
}

function taskFieldTotals(tasks: TimelineDetailTask[]): { filled: number; total: number } {
  return tasks.reduce(
    (result, task) => ({ filled: result.filled + task.filled, total: result.total + task.total }),
    { filled: 0, total: 0 },
  );
}

function buildRequiredProgress(
  tasks: TimelineDetailTask[],
  options: { received: boolean; preResultDone: boolean; finalResultDone: boolean },
): TimelineDetailProgress {
  const fields = taskFieldTotals(tasks);
  const total = fields.total + 3;
  const filled = options.finalResultDone
    ? total
    : (options.received ? 1 : 0) + fields.filled + (options.preResultDone ? 1 : 0);
  const rawPercent = Math.round((filled / total) * 100);
  return { filled, total, percent: options.finalResultDone ? 100 : Math.min(rawPercent, 99) };
}

function statusLabel(status?: PetitionStatus): string {
  return status ? PETITION_STATUS_CONFIG[status]?.label ?? status : "เปลี่ยนสถานะ";
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataObjectName(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  for (const property of ["name", "email", "employeeId"]) {
    const text = candidate[property];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

function resultActivityTarget(entry: PetitionAuditLogEntry): string | null {
  const parameterName = metadataString(entry.metadata, "parameterName");
  const fieldLabel = metadataString(entry.metadata, "fieldLabel");
  const sampleName = metadataString(entry.metadata, "sampleName");
  const parameterAndField = [parameterName, fieldLabel].filter(Boolean).join(" · ");
  if (parameterAndField) return sampleName ? `${parameterAndField} (${sampleName})` : parameterAndField;
  return entry.note?.trim() || null;
}

function activityLabel(entry: PetitionAuditLogEntry): string {
  switch (entry.event) {
    case "created": return "สร้างคำร้อง";
    case "received": return metadataString(entry.metadata, "side") === "lab" ? "Lab รับตัวอย่าง" : "QC รับตัวอย่าง";
    case "accepted": return entry.note?.trim() || "เจ้าหน้าที่รับงาน";
    case "assigned": {
      const assignee = metadataString(entry.metadata, "assignee") ?? metadataObjectName(entry.metadata, "assignee");
      return `มอบหมาย${assignee ? `ให้ ${assignee}` : "งาน"}`;
    }
    case "resultEntered": {
      const target = resultActivityTarget(entry);
      return `บันทึกผล${target ? `: ${target}` : ""}`;
    }
    case "resultUpdated": {
      const target = resultActivityTarget(entry);
      return `แก้ไขผล${target ? `: ${target}` : ""}`;
    }
    case "statusChanged": return entry.note?.trim() || `เปลี่ยนสถานะเป็น ${statusLabel(entry.toStatus)}`;
    case "reviewed": return entry.note?.trim() || "พิจารณาคำร้อง";
    case "updated": return entry.note?.trim() || "แก้ไขข้อมูลคำร้อง";
    case "deleted": return "ลบคำร้อง";
  }
}

function normalizeTimelineActivities(entries: PetitionAuditLogEntry[]): TimelineDetailActivity[] {
  return entries
    .filter((entry) => !!validDate(entry.createdAt))
    .map((entry) => ({ key: entry._id, at: entry.createdAt, actor: entry.actor?.trim() || null, label: activityLabel(entry) }))
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

function makeBarRow(input: {
  key: string;
  label: string;
  track: TimelineDetailRowTrack;
  startAt: string | null;
  endAt: string | null;
  done?: boolean;
}): TimelineDetailRow {
  const start = validDate(input.startAt);
  const end = validDate(input.endAt);
  const complete = !!start && !!end;
  // กันข้อมูลเพี้ยน: ถ้า start มาหลัง end ให้ยุบเป็นแท่งสั้น ๆ ที่ end
  const orderedStart = complete && start.getTime() > end.getTime() ? end : start;
  return {
    key: input.key,
    label: input.label,
    kind: "bar",
    track: input.track,
    at: null,
    startAt: complete ? orderedStart.toISOString() : null,
    endAt: complete ? end.toISOString() : null,
    // แท่งที่ยังทำอยู่มี start/end ครบ (end = ตอนนี้) แต่ยังไม่ done
    done: input.done ?? complete,
  };
}

// ทุกสถานะเป็นช่วงเวลาที่ลากไปจนสถานะถัดไปเริ่ม — end ของแถวหนึ่งคือ start ของแถวถัดไป
// ปิดท้ายด้วยจุดเดียว (Final Result) ที่หัวหน้า QC อนุมัติ
function buildStageRows(petition: Petition, now: Date, fallbackStartAt: string): TimelineDetailRow[] {
  const hasLab = hasLabTrack(petition);
  const nowAt = now.toISOString();

  const submittedAt = firstValidDate(petition.submittedBy?.submittedAt, petition.createdAt);
  // คำร้องเก่า/เคสที่ข้ามการสแกนส่ง ยังต้องเห็นช่วงส่งตัวอย่าง — ถอยไปใช้เวลารับตัวอย่างที่เร็วสุดแทน
  const sampleSentAt = petition.sampleSentAt
    ?? firstValidDate(petition.qcReceivedAt, petition.receivedAt, petition.labReceivedAt);
  // ต้องคง guard hasLab ไว้: assignedAt ถูกใช้ต่อใน endAt ของแถว sample-sent ด้วย (นอกบล็อก hasLab-only)
  // ถ้าตัด guard ออก คำร้องไม่มี Lab ที่บังเอิญมี assignedTo ค้างอยู่ (stray) จะทำให้แถว sample-sent จบผิดเวลา
  const assignedAt = hasLab ? petition.assignedTo?.assignedAt ?? null : null;
  // ข้อมูลเก่าบางเคสมีรู timestamp: บันทึกผลแล้วแต่ไม่มีเวลารับตัวอย่าง — ถอยไปใช้จุดเริ่มกราฟ/เวลามอบหมาย
  // ไม่งั้นแท่งวิเคราะห์หายไปทั้งที่ทำจริง (ถ้ายังไม่บันทึกผลและยังไม่รับตัวอย่าง = ยังไม่เริ่มจริง ต้องไม่ fallback)
  const qcReceivedRealAt = petition.qcReceivedAt ?? petition.receivedAt ?? null;
  const qcStartAt = qcReceivedRealAt ?? (petition.qcCompletedAt ? fallbackStartAt : null);
  const labStartAt = petition.labReceivedAt ?? (petition.labCompletedAt ? (assignedAt ?? fallbackStartAt) : null);
  const qcCompletedAt = petition.qcCompletedAt ?? null;
  const labCompletedAt = petition.labCompletedAt ?? null;
  const labApprovedAt = petition.labApprovedAt ?? null;
  const closedAt = petition.approvedAt ?? petition.rejectedAt ?? null;
  // Pre Result เริ่มเมื่อ "บันทึกผลครบทั้งสองฝั่ง" — คำร้องที่มี Lab ต้องรอ Lab บันทึกผลด้วย
  const preResultStartAt = hasLab
    ? (qcCompletedAt && labCompletedAt ? latestValidDate(qcCompletedAt, labCompletedAt) : null)
    : qcCompletedAt;

  // แถวที่เริ่มแล้วแต่สถานะถัดไปยังไม่เกิด → ลากถึงตอนนี้ (done = false); ยังไม่เริ่ม → ไม่มีแท่ง
  // คำร้องที่ปิดแล้ว (closedAt) ห้ามลากเลยจุดปิด — ไม่งั้นแท่งที่ขาด timestamp กลาง ๆ (รูข้อมูลเก่า) จะลากยาวถึงวันนี้ตลอดกาล
  const openEndAt = closedAt ?? nowAt;
  const stage = (key: string, label: string, track: TimelineDetailRowTrack, startAt: string | null, endAt: string | null) =>
    makeBarRow({ key, label, track, startAt, endAt: startAt ? endAt ?? openEndAt : null, done: !!startAt && !!endAt });

  const final: TimelineDetailRow = {
    key: "final",
    label: petition.status === "rejected" ? "ส่งกลับแก้ไข" : "Final Result",
    kind: "milestone",
    track: "stage",
    at: closedAt,
    startAt: null,
    endAt: null,
    done: !!validDate(closedAt),
  };

  return [
    stage("submitted", "ยื่นคำขอ", "stage", submittedAt, sampleSentAt),
    // ใช้เวลารับตัวอย่างจริงเท่านั้น ห้ามใช้ qcStartAt (อาจเป็น fallbackStartAt ที่ปั้นขึ้น) ไม่งั้นแถวนี้อาจจบก่อนเริ่ม
    stage("sample-sent", "ส่งตัวอย่าง", "stage", sampleSentAt, firstValidDate(qcReceivedRealAt, assignedAt)),
    hasLab ? stage("assigned", "มอบหมายงาน Lab", "lab", assignedAt, labStartAt) : null,
    stage("qc-analyzing", "QC กำลังวิเคราะห์", "qc", qcStartAt, qcCompletedAt),
    hasLab ? stage("lab-analyzing", "Lab กำลังวิเคราะห์", "lab", labStartAt, labCompletedAt) : null,
    hasLab ? stage("lab-approval", "ออกผล Lab", "lab", labCompletedAt, labApprovedAt) : null,
    stage("pre-result", "Pre Result", "stage", preResultStartAt, closedAt),
    final,
  ].filter((row): row is TimelineDetailRow => row !== null);
}

export function buildTimelineDetailModel(input: TimelineDetailInput, now = new Date()): TimelineDetailModel {
  const submittedAt = firstValidDate(input.petition.submittedBy?.submittedAt, input.petition.createdAt) ?? now.toISOString();
  const receivedAt = firstValidDate(input.petition.qcReceivedAt, input.petition.labReceivedAt, input.petition.receivedAt);
  const startAt = receivedAt ?? submittedAt;
  // กราฟเริ่มที่จุดยื่นคำขอ (เก่าสุด) ส่วน header ยังนับจากเวลารับตัวอย่างเหมือนเดิม
  const timelineStartAt = firstValidDate(submittedAt, startAt);
  const actualEndAt = latestValidDate(
    input.petition.approvedAt,
    input.petition.rejectedAt,
    input.petition.completedAt,
    input.petition.labApprovedAt,
    input.petition.labCompletedAt,
    input.petition.qcCompletedAt,
  );
  const allTasks = buildRequiredTasks(input.petition, input.parameters, input.progressEntries, input.itemGroupIds);
  // matchParametersForItem() deliberately keeps scope:"lab" parameters for lab-batch items (progress
  // needs them) — but QC's estimate anchor (qcReceivedAt) only covers QC's own work, so lab-scope
  // tasks must not add QC minutes on top of the Lab machine estimate (double counting).
  const qcTaskCount = allTasks.filter((task) => task.scope !== "lab").length;
  const header = buildHeaderTiming(input.petition, startAt, actualEndAt, qcTaskCount, now);
  // คำขอที่ปิดแล้วจบแกนที่เวลาจริง; ที่ยังเปิดอยู่ลากถึงแค่กิจกรรมจริงล่าสุด/ตอนนี้ (แท่ง in-progress ลากถึง now)
  // ห้ามลากแกนไปถึง "เวลาคาดการณ์" (header.endAt) — กราฟต้องสะท้อนของจริง ไม่ใช่ดันแท็บวันไปวันอนาคต
  // ที่ยังไม่มีกิจกรรม (คำร้องเพิ่งสร้าง/ยังไม่รับ จะได้ +1 วันเสมอ). Estimate Time ยังโชว์แยกใน header
  const timelineEndAt = header.endKind === "actual"
    ? header.endAt
    : latestValidDate(actualEndAt, now.toISOString())!;
  const tasks = input.itemSeq == null ? allTasks : allTasks.filter((task) => task.itemSeq === input.itemSeq);
  const allFields = taskFieldTotals(allTasks);
  const finalResultDone = input.petition.status === "approved";
  const preResultDone = allFields.total > 0
    && allFields.filled >= allFields.total
    && (input.petition.status === "success" || finalResultDone || !!validDate(input.petition.qcCompletedAt));
  const progressOptions = { received: !!receivedAt, preResultDone, finalResultDone };
  const rows = buildStageRows(input.petition, now, timelineStartAt);

  return {
    header: { ...header, startKind: receivedAt ? "received" : "submitted" },
    items: buildItemTabs(input.petition),
    progress: buildRequiredProgress(tasks, progressOptions),
    overallProgress: buildRequiredProgress(allTasks, progressOptions),
    tasks,
    activities: normalizeTimelineActivities(input.auditLogs),
    timeline: {
      startAt: atHour(new Date(timelineStartAt), WORK_START_HOUR).toISOString(),
      endAt: timelineEndAt,
      ticks: buildTicks(timelineStartAt, timelineEndAt),
      rows,
      days: buildTimelineDays(timelineStartAt, timelineEndAt, rows, now),
    },
  };
}
