import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isAiContentTestItem, resolveAiToleranceCriteria } from "@/lib/aiToleranceCriteria";
import { aiContentTestItemForCommonName, isGrWpSpCommonName } from "@/lib/coaFormulation";
import { productionDateFromLotNo } from "@/lib/coaLot";
import type { CoaDocument, CoaResultSnapshot, CoaSampleSnapshot } from "@/types/coa.types";

type ResultForm = { analysisDate: string; aiCriteria: string; density: string; waxBlockCriteria: string; aiResult: string; appearance: string };
const emptyResultForm = (): ResultForm => ({ analysisDate: "", aiCriteria: "", density: "", waxBlockCriteria: "", aiResult: "", appearance: "" });
const isBromadiolone = (name?: string) => /^BROMADIOLONE\s+0\.005%(?:\s|$)/i.test(name?.trim() || "");

function productionDateForSample(sample: CoaSampleSnapshot) {
  return productionDateFromLotNo(sample.batchNo) || productionDateFromLotNo(sample.lotNo) || sample.productionDate?.slice(0, 10) || "";
}

function formFromRows(rows: CoaResultSnapshot[], commonName?: string): ResultForm {
  const appearance = rows.find((row) => /^appearance$/i.test(row.testItem?.trim() || ""));
  const ai = rows.find((row) => isAiContentTestItem(row.testItem));
  const density = rows.find((row) => isBromadiolone(commonName) ? /wax\s*block\s*size|น้ำหนักก้อนยาหนู/i.test(row.testItem || "") : /density/i.test(row.testItem || ""));
  const analysisDate = rows.find((row) => /date\s*of\s*analysis/i.test(row.testItem || ""));
  return {
    analysisDate: analysisDate?.result?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || analysisDate?.result || "",
    aiCriteria: resolveAiToleranceCriteria(commonName, ai?.criteria) || "",
    density: density?.result || "",
    waxBlockCriteria: isBromadiolone(commonName) ? density?.criteria && density.criteria !== "-" ? density.criteria : "5.88 gm ± 5%" : "",
    aiResult: ai?.result || "",
    appearance: appearance?.criteria && appearance.criteria !== "-" ? appearance.criteria : appearance?.result?.toLowerCase() !== "conform" ? appearance?.result || "" : "",
  };
}

function fields(commonName?: string): Array<[keyof ResultForm, string, "date" | "text"]> {
  const list: Array<[keyof ResultForm, string, "date" | "text"]> = [
    ["analysisDate", "Date of analysis", "date"], ["aiCriteria", "เกณฑ์ความคลาดเคลื่อน", "text"],
    ["density", isBromadiolone(commonName) ? "น้ำหนักก้อนยาหนู" : "Density at 30°C (g/cm³)", "text"],
    ...(isBromadiolone(commonName) ? [["waxBlockCriteria", "เกณฑ์น้ำหนักต่อก้อน", "text"] as const] : []),
    ["aiResult", aiContentTestItemForCommonName(commonName), "text"], ["appearance", "Appearance", "text"],
  ];
  return isGrWpSpCommonName(commonName) ? list.filter(([key]) => key !== "density") : list;
}

function rowsFromForm(itemSeq: number, form: ResultForm, commonName?: string): CoaResultSnapshot[] {
  const ai = form.aiResult.trim();
  const bromadiolone = isBromadiolone(commonName);
  const rows: CoaResultSnapshot[] = [
    { itemSeq, testItem: "Appearance", result: "Conform", criteria: form.appearance.trim(), method: "Visual", unit: "" },
    { itemSeq, testItem: aiContentTestItemForCommonName(commonName), result: ai && !/%$/.test(ai) ? `${ai}%` : ai, criteria: form.aiCriteria.trim(), unit: "%", method: "" },
    { itemSeq, testItem: bromadiolone ? "Wax block size" : "Density at 30°C (g/cm³)", result: form.density.trim(), criteria: bromadiolone ? form.waxBlockCriteria.trim() : "-", unit: bromadiolone ? "g" : "g/cm³", method: bromadiolone ? "" : "DMA 501" },
    { itemSeq, testItem: "Date of analysis", result: form.analysisDate.trim(), criteria: "-", unit: "", method: "" },
  ];
  return isGrWpSpCommonName(commonName) ? rows.filter((row) => !/density/i.test(row.testItem || "")) : rows;
}

