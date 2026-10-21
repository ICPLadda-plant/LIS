import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Factory, FlaskConical, Printer, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/lis/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/lis/PageHeader';
import PrintPreviewDialog from '@/components/lis/PrintPreviewDialog';
import ItemsStep, { type ItemRowValues } from '@/components/petition/wizard/ItemsStep';
import type { SubmitterValues } from '@/components/petition/wizard/SubmitterPicker';
import LabRequestStep, { type LabRequestRowValues } from '@/components/petition/wizard/LabRequestStep';
import SampleLabelPrintTemplate from '@/components/petition/SampleLabelPrintTemplate';
import { createPetition, createLabRequest } from '@/hooks/usePetition';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { canPrintSampleLabel } from '@/lib/petitionPrintability';
import {
  buildPetitionMasterItemOptions,
  findMatchingPetitionMasterItem,
  normalizeMasterItemPayload,
} from '@/lib/petitionMasterItem';
import {
  defaultSendItemToLab,
  duplicateBatchError,
  labSendOverrideNoteError,
  isQualityControlDepartment,
  shouldSendItemToLab,
} from '@/lib/petitionRouting';
import {
  addMfDateFields,
  MF_CURRENT_API_URL,
  MF_HISTORICAL_API_URL,
} from '@/lib/mfItemDates';
import { type Petition, type PetitionRouteTarget } from '@/types/petition.types';

const ICP_LADDA_ADDRESS = '151 ม.8 ต.สามควายเผือก อ.เมืองนครปฐม จ.นครปฐม 73000';
const ICP_LADDA_COMPANY = 'ICP Ladda Co., LTD.';
const PRODUCTION_RETURN_URL = 'https://app-plant.icpladda.com/production-react/?tab=list';

type StepKey = 'items' | 'lab';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'items', label: '1. ผู้นำส่ง + รายการตัวอย่าง' },
  { key: 'lab', label: '2. ใบคำขอรับบริการ' },
];

interface ProductionPetitionNewPageProps {
  integrationMode?: boolean;
  publicMode?: boolean;
}

function makeBlankItem(seq: number): ItemRowValues {
  return {
    seq,
    itemNo: '',
    sampleName: '',
    commonName: '',
    batchNo: '',
    lotNo: '',
    productionDate: null,
    packageUnit: '',
    submissionNo: '',
    testUnit: '',
    testItems: '',
    sendToLab: false,
    sampleQuantity: 1,
    labelQuantity: '',
    labelQuantities: [],
    note: '',
  };
}

function parseSendToLabValue(value: string | null | undefined): boolean | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1'].includes(normalized)) return true;
  if (['false', '0'].includes(normalized)) return false;
  return null;
}

async function fetchOptionalJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function sendToLabFromDefault(item: Pick<ItemRowValues, 'sampleName' | 'commonName' | 'batchNo'>, value?: string): boolean {
  const parsed = parseSendToLabValue(value);
  return parsed == null ? defaultSendItemToLab(item) : shouldSendItemToLab({ ...item, sendToLab: parsed });
}

function sendToLabForSubmit(
  item: Pick<ItemRowValues, 'sampleName' | 'commonName' | 'batchNo' | 'sendToLab'>,
  department: string,
): boolean {
  if (isResearchAndDevelopmentDepartment(department)) return true;
  return shouldSendItemToLab(item);
}

function getQueryValue(searchParams: URLSearchParams, keys: string[]): string {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return '';
}

function normalizeProductionCommonName(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes('+')) return raw;

  const segments = raw.split('+').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 3) return raw;

  const concentrationPattern = /\b\d+(?:[.,]\d+)?\s*%(?:\s*(?:w\/w|w\/v|v\/v))?/i;
  const firstConcentrationIndex = segments.findIndex((segment) => concentrationPattern.test(segment));
  if (firstConcentrationIndex <= 0) return raw;

  const names = segments.slice(0, firstConcentrationIndex);
  const concentrations: string[] = [];
  let formulation = '';

  for (let index = firstConcentrationIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    const match = segment.match(concentrationPattern);
    if (!match || match.index == null) return raw;

    const before = segment.slice(0, match.index).trim();
    const after = segment.slice(match.index + match[0].length).trim();

    if (index === firstConcentrationIndex) {
      if (!before) return raw;
      names.push(before);
    } else if (before) {
      return raw;
    }

    concentrations.push(match[0].replace(/\s+%/, '%').replace(/\s+/g, ' ').trim());
    if (after) {
      if (index !== segments.length - 1) return raw;
      formulation = after;
    }
  }

  if (names.length !== concentrations.length || names.some((name) => !name)) return raw;
  const normalized = names.map((name, index) => `${name} ${concentrations[index]}`).join(' + ');
  return formulation ? `${normalized} ${formulation}` : normalized;
}

