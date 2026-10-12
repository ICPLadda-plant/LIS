export type DateTimeValue = Date | string | number | null | undefined;

function parseDate(value: DateTimeValue): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "string") {
    const match = value.trim().match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?$/i,
    );
    if (match) {
      const [, month, day, year, rawHour = "0", minute = "0", period] = match;
      let hour = Number(rawHour);
      if (period) hour = (hour % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
      const date = new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatDate(value: DateTimeValue, fallback = "-"): string {
  const date = parseDate(value);
  return date ? `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` : fallback;
}

export function formatTime(value: DateTimeValue, fallback = "-"): string {
  const date = parseDate(value);
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : fallback;
}

export function formatMonth(value: DateTimeValue, fallback = "-"): string {
  const date = parseDate(value);
  return date ? `${pad(date.getMonth() + 1)}/${date.getFullYear()}` : fallback;
}

export function formatDateTime(value: DateTimeValue, fallback = "-"): string {
  const date = parseDate(value);
  return date ? `${formatDate(date)} ${formatTime(date)}` : fallback;
}
