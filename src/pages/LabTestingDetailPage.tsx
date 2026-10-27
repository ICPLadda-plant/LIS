import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  FlaskConical,
  CheckCircle2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Pencil,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/lis/AppLayout';
import LabReasonDialog from '@/components/petition/LabReasonDialog';
import PageHeader from '@/components/lis/PageHeader';
import { usePetition, usePetitionList } from '@/hooks/usePetition';
import { api, type ParameterItem, type ParameterValueField, type InstrumentSource, type InstrumentReading, type ValueProvenance } from '@/lib/api';
import InstrumentFetchButton from '@/components/lis/InstrumentFetchButton';
import { useAuth } from '@/hooks/useAuth';
import { useArrivalFlash } from '@/hooks/useArrivalFlash';
import { normalizeRoles } from '@/lib/roles';
import { isAssignedTo } from '@/lib/assignment';
import { labReceivedAt, labReceivedBy } from '@/lib/receiveStatus';
import { useConfirm } from '@/context/ConfirmDialog';
import { isFieldAbnormal, expandFieldForItem, resolveFieldStandard, resolveStandard, getEntryValues, optionOutputText, enumNormalValues, resolveConditionalOutput, isConditionalOutputAbnormal, resolveLabelTolerance } from '@/lib/parameterValidation';
import { SG_FIELD_LABEL, FORM_ENTRY_INDEX_KEY, readSpecificGravityEntryValue } from '@/lib/formSpecificGravity';
import type { ConditionContext, ResolvedOutput, RenderFieldUnit } from '@/lib/parameterValidation';
import { describeResolvedStandard, formatLabelToleranceRange, labelToleranceBadge } from '@/lib/standardOperators';
import { cn } from '@/lib/utils';
import { TimerField } from '@/components/lis/TimerField';
import { PhaseBanner } from '@/components/lis/PhaseBanner';
import { ReferenceFieldDisplay } from '@/components/lis/ReferenceFieldDisplay';
import { getPetitionCategory, itemGroupKey, matchParametersForItem, visibleEnumOptions } from '@/lib/petitionTestItems';
import { aiGridClass, aiSubstanceFromKey, calculateAi, calculatedAiFieldKind, findAiDensity, formatCalculatedAi } from '@/lib/aiCalculation';
import { missingValuesBeforePhaseTrigger, phaseTriggerBlockedReason, visibleFieldsForPhase } from '@/lib/phaseRetest';
import AdditionalSampleRequestDialog from '@/components/petition/AdditionalSampleRequestDialog';
import { createResultAutosaveQueue, currentSampleResults, pendingAdditionalSample, sampleRoundFor, sampleRoundIdFor } from '@/lib/additionalSamples';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import { isResearchAndDevelopmentPetition, shouldSendItemToLab } from '@/lib/petitionRouting';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import {
  type Petition,
  type AdditionalSampleRequest,
  type PetitionItem,
  type PetitionPhase,
  type QCTestResult,
} from '@/types/petition.types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FULL_ACCESS_ROLES = new Set(['admin', 'lab-head']);

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface FieldSaveInfo {
  state: SaveState;
  savedAt?: Date;
  savedBy?: string;
}

function formatTime(d: Date | string | undefined) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function resultKey(itemSeq: number, parameterId: string) {
  return `${itemSeq}__${parameterId}`;
}

// ค่า ถพ. มักเก็บเป็นรายการย่อย (entries) จึงต้องส่งรายการย่อยของพารามิเตอร์อื่นมาด้วย
function aiDensity(values: Record<string, unknown>, context: ConditionContext, substance = '', entries: Record<string, unknown>[] = []) {
  return findAiDensity([values, ...Object.values(context.otherParams), ...entries], substance);
}

const AI_FIELD_ORDER = [
  'Area Inj.1', 'Area Inj.2', 'Area Inj.3',
  '% Sample 1', '% Sample 2', '% Sample 3',
  'Area Average', 'Area %RSD', '% Sample Average', '% Sample %RSD', '%AI',
] as const;

function aiFieldsForParameter(fields: ParameterValueField[]) {
  if (!fields.some((field) => calculatedAiFieldKind(field.label) === 'ai')) return fields;
  const byLabel = new Map(fields.map((field) => [field.label.trim().toLowerCase(), field]));
  const aiField = fields.find((field) => calculatedAiFieldKind(field.label) === 'ai');
  const generated = AI_FIELD_ORDER.map((label): ParameterValueField => (label === '%AI' ? aiField! : byLabel.get(label.toLowerCase())) ?? ({
    label,
    type: 'float',
    unit: label.includes('Sample') || label === '%AI' ? '%' : undefined,
  }));
  const known = new Set(AI_FIELD_ORDER.map((label) => label.toLowerCase()));
  return [...generated, ...fields.filter((field) => calculatedAiFieldKind(field.label) !== 'ai' && !known.has(field.label.trim().toLowerCase()))];
}

function labParametersForPetition(petition: Petition, params: ParameterItem[]): ParameterItem[] {
  return isResearchAndDevelopmentPetition(petition)
    ? params.filter((p) => p.scope === 'lab')
    : params;
}

function matchLabParametersForItem(
  petition: Petition,
  item: PetitionItem,
  params: ParameterItem[],
  itemGroupIds: string[] = [],
): ParameterItem[] {
  return matchParametersForItem(
    item,
    labParametersForPetition(petition, params),
    itemGroupIds,
    {
      forceLabTrack: isResearchAndDevelopmentPetition(petition),
      petitionCategory: getPetitionCategory(petition),
    },
  );
}

const noteLabelFor = (mainLabel: string) => `${mainLabel}__note`;
// Provenance for an instrument-pulled value is stored as a sibling field (same
// QCResult map) so it persists with no schema change — mirrors noteLabelFor.
const sourceLabelFor = (mainLabel: string) => `${mainLabel}__source`;

// Parse the JSON provenance blob stored in a __source sibling field.
function parseProvenance(raw: unknown): ValueProvenance | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && p.source ? (p as ValueProvenance) : undefined;
  } catch {
    return undefined;
  }
}

function describeStandard(field: ParameterValueField): string {
  const op = field.standardOperator;
  const v1 = field.standardValue;
  const v2 = field.standardValue2;
  const unit = field.unit ? ` ${field.unit}` : '';
  switch (op) {
    case 'lt': return `< ${v1}${unit}`;
    case 'lte': return `≤ ${v1}${unit}`;
    case 'eq': return `= ${v1}${unit}`;
    case 'gte': return `≥ ${v1}${unit}`;
    case 'gt': return `> ${v1}${unit}`;
    case 'between': return `${v1} - ${v2}${unit}`;
    case 'tolerance': return `${v1} ± ${v2}%${unit}`;
    default: return '';
  }
}

function formatLabLabelToleranceRange(rv: ReturnType<typeof resolveLabelTolerance>, unit: string): string {
  return formatLabelToleranceRange(rv, unit);
}

interface TestFieldProps {
  field: ParameterValueField;
  item: PetitionItem;
  itemGroupIds?: string[];
  value: unknown;
  noteValue: unknown;
  saveInfo?: FieldSaveInfo;
  noteSaveInfo?: FieldSaveInfo;
  onChange: (val: unknown) => void;
  onNoteChange: (val: unknown) => void;
  disabled?: boolean;
  readOnly?: boolean;
  conditionalPending?: boolean;
  resolvedStandardText?: string;
  // Instrument pull: present only when this field's label matches a configured
  // & enabled InstrumentSource. onPull receives the live reading.
  instrumentSource?: InstrumentSource;
  provenance?: ValueProvenance;
  onPull?: (reading: InstrumentReading) => void;
  outputResult?: ResolvedOutput | null;
  headerMeta?: ReactNode;
  timerStartBlockedReason?: string;
}

