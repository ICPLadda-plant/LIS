import { getItemNo, getPackSize, getRawCommonName, getSampleName } from './masterItemFields';

export type MasterItemRaw = Record<string, unknown>;

export interface PetitionMasterItemOption {
  itemNo: string;
  sampleName: string;
  commonName: string;
  packageUnit: string;
  MF_Before?: string | null;
  MF_Lasted?: string | null;
  MF_GapDays?: number | null;
  MF_BatchAfterGap?: number | null;
  MF_ConsecutivePassCount?: number | null;
}

export interface PetitionMasterItemSelection {
  sampleName?: string;
  commonName?: string;
  packageUnit?: string;
}

export function normalizeMasterItemPayload(payload: unknown): MasterItemRaw[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload)) {
    const nested = [payload.data, payload.items, payload.result, payload.rows].find(Array.isArray);
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is MasterItemRaw {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalized(value?: string | null): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function sameText(left?: string, right?: string): boolean {
  return normalized(left) === normalized(right);
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return String(value);
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildPetitionMasterItemOptions(items: MasterItemRaw[]): PetitionMasterItemOption[] {
  const seen = new Set<string>();
  const options: PetitionMasterItemOption[] = [];

  for (const item of items) {
    const option = {
      itemNo: getItemNo(item),
      sampleName: getSampleName(item),
      commonName: getRawCommonName(item),
      packageUnit: getPackSize(item),
      MF_Before: optionalString(item.MF_Before),
      MF_Lasted: optionalString(item.MF_Lasted),
      MF_GapDays: optionalNumber(item.MF_GapDays),
      MF_BatchAfterGap: optionalNumber(item.MF_BatchAfterGap),
      MF_ConsecutivePassCount: optionalNumber(item.MF_ConsecutivePassCount),
    };
    if (!option.sampleName) continue;

    const key = [
      normalized(option.itemNo),
      normalized(option.sampleName),
      normalized(option.commonName),
      normalized(option.packageUnit),
    ].join('|');
    if (seen.has(key)) continue;

    seen.add(key);
    options.push(option);
  }

  return options.sort((a, b) => a.sampleName.localeCompare(b.sampleName, 'th'));
}

export function findMatchingPetitionMasterItem(
  options: PetitionMasterItemOption[],
  selection: PetitionMasterItemSelection,
): PetitionMasterItemOption | null {
  const sampleName = selection.sampleName?.trim();
  if (!sampleName) return null;

  const exactRows = options.filter((option) => sameText(option.sampleName, sampleName));
  if (exactRows.length === 0) return null;

  const commonName = selection.commonName?.trim();
  const packageUnit = selection.packageUnit?.trim();
  if (commonName || packageUnit) {
    const fullMatch = exactRows.find((option) => (
      (!commonName || sameText(option.commonName, commonName)) &&
      (!packageUnit || sameText(option.packageUnit, packageUnit))
    ));
    if (fullMatch) return fullMatch;
    // Master Item ที่ไม่มีชื่อสามัญ/ขนาดบรรจุ ให้ผู้ใช้กรอกเองได้ จึงถือว่าช่องว่างใน master ตรงกับค่าที่กรอก
    const blankFieldMatch = exactRows.find((option) => (
      (!commonName || !option.commonName?.trim() || sameText(option.commonName, commonName)) &&
      (!packageUnit || !option.packageUnit?.trim() || sameText(option.packageUnit, packageUnit))
    ));
    if (blankFieldMatch) return blankFieldMatch;
  }

  return exactRows.length === 1 ? exactRows[0] : null;
}
