import type { TimelineDetailModel } from "@/lib/petitionTimelineDetail";
import { formatDateTime as formatDisplayDateTime } from "@/lib/dateTime";

export type TimelineMetricTone = "default" | "warning" | "danger";
export type TimelineMetric = { label: string; value: string; hint?: string; tone?: TimelineMetricTone };

export function formatDateTime(value: string): string {
  return formatDisplayDateTime(value);
}

export function estimateMetric(header: TimelineDetailModel["header"]): TimelineMetric {
  if (header.endKind === "actual") {
    return { label: "End time", value: formatDateTime(header.endAt) };
  }
  if (header.endKind === "unreceived") {
    return { label: "Estimate Time", value: "คาดว่าผลจะออก 1-2 วัน", hint: "ยังไม่รับงาน", tone: "warning" };
  }
  return {
    label: "Estimate Time",
    value: formatDateTime(header.endAt),
    hint: header.overdue ? "เลยกำหนด" : "ค่าประมาณ",
    tone: header.overdue ? "danger" : "default",
  };
}
