import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { api } from "@/lib/api";
import { isAiContentTestItem, resolveAiToleranceCriteria } from "@/lib/aiToleranceCriteria";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { normalizeRoles, primaryRole } from "@/lib/roles";
import type { CoaDocument, CoaResultSnapshot, CoaSampleSnapshot, CoaSourceResult, EligibleCoaPetition } from "@/types/coa.types";

type Customer = NonNullable<CoaDocument["customerSnapshot"]>;
type SampleField = Exclude<keyof CoaSampleSnapshot, "itemSeq">;
type CoaField = "aiResult" | "aiCriteria" | "appearance" | "density" | "analysisDate";
type FormField = SampleField | CoaField;

const sampleFields: Array<[FormField, string, boolean]> = [
  ["sampleName", "ชื่อการค้า", true],
  ["commonName", "ชื่อสามัญ", true],
  ["lotNo", "Lot No.", false],
];
const coaFields: Array<[FormField, string, boolean]> = [
  ["batchNo", "Batch", true],
  ["aiResult", "% AI", true],
  ["aiCriteria", "เกณฑ์ความคลาดเคลื่อน", false],
  ["appearance", "Appearance", false],
  ["density", "Density at 30°C (g/cm³)", false],
  ["analysisDate", "Date of analysis", false],
  ["productionDate", "MANUFACTURING DATE", true],
];
const coaFieldNames: CoaField[] = ["aiResult", "aiCriteria", "appearance", "density", "analysisDate"];
const dateFields: FormField[] = ["productionDate", "analysisDate"];

function isCoaField(field: FormField): field is CoaField {
  return coaFieldNames.includes(field as CoaField);
}

function filled<T extends object>(value?: T) {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry)) as Partial<T>;
}

function matchKey(value?: string) {
  return (value || "").toLowerCase().replace(/\s+/g, "");
}

function findErpMatch(petitions: EligibleCoaPetition[], sample?: CoaSampleSnapshot) {
  const commonName = matchKey(sample?.commonName);
  if (!commonName) return null;
  const candidates = petitions.flatMap((petition) => petition.items
    .filter((item) => !item.activeCoa && matchKey(item.commonName) === commonName)
    .map((item) => ({ petitionId: petition._id, seq: item.seq, sameTradeName: matchKey(item.sampleName) === matchKey(sample?.sampleName) })));
  return candidates.find((candidate) => candidate.sameTradeName) ?? candidates[0] ?? null;
}

function coaDefaults(options: CoaSourceResult[], commonName?: string, erpAppearance?: string): Record<CoaField, string> {
  const ai = options.find((option) => option.kind === "ai")
    ?? options.find((option) => option.kind === "result" && option.unit === "%" && isAiContentTestItem(option.testItem));
  const physical = options.find((option) => option.kind === "appearance")
    ?? options.find((option) => option.kind === "result" && /appearance|กายภาพ|ลักษณะ/i.test(option.testItem ?? ""));
  const density = options.find((option) => option.kind === "density")
    ?? options.find((option) => option.kind === "result" && /density/i.test(option.testItem ?? ""));
  return {
    aiResult: ai?.result ?? "",
    aiCriteria: resolveAiToleranceCriteria(commonName, ai?.criteria) || "",
    appearance: erpAppearance || physical?.suggestedEnglish || physical?.result || "",
    density: density?.result ?? "",
    analysisDate: "",
  };
}

// ponytail: Appearance prints as the specification with result "Conform"; add a result field when "Not conform" must be issued.
function coaRows(itemSeq: number, form: Record<CoaField, string>): CoaResultSnapshot[] {
  const value = (field: CoaField) => form[field].trim();
  const ai = value("aiResult");
  return [
    { itemSeq, testItem: "Appearance", result: value("appearance") && "Conform", criteria: value("appearance") },
    { itemSeq, testItem: "%AI content", result: /^\d+(\.\d+)?$/.test(ai) ? `${ai}%` : ai, criteria: value("aiCriteria"), unit: "%" },
    { itemSeq, testItem: "Density at 30°C (g/cm³)", result: value("density"), unit: "g/cm³" },
    { itemSeq, testItem: "Date of analysis", result: value("analysisDate") },
  ].filter((row) => row.result);
}

