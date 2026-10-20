import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  Boxes,
  ChevronDown,
  Eye,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import AppLayout from "@/components/lis/AppLayout";
import ItemGroupManagerDialog from "@/components/lis/ItemGroupManagerDialog";
import PageHeader from "@/components/lis/PageHeader";
import StockPhotoUploader from "@/components/lis/stock/StockPhotoUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, type MachineItem, type ParameterItem, type ItemGroupItem } from "@/lib/api";
import { useItemGroupMembership } from "@/hooks/useItemGroupMembership";
import { cn } from "@/lib/utils";
import { rankSearchResults } from "@/lib/searchRanking";
import { parseSubstances } from "@/lib/substances";
import { readSlotMethods, type MethodDoc } from "@/lib/methodRegistry";
import { buildOverrideMap, normalizeCommonName, normalizeKey } from "@/lib/commonNameOverride";
import type { CommonNameOverrideRow } from "@/lib/commonNameOverride";
import {
  getClassification,
  getCommonName,
} from "@/lib/productClassification";
import { getMasterItemRegulatoryType } from "@/lib/masterItemRegulatoryType";
import { parameterMatchesFacets, type ParameterMatchFacets } from "@/lib/petitionTestItems";
import {
  addMfDateFields,
  MF_CURRENT_API_URL,
  MF_HISTORICAL_API_URL,
} from "@/lib/mfItemDates";

export { getMasterItemRegulatoryType } from "@/lib/masterItemRegulatoryType";

type MasterItem = Record<string, unknown>;
// A substance slot holds a SET of method codes (an AND-set). A row's assignments
// is one inner array per substance, positional (slot i ↔ substance i).
type MatchType = "contains" | "startsWith" | "endsWith" | "exact";

type ExclusionRule = {
  _id: string;
  pattern: string;
  matchType: MatchType;
};

// Toggle one method code on/off within a single substance slot (AND-set).
function toggleMethod(slot: string[], code: string): string[] {
  return slot.includes(code) ? slot.filter((c) => c !== code) : [...slot, code];
}

// Replace one substance slot's method-set, preserving positional alignment.
function setSlotMethods(row: string[][], index: number, next: string[]): string[][] {
  const copy = row.map((s) => [...s]);
  if (index >= 0 && index < copy.length) copy[index] = next;
  return copy;
}

const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  contains: "มีคำ",
  startsWith: "ขึ้นต้น",
  endsWith: "ลงท้าย",
  exact: "ตรงกับ",
};

export function matchesExclusion(commonName: string, rule: ExclusionRule): boolean {
  const target = commonName.trim().toLowerCase();
  const needle = rule.pattern.trim().toLowerCase();
  if (!target || !needle) return false;
  switch (rule.matchType) {
    case "exact": return target === needle;
    case "startsWith": return target.startsWith(needle);
    case "endsWith": return target.endsWith(needle);
    case "contains":
    default: return target.includes(needle);
  }
}

type SimpleMethodRow = {
  key: string;
  commonName: string;
  substances: string[];
  // positional: assignments[i] is the AND-set of method codes for substance i
  assignments: string[][];
  itemNos: string[];
  rawCommonNames: string[];
  items: MasterItem[];
};

type MasterCommonNameRow = {
  key: string;
  commonName: string;
  itemCount: number;
  itemNos: string[];
  items: MasterCommonNameItem[];
};

type MasterCommonNameItem = {
  itemNo: string;
  itemName: string;
  rawCommonName: string;
  category: string;
  unit: string;
  packSize: string;
  imageUrls: string[];
};

type MasterItemForm = {
  itemCode: string;
  itemName: string;
  commonName: string;
  category: string;
  unit: string;
  status: string;
  requiredInspectionQty: string;
  kgPerCarton: string;
  grossKgPerUnit: string;
  packLevel: string;
  cartonUnit: string;
  unitsPerCarton: string;
  packUnit: string;
  measureSize: string;
  measureUnit: string;
  imageUrls: string[];
};

const emptyForm: MasterItemForm = {
  itemCode: "",
  itemName: "",
  commonName: "",
  category: "",
  unit: "",
  status: "active",
  requiredInspectionQty: "0",
  kgPerCarton: "",
  grossKgPerUnit: "",
  packLevel: "",
  cartonUnit: "",
  unitsPerCarton: "",
  packUnit: "",
  measureSize: "",
  measureUnit: "",
  imageUrls: [],
};

type MasterItemOverride = {
  itemNo: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  category: string;
  unit: string;
  status: string;
  description: string;
  requiredInspectionQty: number;
  kgPerCarton?: number | null;
  grossKgPerUnit?: number | null;
  packLevel?: number | null;
  cartonUnit?: string;
  unitsPerCarton?: number | null;
  packUnit?: string;
  measureSize?: number | null;
  measureUnit?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

type MasterItemOverrideMap = Record<string, MasterItemOverride>;

const DIRECT_MASTER_ITEM_URL = "https://n8n-plant.icpladda.com/webhook/API/Item-production";
const MASTER_ITEM_DETAIL_CLICK_DELAY_MS = 250;
const MF_EXTRA_KEYS = ["MF_Before", "MF_Lasted"];
const EMPTY_MF_ITEM_PAYLOADS: { historical: unknown; current: unknown } = { historical: [], current: [] };

const idKeys = ["_id", "id", "itemId", "item_id", "item_no", "code", "itemCode"];
const codeKeys = ["item_no", "itemCode", "item_code", "code", "Code", "ITEM_CODE"];
const nameKeys = ["item_name1", "itemName", "item_name", "name", "Name", "ITEM_NAME", "description"];
const typeKeys = ["common_name", "commonname", "commonName", "itemType", "item_type"];
const categoryKeys = ["inventory_posting_group", "category", "type", "group", "itemGroup", "item_group"];
const unitKeys = ["base_unit_of_mea", "unit", "uom", "UOM", "unitName"];
const statusKeys = ["status", "active", "isActive"];
const descriptionKeys = ["item_name2", "item_name3", "description", "detail", "remark", "note"];
const packSizeKeys = ["packSize", "pack_size", "desc2", "description2", "item_name3"];
const weightKeys = ["kgPerCarton", "kg_per_carton", "gross_kg_per_carton"];
const packKeys = [
  "grossKgPerUnit",
  "packLevel",
  "cartonUnit",
  "unitsPerCarton",
  "packUnit",
  "measureSize",
  "measureUnit",
];
const imageUrlKeys = ["imageUrl", "image_url", "photoUrl", "photo_url", "pictureUrl", "picture_url"];
const imageUrlsKeys = ["imageUrls", "image_urls", "photoUrls", "photo_urls", "pictureUrls", "picture_urls"];
const commonNameKeys = ["common_name", "commonname", "commonName", "item_name2", "itemType"];
const methodInstrumentKeys = [
  "simple_method",
  "simpleMethod",
  "method",
  "method_name",
  "test_method",
  "testMethod",
  "instrument",
  "instrument_type",
  "machine",
];
const hiddenTableKeys = [
  "trade_name",
  "tradename",
  "tradeName",
  "search_name",
  "dm1",
  "dm2",
  "sales_unit_mea",
  "purch_unit_mea",
  "unit_cost",
  "unitCost",
  "unit_cost_lcy",
  "Unit Cost",
  "UNIT_COST",
  "requiredInspectionQty",
  "gross_kg_per_unit",
  "item_sales_unit_mea",
  "reorder_policy",
  "incl_inventory",
  "manufac_policy",
  "create_from_nonstock_item",
  "product_group_code",
  "item_track_code",
  "lot_nos",
  "default_location",
  "routing_no",
  "MF_GapDays",
  "MF_BatchAfterGap",
  "MF_ConsecutivePassCount",
  "base_unit_mea",
  "base_unit_desc",
  "base_qty_per",
  "sales_unit_desc",
  "sales_qty_per",
  "packing_unit_mea",
  "packing_unit_desc",
  "packing_qty_per",
];
// meta.itemType เก็บ "ชื่อสามัญ" (จาก Sync Kg/ลัง) และ meta.description เก็บ "ขนาดบรรจุ"
// แต่ข้อมูลเก่าบางแถวถูกฟอร์มเขียนรหัสสูตร (EC/WP) หรือชื่อสามัญทับไว้ — จึงไม่เอาสองช่องนี้
// ไปทับ common_name / item_name2 / item_name3 ของ ERP. ชื่อสามัญจาก ERP เป็นตัวจริงเสมอ;
// ถ้าต้องการชื่อที่แสดงต่างออกไปให้ใช้ "ตั้งชื่อมาตรฐาน (common name)".
const OVERRIDE_FIELD_MAP: Array<{ key: keyof MasterItemOverride; targets: string[] }> = [
  { key: "itemCode", targets: codeKeys },
  { key: "itemName", targets: nameKeys },
  { key: "category", targets: categoryKeys },
  { key: "unit", targets: unitKeys },
  { key: "status", targets: statusKeys },
];

function applyOverride(item: MasterItem, override?: MasterItemOverride): MasterItem {
  if (!override) return item;
  const merged: MasterItem = { ...item };
  OVERRIDE_FIELD_MAP.forEach(({ key, targets }) => {
    const value = override[key];
    if (typeof value === "string" && value !== "") {
      targets.forEach((target) => {
        merged[target] = value;
      });
    }
  });
  if (override.kgPerCarton !== undefined && override.kgPerCarton !== null) {
    merged.kgPerCarton = override.kgPerCarton;
    merged.kg_per_carton = override.kgPerCarton;
  }
  packKeys.forEach((key) => {
    const value = override[key as keyof MasterItemOverride];
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  });
  if (
    Object.prototype.hasOwnProperty.call(override, "imageUrls") ||
    Object.prototype.hasOwnProperty.call(override, "imageUrl")
  ) {
    const imageUrls = normalizeImageUrls(override.imageUrls);
    if (imageUrls.length === 0) imageUrls.push(...normalizeImageUrls(override.imageUrl));
    imageUrlsKeys.forEach((key) => {
      merged[key] = imageUrls;
    });
    imageUrlKeys.forEach((key) => {
      merged[key] = imageUrls[0] ?? "";
    });
  }
  return merged;
}

function normalizeItems(payload: unknown): MasterItem[] {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (isObject(payload)) {
    const candidates = [payload.data, payload.items, payload.result, payload.rows];
    const found = candidates.find(Array.isArray);
    if (Array.isArray(found)) return found.filter(isObject);
  }
  return [];
}

function isObject(value: unknown): value is MasterItem {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstValue(item: MasterItem, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function formNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function normalizeImageUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const text = String(value ?? "").trim();
  return text ? [text] : [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out;
}

function getImageUrls(item: MasterItem): string[] {
  for (const key of imageUrlsKeys) {
    const urls = normalizeImageUrls(item[key]);
    if (urls.length > 0) return urls;
  }
  for (const key of imageUrlKeys) {
    const urls = normalizeImageUrls(item[key]);
    if (urls.length > 0) return urls;
  }
  return [];
}

// Escape regex-special chars so a method label/code can be matched literally.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Auto-suggest method codes from an item's ERP method/instrument text. Scans the
// text for each active method's label or code (case-insensitive whole-word) and
// returns the matching codes — a convenience over fully manual selection.
function detectMethods(value: unknown, activeMethods: MethodDoc[]): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const found: string[] = [];
  for (const m of activeMethods) {
    const needles = [m.code, m.label].filter((s): s is string => !!s && s.trim() !== "");
    const hit = needles.some((needle) => {
      const re = new RegExp(`\\b${escapeRegExp(needle.trim())}\\b`, "i");
      return re.test(text);
    });
    if (hit && !found.includes(m.code)) found.push(m.code);
  }
  return found;
}

function emptyAssignments(count: number): string[][] {
  return Array.from({ length: count }, () => []);
}

function alignAssignments(source: string[][], substanceCount: number): string[][] {
  const result = emptyAssignments(substanceCount);
  for (let i = 0; i < Math.min(source.length, substanceCount); i += 1) {
    result[i] = Array.isArray(source[i]) ? [...source[i]] : [];
  }
  return result;
}

function slotsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = [...b].sort();
  return [...a].sort().every((value, index) => value === sb[index]);
}

function assignmentsEqual(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((slot, index) => slotsEqual(slot, b[index]));
}

function displayValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function collectSearchValues(value: unknown, output: string[], seen = new WeakSet<object>()) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return;
  }
  if (value instanceof Date) {
    output.push(value.toISOString());
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSearchValues(entry, output, seen));
    return;
  }
  Object.values(value).forEach((entry) => collectSearchValues(entry, output, seen));
}