function TestField({
  field,
  item,
  itemGroupIds = [],
  value,
  noteValue,
  saveInfo,
  noteSaveInfo,
  onChange,
  onNoteChange,
  disabled = false,
  readOnly = false,
  conditionalPending,
  resolvedStandardText,
  instrumentSource,
  provenance,
  onPull,
  outputResult,
  headerMeta,
  timerStartBlockedReason,
}: TestFieldProps) {
  const strVal = value == null ? '' : String(value);
  const strNote = noteValue == null ? '' : String(noteValue);
  const requireNoteOn = field.requireNoteOn ?? [];
  const showNote = field.type === 'enum' && requireNoteOn.includes(strVal);
  const isAbnormal = outputResult ? outputResult.kind === 'abnormal' : isFieldAbnormal(field, value);
  const customText = optionOutputText(field, value);
  const effectivelyDisabled = disabled || readOnly;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="text-sm font-medium text-foreground">
          {field.label}
          {field.unit && <span className="text-muted-foreground font-normal ml-1">({field.unit})</span>}
          {field.required && !readOnly && <span className="text-red-500 ml-1">*</span>}
        </label>
        {headerMeta}
        {saveInfo?.state === 'saved' && saveInfo.savedBy && (
          <span className="text-xs text-muted-foreground">
            กรอกโดย {saveInfo.savedBy} เมื่อ {formatTime(saveInfo.savedAt)}
          </span>
        )}
        {isAbnormal && (
          <span
            className="inline-flex items-center"
            title={
              field.type === 'enum'
                ? `ค่าผิดปกติ — คาดหวัง: ${enumNormalValues(field).join(', ')}`
                : outputResult
                  ? 'ค่าผิดปกติ — ไม่เข้าเกณฑ์ที่กำหนด'
                  : `ค่าผิดปกติ — คาดหวัง: ${describeStandard(field)}`
            }
          >
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          </span>
        )}
        {!readOnly && saveInfo?.state === 'saving' && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {!readOnly && saveInfo?.state === 'saved' && (
          <CheckCircle2 className="h-3 w-3 text-green-500" />
        )}
        {!readOnly && saveInfo?.state === 'error' && (
          <AlertCircle className="h-3 w-3 text-red-400" />
        )}
      </div>

      {field.type === 'timer' ? (
        <TimerField field={field} value={value} onChange={onChange} disabled={effectivelyDisabled} startBlockedReason={timerStartBlockedReason} />
      ) : field.type === 'enum' ? (
        <Select
          value={strVal || '__none__'}
          onValueChange={(v) => !readOnly && onChange(v === '__none__' ? '' : v)}
          disabled={effectivelyDisabled}
        >
          <SelectTrigger
            className={cn(
              'h-8 text-sm',
              isAbnormal && 'border-red-400 ring-1 ring-red-200',
              readOnly && 'bg-muted cursor-default',
            )}
          >
            <SelectValue placeholder="เลือกค่า..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— เลือก —</SelectItem>
            {(() => {
              const visible = visibleEnumOptions(field, item, itemGroupIds);
              const savedOutOfScope = strVal && !visible.includes(strVal);
              return (
                <>
                  {visible.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                  {savedOutOfScope && (
                    <SelectItem key="__saved__" value={strVal} disabled>
                      {strVal} (นอกเงื่อนไข — ค่าเดิม)
                    </SelectItem>
                  )}
                </>
              );
            })()}
          </SelectContent>
        </Select>
      ) : field.type === 'photo' ? (
        <div className="text-xs text-muted-foreground italic py-1">แนบรูปภาพ (ยังไม่รองรับในเวอร์ชันนี้)</div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type={field.type === 'number' || field.type === 'float' ? 'number' : 'text'}
            step={field.type === 'float' ? 'any' : undefined}
            value={strVal}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            // เลื่อนเมาส์ (wheel) ห้ามเปลี่ยนค่าตัวเลข — พิมพ์อย่างเดียว: blur ทิ้งโฟกัสตอน scroll
            onWheel={(e) => {
              if (field.type === 'number' || field.type === 'float') {
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            disabled={effectivelyDisabled}
            className={cn(
              'h-8 text-sm',
              isAbnormal && 'border-red-400 ring-1 ring-red-200',
              readOnly && 'bg-muted cursor-default',
            )}
            placeholder={
              field.standardOperator
                ? `มาตรฐาน: ${describeStandard(field)}`
                : field.standardValue != null
                  ? `มาตรฐาน: ${field.standardValue}`
                  : undefined
            }
          />
          {instrumentSource && onPull && !readOnly && (
            <InstrumentFetchButton
              paramKey={instrumentSource.key}
              instrumentName={instrumentSource.instrumentName}
              onPulled={onPull}
              disabled={effectivelyDisabled}
            />
          )}
        </div>
      )}

      {customText && (
        <p className="text-[11px] text-muted-foreground">ℹ️ {customText}</p>
      )}

      {outputResult && outputResult.text && (
        <p className={cn('text-[11px]', outputResult.kind === 'abnormal' ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300')}>
          ผลลัพธ์: {outputResult.text}
        </p>
      )}

      {/* Provenance badge: shows where an instrument-pulled value came from. */}
      {provenance && (
        <p className="text-[11px] text-indigo-600">
          {provenance.source === 'instrument-edited' ? '✎ แก้ด้วยมือ' : '📡 จากเครื่อง'}
          {provenance.instrument ? ` • ${provenance.instrument}` : ''}
          {provenance.fetchedAt
            ? ` • ${new Date(provenance.fetchedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
            : ''}
          {provenance.source === 'instrument-edited' && provenance.rawValue != null
            ? ` (เครื่อง: ${provenance.rawValue})`
            : ''}
        </p>
      )}

      {/* Live resolved-criterion line for conditionalMode fields */}
      {conditionalPending ? (
        <p className="text-[11px] text-amber-600">ยังกำหนดเกณฑ์ไม่ได้ — รอกรอกช่องเงื่อนไข</p>
      ) : resolvedStandardText ? (
        <p className="text-[11px] text-emerald-600">เกณฑ์: {resolvedStandardText}</p>
      ) : null}

      {showNote && !readOnly && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 space-y-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-amber-800">
              คำอธิบาย / หมายเหตุ <span className="text-red-500">*</span>
            </label>
            {noteSaveInfo?.state === 'saving' && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
            {noteSaveInfo?.state === 'saved' && (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            )}
            {noteSaveInfo?.state === 'error' && (
              <AlertCircle className="h-3 w-3 text-red-400" />
            )}
          </div>
          <textarea
            value={strNote}
            onChange={(e) => onNoteChange(e.target.value)}
            disabled={effectivelyDisabled}
            placeholder={`อธิบายเพิ่มเติมเมื่อเลือก "${strVal}"`}
            className="w-full text-sm rounded border border-amber-500/40 bg-background px-2 py-1 min-h-[60px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:bg-muted disabled:cursor-not-allowed"
          />
          {noteSaveInfo?.state === 'saved' && noteSaveInfo.savedBy && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              กรอกโดย {noteSaveInfo.savedBy} เมื่อ {formatTime(noteSaveInfo.savedAt)}
            </p>
          )}
        </div>
      )}

      {!readOnly && saveInfo?.state === 'error' && (
        <p className="text-xs text-red-400">บันทึกไม่สำเร็จ</p>
      )}
    </div>
  );
}

export default function LabTestingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const confirm = useConfirm();
  const flashClass = useArrivalFlash();

  const { data: fetchedPetition, loading: petitionLoading, error: petitionError } = usePetition(id);
  const [requestedPetition, setRequestedPetition] = useState<Petition | null>(null);
  const routedPetition = (location.state as { petition?: Petition } | null)?.petition;
  const currentPetition = fetchedPetition ?? (routedPetition?._id === id ? routedPetition : null);
  const petition = requestedPetition && requestedPetition._id === currentPetition?._id
    && Date.parse(requestedPetition.updatedAt) >= Date.parse(currentPetition.updatedAt)
    ? requestedPetition : currentPetition;
  const [additionalSampleOpen, setAdditionalSampleOpen] = useState(false);
  const pendingSample = pendingAdditionalSample(petition, 'lab');
  const roundsKey = JSON.stringify(petition?.additionalSampleRequests ?? []);
  const roundRequests = useMemo(() => JSON.parse(roundsKey) as AdditionalSampleRequest[], [roundsKey]);
  const resultsKey = id + ':' + roundsKey;
  const [loadedResultsKey, setLoadedResultsKey] = useState('');
  const resultLoad = useRef(0);
  const currentPetitionPhase = petition?.currentPhase ?? 1;
  const [selectedRoundPhases, setSelectedRoundPhases] = useState<Record<string, PetitionPhase>>({});
  const petitionCategory = getPetitionCategory(petition);
  const { data: worklistData } = usePetitionList({
    status: 'pendingReview,inProgress',
    limit: 20,
  });

  const [allParameters, setAllParameters] = useState<ParameterItem[]>([]);
  // parameter trigger รอบตรวจซ้ำทุกฝั่ง — ตัวอบอาจเป็น QC ที่ไม่ได้แชร์ให้ Lab แต่ Lab ต้องตรวจ %AI ซ้ำ
  const [phaseTriggerParameters, setPhaseTriggerParameters] = useState<ParameterItem[]>([]);
  // Instrument sources (config) → lookup by key for the "ดึงค่า" pull button.
  // Loaded once via useEffect, mirroring the getParameters pattern below.
  const [instrumentSources, setInstrumentSources] = useState<InstrumentSource[]>([]);
  const sourceFor = useCallback(
    (fieldLabel: string): InstrumentSource | undefined =>
      instrumentSources.find((s) => s.enabled !== false && s.key === fieldLabel),
    [instrumentSources],
  );
  const groupMembership = useItemGroupMembership();
  const idsFor = (it: Parameters<typeof itemGroupKey>[0]) =>
    groupMembership.get(itemGroupKey(it)) ?? [];
  const [paramsLoaded, setParamsLoaded] = useState(false);
  const [paramsLoadError, setParamsLoadError] = useState(false);
  const [savedResults, setSavedResults] = useState<QCTestResult[]>([]);
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [valuesPhase2, setValuesPhase2] = useState<Record<string, Record<string, unknown>>>({});
  // Local mirror of QCTestResult.entries for multiEntry params, keyed by resultKey.
  const [entriesByKey, setEntriesByKey] = useState<Record<string, Record<string, unknown>[]>>({});
  // How many entry cards to show per multiEntry resultKey (user-driven via "เพิ่มรายการ").
  // Effective count = max(this, savedEntries.length, 1) — never hides saved data, always ≥1 empty form.
  const [entryRowCounts, setEntryRowCounts] = useState<Record<string, number>>({});
  const [saveStates, setSaveStates] = useState<Record<string, Record<string, FieldSaveInfo>>>({});
  const [saveStatesPhase2, setSaveStatesPhase2] = useState<Record<string, Record<string, FieldSaveInfo>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [wasReturned, setWasReturned] = useState(false);
  const [redoExplanation, setRedoExplanation] = useState('');
  const [reasonDialog, setReasonDialog] = useState<'edit' | 'clear' | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<PetitionPhase>(1);
  const autosaves = useMemo(createResultAutosaveQueue, [id]);
  useEffect(() => () => { void autosaves.flush().catch(() => {}); }, [autosaves]);

  // Load all parameters, filter for Lab scope + shared QC params
  useEffect(() => {
    api.getParameters()
      .then((all) => {
        const labParams = all.filter(
          (p) => p.scope === 'lab' || (p.scope === 'qc' && p.shareWithLab === true),
        );
        setAllParameters(labParams);
        setPhaseTriggerParameters(all.filter((p) => p.hasPhases));
      })
      .catch(() => setParamsLoadError(true))
      .finally(() => setParamsLoaded(true));
  }, []);

  // Load instrument sources once (for the live-pull button).
  useEffect(() => {
    api.getInstrumentSources()
      .then((rows) => setInstrumentSources(rows ?? []))
      .catch(() => {});
  }, []);

  // Auto-advance status pendingReview → inProgress when Lab enters the first value
  const advancedRef = useRef(false);
  const advanceToInProgress = useCallback(() => {
    if (!petition || advancedRef.current) return;
    if (petition.status !== 'pendingReview') return;
    advancedRef.current = true;
    api.patch(`/petitions/${petition._id}`, {
      status: 'inProgress',
      actor: user?.name ?? 'system',
    }).catch(() => {
      advancedRef.current = false;
    });
  }, [petition, user]);

  // Default the visible phase tab to the petition's current phase
  useEffect(() => {
    setSelectedPhase(currentPetitionPhase);
  }, [id, currentPetitionPhase]);

  // Detect if this petition was previously sent back from QC Approval
  useEffect(() => {
    if (!petition?._id) {
      setWasReturned(false);
      return;
    }
    let alive = true;
    api.getReturnedFlags([petition._id])
      .then((map) => { if (alive) setWasReturned(!!map[petition._id]); })
      .catch(() => { if (alive) setWasReturned(false); });
    return () => { alive = false; };
  }, [petition?._id]);

  const loadResults = useCallback((petitionId: string) => {
    const load = ++resultLoad.current;
    return api.getQCResults(petitionId).then((allResults) => {
      if (load !== resultLoad.current) return;
      const results = currentSampleResults({ additionalSampleRequests: roundRequests }, allResults, allParameters);
      setSavedResults(results);
      const v: Record<string, Record<string, unknown>> = {};
      const v2: Record<string, Record<string, unknown>> = {};
      const en: Record<string, Record<string, unknown>[]> = {};
      const s: Record<string, Record<string, FieldSaveInfo>> = {};
      const s2: Record<string, Record<string, FieldSaveInfo>> = {};
      results.forEach((r) => {
        const k = resultKey(r.itemSeq, r.parameterId);
        v[k] = { ...(r.values as Record<string, unknown>) };
        v2[k] = { ...((r.valuesPhase2 ?? {}) as Record<string, unknown>) };
        if (Array.isArray(r.entries)) {
          en[k] = (r.entries as Record<string, unknown>[]).map((e) => ({ ...(e ?? {}) }));
        }
        s[k] = {};
        s2[k] = {};
        const stamp: FieldSaveInfo = {
          state: 'saved',
          savedAt: r.updatedAt ? new Date(r.updatedAt) : undefined,
          savedBy: r.updatedBy?.name || r.enteredBy?.name,
        };
        Object.keys(r.values as object).forEach((label) => { s[k][label] = stamp; });
        Object.keys(r.valuesPhase2 ?? {}).forEach((label) => { s2[k][label] = stamp; });
      });
      setValues(v);
      setValuesPhase2(v2);
      setEntriesByKey(en);
      setSaveStates(s);
      setSaveStatesPhase2(s2);
      setLoadedResultsKey(resultsKey);
    }).catch(() => {});
  }, [roundRequests, allParameters, resultsKey]);

  useEffect(() => {
    if (!id || !allParameters.length) return;
    void loadResults(id);
    return () => { resultLoad.current += 1; };
  }, [id, loadResults, allParameters.length]);

  const pendingDensity = !!petition && !isResearchAndDevelopmentPetition(petition) &&
    (petition.items ?? []).filter(shouldSendItemToLab).some((item) => {
      const matched = matchLabParametersForItem(petition, item, allParameters, idsFor(item));
      // %AI คำนวณจากค่า ถพ. เสมอ → ถ้ายังไม่มีค่า ถพ. ที่บันทึกไว้ของรายการนี้ ห้ามกรอกผล
      const needsAiDensity = matched.some((param) => param.scope === 'lab' &&
        param.valueFields?.some((field) => calculatedAiFieldKind(field.label) === 'ai'));
      if (needsAiDensity) {
        const records = savedResults
          .filter((row) => row.itemSeq === item.seq)
          .flatMap((row) => [row.values ?? {}, ...((row.entries ?? []) as Record<string, unknown>[])]);
        if (findAiDensity(records) == null) return true;
      }
      const sgParam = matched.find(
        (param) => param.scope === 'qc' && param.shareWithLab &&
          param.valueFields?.some((field) => field.label === SG_FIELD_LABEL),
      );
      if (!sgParam) return false;
      const result = savedResults.find((row) => row.itemSeq === item.seq && row.parameterId === sgParam._id);
      return !getEntryValues(result ?? {}, sgParam).some((entry) => {
        const value = Number(readSpecificGravityEntryValue(entry));
        return Number.isFinite(value) && value > 0;
      });
    });

  const handleFieldChange = useCallback(
    (
      petition: Petition,
      item: PetitionItem,
      param: ParameterItem,
      fieldLabel: string,
      newVal: unknown,
      phase: PetitionPhase = 1,
    ) => {
      if (pendingDensity || pendingAdditionalSample(petition, 'lab') || additionalSampleOpen || submitting) return;
      if (phase === 2 && ((sampleRoundFor(petition, 'lab', item.seq) ?? petition).currentPhase ?? 1) === 1) return;
      const k = resultKey(item.seq, param._id!);

      advanceToInProgress();

      const setValuesFn = phase === 2 ? setValuesPhase2 : setValues;
      const setStatesFn = phase === 2 ? setSaveStatesPhase2 : setSaveStates;

      setValuesFn((prev) => ({
        ...prev,
        [k]: { ...(prev[k] ?? {}), [fieldLabel]: newVal },
      }));

      setStatesFn((prev) => ({
        ...prev,
        [k]: { ...(prev[k] ?? {}), [fieldLabel]: { state: 'saving' } },
      }));

      const debounceKey = `${k}__${fieldLabel}__p${phase}`;
      autosaves.schedule(debounceKey, async () => {
        try {
          await api.saveQCResult({
            petitionId: petition._id!,
            petitionNo: petition.petitionNo,
            itemSeq: item.seq,
            sampleRoundId: sampleRoundIdFor(petition, 'lab', item.seq),
            sampleId: item.sampleId,
            sampleName: item.sampleName,
            parameterId: param._id!,
            parameterName: param.name,
            fieldLabel,
            value: newVal,
            enteredBy: {
              name: user?.name ?? 'Unknown',
              email: user?.email ?? '',
            },
            phase,
          });
          const now = new Date();
          setStatesFn((prev) => ({
            ...prev,
            [k]: {
              ...(prev[k] ?? {}),
              [fieldLabel]: {
                state: 'saved',
                savedAt: now,
                savedBy: user?.name ?? 'Unknown',
              },
            },
          }));
        } catch (error) {
          setStatesFn((prev) => ({
            ...prev,
            [k]: { ...(prev[k] ?? {}), [fieldLabel]: { state: 'error' } },
          }));
          throw error;
        }
      }, k);
    },
    [user, advanceToInProgress, autosaves, additionalSampleOpen, submitting, pendingDensity],
  );

  // multiEntry write: field write into entry `entryIndex` of a multiEntry param.
  // Optimistically mirrors entriesByKey and persists via saveQCResult({ entryIndex }).
  const handleEntryFieldChange = useCallback(
    (
      petition: Petition,
      item: PetitionItem,
      param: ParameterItem,
      entryIndex: number,
      fieldLabel: string,
      newVal: unknown,
    ) => {
      if (pendingDensity || pendingAdditionalSample(petition, 'lab') || additionalSampleOpen || submitting) return;
      const k = resultKey(item.seq, param._id!);
      advanceToInProgress();

      setEntriesByKey((prev) => {
        const list = (prev[k] ?? []).map((e) => ({ ...(e ?? {}) }));
        while (list.length <= entryIndex) list.push({});
        list[entryIndex] = { ...list[entryIndex], [fieldLabel]: newVal };
        return { ...prev, [k]: list };
      });

      const debounceKey = `${k}__entry${entryIndex}__${fieldLabel}`;
      autosaves.schedule(debounceKey, async () => {
        try {
          await api.saveQCResult({
            petitionId: petition._id!,
            petitionNo: petition.petitionNo,
            itemSeq: item.seq,
            sampleRoundId: sampleRoundIdFor(petition, 'lab', item.seq),
            sampleId: item.sampleId,
            sampleName: item.sampleName,
            parameterId: param._id!,
            parameterName: param.name,
            fieldLabel,
            value: newVal,
            entryIndex,
            enteredBy: { name: user?.name ?? 'Unknown', email: user?.email ?? '' },
          });
          if (id) await loadResults(id);
        } catch (error) {
          toast.error('บันทึกค่าไม่สำเร็จ');
          throw error;
        }
      }, k);
    },
    [user, advanceToInProgress, id, loadResults, autosaves, additionalSampleOpen, submitting, pendingDensity],
  );

  // multiEntry remove: trim entry `entryIndex` then persist the whole array.
  const handleRemoveEntry = useCallback(
    async (
      petition: Petition,
      item: PetitionItem,
      param: ParameterItem,
      entryIndex: number,
    ) => {
      if (pendingDensity || pendingAdditionalSample(petition, 'lab') || additionalSampleOpen || submitting) return;
      const k = resultKey(item.seq, param._id!);
      const current = getEntryValues({ entries: entriesByKey[k] }, param);
      const trimmed = current.filter((_, i) => i !== entryIndex);
      setEntriesByKey((prev) => ({ ...prev, [k]: trimmed.map((e) => ({ ...(e ?? {}) })) }));
      try {
        await autosaves.run(k, async () => {
          await api.saveQCEntries({
            petitionId: petition._id!,
            petitionNo: petition.petitionNo,
            itemSeq: item.seq,
            sampleRoundId: sampleRoundIdFor(petition, 'lab', item.seq),
            sampleId: item.sampleId,
            sampleName: item.sampleName,
            parameterId: param._id!,
            parameterName: param.name,
            entries: trimmed,
            enteredBy: { name: user?.name ?? 'Unknown', email: user?.email ?? '' },
          });
        });
        if (id) await loadResults(id);
      } catch {
        toast.error('ลบรายการไม่สำเร็จ');
      }
    },
    [user, entriesByKey, id, loadResults, autosaves, additionalSampleOpen, submitting, pendingDensity],
  );

  if (petitionLoading && !petition) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (petitionError || !petition) {
    return (
      <AppLayout>
        <div className="text-center text-muted-foreground">
          {petitionError || 'ไม่พบข้อมูลคำร้อง'}
        </div>
      </AppLayout>
    );
  }

  // Keep routed Lab items visible even when their parameters are missing.
  const allLabBatchItems = isResearchAndDevelopmentPetition(petition)
    ? (petition.items ?? [])
    : (petition.items ?? []).filter((it) => shouldSendItemToLab(it));
  const labItems = allLabBatchItems;
  const hasLabOwnedParams = paramsLoaded && labItems.some((item) =>
    matchLabParametersForItem(petition, item, allParameters, idsFor(item)).some((param) => param.scope === 'lab'),
  );
  const hasAllLabOwnedParams = hasLabOwnedParams && labItems.every((item) =>
    matchLabParametersForItem(petition, item, allParameters, idsFor(item)).some((param) => param.scope === 'lab'),
  );

  // 2-phase support: does any matched parameter use hasPhases?
  const itemHasPhasedParam = (item: PetitionItem) =>
    // รอบตรวจซ้ำ (Phase 2) เป็นของรายการที่มี parameter trigger เช่น อบ 14 วัน เท่านั้น — รายการอื่นในใบเดียวกันจบที่ Phase 1
    matchParametersForItem(item, phaseTriggerParameters, idsFor(item), {
      forceLabTrack: isResearchAndDevelopmentPetition(petition),
      petitionCategory: getPetitionCategory(petition),
    }).length > 0;
  const hasAnyPhasedParam = labItems.some(itemHasPhasedParam);
  const currentPhase: PetitionPhase = (petition.currentPhase ?? 1) as PetitionPhase;
  // If user hasn't picked a tab, default to current phase
  const effectivePhaseForItem = (item: PetitionItem): PetitionPhase => {
    if (!itemHasPhasedParam(item)) return 1;
    const round = sampleRoundFor(petition, 'lab', item.seq);
    return round ? selectedRoundPhases[round._id + ':' + item.seq] ?? round.currentPhase ?? 1 : selectedPhase;
  };

  const visibleFields = (param: ParameterItem, phase: PetitionPhase, item: PetitionItem): ParameterValueField[] => {
    const phaseState = sampleRoundFor(petition, param.scope ?? 'qc', item.seq) ?? petition;
    return visibleFieldsForPhase(param, phase, phaseState.phase2TriggeredBy?.parameterId);
  };

  const valuesForPhase = (phase: PetitionPhase) => (phase === 2 ? valuesPhase2 : values);

  // ต้องกรอกค่าก่อนอบ (Phase 1) ของรายการให้ครบก่อนเริ่มจับเวลาตัว trigger เช่น อบ 14 วัน
  const phaseTriggerReasonFor = (item: PetitionItem): string | undefined =>
    phaseTriggerBlockedReason(missingValuesBeforePhaseTrigger(
      matchLabParametersForItem(petition, item, allParameters, idsFor(item)).filter((param) => param.scope === 'lab'),
      (param) => {
        const k = resultKey(item.seq, param._id!);
        return param.multiEntry ? getEntryValues({ entries: entriesByKey[k] }, param) : [values[k] ?? {}];
      },
      (field) => expandFieldForItem(field, item.commonName, { category: petitionCategory }),
    ));
  const savesForPhase = (phase: PetitionPhase) => (phase === 2 ? saveStatesPhase2 : saveStates);

  // current array value for a `multiple` field (always returns an array for editing)
  const readMultiple = (vals: Record<string, unknown> | undefined, label: string): unknown[] => {
    const v = vals?.[label];
    return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
  };

  // Resolve a reference field's value from another parameter's saved result on the same item
  const resolveReference = (itemSeq: number, field: ParameterValueField) => {
    if (!field.refParameterId || !field.refFieldLabel) {
      return { value: '' as unknown, sourceName: undefined as string | undefined };
    }
    const refKey = resultKey(itemSeq, field.refParameterId);
    const sourceDict = field.refPhase === 2 ? valuesPhase2 : values;
    const value = sourceDict[refKey]?.[field.refFieldLabel] ?? '';
    const sourceName = savedResults.find(
      (r) => r.parameterId === field.refParameterId && r.itemSeq === itemSeq,
    )?.parameterName;
    return { value, sourceName };
  };

  // Count abnormal values across one value-object's render units.
  // Handles field-level `multiple` (each array element counts individually).
  const countAbnormalInValues = (
    fieldsToScan: ParameterValueField[],
    item: PetitionItem,
    src: Record<string, unknown>,
    parameterId: string,
    phase: PetitionPhase = 1,
  ): number => {
    const prefix = item.seq + '__';
    const context: ConditionContext = {
      sameParam: src,
      otherParams: Object.fromEntries(Object.entries(valuesForPhase(phase))
        .filter(([key]) => key.startsWith(prefix) && key !== resultKey(item.seq, parameterId))
        .map(([key, value]) => [key.slice(prefix.length), value])),
    };
    let count = 0;
    fieldsToScan.forEach((field) => {
      expandFieldForItem(field, item.commonName, { category: petitionCategory }).forEach((unit) => {
        if (unit.field.conditionalMode && unit.field.conditionalResult === 'output') {
          if (isConditionalOutputAbnormal(unit.field, context)) count += 1;
          return;
        }
        const field = unit.field.conditionalMode ? resolveFieldStandard(unit.field, context) : unit.field;
        if (unit.field.multiple) {
          readMultiple(src, unit.key).forEach((v) => {
            if (isFieldAbnormal(field, v)) count += 1;
          });
        } else if (isFieldAbnormal(field, src[unit.key])) {
          count += 1;
        }
      });
    });
    return count;
  };

  const countAbnormal = (): number => {
    let count = 0;
    labItems.forEach((item) => {
      const matched = matchLabParametersForItem(petition, item, allParameters, idsFor(item));
      matched.forEach((param) => {
        if (param.scope !== 'lab') return; // skip read-only shared QC params
        const k = resultKey(item.seq, param._id!);
        const p1Fields = visibleFields(param, 1, item);
        // multiEntry: scan every entry; otherwise the flat phase-1 dict.
        if (param.multiEntry) {
          getEntryValues({ entries: entriesByKey[k] }, param).forEach((entryValues) => {
            count += countAbnormalInValues(p1Fields, item, entryValues, param._id!);
          });
        } else {
          count += countAbnormalInValues(p1Fields, item, values[k] ?? {}, param._id!);
        }
        // Check Phase 2 values for both/after fields if phased
        if (hasAnyPhasedParam) {
          const p2Values = valuesPhase2[k] ?? {};
          count += countAbnormalInValues(visibleFields(param, 2, item), item, p2Values, param._id!, 2);
        }
      });
    });
    return count;
  };
  const abnormalCount = countAbnormal();

  // Validate the currently-active phase only — Phase 2 submit doesn't require Phase 1 re-edit.
  const validate = (): string[] => {
    const missing: string[] = [];
    labItems.forEach((item) => {
      const phaseToCheck = effectivePhaseForItem(item);
      const phaseValues = valuesForPhase(phaseToCheck);
      const matched = matchLabParametersForItem(petition, item, allParameters, idsFor(item));
      matched.forEach((param) => {
        if (param.scope !== 'lab') return; // only validate Lab-owned params
        const k = resultKey(item.seq, param._id!);
        // multiEntry params validate each existing entry; otherwise the flat dict.
        // (For multiEntry we only consider phase 1 — multiEntry + phases don't combine.)
        const valueObjs: { values: Record<string, unknown>; suffix: string }[] =
          param.multiEntry
            ? getEntryValues({ entries: entriesByKey[k] }, param).map((e, i) => ({
                values: e,
                suffix: ` (รายการที่ ${i + 1})`,
              }))
            : [{ values: phaseValues[k] ?? {}, suffix: '' }];
        visibleFields(param, phaseToCheck, item).forEach((field) => {
          if (field.type === 'reference') return; // reference fields are auto-resolved
          expandFieldForItem(field, item.commonName, { category: petitionCategory }).forEach((unit) => {
            valueObjs.forEach(({ values: itemValues, suffix }) => {
              const val = itemValues[unit.key];
              // field-level `multiple` — required means at least one non-empty element
              if (unit.field.multiple) {
                if (unit.field.required) {
                  const arr = readMultiple(itemValues, unit.key);
                  const hasOne = arr.some((v) => v != null && String(v).trim() !== '');
                  if (!hasOne) {
                    missing.push(`รายการ ${item.seq} › ${param.name} › ${unit.field.label}${suffix}`);
                  }
                }
                return;
              }
              if (unit.field.required && (val == null || String(val).trim() === '')) {
                missing.push(`รายการ ${item.seq} › ${param.name} › ${unit.field.label}${suffix}`);
                return;
              }
              if (
                unit.field.type === 'enum' &&
                (unit.field.requireNoteOn ?? []).includes(String(val ?? ''))
              ) {
                const noteVal = itemValues[noteLabelFor(unit.key)];
                if (!noteVal || String(noteVal).trim() === '') {
                  missing.push(`รายการ ${item.seq} › ${param.name} › ${unit.field.label} (คำอธิบาย)${suffix}`);
                }
              }
            });
          });
        });
      });
    });
    return missing;
  };

  // required ครบทุกช่องของ phase ปัจจุบัน → ปุ่มเปลี่ยนจาก "บันทึกแบบร่าง" เป็น "บันทึก" (ปิด track)
  const isComplete = hasAllLabOwnedParams && validate().length === 0;

  const handleSaveDraft = async () => {
    if (pendingSample || submitting) return;
    setSubmitting(true);
    try {
      await autosaves.flush();
      toast.success(petition.labCompletedAt ? 'บันทึกการแก้ไขผล Lab เรียบร้อย' : 'บันทึกแบบร่างเรียบร้อย');
      navigate('/lab-testing');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกผลไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  // ผลที่บันทึกแล้ว: กด "แก้ไข"/"ล้างค่า" ต้องระบุเหตุผลก่อน (เก็บ log ฝั่ง server)
  const handleReasonConfirm = async (reason: string) => {
    const action = reasonDialog === 'clear' ? 'clear' : 'edit-start';
    try {
      const updated = await api.labResultAction(petition._id, action, reason);
      setRequestedPetition(updated);
      if (action === 'clear') {
        await loadResults(petition._id);
        toast.success('ล้างค่าผล Lab แล้ว');
      } else {
        toast.success('เปิดแก้ไขผล Lab แล้ว');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ');
      throw error;
    }
  };

  const finishEdit = async (action: 'edit-save' | 'edit-cancel') => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (action === 'edit-save') await autosaves.flush();
      else await autosaves.flush().catch(() => {});
      const updated = await api.labResultAction(petition._id, action);
      setRequestedPetition(updated);
      await loadResults(petition._id);
      toast.success(action === 'edit-save' ? 'บันทึกการแก้ไขผล Lab เรียบร้อย' : 'ยกเลิกการแก้ไขและคืนค่าเดิมแล้ว');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitResult = async () => {
    if (!hasAllLabOwnedParams || pendingDensity || pendingSample || submitting || additionalSampleOpen || loadedResultsKey !== resultsKey) return;
    const missing = validate();
    if (missing.length > 0) {
      toast.error('กรอกข้อมูลไม่ครบ', {
        description: `ขาด ${missing.length} ช่อง:\n${missing.slice(0, 5).join('\n')}${missing.length > 5 ? `\n…และอีก ${missing.length - 5}` : ''}`,
      });
      return;
    }
    if (petition.labReturnNote && !redoExplanation.trim()) {
      toast.error('กรุณาอธิบายว่าทำใหม่อย่างไร', { description: 'คำร้องนี้เคยถูกส่งกลับให้แก้ไข' });
      return;
    }
    // ปิด track แล้วหน้าจะ lock แก้ไม่ได้ → confirm ทุกครั้ง (รวมเตือนค่าผิดปกติใน dialog เดียว)
    const ok = await confirm({
      title: 'ยืนยันบันทึกผล',
      description:
        abnormalCount > 0
          ? `พบค่าผิดปกติ ${abnormalCount} รายการ — หลังบันทึกแล้วจะแก้ไขไม่ได้ ยืนยันบันทึกผล?`
          : 'หลังบันทึกแล้วจะแก้ไขไม่ได้ ยืนยันบันทึกผล?',
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      await autosaves.flush();
      const updated = await api.completePetitionTrack(
        petition._id,
        'lab',
        user?.name ?? 'system',
        redoExplanation.trim() || undefined,
      );
      toast.success(
        updated.status === 'success'
          ? 'บันทึกผล Lab เรียบร้อย — ส่งให้หัวหน้า QC ยืนยัน'
          : 'บันทึกผล Lab เรียบร้อย — รอหัวหน้า Lab ออกผล',
      );
      navigate('/lab-testing');
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      toast.error(msg && !/^Failed/.test(msg) ? msg : 'บันทึกผลไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const isFullAccess = normalizeRoles(user).some((r) => FULL_ACCESS_ROLES.has(r));
  const isAssigned = isFullAccess || isAssignedTo(petition.assignedTo, user);
  // ผล Lab ที่ออกแล้วแก้ไขได้จนกว่าคำร้องจะปิด Final Result; การกด
  // "แก้ไขผล Lab" จากหน้ารายการจึงต้องเปิดช่องกรอกจริงตามชื่อปุ่ม.
  const isLocked = ['approved', 'rejected'].includes(petition.status) || !!petition.labApprovedAt || !isAssigned || !!pendingSample || pendingDensity;
  const hasSubmittedLab = !!petition.labCompletedAt;
  const isEditingSubmitted = hasSubmittedLab && !!petition.labEditSession;
  // บันทึกผลแล้ว = ดูอย่างเดียว จนกว่าจะกด "แก้ไข"
  const viewOnly = hasSubmittedLab && !isEditingSubmitted;
  const switchablePetitions = (worklistData?.items ?? []).filter((p) =>
    !!labReceivedAt(p) && (p.items ?? []).some(
      (it) =>
        (isResearchAndDevelopmentPetition(p) || shouldSendItemToLab(it)) &&
        matchLabParametersForItem(p, it, allParameters, idsFor(it)).length > 0,
    ),
  );

  return (
    <AppLayout title={petition.petitionNo}>
      <div className={`space-y-6 pb-20 ${flashClass}`}>
        {/* Header */}
        <PageHeader
          onBack={() => navigate('/lab-testing')}
          title={
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary" />
              {petition.petitionNo}
            </span>
          }
          actions={
            <span className="text-sm text-muted-foreground">
              ผู้นำส่ง: {petition.submittedBy?.name ?? '-'}
              {labReceivedBy(petition) && ` · ผู้รับงาน: ${labReceivedBy(petition)}`}
            </span>
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="blue-soft">{petitionDepartmentLabel(petition)}</Badge>
          {wasReturned && (
            <span
              className="inline-flex items-center text-orange-500"
              title="ส่งกลับมาบันทึกผลใหม่"
              aria-label="ส่งกลับมาบันทึกผลใหม่"
            >
              <RotateCcw className="h-4 w-4" />
            </span>
          )}
          {abnormalCount > 0 && (
            <span
              className="inline-flex items-center text-red-500"
              title={`พบค่าผิดปกติ ${abnormalCount} รายการ`}
            >
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
        </div>

        {!isAssigned && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              คุณไม่ได้ถูก assign งานนี้
              {petition.assignedTo?.name && ` — มอบหมายให้: ${petition.assignedTo.name}`}
            </AlertDescription>
          </Alert>
        )}

        {pendingDensity && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-wrap items-center gap-2">
              รอ QC เลือกและบันทึกค่าถพ. ก่อน จึงจะกรอกผล Lab ได้
              <Button type="button" variant="outline" size="sm" onClick={() => void loadResults(petition._id)}>
                ตรวจค่าอีกครั้ง
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Worklist tab strip */}
        {switchablePetitions.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mt-2">
            <span className="text-xs text-muted-foreground shrink-0 mr-1">สลับไป:</span>
            {switchablePetitions.map((p) => {
              const isActive = p._id === petition._id;
                return (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => navigate(`/lab-testing/${p._id}`, { state: { petition: p } })}
                    className={cn(
                      'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground border-primary cursor-default'
                        : 'bg-card text-card-foreground border-border hover:border-primary/40 hover:bg-accent',
                    )}
                    disabled={isActive}
                  >
                    <span className={cn('h-2 w-2 rounded-full', p.status === 'inProgress' ? 'bg-amber-400' : 'bg-blue-400')} />
                    <span className="font-semibold">{p.petitionNo}</span>
                  </button>
              );
            })}
          </div>
        )}

        {labItems.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">ไม่มีตัวอย่างที่ส่งเข้า Lab ในคำร้องนี้</div>
        )}

        {hasAnyPhasedParam && labItems.some((item) => !sampleRoundFor(petition, 'lab', item.seq)) && (
          <PhaseBanner
            currentPhase={currentPhase}
            selectedPhase={selectedPhase}
            onSelectPhase={setSelectedPhase}
            phase2DueAt={petition.phase2DueAt}
            phase2UnlockedAt={petition.phase2UnlockedAt}
            triggeredByName={petition.phase2TriggeredBy?.parameterName}
          />
        )}

        {/* Each Lab item */}
        {labItems.map((item) => {
          const matchedParams = matchLabParametersForItem(petition, item, allParameters, idsFor(item));
          const round = sampleRoundFor(petition, 'lab', item.seq);
          const itemCurrentPhase = (round ?? petition).currentPhase ?? 1;
          const effectivePhase = effectivePhaseForItem(item);
          const labOwnedParams = matchedParams.filter((p) => p.scope === 'lab');
          const sharedQcParams = matchedParams.filter((p) => p.scope === 'qc' && p.shareWithLab);
          const phaseValues = valuesForPhase(effectivePhase);
          const phaseSaves = savesForPhase(effectivePhase);
          const phaseLocked = effectivePhase === 2 && itemCurrentPhase === 1;
          return (
            <Card key={item.seq} className="overflow-hidden">
              <CardHeader className="bg-muted pb-3">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>รายการที่ {item.seq}: {item.sampleName || '-'}</span>
                  {item.batchNo && (
                    <Badge variant="blue-soft" className="font-normal">
                      Batch: {item.batchNo}
                    </Badge>
                  )}
                  {item.sampleId && (
                    <Badge variant="primary-soft" className="font-normal text-xs">
                      {item.sampleId}
                    </Badge>
                  )}
                </CardTitle>
                {item.testItems && (
                  <p className="text-xs text-muted-foreground mt-1">รายการทดสอบ: {item.testItems}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  ปริมาณที่ส่ง: {item.labelQuantities?.some((quantity) => quantity.trim())
                    ? item.labelQuantities.length === 1
                      ? item.labelQuantities[0]
                      : item.labelQuantities.map((quantity, index) => `ตัวอย่างที่ ${index + 1}: ${quantity.trim() || '-'}`).join(' · ')
                    : item.labelQuantity?.trim() || '-'}
                </p>
              </CardHeader>

              <CardContent className="pt-4 space-y-5">
                {round && matchedParams.some((parameter) => parameter.hasPhases) && (
                  <PhaseBanner
                    currentPhase={itemCurrentPhase}
                    selectedPhase={effectivePhase}
                    onSelectPhase={(phase) => setSelectedRoundPhases((previous) => ({ ...previous, [round._id + ':' + item.seq]: phase }))}
                    phase2DueAt={round.phase2DueAt}
                    phase2UnlockedAt={round.phase2UnlockedAt}
                    triggeredByName={round.phase2TriggeredBy?.parameterName}
                  />
                )}
                {!paramsLoaded ? (
                  <p role="status" className="text-sm text-muted-foreground">กำลังโหลดพารามิเตอร์ Lab...</p>
                ) : paramsLoadError ? (
                  <p role="alert" className="text-sm text-destructive">โหลดพารามิเตอร์ Lab ไม่สำเร็จ กรุณารีเฟรชหน้า</p>
                ) : matchedParams.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    ยังไม่มีพารามิเตอร์ Lab ที่ตรงกับตัวอย่างนี้ กรุณาตรวจการตั้งค่าพารามิเตอร์และรายการทดสอบ
                  </p>
                ) : (
                  <>
                    {/* Lab-owned parameters (editable) */}
                    {labOwnedParams.map((param) => {
                      const k = resultKey(item.seq, param._id!);
                      const fields = aiFieldsForParameter(visibleFields(param, effectivePhase, item));
                      if (fields.length === 0) return null;
                      // Build the condition context for resolving conditionalMode standards:
                      // sameParam = this parameter's live values; otherParams = each OTHER
                      // matched parameter's live values for the same item, keyed by parameterId.
                      const densityEntries = matchedParams.flatMap((p) => (p._id && p._id !== param._id ? entriesByKey[resultKey(item.seq, p._id)] ?? [] : []));
                      const condCtx: ConditionContext = {
                        sameParam: phaseValues[k] ?? {},
                        otherParams: (() => {
                          const out: Record<string, Record<string, unknown>> = {};
                          matchedParams.forEach((p) => {
                            if (!p._id || p._id === param._id) return;
                            out[String(p._id)] = phaseValues[resultKey(item.seq, p._id)] ?? {};
                          });
                          return out;
                        })(),
                      };
                      return (
                        <div key={param._id} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1 flex-1">
                              {param.name}
                            </h3>
                            <Badge className="bg-primary/10 text-primary text-[10px] font-semibold uppercase hover:bg-primary/10">
                              Lab
                            </Badge>
                            {param.hasPhases && (
                              <Badge className="bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase hover:bg-amber-100">
                                Phase {effectivePhase}
                              </Badge>
                            )}
                            {param.note && (
                              <span className="text-xs text-muted-foreground">{param.note}</span>
                            )}
                          </div>
                          {(() => {
                            const fieldDisabled = isLocked || viewOnly || phaseLocked || additionalSampleOpen || submitting || loadedResultsKey !== resultsKey;

                            // Render a single editable render-unit. `srcValues` is the
                            // value-object to read/display from; `onUnitChange` persists a
                            // write. For multiEntry params these target an entry value-
                            // object (instrument-pull/provenance/beforeRef omitted there);
                            // otherwise the flat phase dict (full scalar behavior).
                            const renderEditUnit = (
                              unit: RenderFieldUnit,
                              srcValues: Record<string, unknown>,
                              onUnitChange: (label: string, val: unknown) => void,
                              saveInfoSrc: Record<string, FieldSaveInfo> | undefined,
                              scalarExtras: boolean,
                            ) => {
                              const noteLabel = noteLabelFor(unit.key);
                              const effectiveField = unit.field.conditionalMode
                                ? resolveFieldStandard(unit.field, condCtx)
                                : unit.field;
                              const resolved = unit.field.conditionalMode
                                ? resolveStandard(unit.field, condCtx)
                                : null;
                              const resolvedStandardText = resolved
                                ? `${describeResolvedStandard(resolved, unit.field.unit ?? '')}${resolved.matchedRuleLabel ? ` (${resolved.matchedRuleLabel})` : ''}`
                                : undefined;
                              const isOutputMode = unit.field.conditionalMode && unit.field.conditionalResult === 'output';
                              const outputResult = isOutputMode ? resolveConditionalOutput(unit.field, condCtx) : null;
                              const isAiParameter = (param.valueFields ?? []).some((candidate) => calculatedAiFieldKind(candidate.label) === 'ai');
                              const aiFieldKind = isAiParameter ? calculatedAiFieldKind(unit.field.label) : null;
                              const calculatedAi = aiFieldKind ? calculateAi(srcValues, aiDensity(srcValues, condCtx, aiSubstanceFromKey(unit.key), densityEntries), aiSubstanceFromKey(unit.key)) : null;

                              // Field-level `multiple` — repeatable list of bare value rows.
                              // Each row shares the field's standard/abnormal rule; per-row
                              // save stamps / instrument-pull / beforeRef are intentionally
                              // omitted (mirrors QC). The field value is the WHOLE array.
                              if (unit.field.multiple) {
                                const arr = readMultiple(srcValues, unit.key);
                                const rows = [...arr, '']; // trailing empty row to add next
                                const writeRow = (i: number, rowVal: unknown) => {
                                  const next = [...readMultiple(srcValues, unit.key)];
                                  while (next.length <= i) next.push('');
                                  next[i] = rowVal;
                                  onUnitChange(unit.key, next);
                                };
                                const removeRow = (i: number) => {
                                  const next = readMultiple(srcValues, unit.key).filter((_, idx) => idx !== i);
                                  onUnitChange(unit.key, next);
                                };
                                return (
                                  <div key={unit.key} className="space-y-2 rounded-md border border-border p-2">
                                    <p className="text-sm font-medium text-foreground">
                                      {unit.field.label}
                                      {unit.field.unit && <span className="text-muted-foreground font-normal ml-1">({unit.field.unit})</span>}
                                    </p>
                                    {rows.map((rowVal, i) => {
                                      const isExisting = i < arr.length;
                                      return (
                                        <div key={i} className="flex items-end gap-2">
                                          <div className="flex-1">
                                            <TestField
                                              field={{ ...effectiveField, label: `ค่าที่ ${i + 1}`, multiple: false, required: false }}
                                              item={item}
                                              itemGroupIds={idsFor(item)}
                                              value={rowVal ?? ''}
                                              noteValue={''}
                                              disabled={fieldDisabled}
                                              onChange={(val) => writeRow(i, val)}
                                              onNoteChange={() => {}}
                                            />
                                          </div>
                                          {isExisting && !fieldDisabled && (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="text-red-500 hover:text-red-600"
                                              onClick={() => removeRow(i)}
                                            >
                                              ลบ
                                            </Button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              }

                              // scalar path — full feature set only for the flat phase dict
                              // (scalarExtras); multiEntry entries route writes via onUnitChange.
                              const beforeRef =
                                scalarExtras &&
                                param.hasPhases &&
                                effectivePhase === 2 &&
                                (unit.field.phase ?? 'both') === 'both'
                                  ? (values[k]?.[unit.key] ?? '')
                                  : null;
                              const srcField = scalarExtras ? sourceFor(unit.field.label) : undefined;
                              const sourceLabel = sourceLabelFor(unit.key);
                              const provenance = scalarExtras
                                ? parseProvenance(srcValues[sourceLabel])
                                : undefined;
                              const labelToleranceInfo = unit.labelTolerance
                                ? (() => {
                                    const rv = resolveLabelTolerance(unit.labelTolerance.std, unit.labelTolerance.rawSpec, srcValues[unit.key]);
                                    return {
                                      criteriaText: formatLabLabelToleranceRange(rv, unit.field.unit ?? ''),
                                      badge: labelToleranceBadge(rv.status, rv.center),
                                    };
                                  })()
                                : null;
                              return (
                                <div key={unit.key} className={aiGridClass(unit.field.label)}>
                                  <TestField
                                    field={effectiveField}
                                    item={item}
                                    itemGroupIds={idsFor(item)}
                                    value={aiFieldKind ? (calculatedAi?.[aiFieldKind] != null ? formatCalculatedAi(calculatedAi[aiFieldKind]) : aiFieldKind === 'ai' && calculatedAi?.sampleAverage != null ? '' : srcValues[unit.key] ?? '') : srcValues[unit.key] ?? ''}
                                    noteValue={srcValues[noteLabel] ?? ''}
                                    saveInfo={saveInfoSrc?.[unit.key]}
                                    noteSaveInfo={saveInfoSrc?.[noteLabel]}
                                    disabled={fieldDisabled}
                                    readOnly={!!aiFieldKind}
                                    timerStartBlockedReason={unit.field.triggersPhase2 && effectivePhase === 1 ? phaseTriggerReasonFor(item) : undefined}
                                    instrumentSource={srcField}
                                    provenance={provenance}
                                    onPull={
                                      scalarExtras
                                        ? (reading) => {
                                            onUnitChange(unit.key, String(reading.value ?? ''));
                                            const prov: ValueProvenance = {
                                              source: 'instrument',
                                              instrument: reading.instrument,
                                              rawValue: reading.value,
                                              fetchedAt: reading.readingAt ?? new Date().toISOString(),
                                              fetchedBy: user?.name ?? 'Unknown',
                                            };
                                            onUnitChange(sourceLabel, JSON.stringify(prov));
                                          }
                                        : undefined
                                    }
                                    onChange={(val) => {
                                      if (aiFieldKind) return;
                                      onUnitChange(unit.key, val);
                                      if (isAiParameter) {
                                        const nextValues = { ...srcValues, [unit.key]: val };
                                        fields.forEach((candidate) => {
                                          const kind = calculatedAiFieldKind(candidate.label);
                                          if (!kind) return;
                                          expandFieldForItem(candidate, item.commonName, { category: petitionCategory })
                                            .forEach((derivedUnit) => {
                                    const substance = aiSubstanceFromKey(derivedUnit.key);
                                    onUnitChange(derivedUnit.key, formatCalculatedAi(calculateAi(nextValues, aiDensity(nextValues, condCtx, substance, densityEntries), substance)[kind]));
                                  });
                                        });
                                      }
                                      // Manual edit after a pull → mark provenance as edited (once).
                                      if (scalarExtras && provenance && provenance.source === 'instrument' && String(val) !== String(provenance.rawValue ?? '')) {
                                        onUnitChange(sourceLabel, JSON.stringify({ ...provenance, source: 'instrument-edited' }));
                                      }
                                    }}
                                    onNoteChange={(val) => onUnitChange(noteLabel, val)}
                                    conditionalPending={isOutputMode ? false : (!!unit.field.conditionalMode && !resolved)}
                                    resolvedStandardText={isOutputMode ? undefined : resolvedStandardText}
                                    outputResult={outputResult}
                                    headerMeta={
                                      labelToleranceInfo?.criteriaText ? (
                                        <span className="text-xs text-muted-foreground whitespace-pre-line">
                                          {labelToleranceInfo.criteriaText}
                                        </span>
                                      ) : undefined
                                    }
                                  />
                                  {labelToleranceInfo?.badge && (
                                    <div className="mt-1">
                                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${labelToleranceInfo.badge.cls}`}>
                                        {labelToleranceInfo.badge.text}
                                      </span>
                                    </div>
                                  )}
                                  {aiFieldKind === 'ai' && calculatedAi?.sampleAverage != null && calculatedAi.ai == null && (
                          <p className="mt-1 text-xs text-muted-foreground">รอค่า ถพ.</p>
                        )}
                        {beforeRef != null && beforeRef !== '' ? (
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      ก่อน: <span className="font-mono">{String(beforeRef)}</span>
                                    </p>
                                  ) : null}
                                </div>
                              );
                            };

                            // Field-grid for one value-object (flat dict or one entry).
                            const renderEditGrid = (
                              srcValues: Record<string, unknown>,
                              onUnitChange: (label: string, val: unknown) => void,
                              saveInfoSrc: Record<string, FieldSaveInfo> | undefined,
                              scalarExtras: boolean,
                            ) => (
                              <div className={cn(
                                'grid grid-cols-1 gap-4 pl-2',
                                (param.valueFields ?? []).some((candidate) => calculatedAiFieldKind(candidate.label) === 'ai') ? 'sm:grid-cols-6' : 'sm:grid-cols-2',
                              )}>
                                {fields.map((field) => {
                                  if (field.type === 'reference') {
                                    const { value: refValue, sourceName } = resolveReference(item.seq, field);
                                    return (
                                      <ReferenceFieldDisplay
                                        key={field.label}
                                        field={field}
                                        resolvedValue={refValue}
                                        sourceName={sourceName}
                                      />
                                    );
                                  }
                                  const units = expandFieldForItem(field, item.commonName, { category: petitionCategory });
                                  return units.map((unit) => renderEditUnit(unit, srcValues, onUnitChange, saveInfoSrc, scalarExtras));
                                })}
                              </div>
                            );

                            if (param.multiEntry) {
                              // Per-entry rendering. Saved entries come from entries[]; the
                              // number of cards shown is user-driven (เพิ่มรายการ), never auto.
                              // Entry writes route through handleEntryFieldChange (no instrument-pull).
                              const savedRows = entriesByKey[k] ?? [];
                              const savedCount = savedRows.length;
                              const shown = Math.max(entryRowCounts[k] ?? 0, savedCount, 1);
                              const removeRow = (ei: number) => {
                                if (ei < savedCount) handleRemoveEntry(petition, item, param, ei);
                                setEntryRowCounts((c) =>
                                  c[k] == null ? c : { ...c, [k]: Math.max(c[k] - 1, 1) },
                                );
                              };
                              return (
                                <div className="space-y-4">
                                  {Array.from({ length: shown }, (_, ei) => {
                                    const entryValues = savedRows[ei] ?? {};
                                    const canRemove = !fieldDisabled && (shown > 1 || ei < savedCount);
                                    return (
                                      <div key={ei} className="rounded-lg border border-border p-3 space-y-2">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-semibold text-muted-foreground flex-1">
                                            รายการที่ {ei + 1}
                                          </span>
                                          {canRemove && (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="text-red-500 hover:text-red-600"
                                              onClick={() => removeRow(ei)}
                                            >
                                              ลบรายการ
                                            </Button>
                                          )}
                                        </div>
                                        {renderEditGrid(
                                          entryValues,
                                          (label, val) => handleEntryFieldChange(petition, item, param, ei, label, val),
                                          undefined,
                                          false,
                                        )}
                                      </div>
                                    );
                                  })}
                                  {!fieldDisabled && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setEntryRowCounts((c) => ({ ...c, [k]: shown + 1 }))}
                                    >
                                      + เพิ่มรายการ
                                    </Button>
                                  )}
                                </div>
                              );
                            }

                            return renderEditGrid(
                              phaseValues[k] ?? {},
                              (label, val) => handleFieldChange(petition, item, param, label, val, effectivePhase),
                              phaseSaves[k],
                              true,
                            );
                          })()}
                        </div>
                      );
                    })}

                    {/* Shared QC parameters (read-only) */}
                    {sharedQcParams.map((param) => {
                      const k = resultKey(item.seq, param._id!);
                      const fields = aiFieldsForParameter(visibleFields(param, effectivePhase, item));
                      if (fields.length === 0) return null;
                      // Build the condition context for resolving conditionalMode standards:
                      // sameParam = this parameter's live values; otherParams = each OTHER
                      // matched parameter's live values for the same item, keyed by parameterId.
                      const condCtx: ConditionContext = {
                        sameParam: phaseValues[k] ?? {},
                        otherParams: (() => {
                          const out: Record<string, Record<string, unknown>> = {};
                          matchedParams.forEach((p) => {
                            if (!p._id || p._id === param._id) return;
                            out[String(p._id)] = phaseValues[resultKey(item.seq, p._id)] ?? {};
                          });
                          return out;
                        })(),
                      };
                      return (
                        <div key={param._id} className="space-y-3 rounded-lg bg-indigo-50/40 border border-indigo-100 p-3">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground flex-1">
                              {param.name}
                            </h3>
                            <Badge className="bg-indigo-100 text-indigo-800 text-[10px] font-semibold uppercase hover:bg-indigo-100">
                              QC กรอกแล้ว
                            </Badge>
                            {param.hasPhases && (
                              <Badge className="bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase hover:bg-amber-100">
                                Phase {effectivePhase}
                              </Badge>
                            )}
                            {param.note && (
                              <span className="text-xs text-muted-foreground">{param.note}</span>
                            )}
                          </div>
                          {(() => {
                            // Read-only render of one render-unit from a value-object.
                            // Field-level `multiple` lists each array value read-only
                            // (no add/remove inputs); scalar uses the read-only TestField.
                            const renderReadUnit = (
                              unit: RenderFieldUnit,
                              srcValues: Record<string, unknown>,
                              saveInfoSrc: Record<string, FieldSaveInfo> | undefined,
                            ) => {
                              const noteLabel = noteLabelFor(unit.key);
                              const effectiveField = unit.field.conditionalMode
                                ? resolveFieldStandard(unit.field, condCtx)
                                : unit.field;
                              const resolved = unit.field.conditionalMode
                                ? resolveStandard(unit.field, condCtx)
                                : null;
                              const resolvedStandardText = resolved
                                ? `${describeResolvedStandard(resolved, unit.field.unit ?? '')}${resolved.matchedRuleLabel ? ` (${resolved.matchedRuleLabel})` : ''}`
                                : undefined;
                              const isOutputMode = unit.field.conditionalMode && unit.field.conditionalResult === 'output';
                              const outputResult = isOutputMode ? resolveConditionalOutput(unit.field, condCtx) : null;
                              const labelToleranceInfo = unit.labelTolerance
                                ? (() => {
                                    const rv = resolveLabelTolerance(unit.labelTolerance.std, unit.labelTolerance.rawSpec, srcValues[unit.key]);
                                    return {
                                      criteriaText: formatLabLabelToleranceRange(rv, unit.field.unit ?? ''),
                                      badge: labelToleranceBadge(rv.status, rv.center),
                                    };
                                  })()
                                : null;

                              if (unit.field.multiple) {
                                const arr = readMultiple(srcValues, unit.key);
                                return (
                                  <div key={unit.key} className="space-y-2 rounded-md border border-border p-2">
                                    <p className="text-sm font-medium text-foreground">
                                      {unit.field.label}
                                      {unit.field.unit && <span className="text-muted-foreground font-normal ml-1">({unit.field.unit})</span>}
                                    </p>
                                    {arr.length === 0 ? (
                                      <p className="text-xs text-muted-foreground italic">— ไม่มีค่า —</p>
                                    ) : (
                                      arr.map((rowVal, i) => (
                                        <TestField
                                          key={i}
                                          field={{ ...effectiveField, label: `ค่าที่ ${i + 1}`, multiple: false, required: false }}
                                          item={item}
                                          itemGroupIds={idsFor(item)}
                                          value={rowVal ?? ''}
                                          noteValue={''}
                                          readOnly
                                          onChange={() => {}}
                                          onNoteChange={() => {}}
                                        />
                                      ))
                                    )}
                                  </div>
                                );
                              }

                              return (
                                <div key={unit.key}>
                                  <TestField
                                    field={effectiveField}
                                    item={item}
                                    itemGroupIds={idsFor(item)}
                                    value={srcValues[unit.key] ?? ''}
                                    noteValue={srcValues[noteLabel] ?? ''}
                                    saveInfo={saveInfoSrc?.[unit.key]}
                                    noteSaveInfo={saveInfoSrc?.[noteLabel]}
                                    readOnly
                                    onChange={() => {}}
                                    onNoteChange={() => {}}
                                    conditionalPending={isOutputMode ? false : (!!unit.field.conditionalMode && !resolved)}
                                    resolvedStandardText={isOutputMode ? undefined : resolvedStandardText}
                                    outputResult={outputResult}
                                    headerMeta={
                                      labelToleranceInfo?.criteriaText ? (
                                        <span className="text-xs text-muted-foreground">
                                          {labelToleranceInfo.criteriaText}
                                        </span>
                                      ) : undefined
                                    }
                                  />
                                  {labelToleranceInfo?.badge && (
                                    <div className="mt-1">
                                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${labelToleranceInfo.badge.cls}`}>
                                        {labelToleranceInfo.badge.text}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            };

                            const renderReadGrid = (
                              srcValues: Record<string, unknown>,
                              saveInfoSrc: Record<string, FieldSaveInfo> | undefined,
                            ) => (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-2">
                                {fields.map((field) => {
                                  if (field.type === 'reference') {
                                    const { value: refValue, sourceName } = resolveReference(item.seq, field);
                                    return (
                                      <ReferenceFieldDisplay
                                        key={field.label}
                                        field={field}
                                        resolvedValue={refValue}
                                        sourceName={sourceName}
                                      />
                                    );
                                  }
                                  const units = expandFieldForItem(field, item.commonName, { category: petitionCategory });
                                  return units.map((unit) => renderReadUnit(unit, srcValues, saveInfoSrc));
                                })}
                              </div>
                            );

                            if (param.multiEntry) {
                              // Read-only: one card per saved entry (no trailing add card).
                              const entryRows = getEntryValues({ entries: entriesByKey[k] }, param);
                              if (entryRows.length === 0) {
                                return <p className="text-xs text-muted-foreground italic pl-2">— QC ยังไม่กรอกรายการ —</p>;
                              }
                              // ถ้าเป็นพารามิเตอร์ ค่า ถพ. และมีหลายค่า → ให้ Lab เลือกค่าที่จะลงในใบคำขอรับบริการ
                              const isSgParam = (param.valueFields ?? []).some((f) => f.label === SG_FIELD_LABEL);
                              const showFormPicker = isSgParam && entryRows.length > 1;
                              const rawChosen = Number(values[k]?.[FORM_ENTRY_INDEX_KEY] ?? 0);
                              const chosenIdx =
                                Number.isFinite(rawChosen) && rawChosen >= 0 && rawChosen < entryRows.length
                                  ? rawChosen
                                  : 0;
                              return (
                                <div className="space-y-4">
                                  {showFormPicker && (
                                    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-card px-3 py-2 text-card-foreground">
                                      <span className="text-xs font-semibold text-muted-foreground">ค่าที่ใช้ในใบคำขอรับบริการ:</span>
                                      <Select
                                        value={String(chosenIdx)}
                                        onValueChange={(v) =>
                                          handleFieldChange(petition, item, param, FORM_ENTRY_INDEX_KEY, Number(v), 1)
                                        }
                                        disabled={isLocked}
                                      >
                                        <SelectTrigger className="h-8 w-40 text-sm">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {entryRows.map((ev, ei) => {
                                            const sgValue = readSpecificGravityEntryValue(ev, SG_FIELD_LABEL);
                                            return (
                                              <SelectItem key={ei} value={String(ei)}>
                                                รายการที่ {ei + 1}
                                                {sgValue != null && sgValue !== '' ? ` (${sgValue})` : ''}
                                              </SelectItem>
                                            );
                                          })}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  )}
                                  {entryRows.map((entryValues, ei) => (
                                    <div
                                      key={ei}
                                      className={`rounded-lg border p-3 space-y-2 ${
                                        showFormPicker && ei === chosenIdx
                                          ? 'border-primary/50 bg-primary/10'
                                          : 'border-border'
                                      }`}
                                    >
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        รายการที่ {ei + 1}
                                        {showFormPicker && ei === chosenIdx && (
                                          <span className="ml-1 text-primary">← ใช้บนฟอร์ม</span>
                                        )}
                                      </span>
                                      {renderReadGrid(entryValues, undefined)}
                                    </div>
                                  ))}
                                </div>
                              );
                            }

                            return renderReadGrid(phaseValues[k] ?? {}, phaseSaves[k]);
                          })()}
                        </div>
                      );
                    })}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* banner เหตุผลส่งกลับ + ช่องอธิบายทำใหม่ (เฉพาะตอนยังกรอก/แก้อยู่) */}
        {!isLocked && petition.labReturnNote && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-orange-700 flex items-center gap-1">
              <RotateCcw className="h-4 w-4" /> ถูกส่งกลับให้แก้ไข
            </p>
            <p className="text-sm text-orange-800">{petition.labReturnNote}</p>
            <label className="block text-xs font-medium text-muted-foreground mt-2">อธิบายว่าทำใหม่อย่างไร (จำเป็น)</label>
            <textarea
              value={redoExplanation}
              onChange={(e) => setRedoExplanation(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-orange-400"
              placeholder="เช่น คาลิเบรตเครื่องใหม่แล้วทดสอบซ้ำ"
            />
          </div>
        )}

        <AdditionalSampleRequestDialog
          key={petition._id}
          petition={petition}
          side="lab"
          items={labItems.filter((item) => matchLabParametersForItem(petition, item, allParameters, idsFor(item)).some((parameter) => parameter.scope === 'lab'))}
          open={additionalSampleOpen}
          onOpenChange={setAdditionalSampleOpen}
          beforeSubmit={autosaves.flush}
          onRequested={setRequestedPetition}
        />

        {pendingSample && (
          <div role="status" className="rounded-lg border bg-card p-4 space-y-2">
            <Badge variant="yellow-soft">รอรับตัวอย่างเพิ่ม (LAB)</Badge>
            <p className="text-sm text-muted-foreground">{pendingSample.reason} — ยังแก้ไขหรือปิดผลตรวจฝั่ง LAB ไม่ได้จนกว่าจะรับรอบนี้</p>
          </div>
        )}

        {/* Action buttons stay available until Lab approval. */}
        {hasLabOwnedParams && !isLocked && (
          <div className="fixed bottom-0 left-0 right-0 z-50 md:left-72 px-4 sm:px-6 py-3 border-t border-border bg-background/95 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {abnormalCount > 0 && labReceivedAt(petition) && (
              <Button variant="outline" onClick={() => setAdditionalSampleOpen(true)} disabled={submitting || additionalSampleOpen || loadedResultsKey !== resultsKey}>ขอตัวอย่างเพิ่ม</Button>
            )}
            {viewOnly ? (
              <>
                <Button variant="outline" onClick={() => setReasonDialog('clear')} disabled={submitting || loadedResultsKey !== resultsKey} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  ล้างค่า
                </Button>
                <Button variant="primary" onClick={() => setReasonDialog('edit')} disabled={submitting || loadedResultsKey !== resultsKey} className="gap-2">
                  <Pencil className="h-4 w-4" />
                  แก้ไข
                </Button>
              </>
            ) : isEditingSubmitted ? (
              <>
                <Button variant="outline" onClick={() => void finishEdit('edit-cancel')} disabled={submitting}>
                  ยกเลิก
                </Button>
                <Button variant="primary" onClick={() => void finishEdit('edit-save')} disabled={submitting || loadedResultsKey !== resultsKey} className="gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  บันทึก
                </Button>
              </>
            ) : (
              <Button
                variant={isComplete ? 'primary' : 'outline'}
                onClick={isComplete ? handleSubmitResult : handleSaveDraft}
                disabled={submitting || additionalSampleOpen || loadedResultsKey !== resultsKey}
                className="gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isComplete ? <Send className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {isComplete ? 'บันทึก' : 'บันทึกแบบร่าง'}
              </Button>
            )}
          </div>
        )}

        <LabReasonDialog
          open={reasonDialog !== null}
          onOpenChange={(open) => { if (!open) setReasonDialog(null); }}
          title={reasonDialog === 'clear' ? 'ล้างค่าผล Lab' : 'แก้ไขผล Lab'}
          description={reasonDialog === 'clear'
            ? 'ค่าที่กรอกไว้ทั้งหมดจะถูกล้างเหมือนยังไม่เคยกรอก ระบบจะเก็บค่าเดิมและเหตุผลไว้ในประวัติ'
            : 'ระบุเหตุผลที่ต้องแก้ไขผลที่บันทึกแล้ว'}
          confirmLabel={reasonDialog === 'clear' ? 'ล้างค่า' : 'เริ่มแก้ไข'}
          defaultReason={reasonDialog === 'edit' ? 'ใส่ค่าผิด' : ''}
          destructive={reasonDialog === 'clear'}
          onConfirm={handleReasonConfirm}
        />

        {/* รอหัวหน้า Lab ออกผล */}
        {labItems.length > 0 && petition.labCompletedAt && !petition.labApprovedAt && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <CheckCircle2 className="h-6 w-6 text-amber-500" />
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">บันทึกผลแล้ว — รอหัวหน้า Lab ออกผล</p>
              {abnormalCount > 0 && (
                <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3.5 w-3.5" />คำร้องนี้มีค่าผิดปกติ {abnormalCount} รายการ
                </p>
              )}
            </div>
          </div>
        )}

        {/* ผล Lab ออกแล้ว */}
        {petition.labApprovedAt && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex flex-col items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">ผล Lab ออกแล้ว</p>
            {petition.labApprovedBy && <p className="text-xs text-muted-foreground">โดย {petition.labApprovedBy}</p>}
          </div>
        )}

      </div>
    </AppLayout>
  );
}