export function objectToSearchParams(input: unknown): URLSearchParams {
  const params = new URLSearchParams();
  const append = (key: string, value: unknown) => {
    if (value == null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object') {
          Object.entries(item as Record<string, unknown>).forEach(([childKey, childValue]) =>
            append(`${key}[${index}][${childKey}]`, childValue),
          );
        } else {
          append(key, item);
        }
      });
      return;
    }
    if (typeof value === 'object') return;
    params.append(key, String(value));
  };

  if (input && typeof input === 'object') {
    Object.entries(input as Record<string, unknown>).forEach(([key, value]) => append(key, value));
  }
  return params;
}

export function buildProductionReturnUrl(searchParams: URLSearchParams, createdPetition?: Pick<Petition, 'petitionNo'> | null): string {
  const petitionNo = createdPetition?.petitionNo;
  const requestNo = getQueryValue(searchParams, ['requestNo', 'request_no', 'submissionNo']);
  const url = new URL(PRODUCTION_RETURN_URL);
  const requesterEmail = getQueryValue(searchParams, ['requesterEmail', 'requester_email', 'email']);
  if (requestNo) {
    url.searchParams.set('requestNo', requestNo);
    url.searchParams.set('request_no', requestNo);
  }
  if (petitionNo) {
    url.searchParams.set('lisPetitionNo', petitionNo);
    url.searchParams.set('petitionNo', petitionNo);
    url.searchParams.set('lisStatus', 'sent');
    url.searchParams.set('lisSent', '1');
  }
  if (requesterEmail) {
    url.searchParams.set('requesterEmail', requesterEmail);
    url.searchParams.set('requester_email', requesterEmail);
  }
  return url.toString();
}

export function isResearchAndDevelopmentDepartment(department?: string | null): boolean {
  return String(department || '').replace(/\s+/g, '').toLowerCase() === 'r&d';
}

export function requiresDeliveryAndBatch(department?: string | null): boolean {
  return !isResearchAndDevelopmentDepartment(department);
}

export function requiresMasterItemSelection({
  department,
  integrationMode,
}: {
  department?: string | null;
  integrationMode: boolean;
}): boolean {
  return !integrationMode && !isResearchAndDevelopmentDepartment(department);
}

export function hasRequiredLabRequestStep(
  department: string | null | undefined,
  items: Array<{ sampleName?: string; commonName?: string; batchNo: string; testItems?: string; sendToLab?: boolean }>,
): boolean {
  if (isResearchAndDevelopmentDepartment(department)) return items.length > 0;
  return items.some((it) => shouldSendItemToLab(it));
}

