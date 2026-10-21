export const classificationTypes = [
  { key: "sg", code: "SG", label: "Sand granule (SG)", group: "sand" },
  { key: "ulv", code: "ULV", label: "น้ำ (ยูแอลวี)", group: "water" },
  { key: "ec", code: "EC", label: "น้ำ (อีซี)", group: "water" },
  { key: "ew", code: "EW", label: "น้ำ (อีดับเบิ้ลยู)", group: "water" },
  { key: "sc", code: "SC", label: "น้ำ (เอสซี)", group: "water" },
  { key: "sl", code: "SL", label: "น้ำ (เอสแอล)", group: "water" },
  { key: "me", code: "ME", label: "น้ำ (เอ็มอี)", group: "water" },
  { key: "zc", code: "ZC", label: "น้ำ (แซดซี)", group: "water" },
  { key: "wv", code: "W/V", label: "น้ำ (ดับเบิ้ลยูวี)", group: "water" },
  { key: "ww", code: "W/W", label: "ทราย/เม็ด", group: "sand" },
  { key: "wp", code: "WP", label: "ผง (ดับเบิลยูพี)", group: "powder" },
  { key: "wdg", code: "WDG", label: "เม็ด/ผงเม็ด (ดับเบิลยูดีจี)", group: "powder" },
  { key: "wg", code: "WG", label: "เม็ด/ผงเม็ด (ดับเบิลยูจี)", group: "powder" },
  { key: "gr", code: "GR", label: "ทราย/เม็ด (จีอาร์)", group: "sand" },
  { key: "st", code: "ST", label: "เม็ดละลายน้ำ (เอสที)", group: "sand" },
  { key: "gb", code: "GB", label: "ทราย/เม็ด (จีบี)", group: "sand" },
  { key: "sp", code: "SP", label: "ผง (เอสพี)", group: "powder" },
  { key: "ds", code: "DS", label: "ผง (ดีเอส)", group: "powder" },
  { key: "dp", code: "DP", label: "ผงฝุ่น", group: "powder" },
] as const;

export type ClassificationType = (typeof classificationTypes)[number];

export const productTypeLabels: Record<string, string> = {
  water: "น้ำ",
  sand: "ทราย",
  powder: "ผง",
  liquid: "ของเหลว",
  solid: "ของแข็ง",
};

function normalizeClassificationValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CLASSIFICATION_ALIASES = [
  { phrase: "SAND GRANULE", code: "SG" },
] as const;

function aliasPattern(phrase: string) {
  const words = phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(^|[^A-Z0-9])${words}([^A-Z0-9]|$)`);
}

function findClassificationByCode(code: string): ClassificationType | undefined {
  return classificationTypes.find((item) => item.code === code);
}

function getClassificationAlias(value: string): ClassificationType | undefined {
  const upperValue = value.toUpperCase();
  return CLASSIFICATION_ALIASES
    .map((alias) => (aliasPattern(alias.phrase).test(upperValue) ? findClassificationByCode(alias.code) : undefined))
    .find(Boolean);
}

export function getClassification(value: unknown): ClassificationType | undefined {
  const rawValue = String(value ?? "").trim();
  const normalized = normalizeClassificationValue(rawValue);
  const exactMatch = classificationTypes.find((item) => (
    normalizeClassificationValue(item.key) === normalized ||
    normalizeClassificationValue(item.code) === normalized ||
    normalizeClassificationValue(item.label) === normalized
  ));
  if (exactMatch) return exactMatch;

  const aliasMatch = getClassificationAlias(rawValue);
  if (aliasMatch) return aliasMatch;

  const upperValue = rawValue.toUpperCase();
  return [...classificationTypes]
    // W/V และ W/W เป็นหน่วยความเข้มข้น ไม่ใช่ประเภทสูตรเมื่ออยู่ในชื่อสามัญ
    .filter((item) => !COMMON_NAME_EXCLUDED_CODES.has(item.code))
    .sort((a, b) => b.code.length - a.code.length)
    .find((item) => {
      const pattern = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(item.code.toUpperCase())}([^A-Z0-9]|$)`);
      return pattern.test(upperValue);
    });
}

export function formatClassificationOption(code: string): string {
  const match = classificationTypes.find((c) => c.code === code);
  return match ? `${match.code} - ${match.label}` : code;
}

const COMMON_NAME_EXCLUDED_CODES = new Set(["W/V", "W/W"]);

const COMMON_NAME_CODES = classificationTypes
  .map((t) => t.code.toUpperCase())
  .filter((c) => !COMMON_NAME_EXCLUDED_CODES.has(c))
  .sort((a, b) => b.length - a.length);

function getCommonNameAlias(value: string): string {
  const upperValue = value.toUpperCase();
  const match = CLASSIFICATION_ALIASES.find((alias) => aliasPattern(alias.phrase).test(upperValue));
  return match?.code ?? "";
}

export function getCommonName(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const aliasHit = getCommonNameAlias(raw);
  if (aliasHit) return aliasHit;

  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const directHit = COMMON_NAME_CODES.find((c) => compact === c.replace(/\s+/g, ""));
  if (directHit) return directHit;

  const stripped = raw.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  const tokens = stripped.toUpperCase().split(/[\s,;|]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const cleaned = tokens[i].replace(/^[^A-Z0-9/]+|[^A-Z0-9/]+$/g, "");
    if (!cleaned) continue;
    if (COMMON_NAME_EXCLUDED_CODES.has(cleaned)) continue;
    if (COMMON_NAME_CODES.includes(cleaned)) return cleaned;
  }

  return "";
}
