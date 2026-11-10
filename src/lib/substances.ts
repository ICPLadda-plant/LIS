function splitTopLevelPlus(value: string): string[] {
  const parts: string[] = [];
  let currentPart = "";
  let parenthesisDepth = 0;

  for (const character of value) {
    if (character === "(") {
      parenthesisDepth += 1;
      currentPart += character;
      continue;
    }
    if (character === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      currentPart += character;
      continue;
    }
    if (character === "+" && parenthesisDepth === 0) {
      parts.push(currentPart);
      currentPart = "";
      continue;
    }
    currentPart += character;
  }

  parts.push(currentPart);
  return parts;
}

// Split a commonName into its component substances by top-level "+", merging
// short fragments (3+ parts) down to at most 2 substances. Used by Petition
// Assign, Master Items (Simple Method tab), and Standard Config to keep
// positional instrument arrays aligned across the app.
export function parseSubstances(commonName: string): string[] {
  const parts = splitTopLevelPlus(commonName).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return [commonName.trim()].filter(Boolean);
  if (parts.length <= 2) return parts;

  while (parts.length > 2) {
    let shortestIdx = 0;
    for (let i = 1; i < parts.length; i += 1) {
      if (parts[i].length < parts[shortestIdx].length) shortestIdx = i;
    }
    let neighborIdx: number;
    if (shortestIdx === 0) neighborIdx = 1;
    else if (shortestIdx === parts.length - 1) neighborIdx = shortestIdx - 1;
    else
      neighborIdx =
        parts[shortestIdx - 1].length <= parts[shortestIdx + 1].length
          ? shortestIdx - 1
          : shortestIdx + 1;

    const lo = Math.min(shortestIdx, neighborIdx);
    const hi = Math.max(shortestIdx, neighborIdx);
    const merged = `${parts[lo]} + ${parts[hi]}`;
    parts.splice(lo, hi - lo + 1, merged);
  }
  return parts;
}

export function substanceKey(value: string): string {
  return value.trim().toLowerCase();
}

// คีย์เทียบชื่อสินค้าแบบยืดหยุ่น ใช้เมื่อชื่อเต็มไม่ตรงกันทุกตัวอักษร:
// ไม่สนใจตัวพิมพ์/ช่องว่าง, ตัด "IMPORTED" ออกจากวงเล็บ, ตัด "W/V",
// ตัดศูนย์ท้ายทศนิยม (12.50 → 12.5) และเรียงสารในยาผสมให้ลำดับไม่มีผล
// "AZOXYSTROBIN 20%+DIFENOCONAZOLE 12.50% SC" กับ
// "DIFENOCONAZOLE 12.5% + AZOXYSTROBIN 20% W/V SC" ได้คีย์เดียวกัน
export function productMatchKey(value: string): string {
  let text = String(value ?? "").toLowerCase();
  text = text.replace(/\(([^()]*)\)/g, (_match, inner: string) => {
    const kept = inner.split(",").map((part) => part.trim()).filter((part) => part && part !== "imported");
    return kept.length ? ` (${kept.join(", ")}) ` : " ";
  });
  text = text
    .replace(/(^|[^a-z0-9])w\/v(?=[^a-z0-9]|$)/g, "$1 ")
    .replace(/(\d+\.\d*?)0+(?=\D|$)/g, "$1")
    .replace(/(\d)\.(?=\D|$)/g, "$1")
    .replace(/\s*%/g, "%")
    .replace(/\s+/g, " ")
    .trim();
  const parts = splitTopLevelPlus(text).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts.pop() ?? "";
  const lastMatch = last.match(/^(.*?\d%)(.*)$/);
  const actives = [...parts, lastMatch ? lastMatch[1].trim() : last].sort();
  const tail = lastMatch ? lastMatch[2].trim() : "";
  return [actives.join(" + "), tail].filter(Boolean).join(" ");
}

// Take the first whitespace-separated token. Used to reduce a product spec
// like "ABAMECTIN 1.8% W/V EC (BROWN)" to its active substance "ABAMECTIN".
// Used after parseSubstances() splits on "+".
export function extractSubstanceName(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] || "";
}

// Canonical match key for a substance: first whitespace token, trimmed + lowercased.
// Used on BOTH sides (config substanceStandards[].substance and test-time
// parseSubstances() output) so they line up regardless of trailing % / form spec.
export function matchSubstanceKey(name: string): string {
  return substanceKey(extractSubstanceName(name));
}

// Storage key for a per-substance value inside result.values:
// `${fieldLabel}::${matchSubstanceKey(substance)}`.
export function substanceFieldKey(label: string, substance: string): string {
  return `${label}::${matchSubstanceKey(substance)}`;
}

// แกะเลข %ฉลากจากชื่อสารดิบ (หลัง parseSubstances split "+" แล้ว).
// จับเลขที่ตามด้วย "%" ตัวแรก: "ABAMECTIN 1.8% W/V EC" → 1.8 ; "2,4-D 96% SL" → 96 (ข้าม "2,4").
// ไม่มี "%" → null (สารนั้นข้ามการตรวจโหมด labelTolerance).
export function parseLabelPercent(raw: string): number | null {
  const m = String(raw ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}