function makeInitialItemFromQuery(searchParams: URLSearchParams): ItemRowValues | null {
  const sampleName = getQueryValue(searchParams, ['sampleName', 'itemName', 'productName']);
  const batchNo = getQueryValue(searchParams, ['batchNo', 'batch']);
  const lotNo = getQueryValue(searchParams, ['lotNo', 'lot']);
  const commonName = normalizeProductionCommonName(getQueryValue(searchParams, ['commonName', 'activeIngredient']));
  const productionDate = getQueryValue(searchParams, ['productionDate', 'requestDate', 'mfgDate']);
  const packageUnit = getQueryValue(searchParams, ['quantity', 'packageUnit', 'packSize']);
  const submissionNo = getQueryValue(searchParams, ['submissionNo', 'requestNo', 'request_no']);
  const testItems = getQueryValue(searchParams, ['testItems', 'tests', 'lab']);
  const itemNo = getQueryValue(searchParams, ['itemNo']);
  const mfNo = getQueryValue(searchParams, ['mfNo']);
  const priority = getQueryValue(searchParams, ['priority']);
  const sendToLab = getQueryValue(searchParams, ['sendToLab']);
  const note = [
    getQueryValue(searchParams, ['note']),
    itemNo ? `Item: ${itemNo}` : '',
    mfNo ? `MF: ${mfNo}` : '',
    priority ? `Priority: ${priority}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  if (![sampleName, batchNo, lotNo, commonName, productionDate, packageUnit, submissionNo, testItems, note].some(Boolean)) {
    return null;
  }

  return {
    ...makeBlankItem(1),
    itemNo,
    sampleName,
    batchNo,
    lotNo,
    commonName,
    productionDate: productionDate || null,
    packageUnit,
    // submissionNo เว้นว่าง — backend จะเซ็ต = เลขคำขออัตโนมัติตอนบันทึก
    testItems,
    sendToLab: sendToLabFromDefault({ sampleName, commonName, batchNo }, sendToLab),
    note,
  };
}

function splitQueryList(value: string, splitComma = false): string[] {
  const delimiter = splitComma ? /[,\n|;]+/ : /[\n|;]+/;
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getQueryValues(
  searchParams: URLSearchParams,
  keys: string[],
  options: { splitComma?: boolean } = {},
): string[] {
  const values: Array<{ index: number; value: string }> = [];
  const lowerKeys = keys.map((key) => key.toLowerCase());

  for (const key of keys) {
    for (const value of searchParams.getAll(key)) {
      for (const item of splitQueryList(value, options.splitComma)) {
        values.push({ index: values.length, value: item });
      }
    }
  }

  for (const [rawKey, rawValue] of searchParams.entries()) {
    const key = rawKey.toLowerCase();
    for (const base of lowerKeys) {
      const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = key.match(new RegExp(`^${escaped}(?:\\[(\\d+)\\]|_(\\d+)|(\\d+))$`));
      if (!match) continue;
      const index = Number(match[1] ?? match[2] ?? match[3]);
      for (const item of splitQueryList(rawValue, options.splitComma)) {
        values.push({ index, value: item });
      }
    }
  }

  return values
    .sort((a, b) => a.index - b.index)
    .map((item) => item.value);
}

function valueAt(values: string[], index: number, fallbackToFirst = true): string {
  return values[index] ?? (fallbackToFirst ? values[0] : '') ?? '';
}

function makeQuantityLabel(qty: string, unit: string): string {
  return [qty, unit].filter(Boolean).join(' ');
}

function dedupeImportedItems(items: ItemRowValues[]): ItemRowValues[] {
  const seen = new Set<string>();
  const unique: ItemRowValues[] = [];
  for (const item of items) {
    const { seq: _seq, ...rest } = item;
    const key = JSON.stringify(rest);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.map((item, index) => ({ ...item, seq: index + 1 }));
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getNestedSampleValues(
  searchParams: URLSearchParams,
  keys: string[],
  options: { splitComma?: boolean } = {},
): string[] {
  const values: Array<{ index: number; value: string }> = [];
  const lowerKeys = keys.map((key) => key.toLowerCase());

  for (const [rawKey, rawValue] of searchParams.entries()) {
    const match = rawKey.toLowerCase().match(/^samples\[(\d+)\]\[([^\]]+)\]$/);
    if (!match || !lowerKeys.includes(match[2])) continue;
    const index = Number(match[1]);
    for (const item of splitQueryList(rawValue, options.splitComma)) {
      values.push({ index, value: item });
    }
  }

  return values
    .sort((a, b) => a.index - b.index)
    .map((item) => item.value);
}

function getSampleOrQueryValues(
  searchParams: URLSearchParams,
  keys: string[],
  options: { splitComma?: boolean } = {},
): string[] {
  const nested = getNestedSampleValues(searchParams, keys, options);
  return nested.length ? nested : getQueryValues(searchParams, keys, options);
}

export function makeInitialItemsFromQuery(searchParams: URLSearchParams): ItemRowValues[] {
  const singleItem = makeInitialItemFromQuery(searchParams);
  const sampleNames = getSampleOrQueryValues(searchParams, ['sampleName', 'itemName', 'productName'], { splitComma: true });
  const batchNos = getSampleOrQueryValues(searchParams, ['batchNo', 'batch'], { splitComma: true });
  const lotNos = getSampleOrQueryValues(searchParams, ['lotNo', 'lot'], { splitComma: true });
  const commonNames = getSampleOrQueryValues(searchParams, ['commonName', 'activeIngredient']).map(normalizeProductionCommonName);
  const productionDates = getSampleOrQueryValues(searchParams, ['productionDate', 'requestDate', 'mfgDate'], { splitComma: true });
  const packageUnits = getSampleOrQueryValues(searchParams, ['quantity', 'packageUnit', 'packSize', 'packsize']);
  const quantities = getSampleOrQueryValues(searchParams, ['qty', 'quantityValue', 'amount'], { splitComma: true });
  const quantityUnits = getSampleOrQueryValues(searchParams, ['unit', 'qtyUnit', 'quantityUnit'], { splitComma: true });
  const testItems = getSampleOrQueryValues(searchParams, ['testItems', 'tests', 'lab']);
  const notes = getSampleOrQueryValues(searchParams, ['note']);
  const itemNos = getSampleOrQueryValues(searchParams, ['itemNo'], { splitComma: true });
  const mfNos = getSampleOrQueryValues(searchParams, ['mfNo'], { splitComma: true });
  const priorities = getSampleOrQueryValues(searchParams, ['priority'], { splitComma: true });
  const sendToLabs = getSampleOrQueryValues(searchParams, ['sendToLab'], { splitComma: true });

  const itemCount = Math.max(
    sampleNames.length,
    batchNos.length,
    lotNos.length,
    commonNames.length,
    productionDates.length,
    packageUnits.length,
    quantities.length,
    quantityUnits.length,
    testItems.length,
    notes.length,
    itemNos.length,
    mfNos.length,
    priorities.length,
    sendToLabs.length,
  );

  if (itemCount <= 1) {
    if (!singleItem) return [];
    const productionDate = productionDates[0] || singleItem.productionDate || '';
    const submittedQuantity = quantities[0] ?? '';
    const submittedUnit = quantityUnits[0] ?? '';
    const labelQuantity = makeQuantityLabel(submittedQuantity, submittedUnit);
    return [{
      ...singleItem,
      productionDate: productionDate || null,
      packageUnit: packageUnits[0] || singleItem.packageUnit,
      labelQuantity,
      labelQuantities: labelQuantity ? [labelQuantity] : [],
      labelSampledDate: productionDate,
      submittedQuantity,
      submittedUnit,
    }];
  }

  const items: ItemRowValues[] = [];
  for (let i = 0; i < itemCount; i += 1) {
    const note = [
      valueAt(notes, i),
      valueAt(itemNos, i, false) ? `Item: ${valueAt(itemNos, i, false)}` : '',
      valueAt(mfNos, i) ? `MF: ${valueAt(mfNos, i)}` : '',
      valueAt(priorities, i) ? `Priority: ${valueAt(priorities, i)}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    const labelQuantity = makeQuantityLabel(valueAt(quantities, i, false), valueAt(quantityUnits, i));
    const item = {
      ...makeBlankItem(i + 1),
      itemNo: valueAt(itemNos, i, false),
      sampleName: valueAt(sampleNames, i),
      batchNo: valueAt(batchNos, i, false),
      lotNo: valueAt(lotNos, i, false),
      commonName: valueAt(commonNames, i),
      productionDate: valueAt(productionDates, i) || null,
      packageUnit: valueAt(packageUnits, i),
      testItems: valueAt(testItems, i),
      sendToLab: sendToLabFromDefault({
        sampleName: valueAt(sampleNames, i),
        commonName: valueAt(commonNames, i),
        batchNo: valueAt(batchNos, i, false),
      }, valueAt(sendToLabs, i, false)),
      note,
      labelQuantity,
      labelQuantities: labelQuantity ? [labelQuantity] : [],
      labelSampledDate: valueAt(productionDates, i),
      submittedQuantity: valueAt(quantities, i, false),
      submittedUnit: valueAt(quantityUnits, i),
    };

    if ([
      item.sampleName,
      item.batchNo,
      item.lotNo,
      item.commonName,
      item.productionDate,
      item.packageUnit,
      item.labelQuantity,
      item.labelSampledDate,
      item.testItems,
      item.note,
    ].some(Boolean)) {
      items.push(item);
    }
  }

  return dedupeImportedItems(items);
}

