import {
  PETITION_STATUS_CONFIG, PETITION_DEPT_LABELS,
  type Petition, type PetitionStatus, type PetitionDept,
} from "@/types/petition.types";
import type { KpiId } from "@/lib/dashboardProfiles";
import { labReceivedAt, qcReceivedAt, qcReceivedBy } from "@/lib/receiveStatus";
import { readSlotMethods, type MethodDoc } from "@/lib/methodRegistry";
import { parseSubstances } from "@/lib/substances";
import type {
  StockGlasswareItem,
  StockSolventItem,
  StockStandardItem,
  StockTransactionItem,
  StockUnitItem,
} from "@/types/stock";
import { summarizeStandard } from "@/lib/stockStatus";
import { formatDate } from "@/lib/dateTime";
import { isUrgentPetition, prioritizeUrgentPetitions } from "@/lib/urgentPetition";

export { isUrgentPetition, prioritizeUrgentPetitions };

export interface MetricsCtx {
  petitions: Petition[];
  now: number;
  abnormalFlags: Record<string, boolean>;
  returnedFlags: Record<string, boolean>;
  pendingQcCount: number;
  assignedToMeCount: number;
  usersTotal: number;
  usersActive: number;
  rolesTotal: number;
  dailyCheckPending: number;
  dailyCheckDone: number;
  dailyCheckTotal: number;
  dailyCheckLoading: boolean;
  stockLow: number;
  stockExpiring: number;
  withdrawalsToday: number;
  withdrawalsYesterday: number;
  qcApprovedToday: number;
  qcApprovedYesterday: number;
  methodGaps: number;
  masterItemsTotal: number;
  labInventorySummary: LabInventorySummary;
  labInventoryLoading: boolean;
  deductionTrend: DeductionTrendDatum[];
  simpleMethodCoverage: ConfigPieDatum[];
  standardTimeCoverage: ConfigPieDatum[];
  configCoverageLoading: boolean;
}

export interface KpiValue { value: number; delta?: number }

// ---- date helpers ----
export function ageHours(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 3_600_000));
}
function startOfLocalDay(now: number, dayOffset = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - dayOffset);
  return d.getTime();
}

export function localDayWindow(now: number, days: number): { createdFrom: string; createdTo: string } {
  return {
    createdFrom: new Date(startOfLocalDay(now, days - 1)).toISOString(),
    createdTo: new Date(startOfLocalDay(now, -1)).toISOString(),
  };
}
export function isSameLocalDay(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= startOfLocalDay(now, 0) && t < startOfLocalDay(now, -1);
}
export function isPrevLocalDay(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= startOfLocalDay(now, 1) && t < startOfLocalDay(now, 0);
}

// ---- aggregations ----
const STATUS_COLORS: Record<PetitionStatus, string> = {
  deliveringQC: "hsl(215,16%,60%)",
  sampleSent: "hsl(217,91%,60%)",
  pendingReview: "hsl(38,92%,50%)",
  inProgress: "hsl(217,91%,55%)",
  success: "hsl(142,71%,45%)",
  approved: "hsl(142,71%,40%)",
  rejected: "hsl(0,72%,51%)",
};

export function countByStatus(petitions: Petition[]): Record<PetitionStatus, number> {
  const out = {
    deliveringQC: 0, sampleSent: 0, pendingReview: 0, inProgress: 0,
    success: 0, approved: 0, rejected: 0,
  } as Record<PetitionStatus, number>;
  for (const p of petitions) out[p.status] = (out[p.status] ?? 0) + 1;
  return out;
}

export function statusDonutData(petitions: Petition[]) {
  const counts = countByStatus(petitions);
  return (Object.keys(counts) as PetitionStatus[])
    .filter((k) => counts[k] > 0)
    .map((k) => ({ key: k, label: PETITION_STATUS_CONFIG[k].label, value: counts[k], color: STATUS_COLORS[k] }));
}

const PIPELINE: { key: PetitionStatus; label: string }[] = [
  { key: "sampleSent", label: "รอรับ" },
  { key: "pendingReview", label: "รับแล้ว" },
  { key: "inProgress", label: "กำลังตรวจ" },
  { key: "success", label: "เสร็จ" },
];
export function pipelineStages(petitions: Petition[]) {
  const counts = countByStatus(petitions);
  return PIPELINE.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }));
}

