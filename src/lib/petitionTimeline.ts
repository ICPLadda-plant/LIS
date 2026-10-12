import { shouldSendItemToLab } from "@/lib/petitionRouting";
import { formatDate } from "@/lib/dateTime";
import type { Petition } from "@/types/petition.types";

export type TimelineTone = "intake" | "receive" | "testing" | "lab" | "final" | "closed" | "blocked";
export type PetitionTimelineMilestone = { key: string; label: string; at: string | null; done: boolean; tone: TimelineTone };
export type PetitionTimelineSegment = { key: string; label: string; startAt: string; endAt: string; tone: TimelineTone; current?: boolean };
export type PetitionTimelineRow = {
  petition: Petition;
  startAt: string;
  endAt: string;
  lastAt: string;
  hasLabTrack: boolean;
  isClosed: boolean;
  isIdle: boolean;
  milestones: PetitionTimelineMilestone[];
  segments: PetitionTimelineSegment[];
};
export type TimelineWindow = { startAt: string; endAt: string; todayAt: string | null };
export type TimelineTick = { key: string; at: string; label: string; major: boolean };
export type PetitionTimelineSummary = { total: number; inProgress: number; closed: number; waiting: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = new Set<Petition["status"]>(["success", "approved", "rejected"]);
const SUMMARY_CLOSED_STATUSES = new Set<Petition["status"]>(["success", "approved", "rejected"]);

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value: Date): string { return value.toISOString(); }
function startOfDay(value: Date): Date { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function addDays(value: Date, days: number): Date { return new Date(value.getTime() + days * DAY_MS); }

function maxDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.map(validDate).filter((date): date is Date => !!date);
  return dates.length === 0 ? null : iso(new Date(Math.max(...dates.map((date) => date.getTime()))));
}

function firstDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.map(validDate).filter((date): date is Date => !!date);
  return dates.length === 0 ? null : iso(new Date(Math.min(...dates.map((date) => date.getTime()))));
}

function submittedAt(petition: Petition): string {
  return firstDate(petition.submittedBy?.submittedAt, petition.createdAt) ?? iso(new Date(0));
}

function hasLabTrack(petition: Petition): boolean {
  return Boolean(petition.labReceivedAt || petition.labCompletedAt || petition.labApprovedAt || petition.items.some((item) => shouldSendItemToLab(item)));
}

