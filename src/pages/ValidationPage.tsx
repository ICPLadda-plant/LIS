import { theoreticalFortified } from "@/lib/validationFortified";
import { formatDateTime } from "@/lib/dateTime";
import { precisionWithAccuracyDayOne } from "@/lib/validationPrecisionDays";
import ValidationAccuracyGrid from "@/components/lis/ValidationAccuracyGrid";
import { toast } from "sonner";
import { syncLinearityConcentrations } from "@/lib/validationLinearitySync";
import { validationChartSvg } from "@/lib/validationCharts";
import { Fragment, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Calculator, Download, FileCheck2, FlaskConical, ShieldCheck } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseMeasurements, regression, stats } from "@/lib/validationCalculator";
import ValidationDataGrid from "@/components/lis/ValidationDataGrid";
import ValidationPreparation from "@/components/lis/ValidationPreparation";
import { defaultPreparationLevels, targetConcentration, positiveNumber, stockConcentration, preparationKind, defaultLinearitySettings, checkLinearityPreparation, preparationTemplate, type ValidationStock, type PreparationLevel } from "@/lib/validationPreparation";
import ValidationStocks from "@/components/lis/ValidationStocks";
import { PrecisionPanel, QcPanel, ValidationResults as Results } from "@/components/lis/ValidationAdvanced";
import { defaultPrecisionSettings, defaultQcSettings, evaluatePrecision, evaluateQc } from "@/lib/validationAdvanced";
import { createValidationReport } from "@/lib/validationReport";
import { validationReportLogo } from "@/lib/validationReportAssets";
import { exportValidationPdf } from "@/lib/validationReportExport";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { clearValidationLibrary, restoreValidationLibrary, loadValidationLibrary, saveValidationWork, validationDrugKey, type ValidationSavedWork } from "@/lib/validationLibrary";
import { readValidationProject, type ValidationProject } from "@/lib/validationProject";
import ValidationSpecificity from "@/components/lis/ValidationSpecificity";
import { defaultSpecificitySettings, evaluateSpecificity } from "@/lib/validationSpecificity";
import ValidationLinearityGrid from "@/components/lis/ValidationLinearityGrid";
import ValidationAccuracyTables from "@/components/lis/ValidationAccuracyTables";
import { defaultLinkedMeasurements, evaluateLinkedMeasurements } from "@/lib/validationMeasurements";
import { NativeSelect } from "@/components/ui/select";
import ValidationTemplateEditor from "@/components/lis/ValidationTemplateEditor";
import { sourceProtocolDetails } from "@/lib/validationSourceTemplate";
import { evaluateProtocolDetails, hasProtocolDetails } from "@/lib/validationProtocol";