export function deptWorkloadData(petitions: Petition[]) {
  const by = {} as Record<PetitionDept, number>;
  for (const p of petitions) by[p.dept] = (by[p.dept] ?? 0) + 1;
  return (Object.keys(PETITION_DEPT_LABELS) as PetitionDept[])
    .map((d) => ({ dept: d, label: PETITION_DEPT_LABELS[d], count: by[d] ?? 0 }))
    .filter((x) => x.count > 0);
}

export function analystWorkloadData(petitions: Petition[]) {
  const by = new Map<string, number>();
  for (const p of petitions) {
    if (p.status !== "inProgress") continue;
    const name = p.assignedTo?.name?.trim();
    if (!name) continue;
    by.set(name, (by.get(name) ?? 0) + 1);
  }
  return [...by.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function normalDonutData(petitions: Petition[], abnormalFlags: Record<string, boolean>) {
  let abnormal = 0;
  for (const p of petitions) if (abnormalFlags[p._id]) abnormal += 1;
  const normal = petitions.length - abnormal;
  return [
    { key: "normal", label: "ปกติ", value: normal, color: "hsl(142,71%,45%)" },
    { key: "abnormal", label: "ผิดปกติ", value: abnormal, color: "hsl(0,72%,51%)" },
  ].filter((x) => x.value > 0);
}

export function requestTrendData(petitions: Petition[], now: number, days: number) {
  const buckets: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = startOfLocalDay(now, i);
    const end = startOfLocalDay(now, i - 1);
    const label = formatDate(start);
    const count = petitions.filter((p) => {
      const t = new Date(p.createdAt).getTime();
      return t >= start && t < end;
    }).length;
    buckets.push({ date: label, count });
  }
  return buckets;
}

export type LabWorklistFilter = "assignedToMe" | "inProgress" | "completedToday";
export type LabHeadWorklistFilter = "all" | "waitingReceive" | "pendingAssign" | "pendingApproval" | "completedToday";
export type LabHeadWorkloadPeriod = "today" | "weekly" | "monthly";
export type QcStaffWorklistFilter = "waitingReceive" | "inProgress" | "waitingReview" | "approvedToday";
export type QcParticipantMap = Record<string, readonly string[]>;

export interface LabDashboardUser {
  employeeId?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface LabWeekdayBucket {
  key: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  label: string;
  count: number;
}

export type WeekdayWorkloadBasis = "labAssigned" | "qcSampleSent";

const WEEKDAY_BUCKETS: LabWeekdayBucket[] = [
  { key: "mon", label: "จันทร์", count: 0 },
  { key: "tue", label: "อังคาร", count: 0 },
  { key: "wed", label: "พุธ", count: 0 },
  { key: "thu", label: "พฤหัส", count: 0 },
  { key: "fri", label: "ศุกร์", count: 0 },
  { key: "sat", label: "เสาร์", count: 0 },
  { key: "sun", label: "อาทิตย์", count: 0 },
];

function assignmentIso(p: Petition): string | null | undefined {
  return p.assignedTo?.assignedAt ?? p.receivedAt ?? p.sampleSentAt ?? p.createdAt;
}

function weekdayWorkloadIso(p: Petition, basis: WeekdayWorkloadBasis): string | null | undefined {
  if (basis === "qcSampleSent") return p.sampleSentAt ?? p.createdAt;
  if (!p.assignedTo) return null;
  return p.assignedTo.assignedAt ?? assignmentIso(p);
}

function qcAssignmentIso(p: Petition): string | null | undefined {
  return qcReceivedAt(p) ?? assignmentIso(p);
}

function completionIso(p: Petition): string | null | undefined {
  return p.completedAt ?? p.approvedAt ?? p.updatedAt;
}

function labCompletionIso(p: Petition): string | null | undefined {
  return p.labCompletedAt ?? p.completedAt ?? p.approvedAt ?? p.updatedAt;
}

function qcCompletionIso(p: Petition): string | null | undefined {
  return p.qcCompletedAt ?? p.completedAt ?? p.approvedAt ?? p.updatedAt;
}

function approvalIso(p: Petition): string | null | undefined {
  return p.approvedAt ?? p.completedAt ?? p.updatedAt;
}

function timeValue(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function localWeekWindow(now: number): { start: number; end: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}

function localMonthWindow(now: number): { start: number; end: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

function labHeadPeriodWindow(now: number, period: LabHeadWorkloadPeriod): { start: number; end: number } {
  if (period === "weekly") return localWeekWindow(now);
  if (period === "monthly") return localMonthWindow(now);
  return { start: startOfLocalDay(now, 0), end: startOfLocalDay(now, -1) };
}

function normalizedPerson(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function isCurrentUserName(value: string | null | undefined, user: LabDashboardUser | null | undefined): boolean {
  const candidate = normalizedPerson(value);
  if (!candidate || !user) return false;
  return [user.name, user.email].some((part) => normalizedPerson(part) === candidate);
}

export function isAssignedToUser(p: Petition, user: LabDashboardUser | null | undefined): boolean {
  const assigned = p.assignedTo;
  if (!user || !assigned) return false;
  const userEmployeeId = user.employeeId?.trim();
  const assignedEmployeeId = assigned.employeeId?.trim();
  if (userEmployeeId && assignedEmployeeId && userEmployeeId === assignedEmployeeId) return true;
  const userName = user.name?.trim();
  const assignedName = assigned.name?.trim();
  return !!userName && !!assignedName && userName === assignedName;
}

export function buildLabWorklist(
  petitions: Petition[],
  filter: LabWorklistFilter,
  user: LabDashboardUser | null | undefined,
  now: number,
): Petition[] {
  const rows = petitions.filter((p) => {
    if (!isAssignedToUser(p, user)) return false;
    if (filter === "assignedToMe") return !p.labCompletedAt && p.status !== "success" && p.status !== "approved" && p.status !== "rejected";
    if (filter === "inProgress") return p.status === "inProgress" && !!labReceivedAt(p) && !p.labCompletedAt;
    return !!p.labCompletedAt && isSameLocalDay(labCompletionIso(p), now);
  });

  const rowTime = filter === "completedToday" ? labCompletionIso : assignmentIso;
  return rows.sort((a, b) => timeValue(rowTime(b)) - timeValue(rowTime(a)));
}

export function labWorklistCounts(
  petitions: Petition[],
  user: LabDashboardUser | null | undefined,
  now: number,
): Record<LabWorklistFilter, number> {
  return {
    assignedToMe: buildLabWorklist(petitions, "assignedToMe", user, now).length,
    inProgress: buildLabWorklist(petitions, "inProgress", user, now).length,
    completedToday: buildLabWorklist(petitions, "completedToday", user, now).length,
  };
}

function isTerminalLabHeadStatus(status: PetitionStatus): boolean {
  return status === "approved" || status === "rejected";
}

function isLabHeadWaitingReceive(p: Petition): boolean {
  return p.status === "sampleSent" && !!p.assignedTo && !labReceivedAt(p) && !p.labCompletedAt && !p.labApprovedAt && !isTerminalLabHeadStatus(p.status);
}

function isLabHeadPendingAssign(p: Petition): boolean {
  return p.status === "sampleSent" && !p.assignedTo && !p.labCompletedAt && !p.labApprovedAt && !isTerminalLabHeadStatus(p.status);
}

function isLabHeadPendingApproval(p: Petition): boolean {
  return !!p.labCompletedAt && !p.labApprovedAt;
}

function isLabHeadOpenWork(p: Petition): boolean {
  if (isTerminalLabHeadStatus(p.status)) return false;
  if (p.labApprovedAt) return false;
  return isLabHeadPendingApproval(p) || !p.labCompletedAt;
}

function labHeadPriority(p: Petition): number {
  if (isLabHeadPendingApproval(p)) return 3;
  if (p.assignedTo) return 2;
  if (isLabHeadPendingAssign(p)) return 1;
  return 0;
}

function labHeadRowIso(p: Petition, filter: LabHeadWorklistFilter): string | null | undefined {
  if (filter === "pendingApproval" || filter === "completedToday") return labCompletionIso(p);
  if (filter === "waitingReceive") return p.sampleSentAt ?? p.receivedAt ?? p.createdAt;
  if (filter === "pendingAssign") return p.sampleSentAt ?? p.receivedAt ?? p.createdAt;
  return isLabHeadPendingApproval(p) ? labCompletionIso(p) : assignmentIso(p);
}

export function buildLabHeadWorklist(
  petitions: Petition[],
  filter: LabHeadWorklistFilter,
  now: number,
): Petition[] {
  const rows = petitions.filter((p) => {
    if (filter === "all") return isLabHeadOpenWork(p);
    if (filter === "waitingReceive") return isLabHeadWaitingReceive(p);
    if (filter === "pendingAssign") return isLabHeadPendingAssign(p);
    if (filter === "pendingApproval") return isLabHeadPendingApproval(p);
    return !!p.labCompletedAt && isSameLocalDay(labCompletionIso(p), now);
  });

  return rows.sort((a, b) => {
    const byTime = timeValue(labHeadRowIso(b, filter)) - timeValue(labHeadRowIso(a, filter));
    if (byTime !== 0) return byTime;
    if (filter === "all") return labHeadPriority(b) - labHeadPriority(a);
    return 0;
  });
}

export function labHeadWorklistCounts(
  petitions: Petition[],
  now: number,
): Record<LabHeadWorklistFilter, number> {
  return {
    all: buildLabHeadWorklist(petitions, "all", now).length,
    waitingReceive: buildLabHeadWorklist(petitions, "waitingReceive", now).length,
    pendingAssign: buildLabHeadWorklist(petitions, "pendingAssign", now).length,
    pendingApproval: buildLabHeadWorklist(petitions, "pendingApproval", now).length,
    completedToday: buildLabHeadWorklist(petitions, "completedToday", now).length,
  };
}

export function labHeadAnalystWorkloadData(
  petitions: Petition[],
  now: number,
  period: LabHeadWorkloadPeriod,
): { name: string; count: number }[] {
  const { start, end } = labHeadPeriodWindow(now, period);
  const byName = new Map<string, number>();

  for (const p of petitions) {
    const name = p.assignedTo?.name?.trim();
    if (!name) continue;
    const assignedAt = timeValue(assignmentIso(p));
    if (!assignedAt || assignedAt < start || assignedAt >= end) continue;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }

  return [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th"));
}

export function isQcParticipant(
  p: Petition,
  user: LabDashboardUser | null | undefined,
  participantNames: readonly string[] = [],
): boolean {
  return [qcReceivedBy(p), p.qcCompletedBy, ...participantNames].some((name) => isCurrentUserName(name, user));
}

export function buildQcStaffWorklist(
  petitions: Petition[],
  filter: QcStaffWorklistFilter = "inProgress",
  user?: LabDashboardUser | null,
  now = Date.now(),
  participantsByPetition: QcParticipantMap = {},
): Petition[] {
  const rows = petitions.filter((p) => {
    const participantNames = participantsByPetition[p._id] ?? [];
    if (filter === "waitingReceive") return p.status === "sampleSent";
    if (filter === "inProgress") {
      return p.status === "inProgress" && (!!qcReceivedAt(p) || isQcParticipant(p, user, participantNames));
    }
    if (filter === "waitingReview") {
      return p.status === "success" && isQcParticipant(p, user, participantNames);
    }
    return p.status === "approved" && isSameLocalDay(approvalIso(p), now);
  });

  const rowTime =
    filter === "waitingReview" ? qcCompletionIso :
    filter === "approvedToday" ? approvalIso :
    filter === "inProgress" ? qcAssignmentIso :
    assignmentIso;
  return rows.sort((a, b) => timeValue(rowTime(b)) - timeValue(rowTime(a)));
}

export function qcStaffWorklistCounts(
  petitions: Petition[],
  user: LabDashboardUser | null | undefined,
  now: number,
  participantsByPetition: QcParticipantMap = {},
): Record<QcStaffWorklistFilter, number> {
  return {
    waitingReceive: buildQcStaffWorklist(petitions, "waitingReceive", user, now, participantsByPetition).length,
    inProgress: buildQcStaffWorklist(petitions, "inProgress", user, now, participantsByPetition).length,
    waitingReview: buildQcStaffWorklist(petitions, "waitingReview", user, now, participantsByPetition).length,
    approvedToday: buildQcStaffWorklist(petitions, "approvedToday", user, now, participantsByPetition).length,
  };
}

export function paginateLabWorklist<T>(rows: T[], page: number, pageSize = 4) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(page)));
  const start = (safePage - 1) * safePageSize;
  return {
    pageRows: rows.slice(start, start + safePageSize),
    page: safePage,
    totalPages,
    total,
  };
}

export function assignedWeekdayData(
  petitions: Petition[],
  now = Date.now(),
  basis: WeekdayWorkloadBasis = "labAssigned",
): LabWeekdayBucket[] {
  const { start, end } = localWeekWindow(now);
  const byKey = new Map<LabWeekdayBucket["key"], LabWeekdayBucket>(
    WEEKDAY_BUCKETS.map((d) => [d.key, { ...d }]),
  );

  for (const p of petitions) {
    const t = timeValue(weekdayWorkloadIso(p, basis));
    if (!t || t < start || t >= end) continue;
    const day = new Date(t).getDay();
    const key: LabWeekdayBucket["key"] =
      day === 0 ? "sun" :
      day === 1 ? "mon" :
      day === 2 ? "tue" :
      day === 3 ? "wed" :
      day === 4 ? "thu" :
      day === 5 ? "fri" :
      "sat";
    const bucket = byKey.get(key);
    if (bucket) bucket.count += 1;
  }

  const ordered = WEEKDAY_BUCKETS.map((d) => byKey.get(d.key) ?? d);
  return ordered.filter((d) => d.key !== "sun" || d.count > 0);
}

export type LabInventorySummaryKey = "nearEmpty" | "outOfStock" | "nearExpiry" | "todayDeductions";

export interface LabInventorySummaryDatum {
  key: LabInventorySummaryKey;
  label: string;
  value: number;
  color: string;
}

export interface LabInventorySummary {
  nearEmpty: number;
  outOfStock: number;
  nearExpiry: number;
  todayDeductions: number;
  rows: LabInventorySummaryDatum[];
}

export interface LabInventorySummaryInput {
  standards: StockStandardItem[];
  units: StockUnitItem[];
  solvents: StockSolventItem[];
  glassware: StockGlasswareItem[];
  deductions: StockTransactionItem[];
  now: number;
}

export interface DeductionTrendDatum {
  date: string;
  count: number;
}

export const EMPTY_LAB_INVENTORY_SUMMARY: LabInventorySummary = {
  nearEmpty: 0,
  outOfStock: 0,
  nearExpiry: 0,
  todayDeductions: 0,
  rows: [
    { key: "nearEmpty", label: "ใกล้หมด", value: 0, color: "hsl(38,92%,50%)" },
    { key: "outOfStock", label: "หมดสต็อก", value: 0, color: "hsl(0,72%,51%)" },
    { key: "nearExpiry", label: "ใกล้หมดอายุ", value: 0, color: "hsl(262,83%,58%)" },
    { key: "todayDeductions", label: "เบิกวันนี้", value: 0, color: "hsl(217,91%,55%)" },
  ],
};

function unitsByItemCode(units: StockUnitItem[]): Map<string, StockUnitItem[]> {
  const byCode = new Map<string, StockUnitItem[]>();
  for (const unit of units) {
    const code = String(unit.itemCode || "").trim();
    if (!code) continue;
    const current = byCode.get(code) ?? [];
    current.push(unit);
    byCode.set(code, current);
  }
  return byCode;
}

function localDayLabel(timestamp: number): string {
  return formatDate(timestamp);
}

export function labInventorySummaryData(input: LabInventorySummaryInput): LabInventorySummary {
  const nowDate = new Date(input.now);
  const unitsByCode = unitsByItemCode(input.units);
  let nearEmpty = 0;
  let outOfStock = 0;
  let nearExpiry = 0;

  for (const standard of input.standards) {
    const summary = summarizeStandard(unitsByCode.get(standard.code) ?? [], nowDate);
    if (summary.usable === 1) nearEmpty += 1;
    if (summary.usable === 0) outOfStock += 1;
    if (summary.expiringSoon > 0) nearExpiry += 1;
  }

  for (const item of input.solvents) {
    const qty = Number(item.qty) || 0;
    if (qty === 1) nearEmpty += 1;
    if (qty === 0) outOfStock += 1;
  }

  for (const item of input.glassware) {
    const qty = Number(item.qty) || 0;
    if (qty === 0) outOfStock += 1;
  }

  const todayDeductions = input.deductions.filter(
    (transaction) => transaction.action === "deduct" && isSameLocalDay(transaction.createdAt, input.now),
  ).length;

  return {
    nearEmpty,
    outOfStock,
    nearExpiry,
    todayDeductions,
    rows: [
      { key: "nearEmpty", label: "ใกล้หมด", value: nearEmpty, color: "hsl(38,92%,50%)" },
      { key: "outOfStock", label: "หมดสต็อก", value: outOfStock, color: "hsl(0,72%,51%)" },
      { key: "nearExpiry", label: "ใกล้หมดอายุ", value: nearExpiry, color: "hsl(262,83%,58%)" },
      { key: "todayDeductions", label: "เบิกวันนี้", value: todayDeductions, color: "hsl(217,91%,55%)" },
    ],
  };
}

export function deductionTrendData(
  transactions: StockTransactionItem[],
  now: number,
  days: number,
): DeductionTrendDatum[] {
  const buckets: DeductionTrendDatum[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = startOfLocalDay(now, i);
    const end = startOfLocalDay(now, i - 1);
    const count = transactions.filter((transaction) => {
      if (transaction.action !== "deduct") return false;
      const t = new Date(transaction.createdAt).getTime();
      return t >= start && t < end;
    }).length;
    buckets.push({ date: localDayLabel(start), count });
  }
  return buckets;
}

/** success/approved whose completedAt (fallback approvedAt/updatedAt) lands on local day `dayOffset`. */
export function completedIn(petitions: Petition[], now: number, dayOffset: number): number {
  const start = startOfLocalDay(now, dayOffset);
  const end = startOfLocalDay(now, dayOffset - 1);
  return petitions.filter((p) => {
    if (p.status !== "success" && p.status !== "approved") return false;
    const iso = p.completedAt ?? p.approvedAt ?? p.updatedAt;
    const t = new Date(iso).getTime();
    return t >= start && t < end;
  }).length;
}

function countStatus(petitions: Petition[], status: PetitionStatus): number {
  return petitions.filter((p) => p.status === status).length;
}
function countFlags(flags: Record<string, boolean>): number {
  return Object.values(flags).filter(Boolean).length;
}

export interface ConfigPieDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface SimpleMethodCoverageItem {
  itemNo?: string;
  commonName?: string;
}

export interface SimpleMethodCoverageEntry {
  itemNo: string;
  methods?: string[][];
  instruments?: string[];
}

export interface StandardTimeCoverageSummary {
  _id: string;
  total: number;
  withData: number;
}

const CONFIG_COLORS = {
  gc: "hsl(217,91%,55%)",
  hplc: "hsl(142,71%,42%)",
  both: "hsl(262,83%,58%)",
  unassigned: "hsl(38,92%,50%)",
};

const STANDARD_TIME_COLORS = [
  "hsl(217,91%,55%)",
  "hsl(142,71%,42%)",
  "hsl(262,83%,58%)",
  "hsl(189,94%,43%)",
  "hsl(330,81%,60%)",
  "hsl(24,95%,53%)",
];

function normalizeCode(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function configuredMachinePrefixes(
  codes: string[],
  methodByCode: Map<string, MethodDoc>,
): Set<"GC" | "HPLC"> {
  const prefixes = new Set<"GC" | "HPLC">();
  for (const code of codes) {
    const method = methodByCode.get(normalizeCode(code));
    if (!method || !method.requiresMachine) continue;
    const prefix = normalizeCode(method.machinePrefix);
    if (prefix === "GC" || prefix === "HPLC") prefixes.add(prefix);
  }
  return prefixes;
}

function pieDatum(key: string, label: string, value: number, color: string): ConfigPieDatum | null {
  return value > 0 ? { key, label, value, color } : null;
}

export function simpleMethodCoverageData(
  items: SimpleMethodCoverageItem[],
  entries: SimpleMethodCoverageEntry[],
  methods: MethodDoc[],
): ConfigPieDatum[] {
  const methodByCode = new Map(methods.map((method) => [normalizeCode(method.code), method]));
  const entryByItemNo = new Map(entries.map((entry) => [String(entry.itemNo || "").trim(), entry]));
  const counts = { gc: 0, hplc: 0, both: 0, unassigned: 0 };

  for (const item of items) {
    const itemNo = String(item.itemNo || "").trim();
    const commonName = String(item.commonName || "").trim();
    if (!itemNo || !commonName) continue;

    const substances = parseSubstances(commonName);
    const entry = entryByItemNo.get(itemNo);
    const slots = entry ? readSlotMethods(entry, substances.length) : Array.from({ length: substances.length }, () => []);

    for (const slot of slots) {
      const prefixes = configuredMachinePrefixes(slot, methodByCode);
      const hasGc = prefixes.has("GC");
      const hasHplc = prefixes.has("HPLC");
      if (hasGc && hasHplc) counts.both += 1;
      else if (hasGc) counts.gc += 1;
      else if (hasHplc) counts.hplc += 1;
      else counts.unassigned += 1;
    }
  }

  return [
    pieDatum("gc", "GC", counts.gc, CONFIG_COLORS.gc),
    pieDatum("hplc", "HPLC", counts.hplc, CONFIG_COLORS.hplc),
    pieDatum("both", "GC + HPLC", counts.both, CONFIG_COLORS.both),
    pieDatum("unassigned", "ยังไม่ได้กำหนด", counts.unassigned, CONFIG_COLORS.unassigned),
  ].filter((row): row is ConfigPieDatum => Boolean(row));
}

export function standardTimeCoverageData(summary: StandardTimeCoverageSummary[]): ConfigPieDatum[] {
  const rows: ConfigPieDatum[] = [];
  let unassigned = 0;

  summary.forEach((row, index) => {
    const label = String(row._id || "").trim() || "ไม่ระบุเครื่อง";
    const total = Math.max(0, Number(row.total) || 0);
    const withData = Math.max(0, Number(row.withData) || 0);
    const configured = Math.min(total, withData);
    unassigned += Math.max(0, total - configured);
    if (configured > 0) {
      rows.push({
        key: `instrument-${label}`,
        label,
        value: configured,
        color: STANDARD_TIME_COLORS[index % STANDARD_TIME_COLORS.length],
      });
    }
  });

  const missing = pieDatum("unassigned", "ยังไม่กำหนด", unassigned, CONFIG_COLORS.unassigned);
  return missing ? [...rows, missing] : rows;
}

// ---- KPI dispatch ----
export function computeKpi(id: KpiId, ctx: MetricsCtx): KpiValue {
  const P = ctx.petitions;
  switch (id) {
    case "urgentTotal": return { value: P.filter(isUrgentPetition).length };
    case "petitionsTotal": return { value: P.length };
    case "inProgress": return { value: countStatus(P, "inProgress") };
    case "waitingReceive": return { value: countStatus(P, "sampleSent") };
    case "pendingAssign": return { value: P.filter(isLabHeadPendingAssign).length };
    case "waitingSendLab": return { value: countStatus(P, "pendingReview") };
    case "waitingReview": return { value: countStatus(P, "success") };
    case "completedTotal": return { value: countStatus(P, "success") + countStatus(P, "approved") };
    case "activeTotal":
      return { value: countStatus(P, "inProgress") + countStatus(P, "pendingReview") + countStatus(P, "sampleSent") };
    case "pendingApprovalQc": return { value: ctx.pendingQcCount };
    case "pendingApprovalLab": return { value: P.filter(isLabHeadPendingApproval).length };
    case "labHeadAll": return { value: P.filter(isLabHeadOpenWork).length };
    case "labHeadWaitingReceive": return { value: P.filter(isLabHeadWaitingReceive).length };
    case "labHeadPendingApproval": return { value: P.filter(isLabHeadPendingApproval).length };
    case "assignedToMe": return { value: ctx.assignedToMeCount };
    case "completedToday":
      return { value: completedIn(P, ctx.now, 0), delta: completedIn(P, ctx.now, 0) - completedIn(P, ctx.now, 1) };
    case "approvedToday":
      return { value: ctx.qcApprovedToday, delta: ctx.qcApprovedToday - ctx.qcApprovedYesterday };
    case "qcApprovedToday":
      return { value: ctx.qcApprovedToday, delta: ctx.qcApprovedToday - ctx.qcApprovedYesterday };
    case "withdrawalsToday":
      return { value: ctx.withdrawalsToday, delta: ctx.withdrawalsToday - ctx.withdrawalsYesterday };
    case "abnormalResults": return { value: countFlags(ctx.abnormalFlags) };
    case "returnedTotal": return { value: countFlags(ctx.returnedFlags) };
    case "normalRateApprox": {
      const total = P.length;
      const abn = countFlags(ctx.abnormalFlags);
      return { value: total === 0 ? 100 : Math.round(100 * (1 - abn / total)) };
    }
    case "usersTotal": return { value: ctx.usersTotal };
    case "usersActive": return { value: ctx.usersActive };
    case "rolesTotal": return { value: ctx.rolesTotal };
    case "dailyCheckPending": return { value: ctx.dailyCheckPending };
    case "stockLow": return { value: ctx.stockLow };
    case "stockExpiring": return { value: ctx.stockExpiring };
    case "methodGaps": return { value: ctx.methodGaps };
    case "masterItemsTotal": return { value: ctx.masterItemsTotal };
    default: return { value: 0 };
  }
}
