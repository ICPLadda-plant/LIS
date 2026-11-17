export function formatCoaAiResult(value?: string | null): string {
  const text = value?.trim() || "";
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)\s*%?$/);
  if (!match) return text;

  const number = Number(match[1]);
  return Number.isFinite(number) ? `${(Math.round((number + Number.EPSILON) * 100) / 100).toFixed(2)}%` : text;
}
