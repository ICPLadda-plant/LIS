import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useParams, useNavigate, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { FlaskConical, CheckCircle2, Loader2, AlertCircle, AlertTriangle, RotateCcw, Save, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/lis/AppLayout';
import { mergeQcLabDuplicateItems } from '@/lib/petitionRouting';
import PageHeader from '@/components/lis/PageHeader';
import { usePetition, usePetitionList } from '@/hooks/usePetition';
import { api, type ParameterItem, type ParameterValueField } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useArrivalFlash } from '@/hooks/useArrivalFlash';
import { useConfirm } from '@/context/ConfirmDialog';
import { isFieldAbnormal, expandFieldForItem, resolveFieldStandard, resolveStandard, getEntryValues, optionOutputText, enumNormalValues, resolveConditionalOutput, isConditionalOutputAbnormal, resolveLabelTolerance } from '@/lib/parameterValidation';
import type { ConditionContext, ResolvedOutput, RenderFieldUnit } from '@/lib/parameterValidation';
import { describeResolvedStandard, describeStandard, formatLabelToleranceRange, labelToleranceBadge } from '@/lib/standardOperators';
import { cn } from '@/lib/utils';
import { aiGridClass, aiSubstanceFromKey, calculateAi, calculatedAiFieldKind, findAiDensity, formatCalculatedAi } from '@/lib/aiCalculation';
import { TimerField } from '@/components/lis/TimerField';
import { PhotoField } from '@/components/lis/PhotoField';
import { PhaseBanner } from '@/components/lis/PhaseBanner';
import { ReferenceFieldDisplay } from '@/components/lis/ReferenceFieldDisplay';
import { getPetitionCategory, itemGroupKey, matchParametersForItem, visibleEnumOptions } from '@/lib/petitionTestItems';
import { missingValuesBeforePhaseTrigger, phaseTriggerBlockedReason, visibleFieldsForPhase } from '@/lib/phaseRetest';
import AdditionalSampleRequestDialog from '@/components/petition/AdditionalSampleRequestDialog';
import { createResultAutosaveQueue, currentSampleResults, pendingAdditionalSample, sampleRoundFor, sampleRoundIdFor } from '@/lib/additionalSamples';
import { useItemGroupMembership } from '@/hooks/useItemGroupMembership';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { qcReceivedAt } from '@/lib/receiveStatus';
import { isVisibleInQcTestingQueue } from '@/lib/petitionQueueVisibility';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildPreviousValueLookup, getPreviousValue, type PreviousValueLookup } from '@/lib/revisionHelpers';
import { AiOutlierBadge } from '@/components/lis/AiOutlierBadge';
import { checkOutlier, getAiStatus, streamAnalyzeQC, type OutlierCheckResult } from '@/lib/aiApi';
import DensitySyncButton from '@/components/lis/DensitySyncButton';
import { normalizeRoles } from '@/lib/roles';
import {
  SG_VALUE_LABEL,
  SG_TEMP_LABEL,
  densityRowToEntry,
  formatDensity3,
  formatTSetComparison,
  isSgMachineUnitKey,
} from '@/lib/densitySync';

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

const AI_FIELD_ORDER = ['Area Inj.1', 'Area Inj.2', 'Area Inj.3', '% Sample 1', '% Sample 2', '% Sample 3', 'Area Average', 'Area %RSD', '% Sample Average', '% Sample %RSD', '%AI'] as const;
function aiFieldsForParameter(fields: ParameterValueField[]) {
  if (!fields.some((field) => calculatedAiFieldKind(field.label) === 'ai')) return fields;
  const byLabel = new Map(fields.map((field) => [field.label.trim().toLowerCase(), field]));
  const aiField = fields.find((field) => calculatedAiFieldKind(field.label) === 'ai');
  const generated = AI_FIELD_ORDER.map((label): ParameterValueField => (label === '%AI' ? aiField! : byLabel.get(label.toLowerCase())) ?? ({ label, type: 'float', unit: label.includes('Sample') || label === '%AI' ? '%' : undefined }));
  const known = new Set(AI_FIELD_ORDER.map((label) => label.toLowerCase()));
  return [...generated, ...fields.filter((field) => calculatedAiFieldKind(field.label) !== 'ai' && !known.has(field.label.trim().toLowerCase()))];
}

// ค่า ถพ. มักเก็บเป็นรายการย่อย (entries) จึงต้องส่งรายการย่อยของพารามิเตอร์อื่นมาด้วย
function aiDensity(values: Record<string, unknown>, context: ConditionContext, substance = '', entries: Record<string, unknown>[] = []) {
  return findAiDensity([values, ...Object.values(context.otherParams), ...entries], substance);
}

