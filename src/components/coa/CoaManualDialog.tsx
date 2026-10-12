import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isAiContentTestItem } from "@/lib/aiToleranceCriteria";
import type { CoaDocument, CoaResultSnapshot, CoaSampleSnapshot } from "@/types/coa.types";

const formLabels = {
  standard: "มาตรฐาน",
  grWpSp: "GR / WP / SP",
  liquid: "ยาน้ำ",
  bromadiolone0005: "Bromadiolone 0.005%",
} as const;

type ResultForm = {
  analysisDate: string;
  aiCriteria: string;
  density: string;
  aiResult: string;
  appearance: string;
};

const resultFields: Array<[keyof ResultForm, string, "date" | "text"]> = [
  ["analysisDate", "Date of analysis", "date"],
  ["aiCriteria", "เกณฑ์ความคลาดเคลื่อน", "text"],
  ["density", "Density at 30°C (g/cm³)", "text"],
  ["aiResult", "%AI content (W/V)", "text"],
  ["appearance", "Appearance", "text"],
];

function emptyResultForm(): ResultForm {
  return { analysisDate: "", aiCriteria: "", density: "", aiResult: "", appearance: "" };
}

function dateValue(value?: string) {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || value || "";
}

function resultFormFromRows(rows: CoaResultSnapshot[]): ResultForm {
  const appearance = rows.find((row) => /^appearance$/i.test(row.testItem?.trim() || ""));
  const ai = rows.find((row) => isAiContentTestItem(row.testItem));
  const density = rows.find((row) => /density/i.test(row.testItem || ""));
  const analysisDate = rows.find((row) => /date\s*of\s*analysis/i.test(row.testItem || ""));
  const appearanceCriteria = appearance?.criteria?.trim();
  return {
    analysisDate: dateValue(analysisDate?.result),
    aiCriteria: ai?.criteria || "",
    density: density?.result || "",
    aiResult: ai?.result || "",
    appearance: appearanceCriteria && appearanceCriteria !== "-"
      ? appearanceCriteria
      : appearance?.result && appearance.result.toLowerCase() !== "conform" ? appearance.result : "",
  };
}

function resultRowsFromForm(itemSeq: number, values: ResultForm): CoaResultSnapshot[] {
  const aiResult = values.aiResult.trim();
  return [
    { itemSeq, testItem: "Appearance", result: "Conform", criteria: values.appearance.trim(), method: "Visual", unit: "" },
    { itemSeq, testItem: "%AI content (W/V)", result: aiResult && /%$/.test(aiResult) ? aiResult : aiResult ? `${aiResult}%` : "", criteria: values.aiCriteria.trim(), unit: "%", method: "" },
    { itemSeq, testItem: "Density at 30°C (g/cm³)", result: values.density.trim(), criteria: "-", unit: "g/cm³", method: "DMA 501" },
    { itemSeq, testItem: "Date of analysis", result: values.analysisDate.trim(), criteria: "-", unit: "", method: "" },
  ];
}

type LabAiLookupStatus = "idle" | "waiting" | "searching" | "found" | "not-found" | "error";

type AutoFilledResultValues = {
  batchNo: string;
  aiResult?: string;
  analysisDate?: string;
};