function makeBlankLabRequest(
  batchNo: string,
  sampleSeq: number,
  sampleName: string,
  fullName: string,
  email: string,
  department: string,
): LabRequestRowValues {
  return {
    batchNo,
    sampleSeq,
    sampleName,
    requester: {
      fullName,
      department,
      address: ICP_LADDA_ADDRESS,
      phone: '034-305281-2',
      fax: '',
      email,
      contactName: fullName,
      position: '',
    },
    serviceAgreement: {
      sampleDelivery: 'self',
      testMethod: 'standard',
      testMethodDoneBefore: null,
      testMethodDetail: '',
      testDuration: 'normal',
      testDurationDays: null,
      requireUncertainty: false,
      uncertaintyValue: '',
    },
    reportCustomerName: ICP_LADDA_COMPANY,
    reportAddressType: 'default',
    reportAddressOther: '',
    invoiceAddressType: 'default',
    invoiceAddressOther: '',
    testDelivery: ['email'],
    storageCondition: ['room'],
    packageType: ['plasticBag'],
    packageTypeOther: '',
    sampleReturn: 'return',
  };
}

export default function ProductionPetitionNewPage({
  integrationMode = false,
  publicMode = false,
}: ProductionPetitionNewPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const integrationToken = searchParams.get('integrationToken');
  const [postedSearchParams, setPostedSearchParams] = useState<URLSearchParams | null>(null);
  const effectiveSearchParams = postedSearchParams ?? searchParams;
  const { user } = useAuth();
  const prodOrderNosFromState = (location.state as { prodOrderNos?: string[] } | null)?.prodOrderNos;

  useEffect(() => {
    if (!integrationToken) return;
    let alive = true;
    api.get<unknown>(`/production-integration/petitions/${encodeURIComponent(integrationToken)}`)
      .then((res) => {
        if (alive) setPostedSearchParams(objectToSearchParams(res.data.data));
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'โหลดข้อมูลจาก Production ไม่สำเร็จ');
      });
    return () => { alive = false; };
  }, [integrationToken]);

  const prodOrderNosFromQuery = useMemo(() => {
    const plural = getQueryValues(effectiveSearchParams, ['prodOrderNos'], { splitComma: true });
    const singular = getQueryValues(effectiveSearchParams, ['prodOrderNo'], { splitComma: true });
    const mfNo = getSampleOrQueryValues(effectiveSearchParams, ['mfNo'], { splitComma: true });
    return uniqueValues([...plural, ...singular, ...mfNo]);
  }, [effectiveSearchParams]);
  const prodOrderNos = prodOrderNosFromState?.length ? prodOrderNosFromState : prodOrderNosFromQuery;
  const productionRequestNo = getQueryValue(effectiveSearchParams, ['requestNo', 'request_no', 'submissionNo']);
  const productionRequesterEmail = getQueryValue(effectiveSearchParams, ['requesterEmail', 'requester_email', 'email']);
  const initialQueryItems = useMemo(() => makeInitialItemsFromQuery(effectiveSearchParams), [effectiveSearchParams]);
  const integrationActor = useMemo(() => {
    const department = getQueryValue(effectiveSearchParams, ['department']);
    const requesterName = getQueryValue(effectiveSearchParams, ['requesterName', 'submittedBy', 'submitterName', 'employeeName']);
    const requesterEmail = getQueryValue(effectiveSearchParams, ['requesterEmail', 'requester_email', 'email', 'requesterMail', 'mail']);
    const requestNo = getQueryValue(effectiveSearchParams, ['requestNo', 'request_no']);
    const mfNo = getQueryValue(effectiveSearchParams, ['mfNo']);
    const ref = requestNo || mfNo;
    return {
      employeeId: ref || 'production-system',
      name: requesterName || (department ? `Production System (${department})` : 'Production System'),
      department,
      email: requesterEmail,
    };
  }, [effectiveSearchParams]);
  const submitterDepartment = integrationMode
    ? integrationActor.department
    : user?.department;
  const deliveryAndBatchRequired = requiresDeliveryAndBatch(submitterDepartment);
  const masterItemSelectionRequired = requiresMasterItemSelection({
    department: submitterDepartment,
    integrationMode,
  });
  const revisionOfId = searchParams.get('revisionOf');
  const [revisionSource, setRevisionSource] = useState<Petition | null>(null);
  const {
    data: masterItemRows = [],
    isLoading: masterItemsLoading,
    isError: masterItemsError,
  } = useQuery({
    queryKey: ['master-items-for-petition-new'],
    enabled: !integrationMode,
    queryFn: async () => {
      const res = await api.get<unknown>('/master-items');
      const masterItems = normalizeMasterItemPayload(res.data.data);
      const [historical, current] = await Promise.all([
        fetchOptionalJson(MF_HISTORICAL_API_URL),
        fetchOptionalJson(MF_CURRENT_API_URL),
      ]);
      return addMfDateFields(masterItems, historical, current);
    },
  });
  const masterItemOptions = useMemo(
    () => buildPetitionMasterItemOptions(masterItemRows),
    [masterItemRows],
  );

  const [stepIdx, setStepIdx] = useState(0);
  const currentStep = STEPS[stepIdx].key;

  const [submitter, setSubmitter] = useState<SubmitterValues>({
    employeeId: integrationMode ? integrationActor.employeeId : (user?.id ?? ''),
    name: integrationMode ? integrationActor.name : (user?.name ?? ''),
    email: integrationMode ? integrationActor.email : (user?.email ?? ''),
  });
  // ผู้นำส่ง = required ต้องเลือกเอง ไม่ default เป็นผู้ล็อกอิน (integration เท่านั้นที่ตั้งค่าให้)
  const [deliverer, setDeliverer] = useState<SubmitterValues>({
    employeeId: integrationMode ? integrationActor.employeeId : '',
    name: integrationMode ? integrationActor.name : '',
    email: integrationMode ? integrationActor.email : '',
  });
  const [delivererTouched, setDelivererTouched] = useState(false);

  // Re-sync submitter when user auth resolves (read-only — always match logged-in user)
  useEffect(() => {
    if (integrationMode) {
      setSubmitter(integrationActor);
      if (!delivererTouched) {
        setDeliverer(integrationActor);
      }
    } else if (user?.name) {
      setSubmitter({ employeeId: user.id ?? '', name: user.name, email: user.email ?? '' });
    }
  }, [user?.id, user?.name, delivererTouched, integrationMode, integrationActor]);

  const [items, setItems] = useState<ItemRowValues[]>(() =>
    initialQueryItems.length ? initialQueryItems : [makeBlankItem(1)],
  );

  useEffect(() => {
    if (initialQueryItems.length) setItems(initialQueryItems);
  }, [initialQueryItems]);

  // Pre-fill from a rejected predecessor when ?revisionOf=<id> is present
  useEffect(() => {
    if (!revisionOfId) return;
    let alive = true;
    api.getPetition(revisionOfId)
      .then((source) => {
        if (!alive) return;
        if (source.status !== 'rejected') {
          toast.error('คำร้องต้นทางไม่ได้ถูกส่งกลับให้แก้ไข');
          navigate('/petition');
          return;
        }
        if (
          user?.employeeId &&
          source.submittedBy?.employeeId &&
          user.employeeId !== source.submittedBy.employeeId
        ) {
          toast.error('คุณไม่ใช่ผู้ยื่นของคำร้องต้นทาง');
          navigate('/petition');
          return;
        }
        setRevisionSource(source);
        // Pre-fill items (strip sampleId so backend regenerates)
        setItems(
          source.items.map((it, idx) => ({
            seq: idx + 1,
            sampleName: it.sampleName ?? '',
            commonName: it.commonName ?? '',
            batchNo: it.batchNo ?? '',
            lotNo: it.lotNo ?? '',
            productionDate: it.productionDate ?? null,
            packageUnit: it.packageUnit ?? '',
            submissionNo: it.submissionNo ?? '',
            testUnit: it.testUnit ?? '',
            testItems: it.testItems ?? '',
            sendToLab: sendToLabForSubmit({ ...it, commonName: it.commonName ?? '' }, source.submittedBy?.department ?? ''),
            sampleQuantity: it.sampleQuantity ?? 1,
            labelQuantity: it.labelQuantity ?? '',
            labelQuantities: it.labelQuantities ?? [],
            note: it.note ?? '',
          })),
        );
      })
      .catch(() => {
        if (alive) {
          toast.error('โหลดคำร้องต้นทางไม่สำเร็จ');
          navigate('/petition');
        }
      });
    return () => { alive = false; };
  }, [revisionOfId, navigate, user?.employeeId]);

  const labBatches = useMemo(
    () => (
      isResearchAndDevelopmentDepartment(submitterDepartment)
        ? items
        : items.filter((it) => shouldSendItemToLab(it))
    ),
    [items, submitterDepartment],
  );

  const [labRequest, setLabRequest] = useState<LabRequestRowValues | null>(null);

  // sync labRequest with items
  useEffect(() => {
    const labItems = isResearchAndDevelopmentDepartment(submitterDepartment)
      ? items
      : items.filter((it) => shouldSendItemToLab(it));
    if (labItems.length > 0) {
      setLabRequest((prev) => {
        const current = prev ? labItems.find((item) => item.batchNo === prev.batchNo) : null;
        if (prev && current) {
          return {
            ...prev,
            batchNo: current.batchNo,
            sampleSeq: current.seq,
            sampleName: current.sampleName,
          };
        }
        const first = labItems[0];
        return makeBlankLabRequest(
          first.batchNo,
          first.seq,
          first.sampleName,
          submitter.name,
          integrationMode ? integrationActor.email : (user?.email ?? ''),
          submitterDepartment ?? 'ผลิต',
        );
      });
    } else {
      setLabRequest(null);
    }
  }, [items, submitter.name, submitterDepartment, user?.email, integrationMode, integrationActor.email]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [createdPetition, setCreatedPetition] = useState<Petition | null>(null);
  const [labelPrintOpen, setLabelPrintOpen] = useState(false);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [routeTargets, setRouteTargets] = useState<PetitionRouteTarget[] | null>(null);

  function validateStep(): boolean {
    setStepError(null);
    if (currentStep === 'items') {
      if (!submitter.name.trim()) {
        setStepError('ไม่พบชื่อผู้ยื่นคำขอ กรุณาเข้าสู่ระบบใหม่');
        return false;
      }
      if (items.length === 0) {
        setStepError('ต้องมีตัวอย่างอย่างน้อย 1 รายการ');
        return false;
      }
      if (masterItemSelectionRequired && masterItemsLoading) {
        setStepError('กำลังโหลด Master Item กรุณารอสักครู่');
        return false;
      }
      if (masterItemSelectionRequired && (masterItemsError || masterItemOptions.length === 0)) {
        setStepError('โหลด Master Item ไม่สำเร็จ กรุณาลองใหม่');
        return false;
      }
      for (const it of items) {
        if (!it.sampleName.trim()) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกชื่อตัวอย่าง`);
          return false;
        }
        if (masterItemSelectionRequired && !findMatchingPetitionMasterItem(masterItemOptions, it)) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณาเลือกชื่อตัวอย่างจาก Master Item`);
          return false;
        }
        if (deliveryAndBatchRequired && !it.batchNo.trim()) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกเลขแบช`);
          return false;
        }
        if (!it.commonName.trim()) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกชื่อสามัญ`);
          return false;
        }
        if (!it.productionDate) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณาเลือกวันผลิต/วันที่รับเข้า`);
          return false;
        }
        if (!it.packageUnit.trim()) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกขนาดบรรจุ`);
          return false;
        }
        if (!Number.isInteger(it.sampleQuantity ?? 1) || (it.sampleQuantity ?? 1) < 1) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกจำนวนตัวอย่างเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป`);
          return false;
        }
      }
      const overrideNoteError = deliveryAndBatchRequired ? labSendOverrideNoteError(items) : null;
      if (overrideNoteError) {
        setStepError(overrideNoteError);
        return false;
      }
      const duplicateError = duplicateBatchError(items, { allowDuplicates: true });
      if (duplicateError) {
        setStepError(duplicateError);
        return false;
      }
    }
    return true;
  }

  function requestSubmit() {
    if (isQualityControlDepartment(submitterDepartment) && !routeTargets) {
      setRouteDialogOpen(true);
      return;
    }
    void handleSubmit();
  }

  function selectRoute(targets: PetitionRouteTarget[]) {
    setRouteTargets(targets);
    setRouteDialogOpen(false);
    void handleSubmit(targets);
  }

  function goNext() {
    if (!validateStep()) return;
    // items เป็น step ก่อน lab; ถ้าไม่มี batch ส่ง lab ให้บันทึกเลย
    if (currentStep === 'items' && labBatches.length === 0) {
      requestSubmit();
      return;
    }
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setStepError(null);
    setStepIdx((i) => Math.max(0, i - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(selectedTargets = routeTargets) {
    if (!validateStep()) return;
    // Production integration requests are already validated by the source system.
    // They do not have a LIS session, so avoid the session-protected duplicate check.
    if (!publicMode) {
      const repeatedBatches = [...new Set(items.map((item) => String(item.batchNo ?? '').trim()).filter(Boolean))];
      for (const batchNo of repeatedBatches) {
        try {
          const { exists } = await api.batchExists(batchNo);
          if (exists && !window.confirm(`Batch ${batchNo} เคยส่งไปแล้ว ต้องการส่งอีกใช่ไหม?`)) return;
        } catch {
          setError('ตรวจสอบประวัติ batch ไม่สำเร็จ กรุณาลองใหม่');
          return;
        }
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        dept: 'production' as const,
        submittedBy: {
          employeeId: submitter.employeeId || undefined,
          name: submitter.name,
          email: submitter.email || undefined,
          department: submitterDepartment || undefined,
        },
        items: items.map((it, idx) => ({
          ...it,
          seq: idx + 1,
          sendToLab: selectedTargets ? selectedTargets.includes('lab') : sendToLabForSubmit(it, submitterDepartment),
        })),
        routeTargets: selectedTargets ?? undefined,
        labRequests: [],
        prodOrderNos,
        productionWorkflow: productionRequestNo ? {
          requestNo: productionRequestNo,
          requesterEmail: productionRequesterEmail || undefined,
        } : undefined,
        cause: '',
        revisionOf: revisionOfId || undefined,
      };
      const created = await createPetition(payload as Parameters<typeof createPetition>[0]);

      if (labBatches.length > 0 && labRequest) {
        try {
          await createLabRequest({ ...labRequest, petitionId: created._id });
        } catch (e) {
          setError(`สร้างใบคำขอรับบริการไม่สำเร็จ: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
      if (publicMode) {
        setCreatedPetition(created);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      navigate(`/petition/${created._id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'บันทึกคำร้องไม่สำเร็จ';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  function handlePageBack() {
    if (publicMode) {
      window.location.href = buildProductionReturnUrl(effectiveSearchParams, createdPetition);
      return;
    }
    navigate('/petition');
  }

  const successContent = createdPetition ? (
    <div className="space-y-4">
      <div className="print:hidden space-y-4">
        <PageHeader title="บันทึกคำขอสำเร็จ" onBack={handlePageBack} />

        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" />
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-foreground">สร้างคำขอเรียบร้อย</h2>
                  <p className="text-sm text-muted-foreground">
                    เลขที่คำขอ: <span className="font-semibold text-foreground">{createdPetition.petitionNo}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    จำนวนตัวอย่าง: {createdPetition.items.length} รายการ
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                {canPrintSampleLabel(createdPetition) && (
                  <Button onClick={() => setLabelPrintOpen(true)} className="w-full sm:w-auto">
                    <Printer className="h-4 w-4" />
                    พิมพ์สติกเกอร์
                  </Button>
                )}
                <Button variant="primary-outline" onClick={handlePageBack} className="w-full sm:w-auto">
                  กลับ Production System
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      {labelPrintOpen && (
        <PrintPreviewDialog open={labelPrintOpen} onOpenChange={setLabelPrintOpen} docType="sample-label">
          <SampleLabelPrintTemplate petition={createdPetition} />
        </PrintPreviewDialog>
      )}
    </div>
  ) : null;

  const content = (
      <div className="space-y-4">
        <PageHeader title={integrationMode ? 'Production System Request' : 'คำขอแผนกผลิต'} onBack={handlePageBack} />

        {integrationMode && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <Factory className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="space-y-1 text-sm text-blue-900">
                <p className="font-medium">Created from Production System</p>
                {prodOrderNos.length > 0 && (
                  <p>
                    Production order: <span className="font-semibold">{prodOrderNos.join(', ')}</span>
                  </p>
                )}
                <p className="text-blue-800">Please review the imported sample data before saving.</p>
              </div>
            </div>
          </div>
        )}

        {revisionSource && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-orange-500 shrink-0" />
            <p className="text-sm text-orange-800">
              ยื่นแก้ไขจากคำร้อง{' '}
              <span className="font-semibold">{revisionSource.petitionNo}</span>
            </p>
          </div>
        )}


        {/* Stepper — ซ่อน step ใบคำขอรับบริการเมื่อไม่มี batch ลงท้าย 1/6 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {STEPS.filter((s) => s.key !== 'lab' || labBatches.length > 0).map((s, i, arr) => {
            const active = i === stepIdx;
            const done = i < stepIdx;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={
                    active
                      ? 'font-semibold text-primary-500'
                      : done
                        ? 'text-grey-500'
                        : 'text-grey-400'
                  }
                >
                  {s.label}
                </span>
                {i < arr.length - 1 && <span className="text-grey-300">→</span>}
              </div>
            );
          })}
        </div>

        {stepError && (
          <div className="rounded-[10px] border border-red-500 bg-red-50 p-3 text-sm text-red-500">
            {stepError}
          </div>
        )}
        {error && (
          <div className="rounded-[10px] border border-red-500 bg-red-50 p-3 text-sm text-red-500 whitespace-pre-wrap">
            {error}
          </div>
        )}

        <Card>
          <CardContent className="p-4 md:p-5">
            {currentStep === 'items' && (
              <ItemsStep
                value={items}
                onChange={setItems}
                submitter={submitter}
                onSubmitterChange={setSubmitter}
                submitterReadOnly
                submitterDepartment={submitterDepartment}
                deliverer={deliverer}
                onDelivererChange={(v) => {
                  setDelivererTouched(true);
                  setDeliverer(v);
                }}
                showDeliverer={false}
                requireDeliveryAndBatch={deliveryAndBatchRequired}
                itemsReadOnly={integrationMode}
                allowManualItemFields={!masterItemSelectionRequired}
                masterItemOptions={masterItemOptions}
                masterItemsLoading={masterItemsLoading}
              />
            )}
            {currentStep === 'lab' && labRequest && (
              <LabRequestStep
                items={labBatches}
                request={labRequest}
                onChange={setLabRequest}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3">
          <Button variant="ghost" onClick={goBack} disabled={stepIdx === 0 || submitting} className="w-full sm:w-auto">
            <ArrowLeft className="h-4 w-4" />
            ย้อนกลับ
          </Button>
          <div className="flex flex-col sm:flex-row gap-2">
            {stepIdx < STEPS.length - 1 ? (
              <Button onClick={goNext} disabled={submitting} className="w-full sm:w-auto">
                {currentStep === 'items' && labBatches.length === 0 ? (
                  <>
                    <Save className="h-4 w-4" />
                    บันทึก (ไม่มี batch ส่ง lab)
                  </>
                ) : (
                  <>
                    ถัดไป
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={requestSubmit} disabled={submitting} className="w-full sm:w-auto">
                <Save className="h-4 w-4" />
                {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            )}
          </div>
        </div>

        <Dialog open={routeDialogOpen} onOpenChange={setRouteDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader className="border-b border-border pb-4">
              <DialogTitle>เลือกประเภทการส่งตรวจ</DialogTitle>
              <DialogDescription>เลือกปลายทางที่ต้องการส่งตัวอย่าง</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { targets: ['qc'] as PetitionRouteTarget[], label: 'ส่ง QC', icon: ShieldCheck },
                { targets: ['lab'] as PetitionRouteTarget[], label: 'ส่ง LAB', icon: FlaskConical },
                { targets: ['qc', 'lab'] as PetitionRouteTarget[], label: 'ส่งทั้ง 2', icon: CheckCircle2 },
              ].map(({ targets, label, icon: Icon }) => (
                <button key={label} type="button" onClick={() => selectRoute(targets)} className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                  <Icon className="h-7 w-7 text-primary" />
                  <span className="font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
  );

  if (publicMode) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6">
        <div className="mx-auto max-w-6xl">{successContent ?? content}</div>
      </div>
    );
  }

  return <AppLayout>{content}</AppLayout>;
}