function compactMilestones(items: PetitionTimelineMilestone[]): PetitionTimelineMilestone[] {
  return items.filter((item) => item.done || item.key === "submitted").sort((a, b) => (validDate(a.at)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (validDate(b.at)?.getTime() ?? Number.MAX_SAFE_INTEGER));
}

function segment(key: string, label: string, startAt: string | null, endAt: string | null, tone: TimelineTone, current = false): PetitionTimelineSegment | null {
  const start = validDate(startAt);
  const end = validDate(endAt);
  if (!start || !end || end.getTime() < start.getTime()) return null;
  return { key, label, startAt: iso(start), endAt: iso(end), tone, current };
}

export function buildPetitionTimelineRow(petition: Petition, now: Date = new Date()): PetitionTimelineRow {
  const hasLab = hasLabTrack(petition);
  const startAt = submittedAt(petition);
  const firstReceivedAt = firstDate(petition.qcReceivedAt, petition.labReceivedAt, petition.receivedAt);
  const assignedAt = petition.assignedTo?.assignedAt ?? null;
  const testingStartAt = firstDate(assignedAt, firstReceivedAt, petition.sampleSentAt, startAt);
  const testingEndAt = maxDate(petition.qcCompletedAt, petition.labCompletedAt, petition.labApprovedAt, petition.completedAt, petition.approvedAt, petition.rejectedAt);
  const finalAt = maxDate(petition.approvedAt, petition.rejectedAt);
  const isClosed = CLOSED_STATUSES.has(petition.status);
  const activeEnd = isClosed ? finalAt : iso(now);
  const lastAt = maxDate(startAt, petition.sampleSentAt, petition.receivedAt, petition.qcReceivedAt, petition.labReceivedAt, assignedAt, petition.firstResultAt, petition.qcCompletedAt, petition.labCompletedAt, petition.labApprovedAt, petition.completedAt, petition.approvedAt, petition.rejectedAt) ?? startAt;
  const idleSince = validDate(lastAt);
  const isIdle = !isClosed && !!idleSince && now.getTime() - idleSince.getTime() > DAY_MS;

  const milestones = compactMilestones([
    { key: "submitted", label: "ยื่นคำขอ", at: startAt, done: true, tone: "intake" },
    { key: "sample-sent", label: "ส่งตัวอย่าง", at: petition.sampleSentAt ?? null, done: !!petition.sampleSentAt, tone: "intake" },
    { key: "qc-received", label: "QC รับ", at: petition.qcReceivedAt ?? petition.receivedAt ?? null, done: !!(petition.qcReceivedAt || petition.receivedAt), tone: "receive" },
    { key: "lab-received", label: "Lab รับ", at: petition.labReceivedAt ?? null, done: hasLab && !!petition.labReceivedAt, tone: "receive" },
    { key: "assigned", label: "Assign", at: assignedAt, done: !!assignedAt, tone: "testing" },
    { key: "first-result", label: "เริ่มบันทึกผล", at: petition.firstResultAt ?? null, done: !!petition.firstResultAt, tone: "testing" },
    { key: "qc-completed", label: "QC ครบ", at: petition.qcCompletedAt ?? null, done: !!petition.qcCompletedAt, tone: "testing" },
    { key: "lab-completed", label: "Lab ครบ", at: petition.labCompletedAt ?? null, done: hasLab && !!petition.labCompletedAt, tone: "lab" },
    { key: "lab-approved", label: "ออกผล Lab", at: petition.labApprovedAt ?? null, done: hasLab && !!petition.labApprovedAt, tone: "lab" },
    { key: petition.status === "rejected" ? "rejected" : "final-result", label: petition.status === "rejected" ? "ส่งกลับแก้ไข" : "Final Result", at: finalAt, done: !!finalAt, tone: petition.status === "rejected" ? "blocked" : "closed" },
  ]);

  const segments = [
    segment("intake", "นำส่งตัวอย่าง", startAt, firstDate(petition.sampleSentAt, firstReceivedAt, activeEnd), "intake", !petition.sampleSentAt && !firstReceivedAt && !isClosed),
    segment("receive-assign", "รับและมอบหมาย", firstReceivedAt ?? petition.sampleSentAt ?? null, assignedAt ?? firstDate(testingStartAt, activeEnd), "receive", !!firstReceivedAt && !assignedAt && !isClosed),
    segment("testing", "ตรวจวิเคราะห์", testingStartAt, testingEndAt ?? activeEnd, "testing", !testingEndAt && !isClosed),
    hasLab ? segment("lab-approval", "ออกผล Lab", petition.labCompletedAt ?? null, petition.labApprovedAt ?? activeEnd, "lab", !!petition.labCompletedAt && !petition.labApprovedAt && !isClosed) : null,
    segment("final", "ออก Final Result", testingEndAt ?? petition.completedAt ?? null, finalAt ?? activeEnd, isClosed ? "closed" : "final", !!testingEndAt && !finalAt && !isClosed),
  ].filter((item): item is PetitionTimelineSegment => !!item);
  const rowEnd = maxDate(lastAt, activeEnd, ...segments.map((item) => item.endAt)) ?? startAt;
  return { petition, startAt, endAt: rowEnd, lastAt, hasLabTrack: hasLab, isClosed, isIdle, milestones, segments };
}

export function buildTimelineWindow(rows: PetitionTimelineRow[], now: Date = new Date()): TimelineWindow {
  const dates = rows.flatMap((row) => [row.startAt, row.endAt, row.lastAt, ...row.milestones.map((item) => item.at), ...row.segments.flatMap((item) => [item.startAt, item.endAt])]).map(validDate).filter((date): date is Date => !!date);
  const today = startOfDay(now);
  if (dates.length === 0) return { startAt: iso(addDays(today, -7)), endAt: iso(addDays(today, 7)), todayAt: iso(today) };
  let min = addDays(startOfDay(new Date(Math.min(...dates.map((date) => date.getTime())))), -1);
  let max = addDays(startOfDay(new Date(Math.max(...dates.map((date) => date.getTime())))), 2);
  if (max.getTime() - min.getTime() < 7 * DAY_MS) { const mid = new Date((min.getTime() + max.getTime()) / 2); min = addDays(startOfDay(mid), -3); max = addDays(startOfDay(mid), 4); }
  return { startAt: iso(min), endAt: iso(max), todayAt: today >= min && today <= max ? iso(today) : null };
}

export function timelinePercent(at: string | null | undefined, window: TimelineWindow): number | null {
  const date = validDate(at); const start = validDate(window.startAt); const end = validDate(window.endAt);
  if (!date || !start || !end || end.getTime() <= start.getTime()) return null;
  return Math.max(0, Math.min(100, ((date.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
}

export function buildTimelineTicks(window: TimelineWindow): TimelineTick[] {
  const start = validDate(window.startAt); const end = validDate(window.endAt);
  if (!start || !end || end <= start) return [];
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
  const step = totalDays <= 14 ? 1 : totalDays <= 45 ? 3 : totalDays <= 120 ? 7 : 30;
  const ticks: TimelineTick[] = [];
  for (let offset = 0; offset <= totalDays; offset += step) {
    const at = addDays(start, offset);
    ticks.push({ key: iso(at), at: iso(at), label: formatDate(at), major: at.getDate() === 1 || offset === 0 });
  }
  return ticks;
}

export function buildTimelineSummary(rows: PetitionTimelineRow[], now: Date = new Date()): PetitionTimelineSummary {
  const isSummaryClosed = (row: PetitionTimelineRow) => row.isClosed || SUMMARY_CLOSED_STATUSES.has(row.petition.status);
  return {
    total: rows.length,
    inProgress: rows.filter((row) => !isSummaryClosed(row)).length,
    closed: rows.filter(isSummaryClosed).length,
    waiting: rows.filter((row) => !isSummaryClosed(row) && !!validDate(row.lastAt) && now.getTime() - validDate(row.lastAt)!.getTime() > DAY_MS).length,
  };
}
