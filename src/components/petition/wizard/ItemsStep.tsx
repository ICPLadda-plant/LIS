import { useEffect, useMemo, useState } from 'react';
import { defaultFilter } from 'cmdk';
import { rankSearchResults } from '@/lib/searchRanking';
import { Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  findMatchingPetitionMasterItem,
  type PetitionMasterItemOption,
} from '@/lib/petitionMasterItem';
import {
  defaultSendItemToLab,
  isMandatoryLabProduct,
  shouldSendItemToLab,
} from '@/lib/petitionRouting';
import SubmitterPicker, { type SubmitterValues } from './SubmitterPicker';

export interface ItemRowValues {
  seq: number;
  // รหัส Master Item (RO-0123) ของแถวที่เลือก — ขับ "หมวดหมู่ย่อย (prefix code)" +
  // "กลุ่ม Item" ของ parameter. ตามของที่เลือกเสมอ ไม่ใช่ค่าที่คนพิมพ์เอง
  itemNo?: string;
  sampleName: string;
  commonName: string;
  batchNo: string;
  lotNo: string;
  productionDate: string | null;
  packageUnit: string;
  submissionNo: string;
  testUnit: string;
  testItems: string;
  sendToLab?: boolean;
  MF_Before?: string | null;
  MF_Lasted?: string | null;
  MF_GapDays?: number | null;
  MF_BatchAfterGap?: number | null;
  MF_ConsecutivePassCount?: number | null;
  note: string;
  sampleQuantity?: number;
  labelQuantity?: string;
  labelQuantities?: string[];
  labelSampledDate?: string;
  submittedQuantity?: string;
  submittedUnit?: string;
}

interface Props {
  value: ItemRowValues[];
  onChange: (v: ItemRowValues[]) => void;
  submitter: SubmitterValues;
  onSubmitterChange: (v: SubmitterValues) => void;
  submitterReadOnly?: boolean;
  submitterDepartment?: string;
  deliverer: SubmitterValues;
  onDelivererChange: (v: SubmitterValues) => void;
  showDeliverer?: boolean;
  requireDeliveryAndBatch?: boolean;
  itemsReadOnly?: boolean;
  allowManualItemFields?: boolean;
  masterItemOptions?: PetitionMasterItemOption[];
  masterItemsLoading?: boolean;
  /** ส่งทั้ง QC และ LAB: บังคับ 2 ตัวอย่าง ปริมาณน้อยกว่าไป QC มากกว่าไป LAB */
  splitQcLab?: boolean;
}

function quantityNumber(value: string | undefined): number | null {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** คืนปลายทางของแต่ละตัวอย่าง (index 0/1) ตามปริมาณ หรือ null ถ้ายังตัดสินไม่ได้ */
export function qcLabSampleTargets(quantities: string[]): Array<'QC' | 'LAB'> | null {
  const a = quantityNumber(quantities[0]);
  const b = quantityNumber(quantities[1]);
  if (a === null || b === null || a === b) return null;
  return a < b ? ['QC', 'LAB'] : ['LAB', 'QC'];
}

function parseSampleQuantityInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function sampleQuantityInputCount(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1) return 1;
  return value ?? 1;
}

