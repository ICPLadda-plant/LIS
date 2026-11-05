import { parseSubstances } from '@/lib/substances';
import { readSlotMethods, type MethodDoc } from '@/lib/methodRegistry';
import type { Petition, PetitionItem } from '@/types/petition.types';

// One substance within a commonName (split by "+"), with the AND-set of method
// codes the simple-method config assigned to it. `methods.length === 0` means
// "not yet configured" → that slot blocks starting the work.
export type SubstanceSlot = {
  name: string;
  methods: string[];
};

export type SubstanceGroup = {
  groupKey: string;       // `${sampleName.lower}||${commonName.lower}`
  sampleName: string;
  commonName: string;
  items: PetitionItem[];
  slots: SubstanceSlot[];  // per-substance, positional — aligned to parseSubstances(commonName)
};

// commonName (lowercased) → positional method-code AND-sets, index i = parseSubstances()[i].
export type SlotMethods = string[][];

export type MasterItemRaw = Record<string, unknown>;
export type SimpleMethodEntry = { itemNo: string; methods?: string[][]; instruments?: string[] };

const MASTER_COMMON_NAME_KEYS = ['common_name', 'commonname', 'commonName', 'item_name2', 'itemType'];
const MASTER_ITEM_NO_KEYS = ['item_no', 'itemCode', 'item_code', 'code', 'Code', 'ITEM_CODE'];

function pickField(item: MasterItemRaw, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

export function groupKeyOf(sampleName: string, commonName: string): string {
  return `${(sampleName || '').trim().toLowerCase()}||${(commonName || '').trim().toLowerCase()}`;
}

// Sample-number label for a substance group, e.g. items with seq 1 and 2 → "1+2".
export function sampleSeqLabel(group: SubstanceGroup): string {
  return group.items
    .map((item) => item.seq)
    .filter((seq) => seq !== undefined && seq !== null)
    .sort((a, b) => a - b)
    .join('+');
}

// Master items sharing a commonName are merged slot-by-slot (first slot with
// any configured method wins), preserving which methods belong to which substance.
export function buildCommonNameToSlots(
  masterItems: MasterItemRaw[],
  simpleMethods: SimpleMethodEntry[],
): Map<string, SlotMethods> {
  const itemNoToEntry = new Map<string, SimpleMethodEntry>();
  simpleMethods.forEach((entry) => {
    if (entry.itemNo) itemNoToEntry.set(entry.itemNo.trim(), entry);
  });

  const map = new Map<string, SlotMethods>();
  masterItems.forEach((item) => {
    const commonName = pickField(item, MASTER_COMMON_NAME_KEYS);
    if (!commonName) return;
    const entry = itemNoToEntry.get(pickField(item, MASTER_ITEM_NO_KEYS));
    if (!entry) return;
    const key = commonName.trim().toLowerCase();
    const count = parseSubstances(commonName).length;
    const slots = readSlotMethods(entry, count);
    if (slots.every((s) => s.length === 0)) return;
    const current = map.get(key) ?? (Array.from({ length: count }, () => [] as string[]) as SlotMethods);
    const merged = Array.from(
      { length: Math.max(count, current.length, slots.length) },
      (_, i) => (current[i] && current[i].length > 0 ? current[i] : (slots[i] ?? [])),
    ) as SlotMethods;
    map.set(key, merged);
  });
  return map;
}

export function buildSubstanceGroups(
  petition: Petition,
  commonNameToSlots: Map<string, SlotMethods>,
): SubstanceGroup[] {
  const groups = new Map<string, SubstanceGroup>();
  (petition.items ?? []).forEach((item) => {
    const sampleName = (item.sampleName ?? '').trim();
    const commonName = (item.commonName ?? '').trim();
    const key = groupKeyOf(sampleName, commonName);
    let group = groups.get(key);
    if (!group) {
      const slotMethods = commonNameToSlots.get(commonName.toLowerCase()) ?? [];
      group = {
        groupKey: key,
        sampleName,
        commonName,
        items: [],
        slots: parseSubstances(commonName).map((name, idx) => ({
          name,
          methods: slotMethods[idx] ?? [],
        })),
      };
      groups.set(key, group);
    }
    group.items.push(item);
  });
  return Array.from(groups.values());
}

// A group cannot be started when it has no substances, or any slot has no
// configured method / an unknown / inactive method code.
export function groupHasUnassignable(group: SubstanceGroup, methodByCode: Map<string, MethodDoc>): boolean {
  if (group.slots.length === 0) return true;
  return group.slots.some(
    (s) =>
      s.methods.length === 0 ||
      s.methods.some((code) => {
        const method = methodByCode.get(code);
        return !method || method.active === false;
      }),
  );
}