export function buildMasterItemSearchText({
  item,
  originalItemNo = "",
  rawCommonName = "",
  displayCommonName = "",
}: {
  item: MasterItem;
  originalItemNo?: string;
  rawCommonName?: string;
  displayCommonName?: string;
}): string {
  const values = [originalItemNo, rawCommonName, displayCommonName];
  collectSearchValues(item, values);
  return values.join(" ").toLowerCase();
}

// Pack/weight keys carry both a camelCase (override layer) and a snake_case (ERP
// feed) spelling; read either so the value shows regardless of source.
const unitsPerCartonKeys = ["unitsPerCarton", "units_per_carton"];
const measureSizeKeys = ["measureSize", "measure_size"];
const measureUnitKeys = ["measureUnit", "measure_unit"];
const grossKgPerUnitKeys = ["grossKgPerUnit", "gross_kg_per_unit"];
const packLevelKeys = ["packLevel", "pack_level"];
const cartonUnitKeys = ["cartonUnit", "carton_unit"];
const defaultUnitOptions = ["KG", "G", "ซอง", "ลัง"];
const customUnitValue = "__custom_unit__";

// "12 × 1 L" — units per carton × per-unit measure, kept to one line for the
// table cell. Falls back to the raw ERP pack-size string, then "-".
function formatPackSize(item: MasterItem): string {
  const units = String(firstValue(item, unitsPerCartonKeys)).trim();
  const size = String(firstValue(item, measureSizeKeys)).trim();
  const unit = String(firstValue(item, measureUnitKeys)).trim();
  const measure = [size, unit].filter(Boolean).join(" ");
  if (units && measure) return `${units} × ${measure}`;
  if (measure) return measure;
  const raw = String(firstValue(item, packSizeKeys)).trim();
  return raw || "-";
}

// A missing status means active — ERP rows have no status field until an
// override sets one. Only an explicit inactive/false marks it inactive.
function isItemActive(item: MasterItem): boolean {
  const status = firstValue(item, statusKeys);
  if (status === "" || status === true) return true;
  if (status === false) return false;
  const s = String(status).toLowerCase();
  return s !== "inactive" && s !== "false" && s !== "0";
}

function getItemCategory(item: MasterItem) {
  return String(firstValue(item, categoryKeys)).trim();
}

function getItemWarehouseCategory(item: MasterItem) {
  const code = String(firstValue(item, codeKeys)).trim();
  const first = code.charAt(0).toUpperCase();
  if (first === "F") return "FG";
  if (first === "R") return "RM";
  return getItemCategory(item);
}

function getItemSubCategory(item: MasterItem) {
  const cleaned = String(firstValue(item, codeKeys)).trim();
  if (!cleaned) return "";
  const dashIdx = cleaned.indexOf("-");
  return (dashIdx > 0 ? cleaned.slice(0, dashIdx) : cleaned).toUpperCase();
}

function getProductTypeGroup(item: MasterItem) {
  const source = [
    firstValue(item, typeKeys),
    firstValue(item, descriptionKeys),
    firstValue(item, nameKeys),
  ].filter(Boolean).join(" ");
  return getClassification(source)?.group ?? "";
}

const PARAM_ITEM_NAME_KEYS = ["item_name1", "itemName", "item_name", "name"];

function getItemNameForParam(item: MasterItem): string {
  for (const key of PARAM_ITEM_NAME_KEYS) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

// itemGroupIds = group IDs ที่ item นี้สังกัด — resolve มาจาก useItemGroupMembership
// (catalog ดิบ keyed by raw itemNo) เพื่อให้ตรงกับฝั่ง testing เป๊ะ. ห้าม resolve
// จาก item ที่ผ่าน applyOverride แล้ว เพราะ override เขียนทับ commonname.
function getParametersFor(
  item: MasterItem,
  parameters: ParameterItem[],
  itemGroupIds: string[] = [],
): ParameterItem[] {
  if (parameters.length === 0) return [];
  const itemNo = String(firstValue(item, codeKeys)).trim();
  const itemName = getItemNameForParam(item);
  const productType = getProductTypeGroup(item);
  const category = getItemWarehouseCategory(item);
  const subCategory = getItemSubCategory(item);
  const fullCommonName = String(firstValue(item, commonNameKeys)).trim();
  const commonName = getCommonName(fullCommonName)
    || getCommonName(firstValue(item, nameKeys));

  // กฎ "ใช้กับ" มีชุดเดียว (parameterMatchesFacets) — หน้านี้แค่สกัดข้อเท็จจริงจากแถว
  // master item แทนที่จะสกัดจาก PetitionItem. เคยมีสำเนากฎอยู่ตรงนี้แล้วเพี้ยนจากฝั่ง
  // testing (categories จับแบบ OR, subCategories จับแบบตรงตัว) — พรีวิวเลยบอกว่าใช้ได้
  // ทั้งที่หน้ากรอกผลไม่ขึ้น
  const facets: ParameterMatchFacets = {
    itemNo,
    itemName,
    fullCommonName,
    commonName,
    productType,
    subCategory,
    itemGroupIds,
    category,
  };
  return parameters.filter(
    (parameter) => (parameter.status ?? "active") === "active" && parameterMatchesFacets(parameter, facets),
  );
}

function countParametersFor(
  item: MasterItem,
  parameters: ParameterItem[],
  itemGroupIds: string[] = [],
): number {
  return getParametersFor(item, parameters, itemGroupIds).length;
}

function getItemId(item: MasterItem) {
  const value = firstValue(item, idKeys);
  return value ? String(value) : "";
}

function getDetectedSlot(item: MasterItem, activeMethods: MethodDoc[]): string[] {
  if (activeMethods.length === 0) return [];
  for (const key of methodInstrumentKeys) {
    const found = detectMethods(item[key], activeMethods);
    if (found.length > 0) return found;
  }
  return [];
}

export function buildSimpleMethodRows(
  items: MasterItem[],
  overrides: Record<string, string[][]> = {},
  cnMap: Map<string, string> = new Map(),
  activeMethods: MethodDoc[] = [],
): SimpleMethodRow[] {
  const groups = new Map<string, SimpleMethodRow>();
  const collected = new Map<string, string[][]>();

  items.forEach((item) => {
    const rawCommonName = String(firstValue(item, commonNameKeys)).trim();
    if (!rawCommonName) return;
    const commonName = normalizeCommonName(rawCommonName, cnMap);

    const key = normalizeKey(commonName);
    const itemNo = String(firstValue(item, codeKeys)).trim();
    const substances = parseSubstances(commonName);
    const count = substances.length;

    let candidate: string[][] = emptyAssignments(count);
    const override = itemNo ? overrides[itemNo] : undefined;
    if (override && override.length > 0) {
      candidate = alignAssignments(override, count);
    } else {
      const detected = getDetectedSlot(item, activeMethods);
      if (detected.length > 0 && count === 1) candidate = [detected];
    }

    const existing = groups.get(key);
    const current = collected.get(key) ?? emptyAssignments(count);
    // positional merge: keep substance i; fill empties from the detected/override candidate
    const merged = current.map((slot, idx) =>
      slot.length > 0 ? slot : [...(candidate[idx] ?? [])],
    );
    collected.set(key, merged);

    if (existing) {
      existing.items.push(item);
      if (itemNo && !existing.itemNos.includes(itemNo)) existing.itemNos.push(itemNo);
      if (!existing.rawCommonNames.includes(rawCommonName)) existing.rawCommonNames.push(rawCommonName);
      return;
    }

    groups.set(key, {
      key,
      commonName,
      substances,
      assignments: emptyAssignments(count),
      itemNos: itemNo ? [itemNo] : [],
      rawCommonNames: [rawCommonName],
      items: [item],
    });
  });

  groups.forEach((row, key) => {
    row.assignments = collected.get(key) ?? emptyAssignments(row.substances.length);
  });

  return Array.from(groups.values()).sort((a, b) =>
    a.commonName.localeCompare(b.commonName, ["th", "en"]),
  );
}

function splitMasterCommonName(value: string): string[] {
  const parts: string[] = [];
  let currentPart = "";
  let parenthesisDepth = 0;
  let hasTopLevelPlus = false;

  for (const character of String(value || "")) {
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
      hasTopLevelPlus = true;
      parts.push(currentPart);
      currentPart = "";
      continue;
    }
    currentPart += character;
  }

  parts.push(currentPart);

  const rawCommonName = String(value || "").trim().replace(/\s+/g, " ");
  const splitParts = parts
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter((part) => part && !/^\d+(?:[.,]\d+)?\s*%/.test(part));

  return Array.from(new Set(hasTopLevelPlus && rawCommonName ? [...splitParts, rawCommonName] : splitParts));
}

export function buildMasterCommonNameRows(entries: Array<{ item: MasterItem; originalItemNo: string; rawCommonName: string }>): MasterCommonNameRow[] {
  const groups = new Map<string, MasterCommonNameRow>();

  entries.forEach((entry) => {
    const itemNo = entry.originalItemNo || String(firstValue(entry.item, codeKeys)).trim();
    const detail: MasterCommonNameItem = {
      itemNo,
      itemName: String(firstValue(entry.item, nameKeys)).trim(),
      rawCommonName: entry.rawCommonName,
      category: String(firstValue(entry.item, categoryKeys)).trim(),
      unit: String(firstValue(entry.item, unitKeys)).trim(),
      packSize: String(firstValue(entry.item, packSizeKeys)).trim(),
      imageUrls: getImageUrls(entry.item),
    };

    splitMasterCommonName(entry.rawCommonName).forEach((commonName) => {
      const key = normalizeKey(commonName);
      const existing = groups.get(key);

      if (existing) {
        existing.itemCount += 1;
        if (itemNo && !existing.itemNos.includes(itemNo)) existing.itemNos.push(itemNo);
        if (!itemNo || !existing.items.some((item) => item.itemNo === itemNo)) existing.items.push(detail);
        return;
      }

      groups.set(key, {
        key,
        commonName,
        itemCount: 1,
        itemNos: itemNo ? [itemNo] : [],
        items: [detail],
      });
    });
  });

  return Array.from(groups.values()).sort((a, b) =>
    a.commonName.localeCompare(b.commonName, ["th", "en"]),
  );
}