export const noteLabelFor = (mainLabel: string) => `${mainLabel}__note`;

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
  previousValue?: unknown;
  conditionalPending?: boolean;
  resolvedStandardText?: string;
  lastBatchValue?: unknown;
  lastBatchLabel?: string;
  outlierResult?: OutlierCheckResult | null;
  outputResult?: ResolvedOutput | null;
  hideStandard?: boolean;
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
  previousValue,
  conditionalPending,
  resolvedStandardText,
  lastBatchValue,
  lastBatchLabel,
  outlierResult,
  outputResult,
  hideStandard = false,
  timerStartBlockedReason,
}: TestFieldProps) {
  const strVal = value == null ? '' : String(value);
  const strNote = noteValue == null ? '' : String(noteValue);
  const requireNoteOn = field.requireNoteOn ?? [];
  const showNote = field.type === 'enum' && requireNoteOn.includes(strVal);
  const isAbnormal = hideStandard ? false : (outputResult ? outputResult.kind === 'abnormal' : isFieldAbnormal(field, value));
  const numericBounds = field.type !== 'text'
    ? (field as ParameterValueField & { min?: number; max?: number })
    : undefined;
  const customText = optionOutputText(field, value);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-grey-700">
          {field.label}
          {field.unit && <span className="text-grey-400 font-normal ml-1">({field.unit})</span>}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
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
        {/* save state indicator */}
        {saveInfo?.state === 'saving' && (
          <Loader2 className="h-3 w-3 animate-spin text-grey-400" />
        )}
        {saveInfo?.state === 'saved' && (
          <CheckCircle2 className="h-3 w-3 text-green-500" />
        )}
        {saveInfo?.state === 'error' && (
          <AlertCircle className="h-3 w-3 text-red-400" />
        )}
      </div>

      {/* Input by type */}
      {field.type === 'timer' ? (
        <TimerField field={field} value={value} onChange={onChange} disabled={disabled} startBlockedReason={timerStartBlockedReason} />
      ) : field.type === 'enum' ? (
        <Select value={strVal || '__none__'} onValueChange={(v) => onChange(v === '__none__' ? '' : v)} disabled={disabled}>
          <SelectTrigger
            className={cn(
              'h-8 text-sm',
              isAbnormal && 'border-red-400 ring-1 ring-red-200',
            )}
          >
            <SelectValue placeholder="เลือกค่า..." />
          </SelectTrigger>
          <SelectContent>
            {/* onSelect fires on every selection (even same value) so the latest editor is always recorded */}
            <SelectItem value="__none__" onSelect={() => onChange('')}>— เลือก —</SelectItem>
            {(() => {
              const visible = visibleEnumOptions(field, item, itemGroupIds);
              const savedOutOfScope = strVal && !visible.includes(strVal);
              return (
                <>
                  {visible.map((opt) => (
                    <SelectItem key={opt} value={opt} onSelect={() => onChange(opt)}>{opt}</SelectItem>
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
        <PhotoField
          field={field}
          value={Array.isArray(value) ? value as string[] : []}
          onChange={onChange as (urls: string[]) => void}
          disabled={disabled}
        />
      ) : (
        <Input
          type={field.type === 'number' || field.type === 'float' ? 'number' : 'text'}
          step={field.type === 'float' ? 'any' : undefined}
          min={numericBounds?.min}
          max={numericBounds?.max}
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          // เลื่อนเมาส์ (wheel) ห้ามเปลี่ยนค่าตัวเลข — พิมพ์อย่างเดียว: blur ทิ้งโฟกัสตอน scroll
          onWheel={(e) => {
            if (field.type === 'number' || field.type === 'float') {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          disabled={disabled}
          className={cn(
            'h-8 text-sm',
            isAbnormal && 'border-red-400 ring-1 ring-red-200',
          )}
          placeholder={
            hideStandard ? undefined :
            field.standardOperator
              ? `มาตรฐาน: ${describeStandard(field)}`
              : field.standardValue != null
                ? `มาตรฐาน: ${field.standardValue}`
                : undefined
          }
        />
      )}

      {customText && (
        <p className="text-[11px] text-grey-600">ℹ️ {customText}</p>
      )}

      {outputResult && outputResult.text && (
        <p className={cn('text-[11px]', outputResult.kind === 'abnormal' ? 'text-red-600' : 'text-emerald-700')}>
          ผลลัพธ์: {outputResult.text}
        </p>
      )}

      {/* Live resolved-criterion line for conditionalMode fields */}
      {conditionalPending ? (
        <p className="text-[11px] text-amber-600">ยังกำหนดเกณฑ์ไม่ได้ — รอกรอกช่องเงื่อนไข</p>
      ) : !hideStandard && resolvedStandardText ? (
        <p className="text-[11px] text-emerald-600">เกณฑ์: {resolvedStandardText}</p>
      ) : null}

      {field.showLastBatch && lastBatchValue != null && String(lastBatchValue) !== "" && (
        <p className="text-[11px] text-sky-600">
          แบชก่อน{lastBatchLabel ? ` (${lastBatchLabel})` : ""}: {String(lastBatchValue)}{field.unit ? ` ${field.unit}` : ""}
        </p>
      )}
      <AiOutlierBadge result={outlierResult} />

      {/* Conditional note input — appears when enum value requires explanation */}
      {showNote && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 space-y-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-amber-800">
              คำอธิบาย / หมายเหตุ <span className="text-red-500">*</span>
            </label>
            {noteSaveInfo?.state === 'saving' && (
              <Loader2 className="h-3 w-3 animate-spin text-grey-400" />
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
            disabled={disabled}
            placeholder={`อธิบายเพิ่มเติมเมื่อเลือก "${strVal}"`}
            className="w-full text-sm rounded border border-amber-300 bg-white px-2 py-1 min-h-[60px] focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:bg-grey-50 disabled:cursor-not-allowed"
          />
          {noteSaveInfo?.state === 'saved' && noteSaveInfo.savedBy && (
            <p className="text-xs text-amber-700">
              กรอกโดย {noteSaveInfo.savedBy} เมื่อ {formatTime(noteSaveInfo.savedAt)}
            </p>
          )}
        </div>
      )}

      {/* who saved */}
      {saveInfo?.state === 'saved' && saveInfo.savedBy && (
        <p className="text-xs text-grey-400">
          กรอกโดย {saveInfo.savedBy} เมื่อ {formatTime(saveInfo.savedAt)}
        </p>
      )}
      {saveInfo?.state === 'error' && (
        <p className="text-xs text-red-400">บันทึกไม่สำเร็จ</p>
      )}
      {previousValue !== undefined && previousValue !== '' && previousValue !== null && (
        <p
          className={cn(
            'mt-1 inline-flex items-center gap-1.5 rounded border px-2 py-1 text-sm',
            !hideStandard && isFieldAbnormal(field, previousValue)
              ? 'border-red-300 bg-red-50 text-red-700'
              : 'border-grey-200 bg-grey-50 text-grey-700',
          )}
        >
          <span className="font-medium">ค่าเดิม:</span>
          <span className="font-mono font-semibold text-base">{String(previousValue)}</span>
          {!hideStandard && isFieldAbnormal(field, previousValue) && (
            <AlertTriangle className="h-4 w-4 text-red-500" />
          )}
        </p>
      )}
    </div>
  );
}

export default function QCTestingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editOverride = searchParams.get('edit') === '1';
  const overrideReason = searchParams.get('reason') || '';
  const returnPath = location.pathname.includes('/record-results/') ? `/record-results/${id}` : '/qc-testing';
  const { user } = useAuth();
  const canSeeRestrictedStandards = normalizeRoles(user).some((role) => role === 'admin' || role === 'qc-head');
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
  const pendingSample = pendingAdditionalSample(petition, 'qc');
  const roundsKey = JSON.stringify(petition?.additionalSampleRequests ?? []);
  const roundRequests = useMemo(() => JSON.parse(roundsKey) as AdditionalSampleRequest[], [roundsKey]);
  const resultsKey = id + ':' + roundsKey;
  const [loadedResultsKey, setLoadedResultsKey] = useState('');
  const resultLoad = useRef(0);
  const currentPetitionPhase = petition?.currentPhase ?? 1;
  const [selectedRoundPhases, setSelectedRoundPhases] = useState<Record<string, PetitionPhase>>({});
  const petitionCategory = getPetitionCategory(petition);
  // Active worklist for tab-strip switcher (other petitions currently in QC).
  // Apply the same routing/visibility rule as /qc-testing so petitions that are
  // active in another track do not appear only in this switcher.
  const { data: worklistData } = usePetitionList({
    status: 'pendingReview,inProgress',
    limit: 20,
  });
  const [allParameters, setAllParameters] = useState<ParameterItem[]>([]);
  const parameters = useMemo(() => allParameters.filter((parameter) => (parameter.scope ?? 'qc') === 'qc'), [allParameters]);
  const groupMembership = useItemGroupMembership();
  const idsFor = (it: Parameters<typeof itemGroupKey>[0]) =>
    groupMembership.get(itemGroupKey(it)) ?? [];
  const [savedResults, setSavedResults] = useState<QCTestResult[]>([]);
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [valuesPhase2, setValuesPhase2] = useState<Record<string, Record<string, unknown>>>({});
  // Local mirror of QCTestResult.entries for multiEntry params, keyed by resultKey.
  const [entriesByKey, setEntriesByKey] = useState<Record<string, Record<string, unknown>[]>>({});
  const [densityOptionsByKey, setDensityOptionsByKey] = useState<Record<string, string[]>>({});
  const [manualDensityKeys, setManualDensityKeys] = useState<Record<string, boolean>>({});
  // How many entry cards to show per multiEntry resultKey (user-driven via "เพิ่มรายการ").
  // Effective count = max(this, savedEntries.length, 1) — never hides saved data, always ≥1 empty form.
  const [entryRowCounts, setEntryRowCounts] = useState<Record<string, number>>({});
  // key: resultKey(itemSeq, parameterId) → { fieldLabel → FieldSaveInfo }
  const [saveStates, setSaveStates] = useState<Record<string, Record<string, FieldSaveInfo>>>({});
  const [saveStatesPhase2, setSaveStatesPhase2] = useState<Record<string, Record<string, FieldSaveInfo>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [wasReturned, setWasReturned] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<PetitionPhase>(1);
  const [previousLookup, setPreviousLookup] = useState<PreviousValueLookup>(new Map());
  const autosaves = useMemo(createResultAutosaveQueue, [id]);
  useEffect(() => () => { void autosaves.flush().catch(() => {}); }, [autosaves]);
  const [outlierResults, setOutlierResults] = useState<Record<string, OutlierCheckResult>>({});
  const [copyPasteWarnings, setCopyPasteWarnings] = useState<Record<string, boolean>>({});
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeText, setAnalyzeText] = useState('');

  // Load parameters and existing results (QC scope only)
  useEffect(() => {
    api.getParameters()
      .then(setAllParameters)
      .catch(() => {});
  }, []);

  useEffect(() => {
    getAiStatus().then((s) => setOllamaAvailable(s.available));
  }, []);

  // Auto-advance status pendingReview → inProgress when QC enters the first value
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

  // Resolve the predecessor petition for inline comparison.
  // Two paths: explicit (petition.revisionOf set via "ยื่นแก้ไขใหม่" button) OR
  // implicit (a rejected petition exists with same submitter employeeId + a
  // matching batchNo). QC sees the link either way; the submitter need not know.
  const [implicitPredecessorNo, setImplicitPredecessorNo] = useState<string | null>(null);
  useEffect(() => {
    if (!petition) {
      setPreviousLookup(new Map());
      setImplicitPredecessorNo(null);
      setWasReturned(false);
      return;
    }
    let alive = true;

    const loadFromPredecessor = async (predecessorId: string, predecessorNo?: string) => {
      try {
        const [prevPetition, prevResults] = await Promise.all([
          api.getPetition(predecessorId),
          api.getQCResults(predecessorId),
        ]);
        if (!alive) return;
        setPreviousLookup(buildPreviousValueLookup(prevPetition.items, prevResults));
        setImplicitPredecessorNo(predecessorNo ?? prevPetition.petitionNo ?? null);
        setWasReturned(true);
      } catch {
        if (alive) {
          setPreviousLookup(new Map());
          setImplicitPredecessorNo(null);
        }
      }
    };

    if (petition.revisionOf) {
      loadFromPredecessor(String(petition.revisionOf));
      return () => { alive = false; };
    }

    // No explicit revisionOf — try to detect via batch + submitter
    const submitterEmpId = petition.submittedBy?.employeeId?.trim();
    const batches = Array.from(
      new Set((petition.items ?? []).map((it) => it.batchNo?.trim()).filter((b): b is string => !!b)),
    );
    if (!submitterEmpId || batches.length === 0) {
      setPreviousLookup(new Map());
      setImplicitPredecessorNo(null);
      setWasReturned(false);
      return;
    }
    (async () => {
      try {
        const results = await Promise.all(
          batches.map((b) => api.findRejectedByBatch(b, submitterEmpId).catch(() => [] as typeof petition[])),
        );
        if (!alive) return;
        const flat = results.flat().filter((p) => p._id !== petition._id);
        if (flat.length === 0) {
          setPreviousLookup(new Map());
          setImplicitPredecessorNo(null);
          setWasReturned(false);
          return;
        }
        // Pick the most recently rejected (endpoint already sorts by rejectedAt desc)
        const predecessor = flat[0];
        await loadFromPredecessor(predecessor._id, predecessor.petitionNo);
      } catch {
        if (alive) {
          setPreviousLookup(new Map());
          setImplicitPredecessorNo(null);
          setWasReturned(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [petition?._id, petition?.revisionOf, petition?.submittedBy?.employeeId, petition?.items]);

  // Default the visible phase tab to the petition's current phase
  useEffect(() => {
    setSelectedPhase(currentPetitionPhase);
  }, [id, currentPetitionPhase]);

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
    if (!id || !parameters.length) return;
    void loadResults(id);
    return () => { resultLoad.current += 1; };
  }, [id, loadResults, parameters.length]);

  const handleFieldChange = useCallback(
    (
      petition: Petition,
      item: PetitionItem,
      param: ParameterItem,
      fieldLabel: string,
      newVal: unknown,
      phase: PetitionPhase = 1,
    ) => {
      if (pendingAdditionalSample(petition, 'qc') || additionalSampleOpen || submitting) return;
      if (phase === 2 && ((sampleRoundFor(petition, 'qc', item.seq) ?? petition).currentPhase ?? 1) === 1) return;
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
            sampleRoundId: sampleRoundIdFor(petition, 'qc', item.seq),
            sampleId: item.sampleId,
            sampleName: item.sampleName,
            commonName: item.commonName,
            parameterId: param._id!,
            parameterName: param.name,
            fieldLabel,
            value: newVal,
            enteredBy: {
              name: user?.name ?? 'Unknown',
              email: user?.email ?? '',
            },
            overrideReason: overrideReason || undefined,
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
    [user, advanceToInProgress, autosaves, additionalSampleOpen, submitting],
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
      if (pendingAdditionalSample(petition, 'qc') || additionalSampleOpen || submitting) return;
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
            sampleRoundId: sampleRoundIdFor(petition, 'qc', item.seq),
            sampleId: item.sampleId,
            sampleName: item.sampleName,
            commonName: item.commonName,
            parameterId: param._id!,
            parameterName: param.name,
            fieldLabel,
            value: newVal,
            entryIndex,
            enteredBy: { name: user?.name ?? 'Unknown', email: user?.email ?? '' },
            overrideReason: overrideReason || undefined,
          });
          if (id) await loadResults(id);
        } catch (error) {
          toast.error('บันทึกค่าไม่สำเร็จ');
          throw error;
        }
      }, k);
    },
    [user, advanceToInProgress, id, loadResults, autosaves, additionalSampleOpen, submitting],
  );

  // multiEntry remove: trim entry `entryIndex` then persist the whole array.
  const handleRemoveEntry = useCallback(
    async (
      petition: Petition,
      item: PetitionItem,
      param: ParameterItem,
      entryIndex: number,
    ) => {
      if (pendingAdditionalSample(petition, 'qc') || additionalSampleOpen || submitting) return;
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
            sampleRoundId: sampleRoundIdFor(petition, 'qc', item.seq),
            sampleId: item.sampleId,
            sampleName: item.sampleName,
            commonName: item.commonName,
            parameterId: param._id!,
            parameterName: param.name,
            entries: trimmed,
            enteredBy: { name: user?.name ?? 'Unknown', email: user?.email ?? '' },
            overrideReason: overrideReason || undefined,
          });
        });
        if (id) await loadResults(id);
      } catch {
        toast.error('ลบรายการไม่สำเร็จ');
      }
    },
    [user, entriesByKey, id, loadResults, autosaves, additionalSampleOpen, submitting],
  );

  // Density sync: replace the SG param's entries with the selected valid
  // Result-Density row (Density + T block; T set lives in provenance only).
  const applyDensityRows = useCallback(
    async (
      petition: Petition,
      item: PetitionItem,
      param: ParameterItem,
      docs: Record<string, unknown>[],
    ) => {
      if (pendingAdditionalSample(petition, 'qc') || additionalSampleOpen || submitting) return;
      const k = resultKey(item.seq, param._id!);
      const fetchedAt = new Date().toISOString();
      const sgValueField = (param.valueFields ?? []).find((field) => field.label === SG_VALUE_LABEL || field.label.startsWith(`${SG_VALUE_LABEL} —`));
      const sgValueKeys = sgValueField
        ? expandFieldForItem(sgValueField, item.commonName, { category: petitionCategory }).map((unit) => unit.key)
        : [SG_VALUE_LABEL];
      const rows = docs.map((d) => densityRowToEntry(d, fetchedAt, sgValueKeys));
      setEntriesByKey((prev) => ({ ...prev, [k]: rows.map((e) => ({ ...e })) }));
      setEntryRowCounts((c) => ({ ...c, [k]: Math.max(rows.length, 1) }));
      advanceToInProgress();
      try {
        await autosaves.run(k, async () => {
          await api.saveQCEntries({
            petitionId: petition._id!,
            petitionNo: petition.petitionNo,
            itemSeq: item.seq,
            sampleRoundId: sampleRoundIdFor(petition, 'qc', item.seq),
            sampleId: item.sampleId,
            sampleName: item.sampleName,
            commonName: item.commonName,
            parameterId: param._id!,
            parameterName: param.name,
            entries: rows,
            enteredBy: { name: user?.name ?? 'Unknown', email: user?.email ?? '' },
            overrideReason: overrideReason || undefined,
          });
        });
        if (id) await loadResults(id);
      } catch {
        toast.error('บันทึกค่าไม่สำเร็จ');
      }
    },
    [user, advanceToInProgress, id, loadResults, petitionCategory, autosaves, additionalSampleOpen, submitting],
  );

  const handleOutlierCheck = useCallback(
    async (
      commonName: string,
      parameterId: string,
      fieldLabel: string,
      value: unknown,
      fieldType: string,
    ) => {
      if (fieldType !== 'number' && fieldType !== 'float') return;
      const num = Number(value);
      if (isNaN(num) || value === '' || value == null) return;
      const result = await checkOutlier({ commonName, parameterId, fieldLabel, value: num });
      const key = `${parameterId}__${fieldLabel}`;
      setOutlierResults((prev) => ({ ...prev, [key]: result }));
    },
    [],
  );

  // ── Feature B: last-batch reference values (display-only) ──────────────────
  // Build the unique (commonName, parameterId) pairs that need a prior-batch
  // lookup: only params that have at least one field with showLastBatch and a
  // truthy commonName. Deduped on commonName+parameterId since last-values only
  // depends on those two.
  const lastBatchPairs = useMemo(() => {
    if (!petition) return [] as { commonName: string; parameterId: string }[];
    const seen = new Set<string>();
    const pairs: { commonName: string; parameterId: string }[] = [];
    (petition.items ?? []).forEach((item) => {
      const commonName = item.commonName?.trim();
      if (!commonName) return;
      const matched = matchParametersForItem(item, parameters, idsFor(item), { petitionCategory });
      matched.forEach((param) => {
        if (!param._id) return;
        const hasLastBatchField = (param.valueFields ?? []).some((f) => f.showLastBatch);
        if (!hasLastBatchField) return;
        const parameterId = String(param._id);
        const dedupeKey = `${commonName}__${parameterId}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        pairs.push({ commonName, parameterId });
      });
    });
    return pairs;
    // idsFor is a render-scoped closure over groupMembership; we depend on
    // groupMembership directly so the pair list recomputes once membership
    // resolves (listing idsFor would defeat memoization).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petition, parameters, groupMembership]);

  const lastBatchQueries = useQueries({
    queries: lastBatchPairs.map((p) => ({
      queryKey: ['qc-last-values', p.commonName, p.parameterId, id],
      queryFn: () => api.getLastBatchValues(p.commonName, p.parameterId, id ?? ''),
      staleTime: 5 * 60 * 1000,
      enabled: !!p.commonName && !!id,
    })),
  });

  const lastBatchByKey = useMemo(() => {
    const map = new Map<string, { petitionNo?: string; values?: Record<string, unknown> } | undefined>();
    lastBatchPairs.forEach((p, i) => {
      map.set(`${p.commonName}__${p.parameterId}`, lastBatchQueries[i]?.data);
    });
    return map;
  }, [lastBatchPairs, lastBatchQueries]);

  // Detect copy-paste: warn when all numeric field values match the last batch exactly
  useEffect(() => {
    const warnings: Record<string, boolean> = {};
    // values keys look like `${itemSeq}__${parameterId}`
    Object.entries(values).forEach(([rKey, fieldValues]) => {
      const matchingEntry = [...lastBatchByKey.entries()].find(([lbKey]) => {
        // lbKey = `${commonName}__${parameterId}`
        // rKey = `${itemSeq}__${parameterId}` — extract parameterId (last segment)
        const parts = rKey.split('__');
        const paramId = parts[parts.length - 1];
        return lbKey.endsWith(`__${paramId}`);
      });
      if (!matchingEntry) return;
      const lastBatchValues = matchingEntry[1]?.values ?? {};

      // Get all numeric fields that have values
      const numericPairs = Object.entries(fieldValues as Record<string, unknown>).filter(([, v]) => {
        const n = Number(v);
        return v !== '' && v != null && !isNaN(n);
      });
      if (numericPairs.length < 2) return; // need at least 2 fields to flag

      const allMatch = numericPairs.every(([label, val]) => {
        const lastVal = lastBatchValues[label];
        return lastVal != null && String(lastVal) === String(val);
      });
      if (allMatch) warnings[rKey] = true;
    });
    // Bail when the warning set is unchanged. `lastBatchByKey` is a fresh ref on
    // every render (its useMemo depends on the useQueries result array, which is
    // never referentially stable), so this effect re-runs each render — committing
    // a brand-new `warnings` object every time would set state → re-render → loop
    // ("Maximum update depth exceeded"). Returning the previous object when the
    // content matches keeps the reference stable and breaks the cycle.
    setCopyPasteWarnings((prev) => {
      const nextKeys = Object.keys(warnings);
      const prevKeys = Object.keys(prev);
      if (nextKeys.length === prevKeys.length && nextKeys.every((k) => prev[k] === warnings[k])) {
        return prev;
      }
      return warnings;
    });
  }, [values, lastBatchByKey]);

  if (petitionLoading && !petition) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      </AppLayout>
    );
  }

  if (petitionError || !petition) {
    return (
      <AppLayout>
        <div className="text-center text-grey-500">
          {petitionError || 'ไม่พบข้อมูลคำร้อง'}
        </div>
      </AppLayout>
    );
  }

  const items = mergeQcLabDuplicateItems(petition, petition.items ?? []);

  // 2-phase support
  // รอบตรวจซ้ำ (Phase 2) เป็นของรายการที่มี parameter trigger เช่น อบ 14 วัน เท่านั้น — รายการอื่นในใบเดียวกันจบที่ Phase 1
  // ดูจาก parameter ทุกฝั่ง เพราะตัวอบอาจตั้งไว้ฝั่ง Lab แต่ QC ต้องตรวจ parameter เดิมของตัวเองซ้ำด้วย
  const itemHasPhasedParam = (item: PetitionItem) =>
    matchParametersForItem(item, allParameters.filter((p) => p.hasPhases), idsFor(item), { petitionCategory }).length > 0;
  const hasAnyPhasedParam = items.some(itemHasPhasedParam);
  const currentPhase: PetitionPhase = (petition.currentPhase ?? 1) as PetitionPhase;
  const effectivePhaseForItem = (item: PetitionItem): PetitionPhase => {
    if (!itemHasPhasedParam(item)) return 1;
    const round = sampleRoundFor(petition, 'qc', item.seq);
    return round ? selectedRoundPhases[round._id + ':' + item.seq] ?? round.currentPhase ?? 1 : selectedPhase;
  };

  const visibleFields = (param: ParameterItem, phase: PetitionPhase, item: PetitionItem): ParameterValueField[] => {
    const phaseState = sampleRoundFor(petition, param.scope ?? 'qc', item.seq) ?? petition;
    return visibleFieldsForPhase(param, phase, phaseState.phase2TriggeredBy?.parameterId);
  };

  const valuesForPhase = (phase: PetitionPhase) => (phase === 2 ? valuesPhase2 : values);
  const savesForPhase = (phase: PetitionPhase) => (phase === 2 ? saveStatesPhase2 : saveStates);

  // ต้องกรอกค่าก่อนอบ (Phase 1) ของรายการให้ครบก่อนเริ่มจับเวลาตัว trigger เช่น อบ 14 วัน
  const phaseTriggerReasonFor = (item: PetitionItem): string | undefined =>
    phaseTriggerBlockedReason(missingValuesBeforePhaseTrigger(
      matchParametersForItem(item, parameters, idsFor(item), { petitionCategory }),
      (param) => {
        const k = resultKey(item.seq, param._id!);
        return param.multiEntry ? getEntryValues({ entries: entriesByKey[k] }, param) : [values[k] ?? {}];
      },
      (field) => expandFieldForItem(field, item.commonName, { includeRestrictedStandards: canSeeRestrictedStandards, category: petitionCategory }),
    ));

  // current array value for a `multiple` field (always returns an array for editing)
  const readMultiple = (values: Record<string, unknown> | undefined, label: string): unknown[] => {
    const v = values?.[label];
    return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
  };

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
      expandFieldForItem(field, item.commonName, { includeRestrictedStandards: canSeeRestrictedStandards, category: petitionCategory }).forEach((unit) => {
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
    items.forEach((item) => {
      const matched = matchParametersForItem(item, parameters, idsFor(item), { petitionCategory });
      matched.forEach((param) => {
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
        if (hasAnyPhasedParam) {
          const p2Values = valuesPhase2[k] ?? {};
          count += countAbnormalInValues(visibleFields(param, 2, item), item, p2Values, param._id!, 2);
        }
      });
    });
    return count;
  };
  const abnormalCount = countAbnormal();

  const validate = (): string[] => {
    const missing: string[] = [];
    items.forEach((item) => {
      const phaseToCheck = effectivePhaseForItem(item);
      const phaseValues = valuesForPhase(phaseToCheck);
      const matched = matchParametersForItem(item, parameters, idsFor(item), { petitionCategory });
      matched.forEach((param) => {
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
          expandFieldForItem(field, item.commonName, { includeRestrictedStandards: canSeeRestrictedStandards, category: petitionCategory }).forEach((unit) => {
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
  const isComplete = validate().length === 0;

  const handleSaveDraft = async () => {
    if (pendingSample || submitting) return;
    setSubmitting(true);
    try {
      await autosaves.flush();
      toast.success(petition.qcCompletedAt ? 'บันทึกการแก้ไขผล QC เรียบร้อย' : 'บันทึกแบบร่างเรียบร้อย');
      navigate(returnPath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกผลไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitResult = async () => {
    if (pendingSample || submitting || additionalSampleOpen || loadedResultsKey !== resultsKey) return;
    const missing = validate();
    if (missing.length > 0) {
      toast.error('กรอกข้อมูลไม่ครบ', {
        description: `ขาด ${missing.length} ช่อง:\n${missing.slice(0, 5).join('\n')}${missing.length > 5 ? `\n…และอีก ${missing.length - 5}` : ''}`,
      });
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
      const updated = await api.completePetitionTrack(petition._id, 'qc', user?.name ?? 'system');
      toast.success(
        updated.status === 'success'
          ? 'บันทึกผล QC เรียบร้อย — ส่งให้หัวหน้า QC ยืนยัน'
          : 'บันทึกผล QC เรียบร้อย — รอ Lab ตรวจให้ครบ',
      );
      navigate(returnPath);
    } catch {
      toast.error('บันทึกผลไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  // Final approval/rejection locks the QC form; submitted results remain editable.
  const isLocked = (!editOverride && ['approved', 'rejected'].includes(petition.status)) || !!pendingSample;
  const hasSubmittedQc = !!petition.qcCompletedAt;

  return (
    <AppLayout title={petition.petitionNo}>
    <div className={`space-y-6 pb-20 ${flashClass}`}>
      {/* Header */}
      <PageHeader
        onBack={() => navigate(returnPath)}
        title={
          <span className="inline-flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary-500" />
            {petition.petitionNo}
          </span>
        }
        actions={
          <span className="text-sm text-grey-500">
            ผู้นำส่ง: {petition.submittedBy?.name ?? '-'}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="blue-soft">{petitionDepartmentLabel(petition)}</Badge>
        {wasReturned && (
          <span
            className="inline-flex items-center text-orange-500"
            title={implicitPredecessorNo
              ? `อ้างอิงจากคำร้อง ${implicitPredecessorNo} (batch เดิม)`
              : 'ส่งกลับมาบันทึกผลใหม่'}
            aria-label="คำร้องแก้ไข"
          >
            <RotateCcw className="h-4 w-4" />
          </span>
        )}
        {abnormalCount > 0 && (
          <span
            className="inline-flex items-center text-red-500"
            title={`พบค่าผิดปกติ ${abnormalCount} รายการ`}
            aria-label={`พบค่าผิดปกติ ${abnormalCount} รายการ`}
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
        )}
      </div>

      {wasReturned && implicitPredecessorNo && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 flex items-center gap-2 -mt-2">
          <RotateCcw className="h-4 w-4 text-orange-500 shrink-0" />
          <p className="text-sm text-orange-800">
            คำร้องนี้ใช้เลขแบชเดียวกับคำร้อง{' '}
            <button
              type="button"
              onClick={() => navigate(`/petition/${implicitPredecessorNo}`)}
              className="font-semibold underline hover:text-orange-900"
            >
              {implicitPredecessorNo}
            </button>{' '}
            ที่เคยถูกส่งให้แก้ไข — ค่าเดิมแสดงใต้แต่ละช่อง
          </p>
        </div>
      )}

      {/* Active worklist tab strip — switch between petitions currently in QC */}
      {worklistData && worklistData.items.filter(isVisibleInQcTestingQueue).length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mt-2">
          <span className="text-xs text-grey-500 shrink-0 mr-1">สลับไป:</span>
          {worklistData.items.filter(isVisibleInQcTestingQueue).map((p) => {
            const isActive = p._id === petition._id;
            return (
              <button
                key={p._id}
                type="button"
                onClick={() => navigate(`/qc-testing/${p._id}`, { state: { petition: p } })}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border transition-colors',
                  isActive
                    ? 'bg-primary-500 text-white border-primary-500 cursor-default'
                    : 'bg-white text-grey-700 border-grey-200 hover:border-primary-300 hover:bg-primary-50',
                )}
                disabled={isActive}
                title={`${petitionDepartmentLabel(p)} · ${p.items?.length ?? 0} รายการ`}
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    p.status === 'inProgress' ? 'bg-amber-400' : 'bg-blue-400',
                  )}
                />
                <span className="font-semibold">{p.petitionNo}</span>
                <span className={cn(isActive ? 'text-white/80' : 'text-grey-400')}>
                  ·{p.items?.length ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 && (
        <div className="text-center py-12 text-grey-400">ไม่มีรายการตัวอย่างในคำร้องนี้</div>
      )}

      {hasAnyPhasedParam && items.some((item) => !sampleRoundFor(petition, 'qc', item.seq)) && (
        <PhaseBanner
          currentPhase={currentPhase}
          selectedPhase={selectedPhase}
          onSelectPhase={setSelectedPhase}
          phase2DueAt={petition.phase2DueAt}
          phase2UnlockedAt={petition.phase2UnlockedAt}
          triggeredByName={petition.phase2TriggeredBy?.parameterName}
        />
      )}

      {ollamaAvailable && (
        <div className="mb-4 space-y-2">
          <button
            type="button"
            disabled={analyzeLoading}
            onClick={async () => {
              setAnalyzeLoading(true);
              setAnalyzeText('');
              try {
                await streamAnalyzeQC(id!, (chunk) => {
                  setAnalyzeText((prev) => prev + chunk);
                });
              } catch {
                setAnalyzeText('(เกิดข้อผิดพลาด — กรุณาลองใหม่)');
              } finally {
                setAnalyzeLoading(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-100 border border-violet-200 disabled:opacity-50"
          >
            {analyzeLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            วิเคราะห์ผล (AI)
          </button>

          {analyzeText && (
            <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 whitespace-pre-wrap">
              {analyzeText}
            </div>
          )}
        </div>
      )}

      {/* Each item */}
      {items.map((item) => {
        const matchedParams = matchParametersForItem(item, parameters, idsFor(item), { petitionCategory });
        const round = sampleRoundFor(petition, 'qc', item.seq);
        const itemCurrentPhase = (round ?? petition).currentPhase ?? 1;
        const effectivePhase = effectivePhaseForItem(item);
        const phaseValues = valuesForPhase(effectivePhase);
        const phaseSaves = savesForPhase(effectivePhase);
        const phaseLocked = effectivePhase === 2 && itemCurrentPhase === 1;
        return (
          <Card key={item.seq} className={`overflow-hidden${/[16]$/.test(String(item.batchNo ?? '').trim()) ? ' border-blue-300' : ''}`}>
            <CardHeader className={`pb-3 ${/[16]$/.test(String(item.batchNo ?? '').trim()) ? 'bg-blue-50' : 'bg-grey-50'}`}>
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <span>รายการที่ {item.seq}: {item.sampleName || '-'}</span>
                {/[16]$/.test(String(item.batchNo ?? '').trim()) && (
                  <Badge variant="blue-soft" className="font-normal text-xs">
                    ผล Lab
                  </Badge>
                )}
                {item.batchNo && (
                  <Badge variant="gray-soft" className="font-normal">
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
                <p className="text-xs text-grey-500 mt-1">
                  รายการทดสอบ: {item.testItems}
                </p>
              )}
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
              {matchedParams.length === 0 ? (
                <p className="text-sm text-grey-400 italic">
                  ไม่พบพารามิเตอร์ที่ตรงกับรายการทดสอบ
                  {!item.testItems && ' (ไม่ได้ระบุ testItems)'}
                </p>
              ) : (
                matchedParams.map((param) => {
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
                  const lastBatch = lastBatchByKey.get(`${item.commonName}__${String(param._id)}`);
                  const fieldDisabled = isLocked || phaseLocked || additionalSampleOpen || submitting || loadedResultsKey !== resultsKey;

                  // Render a single render-unit (one field, or one substance slice).
                  // `srcValues` is the value-object to read/display from; `onUnitChange`
                  // and `onUnitNoteChange` persist a write. For multiEntry params these
                  // target an entry value-object; otherwise the flat phase dict.
                  const renderUnit = (
                    unit: RenderFieldUnit,
                    srcValues: Record<string, unknown>,
                    onUnitChange: (label: string, val: unknown) => void,
                    saveInfoSrc: Record<string, FieldSaveInfo> | undefined,
                  ) => {
                    const noteLabel = noteLabelFor(unit.key);
                    const effectiveField = unit.field.conditionalMode
                      ? resolveFieldStandard(unit.field, condCtx)
                      : unit.field;
                    const resolved = unit.field.conditionalMode
                      ? resolveStandard(unit.field, condCtx)
                      : null;
                    const isOutputMode = unit.field.conditionalMode && unit.field.conditionalResult === 'output';
                    const outputResult = isOutputMode ? resolveConditionalOutput(unit.field, condCtx) : null;
                    const isAiParameter = (param.valueFields ?? []).some((candidate) => calculatedAiFieldKind(candidate.label) === 'ai');
                    const aiFieldKind = isAiParameter ? calculatedAiFieldKind(unit.field.label) : null;
                    const calculatedAi = aiFieldKind ? calculateAi(srcValues, aiDensity(srcValues, condCtx, aiSubstanceFromKey(unit.key), densityEntries), aiSubstanceFromKey(unit.key)) : null;
                    const beforeRef =
                      param.hasPhases &&
                      effectivePhase === 2 &&
                      (unit.field.phase ?? 'both') === 'both'
                        ? (values[k]?.[unit.key] ?? '')
                        : null;
                    const resolvedStandardText = resolved
                      ? `${describeResolvedStandard(resolved, unit.field.unit ?? '')}${resolved.matchedRuleLabel ? ` (${resolved.matchedRuleLabel})` : ''}`
                      : undefined;
                    const lastBatchValue = unit.field.showLastBatch
                      ? lastBatch?.values?.[unit.field.label]
                      : undefined;

                    // Specific-gravity (ค่า ถพ.) value + temperature are filled only by
                    // validated Result-Density rows, never typed by hand.
                    const sgValueField = (param.valueFields ?? []).find((f) => f.label === SG_VALUE_LABEL || f.label.startsWith(`${SG_VALUE_LABEL} —`));
                    const isSgMachineField =
                      sgValueField?.requestValueSource?.mode === 'collection' &&
                      !!sgValueField &&
                      isSgMachineUnitKey(unit.key, unit.field.label);
                    // ค่า ถพ. เลือก/แก้ได้; อุณหภูมิยังคงอ่านจากเครื่องและล็อกไว้
                    const isSgValueUnit = (
                      unit.field.label.trim().startsWith(SG_VALUE_LABEL) ||
                      (param.name ?? '').includes('ถพ.')
                    ) && !unit.field.label.includes(SG_TEMP_LABEL);
                    const unitDisabled = fieldDisabled || !!aiFieldKind || (isSgMachineField && !isSgValueUnit);
                    const densityOptions = densityOptionsByKey[resultKey(item.seq, param._id!) ] ?? [];
                    // Match by label too: legacy SG parameters may not carry requestValueSource.
                    const densityValue = srcValues[unit.key] == null ? '' : String(srcValues[unit.key]);
                    const densityControlKey = `${resultKey(item.seq, param._id!)}::${unit.key}`;
                    const densityChoices = densityValue && !densityOptions.includes(densityValue)
                      ? [...densityOptions, densityValue]
                      : densityOptions;
                    const isManualDensity = isSgValueUnit &&
                      (manualDensityKeys[densityControlKey] || (!!densityValue && densityOptions.length > 0 && !densityOptions.includes(densityValue)));

                    if (isSgValueUnit) {
                      const densityControlDisabled = additionalSampleOpen || submitting;
                      return (
                        <div key={unit.key} className="space-y-1">
                          <label className="text-sm font-medium text-grey-700">{unit.field.label}{unit.field.unit && <span className="text-grey-400 font-normal ml-1">({unit.field.unit})</span>}</label>
                          <Select value={isManualDensity ? '__manual__' : densityValue || '__none__'} onValueChange={(v) => {
                            if (v === '__manual__') {
                              setManualDensityKeys((prev) => ({ ...prev, [densityControlKey]: true }));
                              onUnitChange(unit.key, '');
                            } else if (v !== '__none__') {
                              setManualDensityKeys((prev) => ({ ...prev, [densityControlKey]: false }));
                              onUnitChange(unit.key, v);
                            }
                          }} disabled={densityControlDisabled}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="เลือกค่า ถพ. ..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— เลือก —</SelectItem>
                              {densityChoices.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                              <SelectItem value="__manual__">กรอกค่าเอง</SelectItem>
                            </SelectContent>
                          </Select>
                          {isManualDensity && <Input type="number" step="0.001" value={densityValue} onChange={(e) => onUnitChange(unit.key, e.target.value)} disabled={densityControlDisabled} className="h-8 text-sm" placeholder="กรอกค่า ถพ. 3 ตำแหน่ง" />}
                        </div>
                      );
                    }

                    // Field-level `multiple` — repeatable list of inputs sharing the
                    // same markup. The field value is the WHOLE array.
                    if (unit.field.multiple) {
                      // Repeatable (multiple) fields render bare value rows: per-row save
                      // stamps, outlier checks, last-batch hint and before/after reference
                      // (resolvedStandardText / lastBatchValue / beforeRef computed above for
                      // the scalar path) are intentionally omitted here — each row is a plain
                      // value sharing the field's standard/abnormal rule.
                      const arr = readMultiple(srcValues, unit.key);
                      const rows = [...arr, '']; // trailing empty row to add the next value
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
                        <div key={unit.key} className="space-y-2 rounded-md border border-grey-200 p-2">
                          <p className="text-sm font-medium text-grey-700">
                            {unit.field.label}
                            {unit.field.unit && <span className="text-grey-400 font-normal ml-1">({unit.field.unit})</span>}
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
                                    hideStandard={(unit as { hiddenStandard?: boolean }).hiddenStandard === true}
                                    disabled={unitDisabled}
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

                    return (
                      <div key={unit.key} className={aiGridClass(unit.field.label)}>
                        <TestField
                          field={effectiveField}
                          item={item}
                          itemGroupIds={idsFor(item)}
                          value={aiFieldKind ? (calculatedAi?.[aiFieldKind] != null ? formatCalculatedAi(calculatedAi[aiFieldKind]) : aiFieldKind === 'ai' && calculatedAi?.sampleAverage != null ? '' : srcValues[unit.key] ?? '') : srcValues[unit.key] ?? ''}
                          noteValue={srcValues[noteLabel] ?? ''}
                          hideStandard={(unit as { hiddenStandard?: boolean }).hiddenStandard === true}
                          saveInfo={saveInfoSrc?.[unit.key]}
                          noteSaveInfo={saveInfoSrc?.[noteLabel]}
                          disabled={unitDisabled}
                          timerStartBlockedReason={unit.field.triggersPhase2 && effectivePhase === 1 ? phaseTriggerReasonFor(item) : undefined}
                          onChange={(val) => {
                            if (aiFieldKind) return;
                            onUnitChange(unit.key, val);
                            if (isAiParameter) {
                              const nextValues = { ...srcValues, [unit.key]: val };
                              fields.forEach((candidate) => {
                                const kind = calculatedAiFieldKind(candidate.label);
                                if (!kind) return;
                                expandFieldForItem(candidate, item.commonName, { includeRestrictedStandards: canSeeRestrictedStandards, category: petitionCategory })
                                  .forEach((derivedUnit) => {
                                    const substance = aiSubstanceFromKey(derivedUnit.key);
                                    onUnitChange(derivedUnit.key, formatCalculatedAi(calculateAi(nextValues, aiDensity(nextValues, condCtx, substance, densityEntries), substance)[kind]));
                                  });
                              });
                            }
                            handleOutlierCheck(
                              item.commonName ?? '',
                              String(param._id),
                              unit.field.label,
                              val,
                              unit.field.type,
                            );
                          }}
                          onNoteChange={(val) => onUnitChange(noteLabel, val)}
                          previousValue={getPreviousValue(previousLookup, item, param._id!, unit.key)}
                          conditionalPending={isOutputMode ? false : (!!unit.field.conditionalMode && !resolved)}
                          resolvedStandardText={isOutputMode ? undefined : resolvedStandardText}
                          lastBatchValue={lastBatchValue}
                          lastBatchLabel={lastBatch?.petitionNo}
                          outlierResult={outlierResults[`${String(param._id)}__${unit.field.label}`]}
                          outputResult={outputResult}
                        />
                        {unit.labelTolerance && (() => {
                          const rv = resolveLabelTolerance(unit.labelTolerance.std, unit.labelTolerance.rawSpec, srcValues[unit.key]);
                          const badge = labelToleranceBadge(rv.status, rv.center);
                          return (
                            <div className="mt-1 space-y-0.5">
                              <p className="text-xs text-muted-foreground whitespace-pre-line">{formatLabelToleranceRange(rv, unit.field.unit ?? '', { showAutoPass: true, multiline: true, autoPassLabel: 'ผ่านเกณฑ์ 25%' })}</p>
                              {badge && <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${badge.cls}`}>{badge.text}</span>}
                            </div>
                          );
                        })()}
                        {aiFieldKind === 'ai' && calculatedAi?.sampleAverage != null && calculatedAi.ai == null && (
                          <p className="mt-1 text-xs text-muted-foreground">รอค่า ถพ.</p>
                        )}
                        {beforeRef != null && beforeRef !== '' ? (
                          <p className="text-[10px] text-grey-400 mt-0.5">
                            ก่อน: <span className="font-mono">{String(beforeRef)}</span>
                          </p>
                        ) : null}
                      </div>
                    );
                  };

                  // Render the field-grid for one value-object (one entry or the flat dict).
                  const renderGrid = (
                    srcValues: Record<string, unknown>,
                    onUnitChange: (label: string, val: unknown) => void,
                    saveInfoSrc: Record<string, FieldSaveInfo> | undefined,
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
                        const units = expandFieldForItem(field, item.commonName, { includeRestrictedStandards: canSeeRestrictedStandards, category: petitionCategory });
                        return units.map((unit) => renderUnit(unit, srcValues, onUnitChange, saveInfoSrc));
                      })}
                    </div>
                  );

                  return (
                    <div key={param._id} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-grey-800 border-b pb-1 flex-1">
                          {param.name}
                        </h3>
                        {param.hasPhases && (
                          <Badge className="bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase hover:bg-amber-100">
                            Phase {effectivePhase}
                          </Badge>
                        )}
                        {param.note && (
                          <span className="text-xs text-grey-400">{param.note}</span>
                        )}
                      </div>
                      {copyPasteWarnings[k] && (
                        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 mb-2">
                          <span>🔔</span>
                          <span>ค่าทุกตัวเหมือน batch ก่อนหน้า — กรุณาตรวจสอบว่าไม่ได้ copy ค่าเดิม</span>
                        </div>
                      )}
                      {param.multiEntry ? (
                        (() => {
                          // Per-entry rendering. Saved entries come from entries[]; the
                          // number of cards shown is user-driven (เพิ่มรายการ), never auto.
                          const savedRows = entriesByKey[k] ?? [];
                          const isSgParam = (param.valueFields ?? []).some(
                            (f) => f.label === SG_VALUE_LABEL || f.label.startsWith(`${SG_VALUE_LABEL} —`),
                          );
                          const sgTempField = (param.valueFields ?? []).find(
                            (f) => f.label === SG_TEMP_LABEL,
                          );
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
                              {isSgParam && !fieldDisabled && (
                                <div>
                                  <DensitySyncButton
                                    batchNo={item.batchNo?.trim() ?? ''}
                                    onRows={(docs) => applyDensityRows(petition, item, param, docs)}
                                    onOptions={(docs) => {
                                      const options = Array.from(new Set(docs.map((doc) => formatDensity3(doc)).filter(Boolean)));
                                      setDensityOptionsByKey((prev) => ({ ...prev, [k]: options }));
                                    }}
                                  />
                                </div>
                              )}
                              {Array.from({ length: shown }, (_, ei) => {
                                const entryValues = savedRows[ei] ?? {};
                                // allow remove when there's more than one card, or this card holds saved data
                                const canRemove = !fieldDisabled && (shown > 1 || ei < savedCount);
                                return (
                                  <div key={ei} className="rounded-lg border border-grey-200 p-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-grey-600 flex-1">
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
                                    {renderGrid(
                                      entryValues,
                                      (label, val) => handleEntryFieldChange(petition, item, param, ei, label, val),
                                      undefined,
                                    )}
                                    {isSgParam && (() => {
                                      const src = entryValues['อุณหภูมิ__source'] as
                                        | { tSet?: unknown }
                                        | undefined;
                                      const cmp = formatTSetComparison(
                                        src?.tSet,
                                        sgTempField?.standardValue,
                                      );
                                      if (!cmp) return null;
                                      return (
                                        <p
                                          className={`text-[11px] ${
                                            cmp.status === 'differ'
                                              ? 'text-amber-600'
                                              : 'text-emerald-600'
                                          }`}
                                        >
                                          {cmp.text}
                                        </p>
                                      );
                                    })()}
                                  </div>
                                );
                              })}
                              {!fieldDisabled && !isSgParam && (
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
                        })()
                      ) : (
                        renderGrid(
                          phaseValues[k] ?? {},
                          (label, val) => handleFieldChange(petition, item, param, label, val, effectivePhase),
                          phaseSaves[k],
                        )
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Read-only banner — QC track submitted, page locked while Lab finishes.
          status==='success' redirects to qc-approval above, so this is the
          waiting-for-Lab state. Hides the action footer so the locked page is a
          clean read-only view (back/nav stay usable) instead of a dead end. */}
      {hasSubmittedQc && !pendingSample && petition.status !== 'approved' && petition.status !== 'rejected' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex flex-col items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-blue-500" />
          <p className="text-sm font-semibold text-blue-700">
            บันทึกผล QC แล้ว — รอ Lab ตรวจให้ครบ
          </p>
          <p className="text-xs text-blue-600">
            ยังไม่มีการอนุมัติ QC — สามารถแก้ไขผลแล้วกดบันทึกได้
          </p>
        </div>
      )}

      <AdditionalSampleRequestDialog
        key={petition._id}
        petition={petition}
        side="qc"
        items={items.filter((item) => matchParametersForItem(item, parameters, idsFor(item), { petitionCategory }).length > 0)}
        open={additionalSampleOpen}
        onOpenChange={setAdditionalSampleOpen}
        beforeSubmit={autosaves.flush}
        onRequested={setRequestedPetition}
      />

      {pendingSample && (
        <div role="status" className="rounded-lg border bg-card p-4 space-y-2">
          <Badge variant="yellow-soft">รอรับตัวอย่างเพิ่ม (QC)</Badge>
          <p className="text-sm text-muted-foreground">{pendingSample.reason} — ยังแก้ไขหรือปิดผลตรวจฝั่ง QC ไม่ได้จนกว่าจะรับรอบนี้</p>
        </div>
      )}

      {/* Action buttons stay available until final approval. */}
      {items.length > 0 && !isLocked && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:left-72 px-4 sm:px-6 py-3 bg-white border-t shadow-[0_-4px_20px_rgba(0,0,0,0.08)] flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {qcReceivedAt(petition) && (
            <Button variant="outline" onClick={() => setAdditionalSampleOpen(true)} disabled={submitting || additionalSampleOpen || loadedResultsKey !== resultsKey}>ขอตัวอย่างเพิ่ม</Button>
          )}
          <Button
            variant={isComplete ? 'primary' : 'outline'}
            onClick={hasSubmittedQc ? handleSaveDraft : isComplete ? handleSubmitResult : handleSaveDraft}
            disabled={submitting || additionalSampleOpen || loadedResultsKey !== resultsKey}
            className="gap-2"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isComplete ? (
              <Send className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {hasSubmittedQc ? 'บันทึกการแก้ไข' : isComplete ? 'บันทึก' : 'บันทึกแบบร่าง'}
          </Button>
        </div>
      )}

      {(petition.status === 'approved' || petition.status === 'rejected') && (
        <div className={`rounded-lg border p-4 flex flex-col items-center gap-2 ${
          petition.status === 'approved' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
        }`}>
          {petition.status === 'approved' ? (
            <CheckCircle2 className="h-6 w-6 text-green-500" />
          ) : (
            <RotateCcw className="h-6 w-6 text-red-500" />
          )}
          <p className={`text-sm font-semibold ${
            petition.status === 'approved' ? 'text-green-700' : 'text-red-700'
          }`}>
            {petition.status === 'approved' ? 'ออก Final Result แล้ว' : 'ส่งกลับให้แก้ไขแล้ว'}
          </p>
        </div>
      )}
    </div>
    </AppLayout>
  );
}