function dateInputValue(value?: string | null) {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? value ?? "";
}

function formatProductionDate(value?: string | null) {
  if (!value) return "";
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB");
}

export default function CoaCreateDialog({
  open,
  onOpenChange,
  onCreated,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (doc: CoaDocument) => void;
  request?: CoaDocument | null;
}) {
  const { user } = useAuth();
  const [petitionId, setPetitionId] = useState("");
  const [selectedSeqs, setSelectedSeqs] = useState<number[]>([]);
  const [sampleEdits, setSampleEdits] = useState<Record<number, Partial<CoaSampleSnapshot>>>({});
  const [coaEdits, setCoaEdits] = useState<Record<number, Partial<Record<CoaField, string>>>>({});
  const [erpMatchChecked, setErpMatchChecked] = useState(false);
  const erp = request?.externalCoaRequest;
  const erpSeq = erp?.line || 1;
  const erpSample = erp ? request?.sampleSnapshots?.[0] : undefined;
  const erpBase = filled({ sampleName: erpSample?.sampleName, commonName: erpSample?.commonName });
  const { data, isFetching, error: loadError, refetch } = useQuery({ queryKey: ["coa", "eligible-petitions"], queryFn: api.getEligibleCoaPetitions, enabled: open });
  const petitions = useMemo(() => data?.items ?? [], [data]);
  const selectedPetition = useMemo(
    () => petitions.find((petition: EligibleCoaPetition) => petition._id === petitionId),
    [petitions, petitionId],
  );
  const selectedItems = useMemo(
    () => selectedPetition?.items.filter((item) => selectedSeqs.includes(item.seq)) ?? [],
    [selectedPetition, selectedSeqs],
  );
  const reusableActiveCoa = useMemo(() => {
    if (erp || selectedItems.length === 0) return null;
    const activeCoas = selectedItems.map((item) => item.activeCoa).filter(Boolean);
    const coaIds = new Set(activeCoas.map((coa) => coa?.coaId));
    return activeCoas.length === selectedItems.length && coaIds.size === 1 ? activeCoas[0] : null;
  }, [erp, selectedItems]);
  const source = useQuery({
    queryKey: ["coa", "source-data", petitionId, selectedSeqs],
    queryFn: () => api.getCoaSourceData(petitionId, selectedSeqs),
    enabled: open && Boolean(selectedPetition) && selectedSeqs.length > 0 && !reusableActiveCoa,
  });
  const sourceData = source.data;
  const manualMode = Boolean(erp) && selectedItems.length === 0;
  const activeSamples: CoaSampleSnapshot[] = manualMode
    ? [{ itemSeq: erpSeq, ...erpBase, ...sampleEdits[erpSeq] }]
    : selectedItems.map((item) => ({
      itemSeq: item.seq,
      sampleName: item.sampleName,
      commonName: item.commonName,
      batchNo: item.batchNo,
      lotNo: item.lotNo,
      productionDate: item.productionDate,
      ...sourceData?.sampleSnapshots?.find((sample) => sample.itemSeq === item.seq),
      ...erpBase,
      ...sampleEdits[item.seq],
    }));
  const coaFormFor = (sample: CoaSampleSnapshot) => ({
    ...coaDefaults(manualMode ? [] : sourceData?.results.filter((option) => option.itemSeq === sample.itemSeq) ?? [], sample.commonName, erp?.appearance),
    ...coaEdits[sample.itemSeq],
  });
  const fieldValue = (sample: CoaSampleSnapshot, field: FormField) => (isCoaField(field) ? coaFormFor(sample)[field] : sample[field]) ?? "";
  const activeRows = activeSamples.flatMap((sample) => coaRows(sample.itemSeq, coaFormFor(sample)));
  const formCustomer: Customer = { ...sourceData?.customerSnapshot, ...(erp ? filled(request?.customerSnapshot) : {}) };
  const showForm = manualMode || (Boolean(sourceData) && !source.isFetching && !source.isError);
  const formComplete = activeSamples.length > 0
    && activeSamples.every((sample) => [...sampleFields, ...coaFields].every(([field, , required]) => !required || fieldValue(sample, field).trim()));
  const canCreate = showForm && formComplete && !isFetching && !loadError;
  const reusableActiveCoaFields = useMemo(() => {
    if (!reusableActiveCoa) return "ชื่อสามัญ/Batch/วันที่ผลิตนี้";
    return [
      reusableActiveCoa.commonName ? `ชื่อสามัญ ${reusableActiveCoa.commonName}` : null,
      reusableActiveCoa.batchNo ? `Batch No. ${reusableActiveCoa.batchNo}` : null,
      reusableActiveCoa.productionDate ? `วันที่ผลิต ${formatProductionDate(reusableActiveCoa.productionDate)}` : null,
    ].filter(Boolean).join(" · ") || "ชื่อสามัญ/Batch/วันที่ผลิตนี้";
  }, [reusableActiveCoa]);
  const actor = useMemo(() => {
    const roles = normalizeRoles(user);
    const activeRole = user?.role || primaryRole(roles);
    return {
      name: user?.name,
      email: user?.email,
      role: activeRole,
      activeRole,
    };
  }, [user]);
  const create = useMutation({
    mutationFn: () => api.createManualCoaDocument({
      petitionId: manualMode ? undefined : petitionId,
      selectedItemSeqs: activeSamples.map((sample) => sample.itemSeq),
      customerSnapshot: formCustomer,
      sampleSnapshots: activeSamples,
      resultSnapshots: activeRows,
      externalCoaRequest: erp ? { saleOrderNo: erp.saleOrderNo, line: erp.line, itemNo: erp.itemNo } : undefined,
      _user: actor,
    }),
    onSuccess: (doc) => {
      onOpenChange(false);
      onCreated(doc);
    },
  });
  const submitExisting = useMutation({
    mutationFn: async () => {
      if (!reusableActiveCoa) throw new Error("ไม่พบ COA ใบเดิมสำหรับส่งอนุมัติ");
      const revision = await api.reviseCoaDocument(reusableActiveCoa.coaId, { _user: actor });
      return api.submitCoaDocument(revision._id, { _user: actor });
    },
    onSuccess: (doc) => {
      onOpenChange(false);
      onCreated(doc);
    },
  });

  const resetCreate = create.reset;
  const resetSubmitExisting = submitExisting.reset;
  useEffect(() => {
    if (!open) return;
    const requestErp = request?.externalCoaRequest;
    setPetitionId(requestErp ? "" : request?.petitionId || "");
    setSelectedSeqs(requestErp ? [] : request?.selectedItemSeqs || []);
    setSampleEdits({});
    setCoaEdits({});
    setErpMatchChecked(false);
    resetCreate();
    resetSubmitExisting();
  }, [open, request, resetCreate, resetSubmitExisting]);

  useEffect(() => {
    if (!open || !erp || erpMatchChecked || isFetching || !data) return;
    setErpMatchChecked(true);
    const match = findErpMatch(petitions, erpSample);
    if (!match) return;
    setPetitionId(match.petitionId);
    setSelectedSeqs([match.seq]);
  }, [open, erp, erpMatchChecked, isFetching, data, petitions, erpSample]);


  function toggleSeq(seq: number) {
    if (erp) {
      setSelectedSeqs((value) => (value.includes(seq) ? [] : [seq]));
      return;
    }
    setSelectedSeqs((value) => (value.includes(seq) ? value.filter((item) => item !== seq) : [...value, seq]));
  }

  function renderFields(sample: CoaSampleSnapshot, fields: Array<[FormField, string, boolean]>) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([field, label, required]) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`coa-sample-${sample.itemSeq}-${field}`}>{label}{required ? " *" : ""}</Label>
            <Input
              id={`coa-sample-${sample.itemSeq}-${field}`}
              type={dateFields.includes(field) ? "date" : "text"}
              value={dateFields.includes(field) ? dateInputValue(fieldValue(sample, field)) : fieldValue(sample, field)}
              onChange={(event) => {
                const { value } = event.target;
                if (isCoaField(field)) setCoaEdits((current) => ({ ...current, [sample.itemSeq]: { ...current[sample.itemSeq], [field]: value } }));
                else setSampleEdits((current) => ({ ...current, [sample.itemSeq]: { ...current[sample.itemSeq], [field]: value } }));
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!create.isPending && !submitExisting.isPending) onOpenChange(nextOpen); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>สร้าง COA</DialogTitle>
          <DialogDescription>ระบบเติมข้อมูลจากผล Lab และ ERP ให้ก่อน แก้ไขได้ทุกช่องก่อนสร้างร่าง</DialogDescription>
        </DialogHeader>
        {isFetching && <p role="status" className="text-sm text-muted-foreground">กำลังโหลดคำร้อง...</p>}
        {loadError && <div role="alert" className="text-sm text-destructive">โหลดคำร้องไม่สำเร็จ <Button variant="outline" onClick={() => refetch()}>ลองใหม่</Button></div>}
        {!isFetching && !loadError && petitions.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีคำร้องที่อนุมัติผล Lab พร้อมสร้าง COA</p>}
        {erp && (
          <Alert>
            <AlertTitle>คำขอจาก ERP {erp.saleOrderNo}</AlertTitle>
            <AlertDescription>
              {selectedItems.length
                ? `จับคู่กับคำร้อง ${selectedPetition?.petitionNo ?? ""} แล้ว ตรวจหรือแก้ข้อมูลด้านล่างได้ เลือกตัวอย่างอื่นได้ถ้าไม่ถูกต้อง`
                : "ยังไม่พบคำร้องที่ตรงกัน กรอกข้อมูลที่ขาดเองได้เลย หรือเลือกคำร้องเพื่อดึงผล Lab"}
            </AlertDescription>
          </Alert>
        )}
        {reusableActiveCoa && (
          <Alert className="border-yellow-500/30 bg-yellow-50 text-yellow-500">
            <AlertTitle>พบประวัติการทำ COA แล้ว</AlertTitle>
            <AlertDescription>
              {reusableActiveCoaFields} เคยออก COA แล้ว เลข COA No. {reusableActiveCoa.coaNo}
              {reusableActiveCoa.petitionNo ? ` จากคำร้อง ${reusableActiveCoa.petitionNo}` : ""}
              <span className="mt-1 block">กด “ส่งใบเดิมไปรออนุมัติ” เพื่อส่งข้อมูลไปหน้า “รออนุมัติ” ได้ทันที</span>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="max-h-80 overflow-auto rounded-md border bg-muted/50">
            {petitions.map((petition) => (
              <button
                key={petition._id}
                type="button"
                disabled={create.isPending || submitExisting.isPending}
                className={`block w-full border-b px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${petition._id === petitionId ? "bg-primary-50 text-foreground" : "text-foreground"}`}
                onClick={() => {
                  setPetitionId(petition._id);
                  setSelectedSeqs([]);
                  if (!erp) setSampleEdits({});
                  setCoaEdits((current) => (erp && current[erpSeq] ? { [erpSeq]: current[erpSeq] } : {}));
                }}
              >
                <div className="font-medium">{petition.petitionNo}</div>
                <div className="text-xs text-muted-foreground">{petition.items.length} รายการ</div>
              </button>
            ))}
          </div>
          <div className="max-h-80 overflow-auto rounded-md border bg-card">
            {!selectedPetition && <div className="p-6 text-center text-sm text-muted-foreground">เลือกคำร้องที่อนุมัติผล Lab แล้ว</div>}
            {selectedPetition?.items.map((item) => (
              <label key={item.seq} className="flex items-start gap-3 border-b p-3 text-sm hover:bg-accent">
                <Checkbox checked={selectedSeqs.includes(item.seq)} disabled={create.isPending || submitExisting.isPending} onCheckedChange={() => toggleSeq(item.seq)} />
                <span>
                  <span className="block font-medium text-foreground">{item.sampleName || item.commonName || `Sample ${item.seq}`}</span>
                  <span className="block text-foreground">ชื่อสามัญ: {item.commonName || "ยังไม่ระบุชื่อสามัญ"}</span>
                  <span className="block text-xs text-muted-foreground">{[item.batchNo || item.lotNo || "-", item.productionDate ? `ผลิต ${formatProductionDate(item.productionDate)}` : null].filter(Boolean).join(" · ")}</span>
                  {item.activeCoa && (
                    <span className="mt-1 block rounded-md bg-yellow-50 px-2 py-1 text-xs text-yellow-500">
                      มีประวัติ COA แล้ว: {item.activeCoa.coaNo}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
        {!reusableActiveCoa && activeSamples.length > 0 && (
          <fieldset disabled={create.isPending} className="space-y-4">
            <legend className="text-base font-semibold text-foreground">ข้อมูลที่ใช้ในฟอร์ม COA</legend>
            {!manualMode && source.isFetching && <p role="status" className="text-sm text-muted-foreground">กำลังโหลดผลพารามิเตอร์...</p>}
            {!manualMode && source.isError && <div role="alert" className="text-sm text-destructive">{source.error instanceof Error ? source.error.message : "โหลดผลไม่สำเร็จ"} <Button variant="outline" onClick={() => source.refetch()}>โหลดผลอีกครั้ง</Button></div>}
            {showForm && activeSamples.map((sample) => (
              <section key={sample.itemSeq} className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
                <h3 className="text-base font-semibold">{manualMode ? "ข้อมูลตัวอย่างจาก ERP" : `${sample.commonName || "ยังไม่ระบุชื่อสามัญ"} · ${sample.batchNo || sample.lotNo || "-"}`}</h3>
                {renderFields(sample, sampleFields)}
                {!manualMode && !sourceData?.results.some((option) => option.kind === "result" && option.itemSeq === sample.itemSeq) && (
                  <p className="text-sm text-muted-foreground">ไม่พบค่าพารามิเตอร์จากผล Lab กรอกผลเองได้</p>
                )}
                <div className="space-y-3 rounded-md border bg-muted/50 p-3">
                  <h4 className="text-sm font-semibold text-foreground">ผลที่จะแสดงใน COA</h4>
                  {renderFields(sample, coaFields)}
                </div>
              </section>
            ))}
            {showForm && <p className="text-xs text-muted-foreground">ช่องที่มี * ต้องกรอก</p>}
          </fieldset>
        )}
        {(create.error || submitExisting.error) && <p role="alert" className="text-sm text-destructive">{(create.error || submitExisting.error)?.message}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={create.isPending || submitExisting.isPending} onClick={() => onOpenChange(false)}>ปิด</Button>
          {reusableActiveCoa ? (
            <Button
              className="gap-2 bg-yellow-500 text-white hover:bg-yellow-500/90"
              disabled={submitExisting.isPending || create.isPending}
              onClick={() => submitExisting.mutate()}
            >
              ส่งใบเดิมไปรออนุมัติ
            </Button>
          ) : (
            <Button className="gap-2" disabled={!canCreate || create.isPending || submitExisting.isPending} onClick={() => create.mutate()}>
              <FilePlus2 className="h-4 w-4" />
              สร้างร่าง COA
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