const names = ["Specificity", "Linearity", "Accuracy", "Precision", "Overall Summary"];
const fmt = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 5 });
type Check = { name: string; value: string; criteria: string; pass: boolean | null };
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <Card><CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}
export default function ValidationPage() {
  const { user } = useAuth();
  const owner = user?.email || "local";
  const [workId, setWorkId] = useState<string>(() => crypto.randomUUID());
  const [savedWork, setSavedWork] = useState<ValidationSavedWork | null>(null);
  const [library, setLibrary] = useState<ValidationSavedWork[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [tab, setTab] = useState("setup");
  const [title, setTitle] = useState("Cypermethrin — Method Validation");
  const [analyte, setAnalyte] = useState("Cypermethrin");
  const [method, setMethod] = useState("GC-FID");
  const [preparationSources, setPreparationSources] = useState({ accuracy: "matrix" as "matrix" | "std", precision: "matrix" as "matrix" | "std" });
  const [preparationLevels, setPreparationLevels] = useState<PreparationLevel[]>(() => defaultPreparationLevels().map(row => ({ ...row, preparationKind: row.purpose === "accuracy" ? "matrix" as const : "std" as const, target: "", aliquot: "", actualAliquot: "", finalVolume: "", matrix: row.purpose === "accuracy" ? "" : "0" })));
  const [stocks, setStocks] = useState<ValidationStock[]>([]);
  const [linearity, setLinearity] = useState(defaultLinearitySettings);
  const [prep, setPrep] = useState(["", "", "", "", ""]);
  const [inputTexts, setTexts] = useState(["", "", ""]);
  const [blank, setBlank] = useState("");
  const [specificity, setSpecificity] = useState(defaultSpecificitySettings);
  const [inputPrecision, setPrecision] = useState(defaultPrecisionSettings);
  const [inputQc, setQc] = useState(defaultQcSettings);
  const [linkedMeasurements, setLinkedMeasurements] = useState(defaultLinkedMeasurements);
  const [sourceTemplateValues, setSourceTemplateValues] = useState<Record<string, string>>({});
  const [protocolDetails, setProtocolDetails] = useState(() => sourceProtocolDetails("Cypermethrin"));
  const protocolResult = evaluateProtocolDetails(protocolDetails);
  const [reportMeta, setReportMeta] = useState({ analyst: "", reviewer: "", protocol: "WI-06-04-03 rev.04 (ปรับเกณฑ์ตามวิธีที่ใช้)", calibration: "", notes: "" });
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false), [pdfError, setPdfError] = useState("");
  const projectFile = useRef<HTMLInputElement>(null);
  const [preparationUndo, setPreparationUndo] = useState<{ prep: string[]; stocks: ValidationStock[]; levels: PreparationLevel[] } | null>(null);
  const resetPreparationNumbers = () => {
    setPreparationUndo({ prep: [...prep], stocks, levels: preparationLevels });
    setPrep(old => old.map(() => ""));
    setStocks(old => old.map(row => ({ ...row, weight: "", purity: "", volume: "" })));
    setPreparationLevels(old => old.map(row => ({ ...row, target: "", aliquot: "", actualAliquot: "", finalVolume: "", matrix: preparationKind(row) === "std" ? "0" : "", matrixCalculation: row.matrixCalculation ? { ...row.matrixCalculation, percent: "", reference: "", density: "", sampleDensity: "" } : undefined })));
    setSaveStatus(""); setPreviewHtml("");
    toast.success("รีเซ็ตตัวเลขการเตรียมสารแล้ว ยังไม่แก้ไขงานที่บันทึกในคลัง");
  };

  const [weight, purity, volume] = prep.map(Number);
  const validPrep = prep.slice(0, 3).every(v => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0) && purity <= 100;
  const stock = stockConcentration(weight, purity, volume);
  const linkedResult = evaluateLinkedMeasurements(linkedMeasurements, stock, stocks, Number(linearity.r2Min));
  const linked = linkedMeasurements.enabled;
  const syncedTexts = inputTexts.map((text, index) => index === 1 && savedWork?.sections["STD → linearity"] ? syncLinearityConcentrations(text, preparationLevels, stock, stocks) : text);
  const texts = syncedTexts.map((text, index) => index === 2 ? theoreticalFortified(linked.includes("accuracy") ? linkedResult.outputs.accuracy : text) : text);
  const precision = { ...inputPrecision, minDays: "6", dailyData: theoreticalFortified(precisionWithAccuracyDayOne(linked.includes("daily") ? linkedResult.outputs.daily : inputPrecision.dailyData, texts[2]), true) };
  const qc = { ...inputQc, sampleData: linked.includes("sample") ? linkedResult.outputs.sample : inputQc.sampleData, standardData: linked.includes("standard") ? linkedResult.outputs.standard : inputQc.standardData, spikeData: linked.includes("spike") ? linkedResult.outputs.spike : inputQc.spikeData };
  const parsed = texts.map((t, i) => parseMeasurements(t, i === 2 ? 3 : 2));
  const specificityContext = { standardData: texts[0], analyte, method, protocol: reportMeta.protocol, calibration: reportMeta.calibration, reviewer: reportMeta.reviewer, preparation: JSON.stringify({ prep, preparationLevels, ...(stocks.length ? { stocks } : {}), ...(hasProtocolDetails(protocolDetails) ? { protocolDetails } : {}) }) };
  const specificityResult = evaluateSpecificity(specificity, specificityContext);
  const { rt, area } = specificityResult;
  const fit = parsed[1].errors.length ? null : regression(parsed[1].rows);
  const plannedLinearity = preparationLevels.filter(r => preparationKind(r) === "std");
  const stdSorted = [...plannedLinearity].sort((a, b) => (targetConcentration(a) ?? Infinity) - (targetConcentration(b) ?? Infinity));
  const stdAccuracy = [stdSorted[0], stdSorted[2], stdSorted[4]].filter(Boolean).map(row => ({ ...row, purpose: "accuracy" as const }));
  const plannedAccuracy = preparationSources.accuracy === "std" ? stdAccuracy : preparationLevels.filter(r => r.purpose === "accuracy");
  const plannedPrecision = preparationSources.precision === "std" ? stdAccuracy : preparationLevels.filter(r => r.purpose === "accuracy");
  const accuracyTargets = plannedAccuracy.map(r => targetConcentration(r) ?? NaN);
  const planErrors: string[] = [];
  if (plannedLinearity.length !== 5) planErrors.push("แผน Linearity: ต้องกำหนด 5 ระดับ");
  if (plannedAccuracy.length !== 3) planErrors.push("แผน Accuracy: ต้องมี 3 ระดับ ต่ำ กลาง สูง");
  if (preparationLevels.some(r => targetConcentration(r) == null)) planErrors.push("แผนเตรียมสาร: Target ต้องมากกว่า 0");
  if (new Set(accuracyTargets).size !== accuracyTargets.length) planErrors.push("แผน Accuracy: ระดับเป้าหมายซ้ำกัน");
  if (plannedAccuracy.some(r => positiveNumber(r.recoveryLow) == null || positiveNumber(r.recoveryHigh) == null || Number(r.recoveryLow) >= Number(r.recoveryHigh))) planErrors.push("แผน Accuracy: ตรวจเกณฑ์ Recovery ต่ำและสูง");
  const linearPreparation = checkLinearityPreparation(parsed[1].rows, preparationLevels, stock, stocks, { ...linearity, minReplicates: "3" });
  if (linearPreparation.counts.some(n => n > 3)) planErrors.push("Linearity: กำหนด 3 Area ต่อระดับ กรุณาตรวจข้อมูลที่เกิน");
  const linearReady = planErrors.length === 0 && !!fit && linearPreparation.ready && linearPreparation.counts.every(n => n === 3);
  const linearStats = linearPreparation.prepared.map(({ level, actual }, index) => ({ id: level.id, x: actual, target: targetConcentration(level), stats: stats(linearPreparation.groups[index].map(row => row[1])) }));
  const specificityChecks = specificityResult.checks;
  const linearityChecks: Check[] = [
    { name: "R²", value: fmt(fit?.r2), criteria: `≥ ${linearity.r2Min} · ${plannedLinearity.length} ระดับ ระดับละ ≥ ${linearity.minReplicates} ครั้ง`, pass: linearReady ? fit.r2 >= Number(linearity.r2Min) : null },
    ...linearStats.map(l => ({ name: `Area %RSD Target ${l.target} · Actual ${l.x == null ? "—" : l.x.toFixed(3)} mg/mL`, value: fmt(l.stats?.rsd), criteria: `≤ ${linearity.areaRsdMax}%`, pass: linearReady && l.stats?.rsd != null ? l.stats.rsd <= Number(linearity.areaRsdMax) : null })),
  ];
  const recoveryPoints = parsed[2].rows.map(([level, expected, found], i) => ({ index: i + 1, level, expected, found, recovery: expected > 0 ? found / expected * 100 : null }));
  const accuracyChecks: Check[] = plannedAccuracy.map(planned => {
    const level = targetConcentration(planned) ?? NaN;
    const rows = recoveryPoints.filter(r => r.level === level);
    const values = rows.flatMap(r => r.recovery == null ? [] : [r.recovery]);
    const summary = stats(values);
    const low = Number(planned.recoveryLow), high = Number(planned.recoveryHigh);
    const minReplicates = Number(precision.minReplicates);
    return { name: `Recovery ${level} mg/mL (n=${rows.length})`, value: `${fmt(summary?.mean)}% · RSD ${fmt(summary?.rsd)}%`, criteria: `${low}–${high}% ทุกรายการ · ≥ ${precision.minReplicates} ตัวอย่าง`, pass: Number.isInteger(minReplicates) && minReplicates >= 2 && parsed[2].errors.length === 0 && rows.length >= minReplicates && values.length === rows.length ? values.every(v => v >= low && v <= high) : null };
  });
  const precisionResult = evaluatePrecision(precision, plannedPrecision.map(row => targetConcentration(row) ?? NaN), texts[2]);
  const qcResult = evaluateQc(qc);
  const checks: Check[] = [protocolResult.check, ...specificityChecks, ...linearityChecks, ...accuracyChecks, ...precisionResult.checks, ...qcResult.checks];
  const errors = [...planErrors, ...linkedResult.errors, ...(texts[1] ? linearPreparation.errors : []), ...specificityResult.errors, ...precisionResult.errors, ...qcResult.errors, ...parsed.flatMap((p, i) => i === 0 ? [] : p.errors.map(e => `${names[i]} · ${e}`))];
  if (recoveryPoints.some(p => p.expected <= 0 || !accuracyTargets.includes(p.level))) errors.push("Accuracy: Actual ต้องมากกว่า 0 และระดับเป้าหมายต้องตรงกับแผนเตรียมสาร");
  const invalidAccuracy = errors.some(e => e.startsWith("Accuracy"));
  if (invalidAccuracy || planErrors.length) {
    accuracyChecks.forEach(c => { c.pass = null; });
    precisionResult.checks.forEach(c => { c.pass = null; });
  }
  const passed = checks.filter(c => c.pass === true).length;
  const failed = checks.filter(c => c.pass === false).length;
  const downloadReadableReport = async () => {
    const html = await makeReport();
    if (!html) return;
    /* report is generated from the same snapshot as the preview */
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "method-validation-report.html"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("ดาวน์โหลดรายงาน HTML แล้ว เปิดไฟล์เพื่ออ่านหรือใช้ Ctrl+P บันทึกเป็น PDF");
  };
  const makeReport = async () => {
    try { return createValidationReport({ title, analyte, method, ...reportMeta, prep, levels: preparationLevels, texts, blank, checks, errors, precision: precisionResult, qc: qcResult, includeQc: qc.enabled, specificity, stocks, linearity, linkedMeasurements, protocolDetails, sourceTemplateValues, accuracyLevels: plannedAccuracy, qcSettings: qc, logoDataUrl: await validationReportLogo() }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "สร้างรายงานไม่ได้"); return ""; }
  };
  const previewReport = async () => { setPdfError(""); setPreviewHtml(await makeReport()); };
  const updateText = (index: number, value: string) => { setTexts(old => old.map((v, i) => i === index ? value : v)); setPreviewHtml(""); };
  const templates = [null, preparationTemplate("linearity", preparationLevels, stock, stocks, 3), preparationTemplate("accuracy", plannedAccuracy, stock, stocks, Number(precision.minReplicates))];
  const fillPreparationTemplate = (index: number) => {
    if (texts[index] !== "" || templates[index] == null || (index === 2 && linked.includes("accuracy"))) return;
    setTexts(old => old.map((value, i) => i === index ? templates[index]! : value));
    setNotice("สร้างแถวด้วย Actual จากแผนแล้ว กรุณากรอกผลวัดจริงทุกแถว หากเตรียมตัวอย่างแยกกันให้แก้ Actual ของแต่ละตัวอย่างตามการเตรียมจริง");
  };
  const projectData = () => ({ format: "lis-validation-project", version: 1, title, analyte, method, prep, texts, blank, preparationLevels, stocks, linearity, specificity, reportMeta, precision, qc: inputQc, linkedMeasurements, protocolDetails, preparationSources, sourceTemplateValues });
  let existingWork: ValidationSavedWork | undefined;
  try { existingWork = loadValidationLibrary(owner).find(work => validationDrugKey(work.project.analyte) === validationDrugKey(analyte)); } catch { /* Preserve unreadable storage. */ }
  const saveLabel = existingWork ? "อัปเดต" : "บันทึก";
  const saveSection = (section: string, copy = false, overrides: Partial<ReturnType<typeof projectData>> = {}) => {
    try {
      const id = copy ? crypto.randomUUID() : workId;
      const saved = saveValidationWork(owner, id, section, { ...projectData(), ...overrides });
      setWorkId(saved.id);
      setSavedWork(saved);
      setLibrary(loadValidationLibrary(owner));
      const message = `${saveLabel} ${analyte} สำเร็จ ครบทุกหัวข้อ เวลา ${formatDateTime(saved.savedAt)}`;
      setNotice(message); setSaveStatus(message); toast.success(message);
      return true;
    } catch (error) {
      const reason = error instanceof Error && error.name === "QuotaExceededError" ? "พื้นที่จัดเก็บในเบราว์เซอร์เต็ม" : error instanceof Error && error.name === "ZodError" ? "มีข้อมูลรูปแบบไม่ถูกต้อง กรุณาตรวจช่องกรอกและข้อมูลที่นำเข้า" : error instanceof Error ? error.message : "เข้าถึงคลังงานไม่ได้";
      const message = `${saveLabel}ไม่สำเร็จ: ${reason} · ข้อมูลบนหน้ายังคงอยู่`;
      setNotice(message); setSaveStatus(message); toast.error(message); return false;
    }
  };
  const restoreProject = (project: ValidationProject) => {
    setPreparationUndo(null);
    setSourceTemplateValues(project.sourceTemplateValues); setPreparationSources(project.preparationSources); setProtocolDetails(project.protocolDetails); setTitle(project.title); setAnalyte(project.analyte); setMethod(project.method);
    setPrep(project.prep); setTexts(project.texts); setBlank(project.blank); setSpecificity(project.specificity);
    setPreparationLevels(project.preparationLevels); setStocks(project.stocks); setLinearity({ ...project.linearity, minReplicates: "3" }); setReportMeta(project.reportMeta);
    setPrecision(project.precision); setQc(project.qc); setLinkedMeasurements(project.linkedMeasurements); setPreviewHtml("");
  };
  const saveStdTo = (destination: "linearity" | "accuracy" | "precision") => {
    const sources = destination === "linearity" ? preparationSources : { ...preparationSources, [destination]: "std" as const };
    const nextTexts = [...syncedTexts];
    let nextPrecision = precision;
    if (destination === "linearity") nextTexts[1] = syncLinearityConcentrations(nextTexts[1], plannedLinearity, stock, stocks);
    if (destination === "accuracy" && !nextTexts[2]) nextTexts[2] = preparationTemplate("accuracy", stdAccuracy, stock, stocks, Number(precision.minReplicates)) ?? "";
    if (destination === "precision" && !inputPrecision.dailyData) {
      const template = preparationTemplate("accuracy", stdAccuracy, stock, stocks, Number(precision.minReplicates));
      const days = Number(precision.minDays);
      if (template && Number.isInteger(days) && days >= 2 && days <= 100) nextPrecision = { ...precision, dailyData: Array.from({ length: days }, (_, day) => template.split("\n").map(line => `${day + 1}\t${line}`).join("\n")).join("\n") };
    }
    nextTexts[2] = theoreticalFortified(nextTexts[2]);
    nextPrecision = { ...nextPrecision, dailyData: theoreticalFortified(nextPrecision.dailyData, true) };
    if (!saveSection(`STD → ${destination}`, false, { preparationSources: sources, texts: nextTexts, precision: { ...nextPrecision, dailyData: precisionWithAccuracyDayOne(nextPrecision.dailyData, nextTexts[2]) } })) return;
    setPreparationSources(sources); setTexts(nextTexts); setPrecision(nextPrecision);
    setTab(destination === "linearity" ? "1" : destination === "accuracy" ? "2" : "3");
  };
  const matrixEnabled = !!savedWork && ["STD → accuracy", "STD → precision"].some(section => !!savedWork.sections[section]);
  const matrixPreparation = matrixEnabled ? <ValidationPreparation saveLabel={saveLabel} section="matrix" matrixEnabled analyte={analyte} method={method} stock={stock} stocks={stocks} levels={preparationLevels} onChange={setPreparationLevels} onSave={saveSection} /> : <p className="text-sm text-muted-foreground">บันทึกส่ง STD ไป Accuracy หรือ Precision จากหน้าตั้งค่างานและเตรียมสาร เพื่อเริ่มคำนวณ Matrix</p>;
  return <AppLayout title="Validation" mainClassName="p-4 sm:p-6 overflow-visible"><div className="space-y-6">
    <input type="file" accept=".json" ref={projectFile} className="hidden" aria-label="เปิดงาน Validation" onChange={async e => {
      const selected = e.target.files?.[0]; e.target.value = "";
      if (!selected) return;
      if (selected.size > 3 * 1024 * 1024) { setNotice("ไฟล์งานต้องไม่เกิน 3 MB"); return; }
      try {
        const project = readValidationProject(await selected.text());
        restoreProject(project); setWorkId(crypto.randomUUID()); setSavedWork(null);
        setNotice(`เปิดงาน ${selected.name} และคำนวณใหม่แล้ว`);
      } catch { setNotice("เปิดงานไม่ได้: รูปแบบไฟล์หรือเวอร์ชันไม่ถูกต้อง ข้อมูลปัจจุบันยังคงเดิม"); }
    }} />
    <Dialog open={!!previewHtml} onOpenChange={open => { if (!open) setPreviewHtml(""); }}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader><DialogTitle>ตัวอย่างรายงาน Validation</DialogTitle><DialogDescription>ตรวจตารางและกราฟก่อนดาวน์โหลด PDF พร้อมเลขหน้า หรือเก็บ HTML เพื่อเปิดและพิมพ์ภายหลัง</DialogDescription></DialogHeader>
        <iframe title="ตัวอย่างรายงาน Validation" sandbox="" srcDoc={previewHtml} className="h-[65vh] w-full rounded-lg border" />
        <div className="flex flex-wrap gap-2"><Button disabled={pdfBusy} onClick={async () => {
          setPdfBusy(true); setPdfError("");
          try {
            const latestHtml = await makeReport();
            if (!latestHtml) return;
            setPreviewHtml(latestHtml);
            const blob = await exportValidationPdf(latestHtml);
            const url = URL.createObjectURL(blob), link = document.createElement("a");
            link.href = url; link.download = "method-validation-report.pdf"; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) { setPdfError(error instanceof Error ? error.message : "สร้าง PDF ไม่สำเร็จ"); }
          finally { setPdfBusy(false); }
        }}><Download className="mr-2 h-4 w-4" />{pdfBusy ? "กำลังสร้าง PDF…" : "ดาวน์โหลด PDF พร้อมเลขหน้า"}</Button><Button variant="outline" onClick={downloadReadableReport}>ดาวน์โหลด HTML สำหรับพิมพ์</Button></div>
        {pdfError && <p role="alert" className="text-sm text-destructive">{pdfError}</p>}
      </DialogContent>
    </Dialog>
    <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>คลังงาน Validation</DialogTitle><DialogDescription>หนึ่งยาเก็บเป็นหนึ่งงาน รวมทุกหัวข้อ · เก็บในเบราว์เซอร์นี้สำหรับบัญชีที่ใช้งาน ไม่ซิงก์ข้ามเครื่อง การเปิดงานจะแทนข้อมูลบนหน้า กรุณาบันทึกงานปัจจุบันก่อน</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={!library.length} onClick={() => { try { clearValidationLibrary(owner); setLibrary([]); setSavedWork(null); setWorkId(crypto.randomUUID()); setNotice("ล้างคลังงานแล้ว สามารถกู้คืนครั้งล่าสุดได้ก่อนบันทึกงานใหม่"); } catch { setNotice("ล้างคลังงานไม่สำเร็จ ข้อมูลเดิมยังอยู่"); } }}>ล้างประวัติในคลัง</Button><Button variant="outline" disabled={!!library.length} onClick={() => { try { const restored = restoreValidationLibrary(owner); setLibrary(loadValidationLibrary(owner)); setNotice(restored ? "กู้คืนคลังงานแล้ว" : "ไม่มีประวัติที่ล้างไว้"); } catch { setNotice("กู้คืนไม่สำเร็จ"); } }}>กู้คืนประวัติที่ล้างล่าสุด</Button></div>
      <div className="max-h-96 space-y-3 overflow-y-auto">{!library.length && <p>ยังไม่มีงานที่บันทึก</p>}{library.map(work => <div key={work.id} className="rounded-lg border bg-card p-3"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{work.project.title || work.project.analyte}</p><p className="text-sm text-muted-foreground">{formatDateTime(work.savedAt)}</p></div><Button variant="outline" onClick={() => { restoreProject(work.project); setWorkId(work.id); setSavedWork(work); setLibraryOpen(false); setNotice("เปิดงานที่บันทึกและคำนวณใหม่แล้ว"); }}>เปิดงานนี้</Button></div><p className="mt-2 text-sm text-muted-foreground">เก็บข้อมูลครบทุกหัวข้อในงานเดียว</p></div>)}</div>
    </DialogContent></Dialog>
    <PageHeader title="Validation" description="AI Data & Document Validation Checker · ตรวจข้อมูล คำนวณ และสรุปผลในพื้นที่เดียว" actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { try { setLibrary(loadValidationLibrary(owner)); setLibraryOpen(true); } catch { setNotice("เปิดคลังงานไม่ได้ ข้อมูลที่เก็บไว้ไม่ได้ถูกแก้ไข"); } }}>คลังงานที่บันทึก</Button><Button variant="outline" onClick={() => projectFile.current?.click()}>นำข้อมูลเข้า</Button><Button onClick={previewReport}><FileCheck2 className="mr-2 h-4 w-4" />ออกรายงาน</Button></div>} />

    {notice && <p role="status" className="text-sm">{notice}</p>}
    <Tabs value={tab} onValueChange={v => { setTab(v); setNotice(""); }}>
      <TabsList aria-label="ขั้นตอน Validation" className="sticky top-14 z-20 flex md:top-12 h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border bg-card p-2 shadow-sm">
        <TabsTrigger value="setup" className="min-h-20 min-w-36 flex-1 whitespace-normal rounded-lg px-3 py-4 font-semibold lg:min-w-0 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">ตั้งค่างานและเตรียมสาร</TabsTrigger>
        {names.map((n, i) => <Fragment key={n}>
          <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
          <TabsTrigger className="min-h-20 min-w-36 flex-1 whitespace-normal rounded-lg border border-transparent px-3 py-4 text-center lg:min-w-0 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value={String(i)}>
            <span className="text-lg font-semibold">{n}</span>
          </TabsTrigger>
        </Fragment>)}
      </TabsList>
    <TabsContent value="setup" forceMount className={tab === "setup" ? "mt-4 space-y-4" : "hidden"}>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm"><div className="flex items-center gap-3"><ShieldCheck className="h-8 w-8 text-primary" /><div><h2 className="text-base font-semibold">พื้นที่ตรวจสอบวิธีวิเคราะห์</h2><p className="text-sm text-muted-foreground">{analyte || "ยังไม่ระบุสาร"} · {method || "ยังไม่ระบุวิธี"} · กำหนดช่วงความเข้มข้นในแผนเตรียมสาร</p></div></div><Badge variant="secondary">ฉบับร่าง · รอผู้ทบทวน</Badge></div>
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[["รายการตรวจ", checks.length], ["Passed", passed], ["Failed", failed], ["รอตรวจสอบ", checks.length - passed - failed]].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}</div>
    <ValidationTemplateEditor analyte={analyte} values={sourceTemplateValues} onChange={setSourceTemplateValues} />
    <section aria-labelledby="preparation-heading" className="space-y-4"><div><h2 id="preparation-heading" className="text-base font-semibold text-foreground">ตั้งค่างานและเตรียมสาร</h2><p className="mt-1 text-sm text-muted-foreground">ใช้สำหรับคำนวณสาร · กำหนด Stock ความเข้มข้นที่ต้องการ และ Final volume แล้วพิมพ์ตารางคำนวณเพื่อนำไปเตรียมสาร</p></div><div className="space-y-4"><Panel title="ข้อมูลการเตรียมสาร"><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={resetPreparationNumbers}>รีเซ็ตตัวเลขการเตรียมสาร</Button>{preparationUndo && <Button variant="outline" onClick={() => { setPrep(preparationUndo.prep); setStocks(preparationUndo.stocks); setPreparationLevels(preparationUndo.levels); setPreparationUndo(null); toast.success("คืนค่าตัวเลขก่อนรีเซ็ตแล้ว"); }}>คืนค่าก่อนรีเซ็ต</Button>}</div><p className="text-sm text-muted-foreground">รีเซ็ตน้ำหนัก Purity ปริมาตร Stock และตัวเลขในตาราง STD / Matrix · คงชื่อยา วิธีวิเคราะห์ เกณฑ์ยอมรับ และผลวัดไว้ · กดอัปเดตเมื่อต้องการบันทึกการเปลี่ยนแปลง</p><label className="block space-y-2 text-sm">ชื่องาน / เลขที่รายงาน<Input value={title} onChange={e => setTitle(e.target.value)} /></label><div className="grid gap-4 sm:grid-cols-3">{["น้ำหนักมาตรฐาน (mg)", "Purity (%)", "ปริมาตร Stock (mL)"].map((label, i) => <label className="space-y-2 text-sm" key={label}>{label}<Input type="number" min="0" step="any" value={prep[i]} onChange={e => setPrep(old => old.map((v, n) => n === i ? e.target.value : v))} /></label>)}</div><div className="flex flex-wrap gap-4 rounded-md bg-muted p-3 text-sm"><span>C stock: <strong>{fmt(stock)} mg/mL</strong></span><span className="text-muted-foreground">C stock = น้ำหนัก × Purity/100 ÷ ปริมาตร</span></div><p className="text-sm text-muted-foreground">Stock หลักใช้กับระดับที่เลือก Stock หลักด้านล่าง เพิ่ม Stock แยกสำหรับชุดชั่งอื่น แล้วบันทึกส่งไปยังหัวข้อที่ต้องการคำนวณ </p>{!validPrep && prep[0] && prep[1] && <p className="text-sm text-destructive">น้ำหนักและปริมาตร Stock ต้องมากกว่า 0 และ Purity ต้องมากกว่า 0 ถึง 100%</p>}</Panel>
    <Panel title="กำหนดสารและวิธีสำหรับรายงาน">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm">ชื่อสาร<Input value={analyte} onChange={e => { const value = e.target.value; setTitle(old => old === `${analyte} — Method Validation` ? `${value} — Method Validation` : old); setAnalyte(value); setProtocolDetails(sourceProtocolDetails(value)); }} /></label>
        <label className="space-y-2 text-sm">วิธี / เครื่องมือ<Input value={method} onChange={e => setMethod(e.target.value)} /></label>
      </div>
      <ValidationStocks measurementStockIds={linkedMeasurements.rows.map(row => row.stockId)} stocks={stocks} levels={preparationLevels} onChange={setStocks} />
      <ValidationPreparation saveLabel={saveLabel} section="std" matrixEnabled={matrixEnabled} analyte={analyte} method={method} stock={stock} stocks={stocks} levels={preparationLevels} onChange={setPreparationLevels} onSave={saveSection} onSaveTo={saveStdTo} />

    </Panel>
    </div></section>
    </TabsContent>
      {[0, 1, 2].map(i => <TabsContent key={i} value={String(i)} className="mt-4 space-y-4">
        <h2 className="text-xl font-semibold">{i + 1}. {names[i]}</h2>
        {i === 2 && matrixPreparation}
        {i === 1 && <Panel title="เกณฑ์ Linearity และการเทียบแผนเตรียมสาร"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{([["minReplicates", "จำนวน Injection ต่อระดับขั้นต่ำ"], ["r2Min", "R² ไม่น้อยกว่า"], ["areaRsdMax", "Area %RSD ไม่เกิน"]] as const).map(([key, label]) => <label key={key} className="space-y-2 text-sm">{label}<Input type="number" step="any" readOnly={key === "minReplicates"} value={key === "minReplicates" ? "3" : linearity[key]} onChange={e => setLinearity(old => ({ ...old, [key]: e.target.value }))} /></label>)}</div><p className="text-sm text-muted-foreground">ปรับตาม SOP · เทียบ Actual ของแต่ละ Injection กับความเข้มข้นที่คำนวณจาก Stock และปริมาตรในแผน เมื่อบันทึก STD ไป Linearity ค่า Actual จะอัปเดตตามการเตรียมสารทันที โดยเก็บ Area ที่กรอกไว้</p></Panel>}
        {i === 1 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm"><div><p className="text-sm font-medium">ใช้ความเข้มข้นจากแผนเตรียมสาร</p><p className="text-sm text-muted-foreground">Target = ระดับที่ตั้งใจเตรียม · Actual = คำนวณจากการเตรียมจริง · Found = ผลวัดจากเครื่อง</p><p className="text-xs text-muted-foreground">สร้างได้เมื่อตารางว่างและแผนเตรียมครบ · จำนวนซ้ำ Accuracy ใช้ค่าจากแท็บ Precision · ตรวจ Actual รายตัวอย่างเมื่อเตรียมแยกกัน</p></div><Button variant="outline" disabled={texts[i] !== "" || templates[i] == null} onClick={() => fillPreparationTemplate(i)}>สร้างแถวจากแผนเตรียมสาร</Button></div>}
        <div className={`grid items-start gap-4 ${i === 2 ? "grid-cols-1" : "xl:grid-cols-2"}`}><Panel title={`ข้อมูล ${names[i]}`}><p className="text-sm text-muted-foreground">กรอกค่าตามหน่วยหัวตาราง หรือใช้ “นำเข้า / แปลงหน่วย” เพื่อวางตารางจาก Excel เลือก CSV / TSV, Excel .xlsx หรือ PDF พร้อมตรวจตัวอย่างก่อนใช้ข้อมูล</p><p className="text-sm font-medium">{i === 0 ? "คอลัมน์: RT (min), ผลรวม Area · Standard ตามจำนวนซ้ำที่กำหนดด้านล่าง" : i === 1 ? "คอลัมน์: Actual concentration, Area · หนึ่งแถวต่อ Injection" : "คอลัมน์: Target level, Fortified ตามทฤษฎี, Found · หนึ่งแถวต่อตัวอย่างที่เตรียม"}</p>{i === 0 && specificity.peakMode ? <p className="rounded-lg bg-muted p-3 text-sm">ใช้ข้อมูลแยกรายพีคในส่วน Blank และหลักฐานความจำเพาะด้านล่าง ข้อมูลแบบเดิมยังเก็บไว้และกลับมาใช้ได้เมื่อปิดโหมดรายพีค</p> : i === 1 ? <ValidationLinearityGrid value={texts[1]} onChange={value => updateText(1, value)} levels={plannedLinearity} stock={stock} stocks={stocks} /> : i === 2 ? <ValidationAccuracyGrid value={texts[2]} targets={accuracyTargets} readOnly={linked.includes("accuracy")} onChange={value => updateText(2, value)} /> : <ValidationDataGrid label={`ข้อมูล ${names[i]}`} columns={["RT (min)", "ผลรวม Area"]} value={texts[i]} onChange={value => updateText(i, value)} />}<p className="text-sm text-muted-foreground">อ่านได้ {i === 0 ? specificityResult.standardRows.length : parsed[i].rows.length} แถว · คำนวณอัตโนมัติเมื่อข้อมูลครบ</p>{i === 2 && <p className="text-sm text-muted-foreground">Recovery = Found ÷ Fortified ตามทฤษฎี × 100 · ใช้กับ Matrix Blank ที่ไม่มีสารเป้าหมายเท่านั้น</p>}</Panel><Panel title="ผลการคำนวณและเกณฑ์ยอมรับ"><Results checks={i === 0 ? specificityChecks : i === 1 ? linearityChecks : accuracyChecks} />{i === 0 && <p className="text-sm text-muted-foreground">{specificity.peakMode ? "RT ประเมินแยกรายพีค" : `Mean RT ${fmt(rt?.mean)} min`} · Mean Total Area {fmt(area?.mean)} · Sample SD {fmt(area?.sd)}</p>}{i === 1 && <p className="text-sm text-muted-foreground">Area = {fmt(fit?.slope)} × Concentration + ({fmt(fit?.intercept)}) · ถดถอยจากทุก Injection</p>}{i === 2 && <p className="text-sm text-muted-foreground">%RSD คำนวณจาก Recovery โดยใช้ Sample SD (n−1) · กำหนดฐาน Horwitz และข้อมูลรายวันในแท็บ Precision</p>}<div className="flex gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground"><Calculator className="h-4 w-4 shrink-0" />เก็บทศนิยมเต็มในการคำนวณ ปัดเศษเฉพาะค่าที่แสดง</div></Panel></div>
      {i === 0 && <ValidationSpecificity settings={specificity} context={specificityContext} onChange={setSpecificity} legacyBlank={blank} />}
      {i === 1 && <Panel title={`ตารางที่ 2 ผลการประเมินความเป็นเส้นตรงของวิธีวิเคราะห์ ${analyte}`}><div className="overflow-x-auto rounded-lg border bg-card shadow-sm"><table className="w-full text-sm"><thead className="bg-muted text-muted-foreground"><tr>{["ระดับ", "Actual (mg/mL)", "Area 1", "Area 2", "Area 3", "Mean Area", "SD", "%RSD"].map(label => <th key={label} className="p-3 text-right first:text-left">{label}</th>)}</tr></thead><tbody className="divide-y">{linearStats.map((level, index) => <tr key={index} className="hover:bg-accent"><td className="p-3">LV {index + 1}</td><td className="p-3 text-right tabular-nums">{level.x == null ? "—" : level.x.toFixed(3)}</td>{[0, 1, 2].map(rep => <td key={rep} className="p-3 text-right tabular-nums">{fmt(linearPreparation.groups[index]?.[rep]?.[1])}</td>)}{[level.stats?.mean, level.stats?.sd, level.stats?.rsd].map((value, column) => <td key={column} className="p-3 text-right tabular-nums">{fmt(value)}</td>)}</tr>)}</tbody></table></div><p className="text-sm text-muted-foreground">แสดง Actual 3 ตำแหน่ง · คำนวณ Mean, SD, %RSD และกราฟจากค่าความละเอียดเต็ม</p></Panel>}
      {i === 1 && <div className="grid gap-4 lg:grid-cols-2">{[false, true].map(residual => <Panel key={String(residual)} title={residual ? "Residual Plot" : "Linearity Plot"}>{fit ? <div dangerouslySetInnerHTML={{ __html: validationChartSvg(fit, analyte, residual) }} /> : <p className="py-12 text-center text-sm text-muted-foreground">กรอก Actual และ Area ให้ครบเพื่อแสดงกราฟ</p>}</Panel>)}</div>}
      {i === 2 && recoveryPoints.length > 0 && !invalidAccuracy && <Panel title="Recovery รายตัวอย่าง (%)"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={recoveryPoints}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="index" /><YAxis domain={["auto", "auto"]} /><Tooltip /><Line dataKey="recovery" name="Recovery (%)" stroke="hsl(var(--primary))" connectNulls={false} /></LineChart></ResponsiveContainer></div></Panel>}

      {i === 2 && <ValidationAccuracyTables section="accuracy" analyte={analyte} text={texts[2]} precision={precisionResult} checks={checks} />}
      </TabsContent>)}
      <TabsContent value="3" className="mt-4 space-y-4"><h2 className="text-xl font-semibold">4. Precision</h2>{matrixPreparation}<label className="block max-w-sm space-y-2 text-sm">แผนเตรียมสารสำหรับ Precision<NativeSelect value={preparationSources.precision} onChange={e => setPreparationSources(old => ({ ...old, precision: e.target.value as "std" | "matrix" }))}><option value="matrix">Matrix · ต่ำ–กลาง–สูง</option><option value="std">STD · ต่ำ–กลาง–สูง</option></NativeSelect></label><p className="text-sm text-muted-foreground">ใช้แผน {preparationSources.precision === "std" ? "STD" : "Matrix"} สำหรับข้อมูลระหว่างวัน · Repeatability ใช้ผลรายตัวอย่างจาก Accuracy</p><PrecisionPanel dailyLinked={linked.includes("daily")} settings={precision} onChange={next => setPrecision(old => ({ ...next, dailyData: linked.includes("daily") ? old.dailyData : next.dailyData }))} result={precisionResult} /><ValidationAccuracyTables section="precision" analyte={analyte} text={texts[2]} precision={precisionResult} checks={checks} /></TabsContent>
      <TabsContent value="4" className="mt-4 space-y-4"><h2 className="text-xl font-semibold">5. Overall Summary</h2><QcPanel linkedKinds={linked} settings={qc} onChange={next => setQc(old => ({ ...next, sampleData: linked.includes("sample") ? old.sampleData : next.sampleData, standardData: linked.includes("standard") ? old.standardData : next.standardData, spikeData: linked.includes("spike") ? old.spikeData : next.spikeData }))} result={qcResult} /><Panel title={`ตารางที่ 5 สรุปผลการตรวจสอบความใช้ได้ของวิธีวิเคราะห์ ${analyte} และสถานะการยอมรับ`}><div className="flex gap-3 rounded-lg bg-muted p-4"><FileCheck2 className="h-5 w-5 shrink-0 text-primary" /><p className="text-sm">ผลนี้เป็นฉบับร่าง ยังไม่สรุปผ่านทั้งวิธีจนกว่าจะมีหลักฐาน Specificity และประเมิน Precision ครบ ดาวน์โหลดรายงานพร้อมข้อมูลดิบและรายการที่ต้องทบทวนได้</p></div><Results checks={checks} /></Panel></TabsContent>
    </Tabs>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"><div><p className="text-sm">หนึ่งยา · หนึ่งงาน · บันทึกข้อมูลครบทุกหัวข้อในเบราว์เซอร์นี้</p><p className="text-sm text-muted-foreground">{savedWork ? `บันทึกล่าสุด ${formatDateTime(savedWork.savedAt)} · กดอัปเดตหลังแก้ไข` : "ยังไม่ได้บันทึกงานนี้"}</p></div><div className="ml-auto flex flex-wrap items-center justify-end gap-2"><Button onClick={() => saveSection(tab === "setup" ? "ตั้งค่างาน" : names[Number(tab)])}>{saveLabel}งาน Validation</Button></div>{saveStatus && <p role="status" className="w-full text-sm">{saveStatus}</p>}</div>
    {linked.length > 0 && <div className="rounded-lg border bg-card p-4 text-sm">งานเดิมมีผลที่เชื่อมจาก Area<Button className="ml-3" variant="outline" onClick={() => { setTexts(texts); setPrecision(precision); setQc(qc); setLinkedMeasurements(old => ({ ...old, enabled: [] })); }}>ใช้ผลคำนวณเดิมเป็นข้อมูลกรอกตรง</Button></div>}

    {errors.length > 0 && <Panel title="รายการที่ต้องแก้ไข"><ul className="space-y-2 text-sm text-destructive">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Panel>}
    <div className="flex items-start gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground"><FlaskConical className="h-5 w-5 shrink-0" /><p>ตรวจด้วยสูตรและเกณฑ์ที่ระบุ รองรับ CSV/TSV, Excel .xlsx และ PDF พร้อมเลือกชีต/หน้าและจับคู่คอลัมน์ AI ช่วยอ่านภาพ PDF ตามที่เลือกส่ง โดยต้องตรวจเทียบผลก่อนนำไปคำนวณ</p></div>
  </div></AppLayout>;
}