export default function CoaManualDialog({ open, onOpenChange, request, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; request: CoaDocument; onSaved: (doc: CoaDocument) => void }) {
  const { user } = useAuth();
  const editing = request.sourceType === "erpManual";
  const [samples, setSamples] = useState<CoaSampleSnapshot[]>([]);
  const [forms, setForms] = useState<Record<number, ResultForm>>({});
  const [step, setStep] = useState(0);
  const [remark, setRemark] = useState("");
  const active = samples[step];
  const review = step === samples.length;
  const form = active ? forms[active.itemSeq] || emptyResultForm() : emptyResultForm();

  const autofill = useQuery({ queryKey: ["coa", "erp-autofill", request.externalRequestId || request._id], queryFn: () => api.getErpCoaAutofill(request.externalRequestId || request._id), enabled: open && !editing });
  const labAi = useQuery({
    queryKey: ["coa", "lab-ai-lookup", active?.batchNo, active?.commonName, active?.sampleName],
    queryFn: () => api.getCoaLabAiByBatch({ batchNo: active?.batchNo || "", commonName: active?.commonName || "", sampleName: active?.sampleName }),
    enabled: open && Boolean(active?.batchNo && active?.commonName), retry: false,
  });
  const valid = samples.length > 0 && samples.every((sample) => {
    const result = forms[sample.itemSeq] || emptyResultForm();
    return [sample.sampleName, sample.commonName, sample.batchNo, sample.productionDate].every((value) => value?.trim()) && fields(sample.commonName).every(([key]) => result[key].trim());
  });
  const save = useMutation({
    mutationFn: () => {
      const results = samples.flatMap((sample) => rowsFromForm(sample.itemSeq, forms[sample.itemSeq], sample.commonName));
      const body = { externalRequestId: request.externalRequestId || request._id, samples, results, remark, _user: { name: user?.name, email: user?.email, role: user?.role, activeRole: user?.role } };
      return editing ? api.updateCoaDocument(request._id, body) : api.createErpManualCoaDocument(body);
    },
    onSuccess: (doc) => { onSaved(doc); onOpenChange(false); },
  });

  useEffect(() => {
    if (!open) return;
    const initial = (request.sampleSnapshots.length ? request.sampleSnapshots : [{ itemSeq: request.selectedItemSeqs[0] || 1 }]).map((sample) => ({ ...sample, productionDate: productionDateForSample(sample) }));
    setSamples(initial);
    setForms(Object.fromEntries(initial.map((sample) => [sample.itemSeq, formFromRows(request.resultSnapshots.filter((row) => row.itemSeq === sample.itemSeq), sample.commonName)])));
    setStep(0); setRemark(request.remark || ""); save.reset();
  }, [open, request]);

  useEffect(() => {
    if (!autofill.data || editing) return;
    setSamples((current) => current.map((sample, index) => index ? sample : { ...sample, ...autofill.data.sample, productionDate: productionDateForSample({ ...sample, ...autofill.data.sample }) }));
    setForms((current) => ({ ...current, [autofill.data.sample.itemSeq]: formFromRows(autofill.data.results, autofill.data.sample.commonName) }));
  }, [autofill.data, editing]);

  useEffect(() => {
    if (!active || !labAi.data?.ai) return;
    setForms((current) => {
      const value = current[active.itemSeq] || emptyResultForm();
      return { ...current, [active.itemSeq]: { ...value, aiResult: value.aiResult || labAi.data.ai?.result || "", analysisDate: value.analysisDate || labAi.data.analysisDate || "", aiCriteria: resolveAiToleranceCriteria(active.commonName, value.aiCriteria || labAi.data.ai?.criteria) || value.aiCriteria } };
    });
  }, [active, labAi.data]);

  const updateSample = (key: keyof CoaSampleSnapshot, value: string) => setSamples((current) => current.map((sample, index) => {
    if (index !== step) return sample;
    const next = { ...sample, [key]: value };
    const inferred = key === "batchNo" || key === "lotNo" ? productionDateForSample(next) : "";
    return { ...next, ...(inferred ? { productionDate: inferred } : {}) };
  }));
  const updateForm = (key: keyof ResultForm, value: string) => active && setForms((current) => ({ ...current, [active.itemSeq]: { ...(current[active.itemSeq] || emptyResultForm()), [key]: value } }));

  return <Dialog open={open} onOpenChange={(value) => { if (!save.isPending) onOpenChange(value); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{editing ? "แก้ไข COA แบบกรอกเอง" : "สร้าง COA แบบกรอกเอง"}</DialogTitle><DialogDescription>ใบขาย {request.petitionNoSnapshot} · {request.customerSnapshot?.name} — แสดงข้อมูลครบทุก Batch ใน COA ใบเดียว</DialogDescription></DialogHeader>
    <div className="flex flex-wrap gap-2" aria-label="ขั้นตอนกรอกข้อมูล">
      {samples.map((sample, index) => <Button key={sample.itemSeq} type="button" size="sm" variant={step === index ? "default" : "outline"} onClick={() => setStep(index)}>{sample.batchNo || `Batch ${index + 1}`}</Button>)}
      <Button type="button" size="sm" variant={review ? "default" : "outline"} onClick={() => setStep(samples.length)}>ตรวจสอบรวม</Button>
    </div>
    {!review && active && <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2 text-sm"><span className="font-semibold">Batch {step + 1} จาก {samples.length}</span><span className="text-muted-foreground">{active.batchNo || "ยังไม่ระบุ Batch"}</span></div>
      {autofill.isFetching && step === 0 && <p className="text-sm text-muted-foreground">กำลังดึงข้อมูล ERP, MF, Stock และผล Lab...</p>}
      <div className="grid gap-3 sm:grid-cols-2">{([[
        "sampleName", "ชื่อการค้า *", "text"], ["commonName", "ชื่อสามัญ *", "text"], ["batchNo", "Batch No. *", "text"], ["productionDate", "วันที่ผลิต *", "date"], ["lotNo", "Lot No.", "text"], ["manufacturer", "ผู้ผลิต", "text"],
      ] as Array<[keyof CoaSampleSnapshot, string, string]>).map(([key, label, type]) => <div key={key} className="space-y-1"><Label htmlFor={`manual-${active.itemSeq}-${key}`}>{label}</Label><Input id={`manual-${active.itemSeq}-${key}`} type={type} value={String(active[key] || "")} onChange={(event) => updateSample(key, event.target.value)} /></div>)}</div>
      <div className="space-y-3"><h2 className="text-base font-semibold text-foreground">ผลทดสอบ</h2><p className="text-sm text-muted-foreground">ระบบค้นหา Batch ตรงก่อน แล้วใช้ Batch ก่อนหน้าหรือใกล้ที่สุดเมื่อไม่พบผล</p>
        <div className="grid gap-3 sm:grid-cols-2">{fields(active.commonName).map(([key, label, type]) => <div key={key} className="space-y-1"><Label htmlFor={`manual-result-${active.itemSeq}-${key}`}>{label} *</Label><Input id={`manual-result-${active.itemSeq}-${key}`} type={type} value={form[key]} onChange={(event) => updateForm(key, event.target.value)} /></div>)}</div>
        {labAi.isFetching && <p className="text-sm text-muted-foreground">กำลังค้นหาผลวิเคราะห์ของ Batch นี้...</p>}{labAi.data?.match?.batchNo && <p className="text-sm text-muted-foreground">ใช้ผลวิเคราะห์จาก Batch {labAi.data.match.batchNo}</p>}
      </div>
    </div>}
    {review && <div className="space-y-4"><h2 className="text-base font-semibold text-foreground">ตรวจสอบข้อมูลทุก Batch</h2><div className="divide-y rounded-lg border bg-card">{samples.map((sample, index) => <button key={sample.itemSeq} type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent" onClick={() => setStep(index)}><span><span className="block font-medium">{sample.batchNo || `Batch ${index + 1}`}</span><span className="text-sm text-muted-foreground">{sample.sampleName} · ผลิต {sample.productionDate || "-"}</span></span><span className="text-sm text-muted-foreground">แก้ไข</span></button>)}</div><div className="space-y-1"><Label htmlFor="manual-remark">หมายเหตุ</Label><Textarea id="manual-remark" maxLength={3000} value={remark} onChange={(event) => setRemark(event.target.value)} /></div></div>}
    {save.isError && <p role="alert" className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : "บันทึก COA ไม่สำเร็จ"}</p>}
    <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" disabled={step === 0 || save.isPending} onClick={() => setStep((value) => value - 1)}><ChevronLeft className="h-4 w-4" />ก่อนหน้า</Button><div className="flex gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>ยกเลิก</Button>{!review && samples.length > 1 ? <Button type="button" onClick={() => setStep((value) => value + 1)}>ถัดไป<ChevronRight className="h-4 w-4" /></Button> : <Button type="button" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "กำลังบันทึก..." : "บันทึกร่าง COA"}</Button>}</div></div>
  </DialogContent></Dialog>;
}
