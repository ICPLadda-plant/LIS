function validIsoDate(year: number, month: number, day: number): string {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function productionDateFromLotNo(lotNo?: string): string {
  const value = String(lotNo || "").trim();
  const fg = value.match(/^FG(\d{2})(\d{2})(\d{2})(?:-|$)/i);
  if (fg) return validIsoDate(2000 + Number(fg[1]), Number(fg[2]), Number(fg[3]));

  const suffix = value.match(/([0-3]\d)([01]\d)(\d{2})$/);
  if (suffix) return validIsoDate(2500 + Number(suffix[3]) - 543, Number(suffix[2]), Number(suffix[1]));
  return "";
}