function splitLabelQuantity(value: string | undefined): string[] {
  return String(value ?? '')
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function labelQuantityInputs(item: ItemRowValues): string[] {
  const count = sampleQuantityInputCount(item.sampleQuantity);
  const fromArray = Array.isArray(item.labelQuantities)
    ? item.labelQuantities.map((entry) => String(entry ?? ''))
    : [];
  const source = fromArray.length ? fromArray : splitLabelQuantity(item.labelQuantity);
  return Array.from({ length: count }, (_, index) => source[index] ?? (count === 1 ? item.labelQuantity ?? '' : ''));
}

function labelQuantityPatch(item: ItemRowValues, quantityIndex: number, nextValue: string): Pick<ItemRowValues, 'labelQuantity' | 'labelQuantities'> {
  const quantities = labelQuantityInputs(item);
  quantities[quantityIndex] = nextValue;
  return {
    labelQuantity: quantities.filter((entry) => entry.trim()).join(', '),
    labelQuantities: quantities,
  };
}

const mfFieldKeys = [
  'MF_Before',
  'MF_Lasted',
  'MF_GapDays',
  'MF_BatchAfterGap',
  'MF_ConsecutivePassCount',
] as const;

function mfFieldsFromOption(option: PetitionMasterItemOption): Partial<ItemRowValues> {
  const patch: Partial<ItemRowValues> = {};
  mfFieldKeys.forEach((key) => {
    if (option[key] !== undefined) patch[key] = option[key] as never;
  });
  return patch;
}

function clearMfFieldsIfPresent(item: ItemRowValues): Partial<ItemRowValues> {
  if (!mfFieldKeys.some((key) => item[key] !== undefined)) return {};
  return {
    MF_Before: null,
    MF_Lasted: null,
    MF_GapDays: null,
    MF_BatchAfterGap: null,
    MF_ConsecutivePassCount: null,
  };
}

export default function ItemsStep({
  value,
  onChange,
  submitter,
  onSubmitterChange,
  submitterReadOnly,
  submitterDepartment,
  deliverer,
  onDelivererChange,
  showDeliverer = true,
  requireDeliveryAndBatch = true,
  itemsReadOnly = false,
  allowManualItemFields = false,
  masterItemOptions = [],
  masterItemsLoading = false,
  splitQcLab = false,
}: Props) {
  useEffect(() => {
    if (!splitQcLab || !value.some((item) => item.sampleQuantity !== 2)) return;
    onChange(value.map((item) => (item.sampleQuantity === 2 ? item : { ...item, sampleQuantity: 2 })));
  }, [splitQcLab, value, onChange]);

  function setItem(idx: number, patch: Partial<ItemRowValues>) {
    onChange(value.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function patchWithLabDefault(
    item: ItemRowValues,
    patch: Partial<ItemRowValues>,
    { syncDefault = false }: { syncDefault?: boolean } = {},
  ) {
    const previousDefault = defaultSendItemToLab(item);
    const followsDefault = typeof item.sendToLab !== 'boolean' || item.sendToLab === previousDefault;
    const next = { ...item, ...patch };
    const nextDefault = defaultSendItemToLab(next);
    if (isMandatoryLabProduct(next)) return { ...patch, sendToLab: true };
    if (!syncDefault && !isMandatoryLabProduct(item)) {
      return followsDefault && !previousDefault && nextDefault ? { ...patch, sendToLab: true } : patch;
    }
    return followsDefault ? { ...patch, sendToLab: nextDefault } : patch;
  }

  function setBatchNo(idx: number, batchNo: string) {
    const item = value[idx];
    setItem(idx, patchWithLabDefault(item, { batchNo }, { syncDefault: true }));
  }

  function setCommonName(idx: number, commonName: string) {
    const item = value[idx];
    setItem(idx, patchWithLabDefault(item, { commonName }));
  }

  function setMasterOptionPicked(idx: number, item: ItemRowValues, option: PetitionMasterItemOption) {
    setItem(idx, patchWithLabDefault(item, {
      itemNo: option.itemNo,
      sampleName: option.sampleName,
      commonName: option.commonName,
      packageUnit: option.packageUnit,
      ...mfFieldsFromOption(option),
    }));
  }

  function fillEmptyMasterFields(
    item: ItemRowValues,
    option: PetitionMasterItemOption,
    patch: Partial<ItemRowValues> = {},
  ): Partial<ItemRowValues> {
    return {
      ...patch,
      // itemNo คือตัวตนของ master item ที่เลือก — ตามของที่เลือกเสมอ ต่างจากอีก 3 ฟิลด์
      // ที่เติมเฉพาะช่องว่างเพื่อไม่ทับสิ่งที่ R&D พิมพ์เอง
      itemNo: option.itemNo,
      sampleName: item.sampleName.trim() ? (patch.sampleName ?? item.sampleName) : option.sampleName,
      commonName: item.commonName.trim() ? item.commonName : option.commonName,
      packageUnit: option.packageUnit,
      ...mfFieldsFromOption(option),
    };
  }

  function handleManualSampleNameChange(idx: number, sampleName: string) {
    const item = value[idx];
    const match = findMatchingPetitionMasterItem(masterItemOptions, { sampleName });
    if (!match) {
      // ล้างรหัสเก่าทิ้ง ไม่งั้นชื่อที่พิมพ์ใหม่จะยังลาก parameter ของสินค้าตัวก่อนมาด้วย
      setItem(idx, patchWithLabDefault(item, {
        sampleName,
        itemNo: '',
        ...clearMfFieldsIfPresent(item),
      }));
      return;
    }
    setItem(idx, patchWithLabDefault(item, fillEmptyMasterFields(item, match, { sampleName })));
  }

  function addItem() {
    onChange([
      ...value,
      {
        seq: value.length + 1,
        sampleName: '',
        commonName: '',
        batchNo: '',
        lotNo: '',
        productionDate: null,
        packageUnit: '',
        submissionNo: '',
        testUnit: '',
        testItems: '',
        sampleQuantity: 1,
        labelQuantity: '',
        note: '',
      },
    ]);
  }

  function removeItem(idx: number) {
    onChange(value.filter((_, i) => i !== idx).map((it, i) => ({ ...it, seq: i + 1 })));
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{showDeliverer ? 'ผู้ยื่นคำขอ และ ผู้นำส่ง' : 'ผู้ยื่นคำขอ'}</h2>
        <p className="text-sm text-grey-500">
          {showDeliverer
            ? 'ผู้ยื่นคำขอ = ผู้ใช้งานที่เข้าสู่ระบบ · ผู้นำส่ง = ผู้ที่จะถือตัวอย่างไปส่ง (เลือกจากระบบ HR)'
            : 'ผู้ยื่นคำขอ = ผู้ใช้งานที่เข้าสู่ระบบ'}
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <SubmitterPicker value={submitter} onChange={onSubmitterChange} readOnly={submitterReadOnly} department={submitterDepartment} />
          {showDeliverer && requireDeliveryAndBatch && (
            <SubmitterPicker value={deliverer} onChange={onDelivererChange} />
          )}
        </div>
      </div>

      <div className="border-t border-grey-200 pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">รายการตัวอย่าง</h2>
          <p className="text-sm text-grey-500">
            {allowManualItemFields
              ? 'กรอกข้อมูลตัวอย่างเอง หรือเลือกจาก Master Item เพื่อเติมชื่อตัวอย่าง ชื่อสามัญ และขนาดบรรจุ'
              : 'เลือกชื่อตัวอย่างจาก Master Item และกรอกเลข batch — batch ที่ลงท้ายด้วย 1 หรือ 6 จะถูกขอใบคำขอรับบริการในขั้นถัดไป'}
          </p>
        </div>
        <Button size="sm" variant="primary-outline" onClick={addItem} disabled={itemsReadOnly}>
          <Plus className="h-4 w-4" />
          เพิ่มตัวอย่าง
        </Button>
      </div>

      <div className="space-y-4">
        {value.map((it, idx) => {
          const lab = requireDeliveryAndBatch ? shouldSendItemToLab(it) : true;
          const labDefault = defaultSendItemToLab(it);
          const batchSuffix = it.batchNo.trim().slice(-1);
          const labBatchSuffix = ['1', '6'].includes(batchSuffix);
          const sampleNameId = `sample-name-${idx}`;
          const commonNameId = `common-name-${idx}`;
          const batchNoId = `batch-no-${idx}`;
          const packageUnitId = `package-unit-${idx}`;
          // Master Item บางตัวไม่มีชื่อสามัญ/ขนาดบรรจุ — เปิดให้กรอกเองเฉพาะช่องที่ master ว่าง ไม่งั้นส่งคำขอไม่ได้
          const pickedMaster = allowManualItemFields ? null : findMatchingPetitionMasterItem(masterItemOptions, it);
          const commonNameLocked = !allowManualItemFields && (!pickedMaster || Boolean(pickedMaster.commonName?.trim()));
          const packageUnitLocked = !allowManualItemFields && (!pickedMaster || Boolean(pickedMaster.packageUnit?.trim()));
          const labelQuantityId = `label-quantity-${idx}`;
          const sentQuantityInputs = labelQuantityInputs(splitQcLab ? { ...it, sampleQuantity: 2 } : it);
          const sampleTargets = splitQcLab ? qcLabSampleTargets(sentQuantityInputs) : null;
          return (
            <div key={idx} className="rounded-[10px] border border-grey-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-base font-semibold">ตัวอย่างที่ {it.seq}</div>
                  {lab && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                      {requireDeliveryAndBatch && labBatchSuffix ? `ส่ง lab (ลงท้าย ${batchSuffix})` : 'ส่ง lab'}
                    </span>
                  )}
                </div>
                {value.length > 1 && !itemsReadOnly && (
                  <Button size="sm" variant="danger-outline" onClick={() => removeItem(idx)}>
                    <Trash2 className="h-4 w-4" />
                    ลบ
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={sampleNameId}>ชื่อตัวอย่าง</Label>
                  {allowManualItemFields ? (
                    <Input
                      id={sampleNameId}
                      value={it.sampleName}
                      onChange={(e) => handleManualSampleNameChange(idx, e.target.value)}
                      disabled={itemsReadOnly}
                      placeholder="กรอกชื่อตัวอย่าง"
                    />
                  ) : (
                    <MasterItemPicker
                      id={sampleNameId}
                      value={it}
                      options={masterItemOptions}
                      loading={masterItemsLoading}
                      disabled={itemsReadOnly}
                      onPick={(option) => setMasterOptionPicked(idx, it, option)}
                    />
                  )}
                </div>
                {requireDeliveryAndBatch && (
                  <div>
                    <Label htmlFor={batchNoId}>เลขแบช (Batch No.)</Label>
                    <Input
                      id={batchNoId}
                      value={it.batchNo}
                      onChange={(e) => setBatchNo(idx, e.target.value)}
                      disabled={itemsReadOnly}
                      placeholder="เช่น BN240601"
                    />
                  </div>
                )}
                {requireDeliveryAndBatch && (
                  <div className="sm:col-span-2 text-xs text-grey-500">
                    ระบบกำหนดการส่ง LAB จากเลขแบชหรือกลุ่ม PUBLIC HEALTH/LIVE STOCK: {labDefault ? 'ส่ง LAB' : 'ไม่ส่ง LAB'}{labBatchSuffix ? ` (ลงท้าย ${batchSuffix})` : ''}
                  </div>
                )}
                <div>
                  <Label htmlFor={commonNameId}>ชื่อสามัญ / Active Ingredient</Label>
                  {allowManualItemFields ? (
                    <ManualActiveIngredientMasterPicker
                      id={commonNameId}
                      value={it}
                      options={masterItemOptions}
                      loading={masterItemsLoading}
                      disabled={itemsReadOnly}
                      onActiveIngredientChange={(commonName) => setCommonName(idx, commonName)}
                      onPick={(option) => setItem(idx, patchWithLabDefault(it, fillEmptyMasterFields(it, option)))}
                    />
                  ) : (
                    <Input
                      id={commonNameId}
                      value={it.commonName}
                      onChange={(e) => setCommonName(idx, e.target.value)}
                      disabled={allowManualItemFields ? itemsReadOnly : commonNameLocked}
                      placeholder={commonNameLocked ? 'เติมอัตโนมัติจาก Master Item' : 'Master Item ไม่มีชื่อสามัญ กรุณากรอก'}
                    />
                  )}
                </div>
                <div>
                  <Label>วันผลิต/วันที่รับเข้า</Label>
                  <Input
                    type="date"
                    value={it.productionDate ?? ''}
                    onChange={(e) => setItem(idx, { productionDate: e.target.value || null })}
                    disabled={itemsReadOnly}
                  />
                </div>
                <div>
                  <Label htmlFor={packageUnitId}>ขนาดบรรจุ</Label>
                  <Input
                    id={packageUnitId}
                    value={it.packageUnit}
                    onChange={(e) => setItem(idx, { packageUnit: e.target.value })}
                    disabled={allowManualItemFields ? itemsReadOnly : packageUnitLocked}
                    placeholder={allowManualItemFields ? 'กรอกขนาดบรรจุ หรือเลือกจาก Master Item' : packageUnitLocked ? 'เติมอัตโนมัติจาก Master Item' : 'Master Item ไม่มีขนาดบรรจุ กรุณากรอก'}
                  />
                </div>
                <div>
                  <Label htmlFor={`sample-quantity-${idx}`}>จำนวนตัวอย่าง</Label>
                  <Input
                    id={`sample-quantity-${idx}`}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={splitQcLab ? 2 : it.sampleQuantity ?? ''}
                    onChange={(e) => setItem(idx, { sampleQuantity: parseSampleQuantityInput(e.target.value) })}
                    disabled={itemsReadOnly || splitQcLab}
                  />
                  {splitQcLab && (
                    <p className="mt-1 text-xs text-muted-foreground">ส่งทั้ง QC และ LAB ระบบกำหนด 2 ตัวอย่างอัตโนมัติ</p>
                  )}
                </div>
                {sentQuantityInputs.length === 1 ? (
                  <div>
                    <Label htmlFor={labelQuantityId}>ปริมาณที่ส่ง</Label>
                    <Input
                      id={labelQuantityId}
                      value={sentQuantityInputs[0] ?? ''}
                      onChange={(e) => setItem(idx, labelQuantityPatch(it, 0, e.target.value))}
                      disabled={itemsReadOnly}
                      placeholder="เช่น 100 ml"
                    />
                  </div>
                ) : (
                  <div className="sm:col-span-2 rounded-lg border bg-card p-3">
                    <div className="mb-3 text-sm font-medium text-foreground">ปริมาณที่ส่งแต่ละตัวอย่าง</div>
                    {splitQcLab && (
                      <p className="mb-3 text-xs text-muted-foreground">ปริมาณน้อยกว่าส่ง QC ปริมาณมากกว่าส่ง LAB</p>
                    )}
                    <div className="space-y-2">
                      {sentQuantityInputs.map((sentQuantity, quantityIndex) => {
                        const inputId = `${labelQuantityId}-${quantityIndex}`;
                        return (
                          <div key={inputId} className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-end">
                            <div className="pb-2 text-sm font-semibold text-primary">
                              ตัวอย่างที่ {quantityIndex + 1}
                              {sampleTargets && <span className="ml-1 text-foreground">· ส่ง {sampleTargets[quantityIndex]}</span>}
                            </div>
                            <div>
                              <Label htmlFor={inputId} className="sr-only">ปริมาณที่ส่ง {quantityIndex + 1}</Label>
                              <Input
                                id={inputId}
                                value={sentQuantity}
                                onChange={(e) => setItem(idx, labelQuantityPatch(it, quantityIndex, e.target.value))}
                                // คำขอจาก Production ส่งปริมาณมาค่าเดียว แต่ส่ง QC+LAB ต้องใช้ 2 ค่า จึงเปิดให้กรอกเพิ่มได้
                                disabled={itemsReadOnly && !splitQcLab}
                                placeholder="เช่น 100 ml"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Label>หมายเหตุ</Label>
                  <Textarea
                    rows={2}
                    value={it.note}
                    onChange={(e) => setItem(idx, { note: e.target.value })}
                    disabled={itemsReadOnly}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MasterItemPicker({
  id,
  value,
  options,
  loading,
  disabled,
  compact = false,
  onPick,
}: {
  id?: string;
  value: Pick<ItemRowValues, 'sampleName' | 'commonName' | 'packageUnit'>;
  options: PetitionMasterItemOption[];
  loading: boolean;
  disabled?: boolean;
  compact?: boolean;
  onPick: (option: PetitionMasterItemOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => { if (!open) setSearch(''); }, [open]);
  const rankedOptions = useMemo(() => rankSearchResults(
    options.filter((option) => !search || defaultFilter(
      [option.sampleName, option.commonName, option.packageUnit, option.itemNo].filter(Boolean).join(' ').trim(),
      search,
    ) > 0),
    search,
    (option) => ({ primary: [option.itemNo], secondary: [option.sampleName, option.commonName, option.packageUnit] }),
  ), [options, search]);
  const selected = useMemo(() => {
    if (!value.sampleName) return null;
    return options.find((option) => (
      option.sampleName === value.sampleName &&
      (!value.commonName || !option.commonName?.trim() || option.commonName === value.commonName) &&
      (!value.packageUnit || !option.packageUnit?.trim() || option.packageUnit === value.packageUnit)
    )) ?? null;
  }, [options, value.commonName, value.packageUnit, value.sampleName]);

  function pick(option: PetitionMasterItemOption) {
    onPick(option);
    setOpen(false);
  }

  return (
    <Popover open={open && !disabled} onOpenChange={(nextOpen) => !disabled && setOpen(nextOpen)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-label="ชื่อตัวอย่าง"
          aria-expanded={open}
          className={cn(compact ? 'shrink-0 justify-center px-3' : 'w-full justify-between font-normal')}
          disabled={disabled || loading}
        >
          {compact ? (
            <span>Master</span>
          ) : (
            <span className={cn('truncate text-left', !value.sampleName && 'text-grey-400')}>
              {loading
                ? 'กำลังโหลด Master Item...'
                : value.sampleName || 'พิมพ์เพื่อค้นหาจาก Master Item'}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="ค้นหาชื่อตัวอย่างจาก Master Item..." />
          <CommandList>
            <CommandEmpty>ไม่พบชื่อตัวอย่างใน Master Item</CommandEmpty>
            <CommandGroup>
              {rankedOptions.map((option) => {
                const selectedOption = selected === option;
                const commandValue = [
                  option.sampleName,
                  option.commonName,
                  option.packageUnit,
                  option.itemNo,
                ].filter(Boolean).join(' ');
                return (
                  <CommandItem
                    key={`${option.itemNo}-${option.sampleName}-${option.commonName}-${option.packageUnit}`}
                    value={commandValue}
                    onSelect={() => pick(option)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedOption ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{option.sampleName}</span>
                      <span className="block truncate text-xs text-grey-500">
                        {[option.commonName, option.packageUnit].filter(Boolean).join(' · ') || option.itemNo}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ManualActiveIngredientMasterPicker({
  id,
  value,
  options,
  loading,
  disabled,
  onActiveIngredientChange,
  onPick,
}: {
  id: string;
  value: Pick<ItemRowValues, 'sampleName' | 'commonName' | 'packageUnit'>;
  options: PetitionMasterItemOption[];
  loading: boolean;
  disabled?: boolean;
  onActiveIngredientChange: (commonName: string) => void;
  onPick: (option: PetitionMasterItemOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => { if (!open) setSearch(''); }, [open]);
  const rankedOptions = useMemo(() => rankSearchResults(
    options.filter((option) => !search || defaultFilter(
      [option.sampleName, option.commonName, option.packageUnit, option.itemNo].filter(Boolean).join(' ').trim(),
      search,
    ) > 0),
    search,
    (option) => ({ primary: [option.itemNo], secondary: [option.sampleName, option.commonName, option.packageUnit] }),
  ), [options, search]);
  const selected = useMemo(() => {
    if (!value.sampleName) return null;
    return options.find((option) => (
      option.sampleName === value.sampleName &&
      (!value.commonName || !option.commonName?.trim() || option.commonName === value.commonName) &&
      (!value.packageUnit || !option.packageUnit?.trim() || option.packageUnit === value.packageUnit)
    )) ?? null;
  }, [options, value.commonName, value.packageUnit, value.sampleName]);

  function pick(option: PetitionMasterItemOption) {
    onPick(option);
    setOpen(false);
  }

  return (
    <Popover open={open && !disabled} onOpenChange={(nextOpen) => !disabled && setOpen(nextOpen)}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            id={id}
            value={value.commonName}
            onChange={(e) => onActiveIngredientChange(e.target.value)}
            disabled={disabled}
            placeholder={loading ? 'กำลังโหลด Master Item...' : 'กรอกชื่อสามัญ หรือเลือกจาก Master Item'}
            className="pr-9"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-master-options`}
            aria-autocomplete="list"
          />
          <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="ค้นหาชื่อตัวอย่างจาก Master Item..." />
          <CommandList id={`${id}-master-options`}>
            <CommandEmpty>{loading ? 'กำลังโหลด Master Item...' : 'ไม่พบชื่อตัวอย่างใน Master Item'}</CommandEmpty>
            <CommandGroup>
              {rankedOptions.map((option) => {
                const selectedOption = selected === option;
                const commandValue = [
                  option.sampleName,
                  option.commonName,
                  option.packageUnit,
                  option.itemNo,
                ].filter(Boolean).join(' ');
                return (
                  <CommandItem
                    key={`${option.itemNo}-${option.sampleName}-${option.commonName}-${option.packageUnit}`}
                    value={commandValue}
                    onSelect={() => pick(option)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedOption ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{option.sampleName}</span>
                      <span className="block truncate text-xs text-grey-500">
                        {[option.commonName, option.packageUnit].filter(Boolean).join(' · ') || option.itemNo}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