function itemToForm(item: MasterItem, metaQty = 0): MasterItemForm {
  const statusValue = firstValue(item, statusKeys);
  return {
    itemCode: String(firstValue(item, codeKeys)),
    itemName: String(firstValue(item, nameKeys)),
    commonName: formString(firstValue(item, commonNameKeys)),
    category: String(firstValue(item, categoryKeys)),
    unit: String(firstValue(item, unitKeys)),
    status:
      typeof statusValue === "boolean"
        ? statusValue ? "active" : "inactive"
        : String(statusValue || "active"),
    requiredInspectionQty: String(metaQty || 0),
    kgPerCarton: formString(firstValue(item, weightKeys)),
    grossKgPerUnit: formString(firstValue(item, ["grossKgPerUnit"])),
    packLevel: formString(firstValue(item, ["packLevel"])),
    cartonUnit: formString(firstValue(item, ["cartonUnit"])),
    unitsPerCarton: formString(firstValue(item, ["unitsPerCarton"])),
    packUnit: formString(firstValue(item, ["packUnit"])),
    measureSize: formString(firstValue(item, ["measureSize"])),
    measureUnit: formString(firstValue(item, ["measureUnit"])),
    imageUrls: getImageUrls(item),
  };
}

function buildPayload(form: MasterItemForm, editing: MasterItem | null) {
  const category = form.category.trim();
  const commonName = form.commonName.trim();
  const payload = {
    ...(editing ?? {}),
  };
  delete payload.product_type;
  delete payload.productType;
  delete payload.product_group;
  delete payload.productGroup;

  return {
    ...payload,
    item_no: form.itemCode.trim(),
    item_name1: form.itemName.trim(),
    // แก้ไข: คงชื่อสามัญเดิมจาก ERP (มากับ editing). เพิ่มใหม่: ใช้ชื่อสามัญที่กรอก
    ...(editing ? {} : { common_name: commonName, commonname: commonName }),
    inventory_posting_group: category,
    base_unit_of_mea: form.unit.trim(),
    itemCode: form.itemCode.trim(),
    itemName: form.itemName.trim(),
    category,
    unit: form.unit.trim(),
    status: form.status,
    imageUrl: form.imageUrls[0] ?? "",
    image_url: form.imageUrls[0] ?? "",
    imageUrls: form.imageUrls,
    image_urls: form.imageUrls,
  };
}

