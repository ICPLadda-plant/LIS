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
  if (header.endKind === "waiting") {
    return { label: "Estimate Time", value: "รอเริ่มงาน", hint: "Lab ยังไม่กดเริ่มงาน", tone: "warning" };
  }
  const approx = header.approximate ? " (ประมาณ)" : "";
  return {
    label: "Estimate Time",
    value: formatDateTime(header.endAt) + approx,
    hint: header.overdue ? "เกินกำหนด" : header.approximate ? "ไม่มี Standard Time ใช้ค่าเดา 4 ชม." : "ค่าประมาณ",
    tone: header.overdue ? "danger" : "default",
  };
}