export default function CoaManualDialog({ open, onOpenChange, request, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; request: CoaDocument; onSaved: (doc: CoaDocument) => void;
}) {
  const { user } = useAuth();
  const [sample, setSample] = useState<CoaSampleSnapshot>({ itemSeq: 1 });
  const [resultForm, setResultForm] = useState<ResultForm>(emptyResultForm);
  const [remark, setRemark] = useState("");
  const [labAiLookupKey, setLabAiLookupKey] = useState({ batchNo: "", commonName: "", sampleName: "" });
  const [labAiLookupStatus, setLabAiLookupStatus] = useState<LabAiLookupStatus>("idle");
  const autoFilledResultValues = useRef<AutoFilledResultValues | null>(null);
  const editing = request.sourceType === "erpManual";
  const autofill = useQuery({
    queryKey: ["coa", "erp-autofill", request.externalRequestId || request._id],
    queryFn: () => api.getErpCoaAutofill(request.externalRequestId || request._id),
    enabled: open && !editing,
  });
  const labAiLookup = useQuery({
    queryKey: ["coa", "lab-ai-lookup", labAiLookupKey],
    queryFn: () => api.getCoaLabAiByBatch(labAiLookupKey),
    enabled: open && Boolean(labAiLookupKey.batchNo && labAiLookupKey.commonName),
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => {
      const results = resultRowsFromForm(sample.itemSeq, resultForm);
      const body = { externalRequestId: request.externalRequestId || request._id, sample, results, remark,
        _user: { name: user?.name, email: user?.email, role: user?.role, activeRole: user?.role } };
      return editing ? api.updateCoaDocument(request._id, body) : api.createErpManualCoaDocument(body);
    },
    onSuccess: (doc) => { onSaved(doc); onOpenChange(false); },
  });
  const reset = save.reset;
  useEffect(() => {
    if (!open) return;
    const source = request.sampleSnapshots[0] || { itemSeq: request.selectedItemSeqs[0] || 1 };
    setSample({ ...source, productionDate: source.productionDate?.slice(0, 10) || "" });
    setResultForm(resultFormFromRows(request.resultSnapshots));
    setRemark(request.remark || "");
    autoFilledResultValues.current = null;
    setLabAiLookupKey({ batchNo: "", commonName: "", sampleName: "" });
    setLabAiLookupStatus("idle");
    reset();
  }, [open, request, reset]);
  useEffect(() => {
    if (!open || editing || !autofill.data) return;
    setSample((current) => ({ ...current, ...autofill.data.sample, productionDate: autofill.data.sample.productionDate?.slice(0, 10) || "" }));
    const nextResultForm = resultFormFromRows(autofill.data.results);
    setResultForm(nextResultForm);
    autoFilledResultValues.current = {
      batchNo: String(autofill.data.sample.batchNo || "").trim(),
      ...(nextResultForm.aiResult ? { aiResult: nextResultForm.aiResult } : {}),
      ...(nextResultForm.analysisDate ? { analysisDate: nextResultForm.analysisDate } : {}),
    };
  }, [autofill.data, editing, open]);
  useEffect(() => {
    if (!open) {
      setLabAiLookupKey({ batchNo: "", commonName: "", sampleName: "" });
      setLabAiLookupStatus("idle");
      return;
    }
    const batchNo = String(sample.batchNo || "").trim();
    const commonName = String(sample.commonName || "").trim();
    const sampleName = String(sample.sampleName || "").trim();
    if (!batchNo || !commonName) {
      setLabAiLookupKey({ batchNo: "", commonName: "", sampleName: "" });
      setLabAiLookupStatus("idle");
      return;
    }
    setLabAiLookupStatus("waiting");
    const timer = window.setTimeout(() => {
      setLabAiLookupKey({ batchNo, commonName, sampleName });
      setLabAiLookupStatus("searching");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, sample.batchNo, sample.commonName, sample.sampleName]);
  useEffect(() => {
    if (!labAiLookupKey.batchNo || !labAiLookupKey.commonName || labAiLookup.isFetching) return;
    if (labAiLookup.isError) {
      setLabAiLookupStatus("error");
      return;
    }
    const data = labAiLookup.data;
    if (!data) return;
    const aiResult = String(data.ai?.result || "").trim();
    const analysisDate = String(data.analysisDate || "").trim();
    setResultForm((current) => {
      const previousAuto = autoFilledResultValues.current;
      const batchChanged = Boolean(previousAuto?.batchNo && previousAuto.batchNo !== labAiLookupKey.batchNo);
      const canReplaceAi = !current.aiResult.trim() || previousAuto?.aiResult === current.aiResult;
      const canReplaceAnalysisDate = !current.analysisDate.trim() || previousAuto?.analysisDate === current.analysisDate;
      const updateAi = canReplaceAi && (Boolean(aiResult) || batchChanged);
      const updateAnalysisDate = canReplaceAnalysisDate && (Boolean(analysisDate) || batchChanged);
      const next = {
        ...current,
        ...(updateAi ? { aiResult } : {}),
        ...(updateAnalysisDate ? { analysisDate } : {}),
      };
      autoFilledResultValues.current = {
        batchNo: labAiLookupKey.batchNo,
        ...(updateAi && aiResult ? { aiResult } : (!batchChanged && previousAuto?.aiResult ? { aiResult: previousAuto.aiResult } : {})),
        ...(updateAnalysisDate && analysisDate ? { analysisDate } : (!batchChanged && previousAuto?.analysisDate ? { analysisDate: previousAuto.analysisDate } : {})),
      };
      return next;
    });
    setLabAiLookupStatus(aiResult ? "found" : "not-found");
  }, [labAiLookup.data, labAiLookup.isError, labAiLookup.isFetching, labAiLookupKey]);
  const valid = [sample.sampleName, sample.commonName, sample.batchNo, sample.productionDate].every((value) => value?.trim())
    && resultFields.every(([field]) => resultForm[field].trim());
  function selectStockLot(lotNo: string) {
    const selected = autofill.data?.stockCandidates.find((candidate) => candidate.lotNo === lotNo);
    if (!selected) return;
    setSample((current) => ({ ...current, lotNo: selected.lotNo, batchNo: selected.lotNo, productionDate: selected.productionDate }));
  }
  const sampleFields: Array<[keyof CoaSampleSnapshot, string, string?]> = [
    ["sampleName", "ชื่อการค้า *"], ["commonName", "ชื่อสามัญ *"], ["batchNo", "Batch No. *"],
    ["productionDate", "วันที่ผลิต *", "date"], ["lotNo", "Lot No."], ["manufacturer", "ผู้ผลิต"],
  ];
  return <Dialog open={open} onOpenChange={(value) => { if (!save.isPending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{editing ? "แก้ไข COA แบบกรอกเอง" : "สร้าง COA แบบกรอกเอง"}</DialogTitle>
        <DialogDescription>ใบขาย {request.petitionNoSnapshot} · {request.customerSnapshot?.name} — บันทึกเป็นร่างแล้วส่งให้ QC Head อนุมัติ</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (valid && !save.isPending) save.mutate(); }}>
        {!editing && autofill.isFetching && <p role="status" className="text-sm text-muted-foreground">กำลังดึงข้อมูล ERP, LOT, MF และผล Lab...</p>}
        {!editing && autofill.isError && <Alert variant="destructive">
          <AlertTitle>ดึงข้อมูลอัตโนมัติไม่สำเร็จ</AlertTitle>
          <AlertDescription>{autofill.error instanceof Error ? autofill.error.message : "สามารถกรอกข้อมูลเองได้"}</AlertDescription>
        </Alert>}
        {!editing && autofill.data && <div className="space-y-2 rounded-lg border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">สถานะการจับคู่ข้อมูล</span>
            <Badge variant={autofill.data.match?.matchKind === "exact" ? "green-soft" : "yellow-soft"}>
              {autofill.data.match?.matchKind === "exact" ? "ตรงกัน" : autofill.data.match ? "ใกล้เคียง" : "ไม่พบผล Lab"}
            </Badge>
            <Badge variant="blue-soft">แบบฟอร์ม: {formLabels[autofill.data.form.template]}</Badge>
            {autofill.data.dataSources.density && <Badge variant="blue-soft">มี Density</Badge>}
          </div>
          <p className="text-muted-foreground">
            {autofill.data.match ? `ผล Lab: ${autofill.data.match.petitionNo || "-"} · Batch ${autofill.data.match.batchNo || "-"}` : "ยังไม่พบผล Lab ที่ตรงกัน"}
          </p>
          {autofill.data.warnings.map((warning) => <p key={warning} className="text-sm text-muted-foreground">{warning}</p>)}
          <p className="text-xs text-muted-foreground">ตรวจสอบและแก้ไขข้อมูลทุกช่องได้ก่อนบันทึกร่าง COA</p>
        </div>}
        <p className="text-sm text-muted-foreground">ผลทดสอบที่ดึงจากระบบเป็นข้อมูลตั้งต้น กรุณาตรวจสอบก่อนส่งอนุมัติ</p>
        {!editing && (autofill.data?.stockCandidates.length || 0) > 0 && <div className="space-y-1">
          <Label htmlFor="erp-stock-lot">เลือก LOT NO. จาก Stock</Label>
          <select
            id="erp-stock-lot"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={autofill.data.stockCandidates.some((candidate) => candidate.lotNo === sample.lotNo) ? sample.lotNo : "__manual__"}
            onChange={(event) => selectStockLot(event.target.value)}
          >
            <option value="__manual__">กรอกเอง / ใช้ค่าปัจจุบัน</option>
            {autofill.data.stockCandidates.map((candidate) => <option key={candidate.lotNo} value={candidate.lotNo}>
              {candidate.lotNo} · ผลิต {candidate.productionDate || "ไม่ระบุ"} · คงเหลือ {candidate.quantity || 0}
            </option>)}
          </select>
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {sampleFields.map(([key, label, type]) => <div key={key} className="space-y-1">
            <Label htmlFor={`manual-${key}`}>{label}</Label>
            <Input id={`manual-${key}`} type={type || "text"} required={label.endsWith("*")} maxLength={1000}
              value={String(sample[key] || "")} onChange={(event) => setSample({ ...sample, [key]: event.target.value })} />
          </div>)}
        </div>
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">ผลทดสอบ</h2>
          <p className="text-sm text-muted-foreground">ระบบดึง 5 ข้อมูลจำเป็นจากผล Lab ที่ชื่อสามัญและ Batch No. ตรงกัน</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {resultFields.map(([key, label, type]) => <div key={key} className="space-y-1">
              <Label htmlFor={`manual-result-${key}`}>{label} *</Label>
              <Input id={`manual-result-${key}`} type={type} required maxLength={1000} value={resultForm[key]}
                onChange={(event) => setResultForm((current) => {
                  const value = event.target.value;
                  const previousAuto = autoFilledResultValues.current;
                  if ((key === "aiResult" || key === "analysisDate") && previousAuto?.[key] !== undefined && value !== current[key]) {
                    const nextAuto = { ...previousAuto };
                    delete nextAuto[key];
                    autoFilledResultValues.current = nextAuto.aiResult || nextAuto.analysisDate ? nextAuto : null;
                  }
                  return { ...current, [key]: value };
                })} />
            </div>)}
          </div>
          {labAiLookupStatus !== "idle" && <p role="status" className="text-sm text-muted-foreground">
            {labAiLookupStatus === "waiting" && "กำลังเตรียมค้นหาผล %AI..."}
            {labAiLookupStatus === "searching" && "กำลังค้นหาผล %AI จาก Batch No...."}
            {labAiLookupStatus === "found" && `พบผล %AI จาก Batch No. ${labAiLookupKey.batchNo}`}
            {labAiLookupStatus === "not-found" && "ไม่พบผล %AI ที่ตรงกับชื่อสามัญและ Batch No."}
            {labAiLookupStatus === "error" && "ค้นหาผล %AI ไม่สำเร็จ สามารถกรอกค่าเองได้"}
          </p>}
        </div>
        <div className="space-y-1"><Label htmlFor="manual-remark">หมายเหตุ</Label>
          <Textarea id="manual-remark" maxLength={3000} value={remark} onChange={(event) => setRemark(event.target.value)} /></div>
        {save.isError && <p role="alert" className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : "บันทึก COA ไม่สำเร็จ"}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? "กำลังบันทึก..." : "บันทึกร่าง COA"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
