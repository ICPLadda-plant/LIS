import { PESTICIDE_TEST_METHODS, type PesticideTestMethodEntry } from "@/lib/pesticideTestMethods.data";

// ชื่อสารที่สะกดต่างจากเอกสาร FM-QP-07-01-002 ให้ชี้กลับไปชื่อในเอกสาร
const ALIASES: Record<string, string> = {
  acetamiprid: "acetameiprid",
  difenoconazole: "difenoconazol",
  flumioxazin: "flumioxozin",
  kasugamycin: "kazukamycin",
  pyrazosulfuronethyl: "pyrasosulfuronethyl",
  hexythiazox: "hexythaizox",
  spirodiclofen: "spirodiolofen",
  chlorantraniliprole: "cholorantraniliprole",
  acetochlor: "acetachlor",
  amitraz: "ametraz",
  anilofos: "anilophos",
  cyhalofopbutyl: "cyhalofobbutyl",
  cypermethrin: "cypermetrin",
  deltamethrin: "deltametrin",
  hexaconazole: "hexaconazol",
  imazalil: "lmazaryl",
  lambdacyhalothrin: "lamdacyhalotrin",
  permethrin: "permethin",
  profenofos: "profenophos",
  propiconazole: "propiconazol",
  tebuconazole: "tebuconazol",
  hexazinone: "hexazinon",
  chlorpyriphos: "chlorpyrifos",
  glyphosate: "glyphosateipa",
  paraquat: "paraquatdichloride",
};

const normalize = (value: string) => value.toLowerCase().replace(/\*\s*(tech|ec\/m)\b/g, "").replace(/[^a-z0-9]/g, "");

const byName = new Map<string, PesticideTestMethodEntry[]>();
PESTICIDE_TEST_METHODS.forEach((entry) => {
  const key = normalize(entry.name);
  byName.set(key, [...(byName.get(key) ?? []), entry]);
});
const keysByLength = [...byName.keys()].sort((a, b) => b.length - a.length);
const aliasesByLength = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

function findEntries(name: string): PesticideTestMethodEntry[] {
  const key = normalize(name);
  if (key.length < 4) return [];
  const exact = byName.get(key) ?? byName.get(ALIASES[key] ?? "");
  if (exact) return exact;
  const contained = keysByLength.find((k) => k.length >= 5 && key.includes(k));
  if (contained) return byName.get(contained) ?? [];
  const alias = aliasesByLength.find((a) => key.includes(a));
  return alias ? byName.get(ALIASES[alias]) ?? [] : [];
}

/** วิธีทดสอบตาม FM-QP-07-01-002 ของสารที่ระบุ หรือ "" ถ้าไม่พบในเอกสาร */
export function pesticideTestMethod(name?: string | null): string {
  if (!name?.trim()) return "";
  const texts = findEntries(name).map((entry) => `${entry.technique}\n${entry.reference}`);
  return [...new Set(texts)].join("\n");
}