function UnitSelectField({
  id,
  label,
  value,
  options,
  onChange,
  onAddOption,
}: {
  id: "cartonUnit" | "measureUnit";
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onAddOption: (value: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const shownOptions = value && !options.includes(value) ? [...options, value] : options;
  const add = () => {
    const next = newValue.trim();
    if (!next) return;
    onAddOption(next);
    onChange(next);
    setNewValue("");
    setAdding(false);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === customUnitValue) {
            setAdding(true);
            return;
          }
          onChange(next);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="เลือกหน่วย" />
        </SelectTrigger>
        <SelectContent>
          {shownOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value={customUnitValue}>เพิ่มหน่วยใหม่...</SelectItem>
        </SelectContent>
      </Select>
      {adding && (
        <div className="flex gap-2">
          <Input
            value={newValue}
            onChange={(event) => setNewValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            autoFocus
            placeholder="เช่น PCS"
          />
          <Button type="button" variant="secondary" onClick={add}>
            เพิ่ม
          </Button>
        </div>
      )}
    </div>
  );
}

async function fetchDirectMasterItems() {
  const response = await fetch(DIRECT_MASTER_ITEM_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Cannot fetch master items: ${response.status}`);
  }
  return normalizeItems(await response.json());
}

async function fetchOptionalJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function fetchMfItemPayloads(): Promise<{ historical: unknown; current: unknown }> {
  const [historical, current] = await Promise.all([
    fetchOptionalJson(MF_HISTORICAL_API_URL),
    fetchOptionalJson(MF_CURRENT_API_URL),
  ]);
  return { historical, current };
}

export default function MasterItems() {
  const queryClient = useQueryClient();
  const itemDetailClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageSize, setPageSize] = useState("50");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ item: MasterItem; originalItemNo: string; override?: MasterItemOverride } | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<{ item: MasterItem; originalItemNo: string; override?: MasterItemOverride } | null>(null);
  const [exporting, setExporting] = useState<null | "xlsx" | "pdf">(null);
  const [syncingWeights, setSyncingWeights] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);

  const clearItemDetailClickTimer = () => {
    if (itemDetailClickTimerRef.current) {
      clearTimeout(itemDetailClickTimerRef.current);
      itemDetailClickTimerRef.current = null;
    }
  };

  const openItemDetails = (next: { item: MasterItem; originalItemNo: string; override?: MasterItemOverride }) => {
    clearItemDetailClickTimer();
    setViewing(next);
  };

  const scheduleItemDetails = (next: { item: MasterItem; originalItemNo: string; override?: MasterItemOverride }) => {
    clearItemDetailClickTimer();
    itemDetailClickTimerRef.current = setTimeout(() => {
      itemDetailClickTimerRef.current = null;
      setViewing(next);
    }, MASTER_ITEM_DETAIL_CLICK_DELAY_MS);
  };

  useEffect(() => () => clearItemDetailClickTimer(), []);

  const {
    data: items = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["master-items"],
    queryFn: async () => {
      try {
        const res = await api.get<unknown>("/master-items");
        return normalizeItems(res.data.data);
      } catch {
        return fetchDirectMasterItems();
      }
    },
  });

  const { data: mfItemPayloads = EMPTY_MF_ITEM_PAYLOADS } = useQuery({
    queryKey: ["master-item-mf-dates"],
    queryFn: fetchMfItemPayloads,
  });

  const { data: overrideMap = {} } = useQuery<MasterItemOverrideMap>({
    queryKey: ["master-item-meta"],
    queryFn: async () => {
      const res = await api.get<MasterItemOverride[]>("/master-item-meta");
      const map: MasterItemOverrideMap = {};
      (res.data.data || []).forEach((entry) => {
        if (entry && entry.itemNo) map[entry.itemNo] = entry;
      });
      return map;
    },
  });

  const { data: parameters = [] } = useQuery({
    queryKey: ["parameters"],
    queryFn: () => api.getParameters(),
  });

  const { data: cnOverrides = [] } = useQuery({
    queryKey: ["common-name-overrides"],
    queryFn: async () => {
      const res = await api.get<CommonNameOverrideRow[]>("/common-name-overrides");
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
  });

  const { data: itemGroups = [] } = useQuery({
    queryKey: ["item-groups"],
    queryFn: async () => {
      const res = await api.get<ItemGroupItem[]>("/item-groups");
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
  });

  // group membership keyed by raw itemNo (single source of truth, ตรงกับ testing flow)
  const groupMembership = useItemGroupMembership();
  const groupIdsFor = (itemNo: string) => groupMembership.get(String(itemNo ?? "").trim()) ?? [];

  // id → ชื่อกลุ่ม สำหรับ resolve badge ในตาราง (unknown id ถูกข้ามเวลา render)
  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    itemGroups.forEach((grp) => { if (grp._id) map.set(grp._id, grp.name); });
    return map;
  }, [itemGroups]);

  // กลุ่มเรียงตาม sortOrder แล้ว name สำหรับ dropdown ตัวกรอง
  const sortedGroups = useMemo(
    () => [...itemGroups].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, ["th", "en"]),
    ),
    [itemGroups],
  );

  const cnMap = useMemo(() => buildOverrideMap(cnOverrides), [cnOverrides]);

  const itemsWithMfDates = useMemo(
    () => addMfDateFields(items, mfItemPayloads.historical, mfItemPayloads.current),
    [items, mfItemPayloads],
  );

  const enrichedItems = useMemo(
    () => itemsWithMfDates.map((item) => {
      const originalItemNo = String(firstValue(item, codeKeys)).trim();
      const override = overrideMap[originalItemNo];
      const rawCommonName = String(firstValue(item, commonNameKeys)).trim();
      return {
        item: applyOverride(item, override),
        originalItemNo,
        override,
        rawCommonName,
        displayCommonName: normalizeCommonName(rawCommonName, cnMap),
      };
    }),
    [itemsWithMfDates, overrideMap, cnMap],
  );

  const commonNameRows = useMemo(
    () => buildMasterCommonNameRows(enrichedItems),
    [enrichedItems],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = enrichedItems.filter(({ item, originalItemNo, rawCommonName, displayCommonName }) => {
      const matchesSearch =
        !q ||
        buildMasterItemSearchText({
          item,
          originalItemNo,
          rawCommonName,
          displayCommonName,
        }).includes(q);
      const matchesCategory = categoryFilter === "all" || getItemCategory(item) === categoryFilter;
      const groupIds = groupMembership.get(originalItemNo) ?? [];
      const matchesGroup =
        groupFilter === "all" ||
        (groupFilter === "__none__" ? groupIds.length === 0 : groupIds.includes(groupFilter));
      const matchesStatus =
        statusFilter === "all" || isItemActive(item) === (statusFilter === "active");
      return matchesSearch && matchesCategory && matchesGroup && matchesStatus;
    });
    return rankSearchResults(filtered, q, (entry) => {
      const secondary = [entry.rawCommonName, entry.displayCommonName];
      collectSearchValues(entry.item, secondary);
      return {
        primary: [entry.originalItemNo, ...codeKeys.map((key) => entry.item[key])],
        secondary,
      };
    });
  }, [categoryFilter, enrichedItems, search, groupFilter, statusFilter, groupMembership]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, groupFilter, statusFilter, pageSize]);

  const pageSizeNumber = Number(pageSize) || 50;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSizeNumber));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSizeNumber;
    return filteredItems.slice(start, start + pageSizeNumber);
  }, [currentPage, filteredItems, pageSizeNumber]);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    enrichedItems.forEach(({ item }) => {
      const category = getItemCategory(item);
      if (category) values.add(category);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [enrichedItems]);

  const extraColumns = useMemo(() => {
    const used = new Set([
      ...idKeys,
      ...codeKeys,
      ...nameKeys,
      ...typeKeys,
      ...categoryKeys,
      ...unitKeys,
      ...statusKeys,
      ...descriptionKeys,
      ...packSizeKeys,
      ...weightKeys,
      ...packKeys,
      ...imageUrlKeys,
      ...imageUrlsKeys,
      "productType",
      ...methodInstrumentKeys,
      ...hiddenTableKeys,
    ]);
    const keys: string[] = [];
    for (const key of MF_EXTRA_KEYS) {
      if (itemsWithMfDates.some((item) => String(item[key] ?? "").trim() !== "")) keys.push(key);
    }
    for (const item of itemsWithMfDates) {
      Object.keys(item).forEach((key) => {
        if (!used.has(key) && !keys.includes(key)) keys.push(key);
      });
      if (keys.length >= 3) break;
    }
    return keys;
  }, [itemsWithMfDates]);

  const viewingItem = useMemo(() => {
    if (!viewing) return null;
    return enrichedItems.find((entry) => entry.originalItemNo === viewing.originalItemNo) ?? viewing;
  }, [enrichedItems, viewing]);

  const handleExport = async (format: "xlsx" | "pdf") => {
    if (filteredItems.length === 0) {
      toast.error("ไม่มีข้อมูลสำหรับ export");
      return;
    }
    setExporting(format);
    try {
      const rows = filteredItems.map(({ item }) => item);
      const blob = await api.exportMasterItems(format, rows, "Master Item");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `master-item-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const handleSyncWeights = async () => {
    setSyncingWeights(true);
    try {
      const res = await api.post<{ total?: number }>("/master-item-meta/sync-weight");
      toast.success(`sync weight ${res.data.data.total ?? 0} items`);
      queryClient.invalidateQueries({ queryKey: ["master-item-meta"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncingWeights(false);
    }
  };

  return (
    <AppLayout mainClassName="bg-muted/40 p-4 sm:p-6 overflow-auto">
        <PageHeader
          className="mb-6"
          title={
            <span className="inline-flex items-center gap-2">
              <Package className="h-6 w-6" />
              รายการสินค้า
            </span>
          }
          description={`ทั้งหมด ${items.length.toLocaleString()} รายการ`}
          actions={
            <>
              <Button variant="outline" className="gap-1.5" onClick={() => setGroupDialogOpen(true)}>
                <Boxes className="h-4 w-4" /> จัดกลุ่ม
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-1.5">
                    <FileSpreadsheet className="h-4 w-4" /> Export / Sync
                    <ChevronDown className="h-4 w-4 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>ส่งออก (ตามที่กรอง)</DropdownMenuLabel>
                  <DropdownMenuItem
                    disabled={exporting !== null || filteredItems.length === 0}
                    onClick={() => handleExport("xlsx")}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {exporting === "xlsx" ? "กำลังสร้าง Excel..." : "Excel"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exporting !== null || filteredItems.length === 0}
                    onClick={() => handleExport("pdf")}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    {exporting === "pdf" ? "กำลังสร้าง PDF..." : "PDF"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={syncingWeights} onClick={handleSyncWeights}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", syncingWeights && "animate-spin")} />
                    Sync Kg/ลัง
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button className="gap-1.5" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> เพิ่มสินค้า
              </Button>
            </>
          }
        />

        <Tabs defaultValue="items" className="space-y-4">
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <TabsList className="w-max">
              <TabsTrigger value="items">Master Item</TabsTrigger>
              <TabsTrigger value="common-names">Master Common Name Item</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="items" className="mt-0">
            <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
            <div className="relative flex-1 lg:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ค้นหารหัสสินค้า ชื่อสินค้า หรือชื่อสามัญ"
                className="h-11 pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="หมวดหมู่" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกหมวดหมู่</SelectItem>
                  {categoryOptions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-36">
                  <SelectValue placeholder="สถานะ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกสถานะ</SelectItem>
                  <SelectItem value="active">ใช้งาน</SelectItem>
                  <SelectItem value="inactive">ปิดใช้งาน</SelectItem>
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="กลุ่ม" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกกลุ่ม</SelectItem>
                  {sortedGroups.map((grp) => (
                    <SelectItem key={grp._id} value={grp._id}>
                      {grp.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__none__">ไม่อยู่ในกลุ่มใด</SelectItem>
                </SelectContent>
              </Select>
              <Select value={pageSize} onValueChange={setPageSize}>
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue placeholder="ต่อหน้า" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 / หน้า</SelectItem>
                  <SelectItem value="50">50 / หน้า</SelectItem>
                  <SelectItem value="100">100 / หน้า</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isError ? (
            <div className="m-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {(error as Error).message}
            </div>
          ) : (
            <>
              <Table className="min-w-[760px]" containerClassName="max-h-[calc(100vh-340px)]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="sticky top-0 z-10 bg-muted">รหัสสินค้า</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted">รายละเอียดสินค้า</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted">ขนาดบรรจุ</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted text-right">จำนวนต่อลัง</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted text-right">น้ำหนักต่อลัง (kg)</TableHead>
                    <TableHead className="sticky top-0 z-10 w-16 bg-muted text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                        กำลังโหลด...
                      </TableCell>
                    </TableRow>
                  ) : filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                        ไม่พบสินค้าที่ตรงกับเงื่อนไข
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedItems.map(({ item, originalItemNo, override, rawCommonName, displayCommonName }, index) => {
                      const rowKey = getItemId(item) || originalItemNo || `row-${index}`;
                      const active = isItemActive(item);
                      const imageUrls = getImageUrls(item);
                      const imageUrl = imageUrls[0] ?? "";
                      const itemName = displayValue(firstValue(item, nameKeys));
                      return (
                        <TableRow
                          key={rowKey}
                          className="h-14 cursor-pointer"
                          onClick={(event) => {
                            if (event.detail > 1) return;
                            scheduleItemDetails({ item, originalItemNo, override });
                          }}
                          onDoubleClick={() => openItemDetails({ item, originalItemNo, override })}
                          title="คลิกเพื่อดูรายละเอียด"
                        >
                          <TableCell className="font-semibold text-primary">
                            {displayValue(firstValue(item, codeKeys))}
                          </TableCell>
                          <TableCell>
                            <div className="flex max-w-[420px] items-center gap-3">
                              {imageUrl && (
                                <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                                  <img
                                    src={imageUrl}
                                    alt={`รูปสินค้า ${itemName}`}
                                    className="h-full w-full object-cover"
                                  />
                                  {imageUrls.length > 1 && (
                                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px] leading-4 text-white">
                                      +{imageUrls.length - 1}
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-foreground">
                                  {itemName}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="truncate text-sm text-muted-foreground"
                                    title={displayCommonName !== rawCommonName ? `จากระบบ: ${rawCommonName}` : undefined}
                                  >
                                    {displayValue(displayCommonName)}
                                  </span>
                                  {!active && (
                                    <Badge
                                      variant="outline"
                                      className="h-4 shrink-0 border-muted-foreground/30 px-1 text-[10px] font-normal text-muted-foreground"
                                    >
                                      ปิดใช้งาน
                                    </Badge>
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1" aria-label="กลุ่มสินค้า">
                                  <span className="text-xs text-muted-foreground">กลุ่ม:</span>
                                  {groupIdsFor(originalItemNo).length > 0 ? (
                                    groupIdsFor(originalItemNo).map((id) => groupNameById.has(id) && (
                                      <Badge key={id} variant="secondary" className="max-w-full whitespace-normal break-words">
                                        {groupNameById.get(id)}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-muted-foreground">ยังไม่จัดกลุ่ม</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatPackSize(item)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {displayValue(firstValue(item, unitsPerCartonKeys))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {displayValue(firstValue(item, weightKeys))}
                          </TableCell>
                          <TableCell
                            className="text-right"
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="เมนูจัดการ">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openItemDetails({ item, originalItemNo, override })}>
                                  <Eye className="mr-2 h-4 w-4" /> ดูรายละเอียด
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setEditing({ item, originalItemNo, override })}>
                                  <Pencil className="mr-2 h-4 w-4" /> แก้ไข
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-2 border-t border-border p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground">
                  แสดง {filteredItems.length === 0 ? 0 : ((currentPage - 1) * pageSizeNumber) + 1}-
                  {Math.min(currentPage * pageSizeNumber, filteredItems.length)} จาก {filteredItems.length.toLocaleString()} รายการ
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">หน้า {currentPage}/{totalPages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage <= 1}
                  >
                    ก่อนหน้า
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    ถัดไป
                  </Button>
                </div>
              </div>
            </>
          )}
            </Card>
          </TabsContent>

          <TabsContent value="common-names" className="mt-0">
            <MasterCommonNameItemsTab
              rows={commonNameRows}
              isLoading={isLoading}
              isError={isError}
              error={error}
              onItemImagesSaved={async (itemNo, imageUrls) => {
                await api.put(`/master-item-meta/${encodeURIComponent(itemNo)}`, {
                  imageUrl: imageUrls[0] ?? "",
                  imageUrls,
                });
                queryClient.invalidateQueries({ queryKey: ["master-items"] });
                queryClient.invalidateQueries({ queryKey: ["master-item-meta"] });
              }}
            />
          </TabsContent>
        </Tabs>

        {(editing || creating) && (
          <MasterItemDialog
            item={editing ? editing.item : null}
            originalItemNo={editing ? editing.originalItemNo : ""}
            initialMetaQty={editing ? countParametersFor(editing.item, parameters, groupIdsFor(editing.originalItemNo)) : 0}
            onClose={() => {
              setEditing(null);
              setCreating(false);
            }}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["master-items"] });
              queryClient.invalidateQueries({ queryKey: ["master-item-meta"] });
            }}
          />
        )}

        {viewingItem && (
          <MasterItemDetailDrawer
            item={viewingItem.item}
            originalItemNo={viewingItem.originalItemNo}
            parameters={getParametersFor(viewingItem.item, parameters, groupIdsFor(viewingItem.originalItemNo))}
            groups={itemGroups}
            itemGroupIds={groupIdsFor(viewingItem.originalItemNo)}
            extraColumns={extraColumns}
            onClose={() => setViewing(null)}
            onEdit={() => {
              setEditing(viewingItem);
              setViewing(null);
            }}
          />
        )}

        <ItemGroupManagerDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} items={items} />
    </AppLayout>
  );
}

function MasterCommonNameItemsTab({
  rows,
  isLoading,
  isError,
  error,
  onItemImagesSaved,
}: {
  rows: MasterCommonNameRow[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onItemImagesSaved: (itemNo: string, imageUrls: string[]) => Promise<void>;
}) {
  const [searchText, setSearchText] = useState("");
  const [selectedRow, setSelectedRow] = useState<MasterCommonNameRow | null>(null);
  const dialogRow = selectedRow ? rows.find((row) => row.key === selectedRow.key) ?? selectedRow : null;
  const visibleRows = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    if (!needle) return rows;
    return rankSearchResults(
      rows.filter((row) => row.commonName.toLowerCase().includes(needle)),
      needle,
      (row) => ({ primary: [row.commonName] }),
    );
  }, [rows, searchText]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:items-center lg:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          Master Common Name Item
          <Badge variant="outline">{visibleRows.length}/{rows.length}</Badge>
        </CardTitle>
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="ค้นหา common name"
            className="h-10 pl-9"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isError ? (
          <div className="m-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        ) : (
          <Table className="min-w-[520px]" containerClassName="max-h-[calc(100vh-340px)]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky top-0 z-10 bg-muted">Common Name</TableHead>
                <TableHead className="sticky top-0 z-10 w-36 bg-muted">จำนวนที่พบ</TableHead>
                <TableHead className="sticky top-0 z-10 w-28 bg-muted text-right">รายละเอียด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                    กำลังโหลด...
                  </TableCell>
                </TableRow>
              ) : visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                    ไม่พบ common name ที่ตรงกับเงื่อนไข
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => (
                  <TableRow key={row.key} className="cursor-pointer" onDoubleClick={() => setSelectedRow(row)}>
                    <TableCell className="max-w-[340px] font-semibold text-foreground">
                      <span className="block truncate" title={row.commonName}>{row.commonName}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      พบ {row.itemCount} ครั้ง
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1 px-2 text-xs"
                        aria-label={`ดูรายละเอียด ${row.commonName}`}
                        onClick={() => setSelectedRow(row)}
                      >
                        <Eye className="h-3.5 w-3.5" /> ดู
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <MasterCommonNameDetailDialog
        row={dialogRow}
        onClose={() => setSelectedRow(null)}
        onItemImagesSaved={onItemImagesSaved}
      />
    </Card>
  );
}

function MasterCommonNameDetailDialog({
  row,
  onClose,
  onItemImagesSaved,
}: {
  row: MasterCommonNameRow | null;
  onClose: () => void;
  onItemImagesSaved: (itemNo: string, imageUrls: string[]) => Promise<void>;
}) {
  const [items, setItems] = useState<MasterCommonNameItem[]>([]);
  const [savingItemNo, setSavingItemNo] = useState<string | null>(null);

  useEffect(() => {
    setItems(row?.items ?? []);
  }, [row]);

  const saveImages = (itemNo: string, imageUrls: string[]) => {
    if (!itemNo) {
      toast.error("ไม่พบ item no สำหรับบันทึกรูป");
      return;
    }

    setItems((current) => current.map((item) => (
      item.itemNo === itemNo ? { ...item, imageUrls } : item
    )));
    setSavingItemNo(itemNo);
    onItemImagesSaved(itemNo, imageUrls)
      .then(() => toast.success("บันทึกรูปสินค้าแล้ว"))
      .catch((err) => toast.error((err as Error).message || "บันทึกรูปไม่สำเร็จ"))
      .finally(() => {
        setSavingItemNo((current) => (current === itemNo ? null : current));
      });
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>รายละเอียด Common Name</DialogTitle>
          <DialogDescription>
            {row?.commonName ?? ""} · พบ {row?.itemCount ?? 0} ครั้ง · {row?.itemNos.length ?? 0} item
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.itemNo || item.rawCommonName} className="rounded-lg border p-3">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">{item.itemNo || "-"}</div>
                  <div className="text-sm text-muted-foreground">{item.itemName || "ไม่พบชื่อสินค้า"}</div>
                </div>
                <div className="flex flex-wrap gap-1 text-xs text-muted-foreground sm:justify-end">
                  {item.packSize && <Badge variant="outline">{item.packSize}</Badge>}
                  {item.category && <Badge variant="outline">{item.category}</Badge>}
                  {item.unit && <Badge variant="outline">{item.unit}</Badge>}
                </div>
              </div>
              <StockPhotoUploader
                label={`รูปสินค้า ${item.itemNo || "-"}`}
                value={item.imageUrls}
                onChange={(imageUrls) => saveImages(item.itemNo, imageUrls)}
                disabled={!item.itemNo || savingItemNo === item.itemNo}
              />
              {savingItemNo === item.itemNo && (
                <p className="mt-2 text-xs text-muted-foreground">กำลังบันทึกรูป...</p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// "all" | "unassigned" | a specific method code
type SimpleMethodFilter = string;

export function SimpleMethodPage() {
  const queryClient = useQueryClient();
  const [methodDrafts, setMethodDrafts] = useState<Record<string, string[][]>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [savingAll, setSavingAll] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<SimpleMethodFilter>("all");

  const {
    data: items = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["master-items"],
    queryFn: async () => {
      try {
        const res = await api.get<unknown>("/master-items");
        return normalizeItems(res.data.data);
      } catch {
        return fetchDirectMasterItems();
      }
    },
  });

  const { data: registryMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: () => api.getMethods(),
  });
  const activeMethods = useMemo(() => registryMethods.filter((m) => m.active), [registryMethods]);

  const { data: simpleMethodEntries = [] } = useQuery({
    queryKey: ["simple-methods"],
    queryFn: async () => {
      const res = await api.get<Array<{ itemNo: string; instruments?: string[]; methods?: string[][] }>>("/simple-methods");
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
  });

  const { data: exclusions = [] } = useQuery({
    queryKey: ["simple-method-exclusions"],
    queryFn: async () => {
      const res = await api.get<ExclusionRule[]>("/simple-method-exclusions");
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
  });

  const { data: cnOverrides = [] } = useQuery({
    queryKey: ["common-name-overrides"],
    queryFn: async () => {
      const res = await api.get<CommonNameOverrideRow[]>("/common-name-overrides");
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
  });

  const cnMap = useMemo(() => buildOverrideMap(cnOverrides), [cnOverrides]);

  // substance count per itemNo, using the (override-resolved) commonName so the
  // count aligns with parseSubstances exactly as buildSimpleMethodRows does.
  const substanceCountByItemNo = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const itemNo = String(firstValue(item, codeKeys)).trim();
      if (!itemNo) return;
      const rawCommonName = String(firstValue(item, commonNameKeys)).trim();
      if (!rawCommonName) return;
      const commonName = normalizeCommonName(rawCommonName, cnMap);
      map.set(itemNo, parseSubstances(commonName).length);
    });
    return map;
  }, [items, cnMap]);

  // itemNo → positional AND-sets, read via readSlotMethods (new methods win,
  // legacy instruments mapped) and padded/truncated to that item's substance count.
  const overrides = useMemo(() => {
    const map: Record<string, string[][]> = {};
    simpleMethodEntries.forEach((entry) => {
      if (!entry || !entry.itemNo) return;
      const count = substanceCountByItemNo.get(entry.itemNo) ?? 0;
      map[entry.itemNo] = readSlotMethods(entry, count);
    });
    return map;
  }, [simpleMethodEntries, substanceCountByItemNo]);

  const rows = useMemo(
    () => buildSimpleMethodRows(items, overrides, cnMap, activeMethods),
    [items, overrides, cnMap, activeMethods],
  );

  const visibleRows = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (exclusions.some((rule) => matchesExclusion(row.commonName, rule))) return false;
      if (needle) {
        const haystack = `${row.commonName} ${row.itemNos.join(" ")}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (statusFilter === "all") return true;
      if (statusFilter === "unassigned") return row.assignments.some((slot) => slot.length === 0);
      // otherwise statusFilter is a specific method code
      return row.assignments.some((slot) => slot.includes(statusFilter));
    });
    return rankSearchResults(filtered, needle, (row) => ({
      primary: row.itemNos,
      secondary: [row.commonName],
    }));
  }, [rows, searchText, statusFilter, exclusions]);

  const dirtyRows = useMemo(
    () => rows.filter((row) => {
      const draft = methodDrafts[row.key];
      return draft !== undefined && !assignmentsEqual(draft, row.assignments);
    }),
    [rows, methodDrafts],
  );

  const setMethodDraft = (key: string, assignments: string[][]) => {
    setMethodDrafts((current) => ({
      ...current,
      [key]: assignments,
    }));
  };

  const toggleRowSelected = (key: string, selected: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllVisibleSelected = (selected: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      visibleRows.forEach((row) => {
        if (selected) next.add(row.key);
        else next.delete(row.key);
      });
      return next;
    });
  };

  // Toggle a method code ON for every substance slot of each selected row.
  const applyBulkAdd = (code: string) => {
    if (selectedKeys.size === 0) return;
    setMethodDrafts((current) => {
      const next = { ...current };
      visibleRows.forEach((row) => {
        if (!selectedKeys.has(row.key)) return;
        const base = current[row.key] ?? row.assignments;
        next[row.key] = base.map((slot) => (slot.includes(code) ? [...slot] : [...slot, code]));
      });
      return next;
    });
  };

  // Clear all method codes from every substance slot of each selected row.
  const applyBulkClear = () => {
    if (selectedKeys.size === 0) return;
    setMethodDrafts((current) => {
      const next = { ...current };
      visibleRows.forEach((row) => {
        if (!selectedKeys.has(row.key)) return;
        next[row.key] = row.substances.map(() => []);
      });
      return next;
    });
  };

  const saveAllDirty = async () => {
    if (dirtyRows.length === 0) return;
    setSavingAll(true);
    try {
      const updates = dirtyRows.flatMap((row) => {
        const methods = methodDrafts[row.key] ?? row.assignments;
        return row.items
          .map((item) => String(firstValue(item, codeKeys)).trim())
          .filter((itemNo) => itemNo)
          .map((itemNo) => ({ itemNo, methods }));
      });
      if (updates.length === 0) {
        toast.error("ไม่พบรหัส item สำหรับบันทึก method");
        return;
      }
      await api.put("/simple-methods", { updates });
      toast.success(`บันทึก ${dirtyRows.length} รายการสำเร็จ`);
      setMethodDrafts({});
      setSelectedKeys(new Set());
      queryClient.invalidateQueries({ queryKey: ["simple-methods"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <AppLayout fixedHeight mainClassName="relative flex flex-col overflow-hidden p-4 sm:p-6 pb-24">
        <PageHeader
          className="mb-4 shrink-0"
          title={
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="h-6 w-6" />
              Simple Method
            </span>
          }
          description="กำหนดวิธีวิเคราะห์ตาม commonname"
        />

        <SimpleMethodTab
          rows={visibleRows}
          totalRows={rows.length}
          isLoading={isLoading}
          isError={isError}
          error={error}
          activeMethods={activeMethods}
          methodDrafts={methodDrafts}
          selectedKeys={selectedKeys}
          searchText={searchText}
          statusFilter={statusFilter}
          exclusions={exclusions}
          onSearchTextChange={setSearchText}
          onStatusFilterChange={setStatusFilter}
          onDraftChange={setMethodDraft}
          onToggleRow={toggleRowSelected}
          onToggleAll={toggleAllVisibleSelected}
          onExclusionsChanged={() => queryClient.invalidateQueries({ queryKey: ["simple-method-exclusions"] })}
        />

        <div className="pointer-events-none absolute inset-x-6 bottom-6 z-30 flex justify-center">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">เลือก</span>
                <Badge variant="secondary" className="rounded-full">{selectedKeys.size}</Badge>
                <span className="text-muted-foreground">รายการ</span>
              </div>
              <div className="mx-1 h-6 w-px bg-border" aria-hidden />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">เพิ่มทุกสาร:</span>
                <BulkAddMethodPicker
                  methods={activeMethods}
                  disabled={selectedKeys.size === 0}
                  onAdd={applyBulkAdd}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-3 text-muted-foreground"
                  disabled={selectedKeys.size === 0}
                  onClick={applyBulkClear}
                >
                  ล้าง
                </Button>
              </div>
              <div className="mx-1 h-6 w-px bg-border" aria-hidden />
              <Button
                size="sm"
                disabled={dirtyRows.length === 0 || savingAll}
                onClick={saveAllDirty}
                className="rounded-full"
              >
                {savingAll ? "กำลังบันทึก..." : `บันทึก${dirtyRows.length > 0 ? ` (${dirtyRows.length})` : ""}`}
              </Button>
            </div>
          </div>
    </AppLayout>
  );
}

export function MachinesPage() {
  return (
    <AppLayout>
        <PageHeader
          className="mb-6"
          title={
            <span className="inline-flex items-center gap-2">
              <Wrench className="h-6 w-6" />
              รายการเครื่อง
            </span>
          }
          description="จัดการเครื่องมือและข้อมูลทะเบียนเครื่อง"
        />

        <MachinesTab />
    </AppLayout>
  );
}

// Compact per-slot method picker: a trigger showing the selected method labels as
// badges (or a muted placeholder), opening a popover of checkboxes for every active
// method. Selection logic stays in `toggleMethod`; this is presentational only.
function MethodSlotPicker({
  methods,
  selected,
  onChange,
}: {
  methods: MethodDoc[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const selectedLabels = methods.filter((m) => selected.includes(m.code));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 min-w-24 justify-between gap-1.5 px-2.5"
        >
          {selectedLabels.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {selectedLabels.map((m) => (
                <Badge key={m.code} variant="secondary" className="rounded-full px-2 py-0 text-xs font-normal">
                  {m.label}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">เลือก</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1.5">
        {methods.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">ยังไม่มี method</div>
        ) : (
          <div className="flex flex-col">
            {methods.map((m) => {
              const checked = selected.includes(m.code);
              return (
                <button
                  key={m.code}
                  type="button"
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => onChange(toggleMethod(selected, m.code))}
                >
                  <Checkbox checked={checked} className="pointer-events-none" tabIndex={-1} />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Floating-toolbar bulk picker: a single "เพิ่ม method ▾" trigger opening a popover
// that lists each active method. Clicking a method calls `onAdd(code)` and leaves the
// popover open so several can be added in a row.
function BulkAddMethodPicker({
  methods,
  disabled,
  onAdd,
}: {
  methods: MethodDoc[];
  disabled: boolean;
  onAdd: (code: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 rounded-full px-3"
          disabled={disabled}
        >
          เพิ่ม method
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-44 p-1.5">
        {methods.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">ยังไม่มี method</div>
        ) : (
          <div className="flex flex-col">
            {methods.map((m) => (
              <button
                key={m.code}
                type="button"
                className="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => onAdd(m.code)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SimpleMethodTab({
  rows,
  totalRows,
  isLoading,
  isError,
  error,
  activeMethods,
  methodDrafts,
  selectedKeys,
  searchText,
  statusFilter,
  exclusions,
  onSearchTextChange,
  onStatusFilterChange,
  onDraftChange,
  onToggleRow,
  onToggleAll,
  onExclusionsChanged,
}: {
  rows: SimpleMethodRow[];
  totalRows: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  activeMethods: MethodDoc[];
  methodDrafts: Record<string, string[][]>;
  selectedKeys: Set<string>;
  searchText: string;
  statusFilter: SimpleMethodFilter;
  exclusions: ExclusionRule[];
  onSearchTextChange: (value: string) => void;
  onStatusFilterChange: (value: SimpleMethodFilter) => void;
  onDraftChange: (key: string, methods: string[][]) => void;
  onToggleRow: (key: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onExclusionsChanged: () => void;
}) {
  const visibleSelectedCount = rows.reduce(
    (acc, row) => acc + (selectedKeys.has(row.key) ? 1 : 0),
    0,
  );
  const allSelected: boolean | "indeterminate" =
    rows.length > 0 && visibleSelectedCount === rows.length
      ? true
      : visibleSelectedCount === 0
        ? false
        : "indeterminate";
  const isFiltered = rows.length !== totalRows;

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-col gap-3 space-y-0">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-5 w-5" />
            จัดการ Simple Method
            <Badge variant="outline">
              {isFiltered ? `${rows.length}/${totalRows}` : totalRows}
            </Badge>
          </CardTitle>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(event) => onSearchTextChange(event.target.value)}
              placeholder="ค้นหา commonname / item no..."
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as SimpleMethodFilter)}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="ทุก Method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุก Method</SelectItem>
              <SelectItem value="unassigned">ยังไม่กำหนด</SelectItem>
              {activeMethods.map((m) => (
                <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ExclusionManager exclusions={exclusions} onChanged={onExclusionsChanged} />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        {isError ? (
          <div className="m-6 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        ) : (
          <div className="relative h-full overflow-auto border-t">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => onToggleAll(!!checked)}
                      aria-label="เลือกทุกแถว"
                    />
                  </TableHead>
                  <TableHead>commonname</TableHead>
                  <TableHead className="w-64">Method/Instrument</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      กำลังโหลด...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      ไม่มีข้อมูล simple method
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const draftValue = methodDrafts[row.key] ?? row.assignments;
                    const isDirty =
                      methodDrafts[row.key] !== undefined &&
                      !assignmentsEqual(methodDrafts[row.key], row.assignments);
                    const isRowSelected = selectedKeys.has(row.key);
                    const isMulti = row.substances.length > 1;

                    return (
                      <TableRow
                        key={row.key}
                        data-state={isRowSelected ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => onToggleRow(row.key, !isRowSelected)}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={isRowSelected}
                            onCheckedChange={(checked) => onToggleRow(row.key, !!checked)}
                            aria-label={`เลือกแถว ${row.commonName}`}
                          />
                        </TableCell>
                        <TableCell className="min-w-72 font-medium" onClick={(event) => event.stopPropagation()}>
                          <span className="block min-w-0 truncate">{displayValue(row.commonName)}</span>
                        </TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <div
                            className={`flex flex-col gap-1.5 rounded-md border bg-background p-1.5 transition-colors ${
                              isMulti ? "" : "ml-auto w-fit"
                            } ${isDirty ? "border-primary" : "border-input"}`}
                          >
                            {row.substances.map((substance, index) => {
                              const current = draftValue[index] ?? [];
                              return (
                                <div
                                  key={`${row.key}-${index}`}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  {isMulti && (
                                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                      {substance}
                                    </span>
                                  )}
                                  <div className="ml-auto flex items-center justify-end">
                                    <MethodSlotPicker
                                      methods={activeMethods}
                                      selected={current}
                                      onChange={(next) =>
                                        onDraftChange(row.key, setSlotMethods(draftValue, index, next))
                                      }
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ExclusionManager({
  exclusions,
  onChanged,
}: {
  exclusions: ExclusionRule[];
  onChanged: () => void;
}) {
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("contains");
  const [adding, setAdding] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const isEditing = editingRuleId !== null;

  const resetForm = () => {
    setPattern("");
    setMatchType("contains");
    setEditingRuleId(null);
  };

  const startEdit = (rule: ExclusionRule) => {
    setPattern(rule.pattern);
    setMatchType(rule.matchType);
    setEditingRuleId(rule._id);
  };

  const saveRule = async () => {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      if (editingRuleId) {
        await api.put(`/simple-method-exclusions/${editingRuleId}`, { pattern: trimmed, matchType });
      } else {
        await api.post("/simple-method-exclusions", { pattern: trimmed, matchType });
      }
      resetForm();
      onChanged();
      toast.success(
        isEditing
          ? `แก้ไขสารที่ไม่ตรวจเป็น ${MATCH_TYPE_LABELS[matchType]} "${trimmed}"`
          : `ซ่อนสารที่ ${MATCH_TYPE_LABELS[matchType]} "${trimmed}"`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const removeRule = async (id: string) => {
    setRemovingId(id);
    try {
      await api.delete(`/simple-method-exclusions/${id}`);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full md:w-auto gap-2">
          สารที่ไม่ตรวจ
          {exclusions.length > 0 && (
            <Badge variant="secondary" className="rounded-full">{exclusions.length}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3">
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold">สารที่ไม่ตรวจ Simple Method</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              เพิ่มคำเพื่อซ่อน commonname ที่ไม่ต้องตรวจ (เลือกตำแหน่งที่ตรงได้)
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="เช่น seaweed"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveRule();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <Select value={matchType} onValueChange={(value) => setMatchType(value as MatchType)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">มีคำนี้</SelectItem>
                  <SelectItem value="exact">ตรงกับ</SelectItem>
                  <SelectItem value="startsWith">ขึ้นต้นด้วย</SelectItem>
                  <SelectItem value="endsWith">ลงท้ายด้วย</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={saveRule}
                disabled={adding || !pattern.trim()}
              >
                {isEditing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {isEditing ? "บันทึก" : "เพิ่ม"}
              </Button>
              {isEditing && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={resetForm}
                  disabled={adding}
                >
                  ยกเลิก
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-auto rounded-md border">
            {exclusions.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                ยังไม่มีรายการ
              </div>
            ) : (
              <ul className="divide-y">
                {exclusions.map((rule) => (
                  <li key={rule._id} className="flex items-center gap-2 px-3 py-2">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {MATCH_TYPE_LABELS[rule.matchType]}
                    </Badge>
                    <span className="flex-1 truncate text-sm">{rule.pattern}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      disabled={adding || removingId === rule._id}
                      onClick={() => startEdit(rule)}
                      aria-label={`แก้ไข ${rule.pattern}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      disabled={removingId === rule._id}
                      onClick={() => removeRule(rule._id)}
                      aria-label={`ลบ ${rule.pattern}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CommonNameOverrideDialog({
  rawCommonNames,
  initialCanonical,
  onClose,
  onSaved,
}: {
  rawCommonNames: string[];
  initialCanonical: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [canonical, setCanonical] = useState(initialCanonical);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const value = canonical.trim();
    if (!value) {
      toast.error("กรุณาระบุชื่อมาตรฐาน");
      return;
    }
    setBusy(true);
    try {
      // apply the same canonical to every raw common_name passed in
      for (const raw of rawCommonNames) {
        await api.post("/common-name-overrides", { raw, canonical: value, note: note.trim() });
      }
      toast.success("ตั้งชื่อมาตรฐานสำเร็จ");
      onSaved();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ตั้งชื่อมาตรฐาน (common name)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <span className="text-sm text-muted-foreground">ชื่อจากระบบ (raw)</span>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {rawCommonNames.map((raw) => <li key={raw}>{raw}</li>)}
            </ul>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">ชื่อมาตรฐาน</span>
            <Input value={canonical} onChange={(e) => setCanonical(e.target.value)} />
          </div>
          <div>
            <span className="text-sm text-muted-foreground">หมายเหตุ (ไม่บังคับ)</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MasterItemDialog({
  item,
  originalItemNo,
  initialMetaQty,
  onClose,
  onSaved,
}: {
  item: MasterItem | null;
  originalItemNo: string;
  initialMetaQty: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<MasterItemForm>(() =>
    item ? itemToForm(item, initialMetaQty) : { ...emptyForm, requiredInspectionQty: String(initialMetaQty || 0) },
  );
  const [unitOptions, setUnitOptions] = useState(defaultUnitOptions);
  const [busy, setBusy] = useState(false);
  const isEdit = !!item;
  // ประเภทสูตร (EC/WP/...) คำนวณจากชื่อสามัญเสมอ — ไม่เก็บแยก
  const classification = getClassification(form.commonName);
  const addUnitOption = (option: string) => {
    setUnitOptions((current) => current.includes(option) ? current : [...current, option]);
  };

  const setField = (key: keyof MasterItemForm, value: string | string[]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "kgPerCarton" || key === "unitsPerCarton") {
        const kg = formNumber(next.kgPerCarton);
        const unitsPerCarton = formNumber(next.unitsPerCarton);
        next.grossKgPerUnit = kg === null || unitsPerCarton === null || unitsPerCarton <= 0 ? "" : String(kg / unitsPerCarton);
      }
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.itemCode.trim() || !form.itemName.trim()) {
      toast.error("กรุณาระบุ Code และชื่อ Item");
      return;
    }

    const qtyValue = Math.max(0, Math.floor(Number(form.requiredInspectionQty) || 0));
    const numberFields = {
      kgPerCarton: formNumber(form.kgPerCarton),
      grossKgPerUnit: formNumber(form.grossKgPerUnit),
      packLevel: formNumber(form.packLevel),
      unitsPerCarton: formNumber(form.unitsPerCarton),
      measureSize: formNumber(form.measureSize),
    };
    if (Object.entries(numberFields).some(([key, value]) => value === null && form[key as keyof MasterItemForm].trim() !== "")) {
      toast.error("Pack/weight number is invalid");
      return;
    }
    const overrideKey = (isEdit && originalItemNo ? originalItemNo : form.itemCode.trim());
    const overridePayload = {
      itemCode: form.itemCode.trim(),
      itemName: form.itemName.trim(),
      // meta.itemType = ชื่อสามัญ; ส่งเฉพาะตอนเพิ่มใหม่ ตอนแก้ไขห้ามทับค่าที่ Sync ไว้
      ...(isEdit ? {} : { itemType: form.commonName.trim() }),
      category: form.category.trim(),
      unit: form.unit.trim(),
      status: form.status,
      requiredInspectionQty: qtyValue,
      imageUrl: form.imageUrls[0] ?? "",
      imageUrls: form.imageUrls,
      ...numberFields,
      cartonUnit: form.cartonUnit.trim(),
      packUnit: form.packUnit.trim(),
      measureUnit: form.measureUnit.trim(),
    };

    setBusy(true);
    try {
      await api.put(`/master-item-meta/${encodeURIComponent(overrideKey)}`, overridePayload);
      // best-effort sync to n8n webhook (may not persist there)
      try {
        const payload = buildPayload(form, item);
        if (isEdit) {
          const id = getItemId(item);
          if (id) await api.patch(`/master-items/${encodeURIComponent(id)}`, payload);
        } else {
          await api.post("/master-items", payload);
        }
      } catch {
        // webhook sync failure is non-fatal — override is source of truth
      }
      toast.success(isEdit ? "แก้ไข item สำเร็จ" : "เพิ่ม item สำเร็จ");
      onSaved();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "แก้ไข Item" : "เพิ่ม Item"}</DialogTitle>
            <DialogDescription className="sr-only">
              {isEdit ? "Edit master item metadata" : "Create a master item override"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 grid-cols-1 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="itemCode">Code</Label>
              <Input
                id="itemCode"
                value={form.itemCode}
                onChange={(event) => setField("itemCode", event.target.value)}
                required
                disabled={isEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="itemName">ชื่อ Item</Label>
              <Input
                id="itemName"
                value={form.itemName}
                onChange={(event) => setField("itemName", event.target.value)}
                required
                disabled={isEdit}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="commonname">ชื่อสามัญ</Label>
              <Input
                id="commonname"
                value={form.commonName}
                onChange={(event) => setField("commonName", event.target.value)}
                disabled={isEdit}
                readOnly={isEdit}
                placeholder="เช่น ABAMECTIN 1.8% EC"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="itemType">ประเภท</Label>
              <Input
                id="itemType"
                value={classification ? `${classification.code} - ${classification.label}` : "-"}
                disabled
                readOnly
              />
              <p className="text-xs text-muted-foreground">คำนวณอัตโนมัติจากชื่อสามัญ</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">หมวดหมู่</Label>
              <Input
                id="category"
                value={form.category}
                onChange={(event) => setField("category", event.target.value)}
                disabled={isEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                value={form.unit}
                onChange={(event) => setField("unit", event.target.value)}
                disabled={isEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requiredInspectionQty">พารามิเตอร์</Label>
              <Input
                id="requiredInspectionQty"
                type="number"
                value={form.requiredInspectionQty}
                disabled
                readOnly
              />
              <p className="text-xs text-muted-foreground">
                คำนวนอัตโนมัติจากพารามิเตอร์ที่ตั้งไว้ในหน้า "พารามิเตอร์การตรวจสอบ"
              </p>
            </div>
            <div className="md:col-span-2">
              <StockPhotoUploader
                label="รูปสินค้า (ไม่บังคับ)"
                value={form.imageUrls}
                onChange={(urls) => setField("imageUrls", urls)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kgPerCarton">Kg/Carton</Label>
              <Input
                id="kgPerCarton"
                type="number"
                min="0"
                step="0.000001"
                value={form.kgPerCarton}
                onChange={(event) => setField("kgPerCarton", event.target.value)}
              />
            </div>
            {([
              ["grossKgPerUnit", "Gross Kg/Unit"],
              ["packLevel", "Pack Level"],
              ["unitsPerCarton", "Units/Carton"],
              ["measureSize", "Measure Size"],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  type="number"
                  step="0.000001"
                  value={form[key]}
                  onChange={(event) => setField(key, event.target.value)}
                  disabled={key === "grossKgPerUnit"}
                />
              </div>
            ))}
            {([
              ["packUnit", "Pack Unit"],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  value={form[key]}
                  onChange={(event) => setField(key, event.target.value)}
                />
              </div>
            ))}
            <UnitSelectField
              id="cartonUnit"
              label="Carton Unit"
              value={form.cartonUnit}
              options={unitOptions}
              onChange={(value) => setField("cartonUnit", value)}
              onAddOption={addUnitOption}
            />
            <UnitSelectField
              id="measureUnit"
              label="Measure Unit"
              value={form.measureUnit}
              options={unitOptions}
              onChange={(value) => setField("measureUnit", value)}
              onAddOption={addUnitOption}
            />
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => setField("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="inactive">inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MasterItemDetailDrawer({
  item,
  originalItemNo,
  parameters,
  groups,
  itemGroupIds,
  extraColumns,
  onClose,
  onEdit,
}: {
  item: MasterItem;
  originalItemNo: string;
  parameters: ParameterItem[];
  groups: ItemGroupItem[];
  itemGroupIds: string[];
  extraColumns: string[];
  onClose: () => void;
  onEdit: () => void;
}) {
  // membership resolve มาจาก catalog ดิบแล้ว (ส่งเป็น itemGroupIds) — map เป็นชื่อกลุ่มเพื่อแสดง
  const memberGroups = groups.filter((grp) => itemGroupIds.includes(grp._id));
  const classification = getClassification(firstValue(item, typeKeys));
  const regulatoryType = getMasterItemRegulatoryType(item);
  const active = isItemActive(item);
  const code = displayValue(originalItemNo || firstValue(item, codeKeys));
  const name = displayValue(firstValue(item, nameKeys));
  const imageUrls = getImageUrls(item);
  const hasExtra =
    extraColumns.length > 0 && extraColumns.some((key) => String(item[key] ?? "").trim() !== "");

  const mainFields: Array<{ label: string; value: React.ReactNode }> = [
    { label: "ชื่อสินค้า", value: name },
    ...(regulatoryType ? [{ label: "Type", value: regulatoryType }] : []),
    { label: "ชื่อสามัญ", value: displayValue(firstValue(item, commonNameKeys)) },
    {
      label: "ประเภท",
      value: classification
        ? `${classification.code} - ${classification.label}`
        : displayValue(firstValue(item, typeKeys)),
    },
    { label: "หมวดหมู่", value: displayValue(getItemCategory(item)) },
    { label: "หน่วย", value: displayValue(firstValue(item, unitKeys)) },
    {
      label: "สถานะ",
      value: (
        <Badge
          variant="outline"
          className={cn(
            "gap-1.5",
            active
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30"
              : "text-muted-foreground",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground")} />
          {active ? "ใช้งาน" : "ปิดใช้งาน"}
        </Badge>
      ),
    },
  ];

  const packFields: Array<{ label: string; value: React.ReactNode }> = [
    { label: "ขนาดบรรจุ", value: formatPackSize(item) },
    { label: "จำนวนต่อลัง", value: displayValue(firstValue(item, unitsPerCartonKeys)) },
    { label: "น้ำหนักต่อลัง (kg)", value: displayValue(firstValue(item, weightKeys)) },
    { label: "Kg/Unit", value: displayValue(firstValue(item, grossKgPerUnitKeys)) },
    { label: "pack_level", value: displayValue(firstValue(item, packLevelKeys)) },
    { label: "carton_unit", value: displayValue(firstValue(item, cartonUnitKeys)) },
    {
      label: "measure_size",
      value: displayValue(
        [firstValue(item, measureSizeKeys), firstValue(item, measureUnitKeys)].filter(Boolean).join(" "),
      ),
    },
  ];

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="break-words text-sm">{value}</div>
    </div>
  );

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-10 top-3.5 h-7 w-7"
          aria-label="แก้ไข item จากแถบรายละเอียด"
          title="แก้ไข"
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <SheetHeader className="space-y-1 border-b border-border p-6 pr-20 text-left">
          <SheetTitle className="text-xl font-bold text-primary">{code}</SheetTitle>
          <SheetDescription className="sr-only">
            Master item details and matching parameters
          </SheetDescription>
          <p className="text-sm text-muted-foreground">{name}</p>
        </SheetHeader>

        <div className="flex-1 space-y-6 p-6">
          {imageUrls.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">รูปสินค้า</h3>
              <div className="grid grid-cols-2 gap-2">
                {imageUrls.map((imageUrl, index) => (
                  <img
                    key={imageUrl}
                    src={imageUrl}
                    alt={`รูปสินค้า ${name} ${index + 1}`}
                    className="h-40 w-full rounded-lg border bg-muted object-contain"
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ข้อมูลหลัก</h3>
            <div className="grid grid-cols-2 gap-4">
              {mainFields.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">กลุ่มสินค้า</h3>
            <div className="flex flex-wrap gap-1">
              {memberGroups.length > 0 ? memberGroups.map((grp) => (
                <Badge key={grp._id} variant="secondary" className="max-w-full whitespace-normal break-words">{grp.name}</Badge>
              )) : <p className="text-sm text-muted-foreground">ยังไม่จัดกลุ่ม</p>}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">บรรจุ / น้ำหนัก</h3>
            <div className="grid grid-cols-2 gap-4">
              {packFields.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                พารามิเตอร์ที่ตรงกับสินค้านี้
              </h3>
              <span className="text-xs text-muted-foreground">{parameters.length} รายการ</span>
            </div>
            {parameters.length > 0 ? (
              <ul className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
                {parameters.map((param) => (
                  <li key={param._id ?? param.name} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/70" />
                    <span className="min-w-0 flex-1 truncate font-medium">{param.name}</span>
                    {param.scope && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase">
                        {param.scope}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                ยังไม่มีพารามิเตอร์ที่ตรงกับสินค้านี้
              </div>
            )}
          </section>

          {hasExtra && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ข้อมูลเพิ่มเติม</h3>
              <div className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
                {extraColumns.map((key) => {
                  const value = displayValue(item[key]);
                  if (!value || value === "-") return null;
                  return (
                    <div key={key} className="space-y-0.5">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{key}</div>
                      <div className="break-words text-sm">{value}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <SheetFooter className="border-t border-border p-4">
          <Button variant="outline" onClick={onClose}>ปิด</Button>
          <Button onClick={onEdit}>
            <Pencil className="mr-1.5 h-4 w-4" />
            แก้ไข
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const emptyMachineForm: MachineItem = {
  code: "",
  type: "",
  registerNo: "",
  name: "",
  manufacturer: "",
  model: "",
  serialNo: "",
  manualDoc: "",
  installDate: "",
  startDate: "",
  location: "",
  status: "active",
  note: "",
};

function MachinesTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<MachineItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [retiring, setRetiring] = useState<MachineItem | null>(null);
  const [viewing, setViewing] = useState<MachineItem | null>(null);

  const {
    data: machines = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["machines"],
    queryFn: () => api.getMachines(),
  });

  const locationOptions = useMemo(() => {
    const values = new Set<string>();
    machines.forEach((m) => { if (m.location) values.add(m.location); });
    return Array.from(values).sort((a, b) => a.localeCompare(b, ["th", "en"]));
  }, [machines]);

  const typeOptions = useMemo(() => {
    const values = new Set<string>();
    machines.forEach((m) => { if (m.type) values.add(m.type); });
    return Array.from(values).sort((a, b) => a.localeCompare(b, ["th", "en"]));
  }, [machines]);

  const filteredMachines = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = machines.filter((m) => {
      const matchesSearch = !q || [m.code, m.name, m.manufacturer, m.model, m.serialNo, m.registerNo, m.location]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
      const matchesLocation = locationFilter === "all" || m.location === locationFilter;
      const matchesStatus = statusFilter === "all" || m.status === statusFilter;
      return matchesSearch && matchesLocation && matchesStatus;
    });
    return rankSearchResults(filtered, q, (machine) => ({
      primary: [machine.code],
      secondary: [machine.name, machine.manufacturer, machine.model, machine.serialNo, machine.registerNo, machine.location],
    }));
  }, [machines, search, locationFilter, statusFilter]);

  const handleRetire = async () => {
    if (!retiring?._id) return;
    try {
      await api.updateMachine(retiring._id, { status: "retired" });
      toast.success("ปลดระวางเครื่องมือสำเร็จ");
      setRetiring(null);
      queryClient.invalidateQueries({ queryKey: ["machines"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const closeDialog = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-5 w-5" />
          รายการเครื่องมือ
          <Badge variant="outline">{filteredMachines.length}</Badge>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="สถานที่ตั้ง" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกสถานที่</SelectItem>
              {locationOptions.map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="สถานะ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกสถานะ</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="inactive">inactive</SelectItem>
              <SelectItem value="retired">retired</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหารหัส, ชื่อ, ยี่ห้อ..."
              className="pl-8"
            />
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            เพิ่มเครื่องมือ
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รหัส</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead>ชื่อเครื่องมือ</TableHead>
                  <TableHead>สถานที่</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">กำลังโหลด...</TableCell>
                  </TableRow>
                ) : filteredMachines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      ยังไม่มีข้อมูลเครื่องมือ — กด "เพิ่มเครื่องมือ" เพื่อเริ่มบันทึก
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMachines.map((m) => (
                    <TableRow
                      key={m._id ?? m.code}
                      className="cursor-pointer"
                      onClick={() => setViewing(m)}
                      title="คลิกเพื่อดูรายละเอียด"
                    >
                      <TableCell className="font-semibold text-primary">{m.code}</TableCell>
                      <TableCell>{displayValue(m.type)}</TableCell>
                      <TableCell className="min-w-52 font-medium">{m.name}</TableCell>
                      <TableCell>{displayValue(m.location)}</TableCell>
                      <TableCell>
                        <Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status ?? "active"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" onClick={() => setEditing(m)} title="แก้ไข">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {m.status !== "retired" && (
                            <Button size="icon" variant="ghost" onClick={() => setRetiring(m)} title="ปลดระวาง">
                              <Archive className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {viewing && (
        <MachineDetailDialog
          item={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onRetire={() => { setRetiring(viewing); setViewing(null); }}
        />
      )}

      {(creating || editing) && (
        <MachineDialog
          item={editing}
          typeOptions={typeOptions}
          onClose={closeDialog}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["machines"] })}
        />
      )}

      {retiring && (
        <Dialog open onOpenChange={(open) => { if (!open) setRetiring(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>ยืนยันปลดระวางเครื่องมือ</DialogTitle>
            </DialogHeader>
            <div className="space-y-1 text-sm text-muted-foreground">
              <div>{retiring.code} - {retiring.name}</div>
              <div>เครื่องมือจะถูกตั้งสถานะเป็น <span className="font-medium text-foreground">retired</span> (เลิกใช้งาน) ไม่ใช่การลบข้อมูล</div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRetiring(null)}>ยกเลิก</Button>
              <Button variant="destructive" onClick={handleRetire}>ปลดระวาง</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function MachineDetailDialog({
  item,
  onClose,
  onEdit,
  onRetire,
}: {
  item: MachineItem;
  onClose: () => void;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const Row = ({ label, value }: { label: string; value?: string }) => (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium break-words">{displayValue(value)}</div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-primary">{item.code}</span>
            <span className="font-normal text-muted-foreground">{item.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <Row label="ประเภท" value={item.type} />
          <Row label="ทะเบียน" value={item.registerNo} />
          <Row label="ยี่ห้อ / ผู้ผลิต" value={item.manufacturer} />
          <Row label="รุ่น" value={item.model} />
          <Row label="S/N" value={item.serialNo} />
          <Row label="สถานที่ตั้ง" value={item.location} />
          <Row label="วันที่ติดตั้ง" value={item.installDate} />
          <Row label="เริ่มใช้งาน" value={item.startDate} />
          <Row label="เอกสารวิธีปฏิบัติงาน" value={item.manualDoc} />
          <Row label="สถานะ" value={item.status} />
          {item.note ? (
            <div className="col-span-2">
              <Row label="หมายเหตุ" value={item.note} />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ปิด</Button>
          {item.status !== "retired" && (
            <Button variant="destructive" onClick={onRetire}>
              <Archive className="h-4 w-4" />
              ปลดระวาง
            </Button>
          )}
          <Button onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            แก้ไข
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MachineDialog({
  item,
  typeOptions,
  onClose,
  onSaved,
}: {
  item: MachineItem | null;
  typeOptions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<MachineItem>(() => item ? { ...item } : { ...emptyMachineForm });
  const [busy, setBusy] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState("");
  const isEdit = !!item?._id;

  const setField = <K extends keyof MachineItem>(key: K, value: MachineItem[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // รวมประเภทที่มีอยู่ + ค่าปัจจุบัน (เผื่อแก้ไขเครื่องที่เป็นประเภทเก่าที่ไม่อยู่ในลิสต์)
  const typeChoices = useMemo(() => {
    const set = new Set(typeOptions);
    if (form.type) set.add(form.type);
    return Array.from(set).sort((a, b) => a.localeCompare(b, ["th", "en"]));
  }, [typeOptions, form.type]);

  const confirmNewType = () => {
    const v = newType.trim();
    if (v) setField("type", v);
    setAddingType(false);
    setNewType("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("กรุณาระบุรหัสและชื่อเครื่องมือ");
      return;
    }
    setBusy(true);
    try {
      if (isEdit && item?._id) {
        await api.updateMachine(item._id, form);
        toast.success("แก้ไขเครื่องมือสำเร็จ");
      } else {
        await api.createMachine(form);
        toast.success("เพิ่มเครื่องมือสำเร็จ");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "แก้ไขเครื่องมือ" : "เพิ่มเครื่องมือ"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4 grid-cols-1 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-code">รหัสเครื่องมือ *</Label>
              <Input id="m-code" value={form.code} onChange={(e) => setField("code", e.target.value)} required placeholder="LD-049" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-type">ประเภท</Label>
              {addingType ? (
                <div className="flex gap-2">
                  <Input
                    id="m-type"
                    autoFocus
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    placeholder="พิมพ์ชื่อประเภทใหม่"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); confirmNewType(); }
                    }}
                  />
                  <Button type="button" variant="secondary" onClick={confirmNewType}>เพิ่ม</Button>
                  <Button type="button" variant="ghost" onClick={() => { setAddingType(false); setNewType(""); }}>ยกเลิก</Button>
                </div>
              ) : (
                <Select
                  value={form.type || ""}
                  onValueChange={(v) => {
                    if (v === "__add_new__") { setAddingType(true); setNewType(""); }
                    else setField("type", v);
                  }}
                >
                  <SelectTrigger id="m-type">
                    <SelectValue placeholder="เลือกประเภท" />
                  </SelectTrigger>
                  <SelectContent>
                    {typeChoices.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                    <SelectItem value="__add_new__" className="text-primary">➕ เพิ่มประเภทใหม่</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-register">หมายเลขทะเบียน</Label>
              <Input id="m-register" value={form.registerNo ?? ""} onChange={(e) => setField("registerNo", e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="m-name">ชื่อเครื่องมือ *</Label>
              <Input id="m-name" value={form.name} onChange={(e) => setField("name", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-manufacturer">ยี่ห้อ / ผู้ผลิต</Label>
              <Input id="m-manufacturer" value={form.manufacturer ?? ""} onChange={(e) => setField("manufacturer", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-model">รุ่น</Label>
              <Input id="m-model" value={form.model ?? ""} onChange={(e) => setField("model", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-serial">หมายเลขเครื่อง (S/N)</Label>
              <Input id="m-serial" value={form.serialNo ?? ""} onChange={(e) => setField("serialNo", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-doc">เอกสารวิธีปฏิบัติงาน</Label>
              <Input id="m-doc" value={form.manualDoc ?? ""} onChange={(e) => setField("manualDoc", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-install">วันที่ติดตั้ง</Label>
              <Input id="m-install" value={form.installDate ?? ""} onChange={(e) => setField("installDate", e.target.value)} placeholder="dd/mm/yyyy" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-start">วันที่เริ่มใช้งาน</Label>
              <Input id="m-start" value={form.startDate ?? ""} onChange={(e) => setField("startDate", e.target.value)} placeholder="dd/mm/yyyy" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-location">สถานที่ตั้ง</Label>
              <Input id="m-location" value={form.location ?? ""} onChange={(e) => setField("location", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>สถานะ</Label>
              <Select value={form.status ?? "active"} onValueChange={(v) => setField("status", v as MachineItem["status"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="inactive">inactive</SelectItem>
                  <SelectItem value="retired">retired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="m-note">หมายเหตุ</Label>
              <Textarea id="m-note" value={form.note ?? ""} onChange={(e) => setField("note", e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
