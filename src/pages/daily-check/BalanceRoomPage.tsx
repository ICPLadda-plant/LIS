import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Camera,
  FileSpreadsheet,
  Printer,
  Plus,
  RotateCcw,
  Scale,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PrintPreviewDialog from "@/components/lis/PrintPreviewDialog";
import BalanceControlChart, { BalanceControlLegend } from "@/components/lis/BalanceControlChart";
import BalanceControlConfigDialog from "@/components/lis/BalanceControlConfigDialog";
import BalanceControlReport, { BALANCE_CONTROL_REPORT_CSS } from "@/components/lis/BalanceControlReport";
import { api, type DailyCheckRecord } from "@/lib/api";
import { getDailyCheckTrend, readBalanceDisplayValueFromImage, type DailyCheckTrend } from "@/lib/aiApi";
import { useAuth } from "@/context/AuthContext";
import { getCurrentDailyCheckPeriod, getDailyCheckPeriod, getDailyCheckPeriodLabel } from "@/lib/dailyCheckPeriod";
import { formatDate } from "@/lib/dateTime";
import { fmtDate, fmtTime } from "@/lib/dailyCheckFormat";
import { exportBalanceControlExcel } from "@/lib/balanceControlExport";
import {
  BALANCE_SCALES,
  CONTROL_STATUS_LABEL,
  balanceScaleTypeLabel,
  buildMonthlySeries,
  chartDomain,
  classifyPoint,
  computeLimits,
  controlBaselineValues,
  countByStatus,
  currentMonthStr,
  controlUpdateDueDate,
  displayDigits,
  formatControlNumber,
  formatSd,
  limitDecimalPlaces,
  formatThaiMonth,
  getBalanceControlConfig,
  isControlUpdateDue,
  monthRange,
  monthlyStats,
  type ControlPointStatus,
  type MonthlyPoint,
} from "@/lib/balanceControlChart";
import { cn } from "@/lib/utils";

// ห้องเครื่องชั่ง: บันทึก Calibrate ประจำวัน + Quality Control Chart (เทียบค่าที่ได้กับเส้น Mean / ±2SD / ±3SD)
// ค่า Control (Mean / STD) ตั้งต่อเครื่องผ่าน BalanceControlConfigDialog แล้วออกรายงานได้ทั้ง Print และ Excel

interface ScaleDraft {
  weights100: [string, string, string];
  weights10: [string, string, string];
  status100: "pass" | "fail" | "";
  status10: "pass" | "fail" | "";
  avg100?: number;
  avg10?: number;
  checkedAt?: string;
}

type RecordedPoint = MonthlyPoint<DailyCheckRecord> & { record: DailyCheckRecord; value: number };

const TOLERANCE = 0.05;

const STATUS_BADGE: Record<ControlPointStatus, NonNullable<BadgeProps["variant"]>> = {
  in: "green-soft",
  warning: "yellow-soft",
  out: "red-soft",
};

const SCALE_CARD_COLORS = [
  "border-sky-200 bg-sky-50/70 hover:bg-sky-100/70",
  "border-violet-200 bg-violet-50/70 hover:bg-violet-100/70",
  "border-teal-200 bg-teal-50/70 hover:bg-teal-100/70",
  "border-amber-200 bg-amber-50/70 hover:bg-amber-100/70",
  "border-rose-200 bg-rose-50/70 hover:bg-rose-100/70",
];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const emptyDraft = (): ScaleDraft => ({
  weights100: ["", "", ""],
  weights10: ["", "", ""],
  status100: "",
  status10: "",
});

/** ค่าเฉลี่ยของ 3 ครั้ง; null ถ้ายังกรอกไม่ครบหรือไม่ใช่ตัวเลข */
const calcAvg = (vals: readonly string[]): number | null => {
  const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n));
  if (nums.length !== 3) return null;
  return nums.reduce((a, b) => a + b, 0) / 3;
};

const evaluate = (avg: number, target: number): "pass" | "fail" =>
  Math.abs(avg - target) <= TOLERANCE ? "pass" : "fail";

const isPositiveWeight = (value: string) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;

/** เลขพร้อมเครื่องหมาย เช่น +0.000012 / −1.25 */
const signed = (value: number, digits: number) => {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
};

const controlDueMonth = (updatedDate: string) => {
  const dueDate = controlUpdateDueDate(updatedDate);
  return dueDate ? formatThaiMonth(dueDate.toISOString().slice(0, 7)) : "—";
};

const BalanceRoomPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const todayLabel = formatDate(new Date());
  const currentPeriod = getCurrentDailyCheckPeriod();
  const currentPeriodLabel = getDailyCheckPeriodLabel(currentPeriod);

  const [drafts, setDrafts] = useState<Record<string, ScaleDraft>>({});
  const [consecutiveAlert, setConsecutiveAlert] = useState<DailyCheckTrend | null>(null);
  const [selectedScaleId, setSelectedScaleId] = useState(BALANCE_SCALES[0].id);
  const [month, setMonth] = useState(() => currentMonthStr());
  const [printOpen, setPrintOpen] = useState(false);
  const [printedAt, setPrintedAt] = useState("");
  const [configWeight, setConfigWeight] = useState<number | null>(null);
  const [weightInfoOpen, setWeightInfoOpen] = useState(false);
  const [newWeight, setNewWeight] = useState("");
  const [weightCodeDrafts, setWeightCodeDrafts] = useState<Record<number, string>>({});
  const [historyWeight, setHistoryWeight] = useState<number>(BALANCE_SCALES[0].controlWeight);
  const [recordDate, setRecordDate] = useState(todayStr);
  const [exporting, setExporting] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<{ type: "100" | "10"; index: number } | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const scale = BALANCE_SCALES.find(s => s.id === selectedScaleId) ?? BALANCE_SCALES[0];
  const typeLabel = balanceScaleTypeLabel(scale);

  useEffect(() => setHistoryWeight(scale.controlWeight), [scale.controlWeight]);

  useEffect(() => {
    let cancelled = false;
    setConsecutiveAlert(null);
    getDailyCheckTrend({ type: "consecutive", scaleId: selectedScaleId, days: 7 })
      .then(result => {
        if (!cancelled) setConsecutiveAlert(result);
      })
      .catch(() => {
        if (!cancelled) setConsecutiveAlert(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedScaleId]);

  // วันนี้ (สถานะของทุกเครื่อง + ผลที่บันทึกแล้วบนฟอร์ม)
  const { data: todayRecords = [] } = useQuery({
    queryKey: ["daily-checks", "today"],
    queryFn: () => api.getDailyChecks({ date: todayStr() }),
    refetchOnWindowFocus: true,
  });

  const { data: controlConfigs } = useQuery({
    queryKey: ["balance-control-config"],
    queryFn: () => api.getBalanceControlConfigs(),
  });

  // ทั้งเดือนของเครื่องที่เลือก (สำหรับกราฟ / ตาราง / รายงาน)
  const range = monthRange(month);
  const { data: monthRecords, isLoading: monthLoading } = useQuery({
    queryKey: ["daily-checks", "month", selectedScaleId, month],
    queryFn: () =>
      range ? api.getDailyChecks({ from: range.from, to: range.to, scaleId: selectedScaleId }) : Promise.resolve([]),
    enabled: !!range,
  });

  const latestByScale = useMemo(() => {
    const map: Record<string, DailyCheckRecord> = {};
    for (const r of todayRecords) {
      if (currentPeriod) {
        const recordPeriod = r.period ?? getDailyCheckPeriod(r.checkedAt);
        if (recordPeriod !== currentPeriod) continue;
      }
      if (!map[r.scaleId]) map[r.scaleId] = r;
    }
    return map;
  }, [todayRecords, currentPeriod]);

  const config = getBalanceControlConfig(controlConfigs, scale.id, scale.controlWeight);
  const series = useMemo(() => buildMonthlySeries(monthRecords ?? [], month, scale.controlWeight), [monthRecords, month, scale.controlWeight]);
  const values = useMemo(() => series.map(point => point.value), [series]);
  const baselineValues = useMemo(() => controlBaselineValues(series, 20), [series]);
  const baselineStats = useMemo(() => monthlyStats(baselineValues), [baselineValues]);
  const savedLimits = useMemo(() => computeLimits(config.mean, config.sd), [config.mean, config.sd]);
  const limits = useMemo(
    () => savedLimits ?? (baselineStats.n === 20 ? computeLimits(baselineStats.mean, baselineStats.sd) : null),
    [baselineStats, savedLimits],
  );
  const digits = displayDigits(scale.decimals, limits?.sd ?? config.sd);
  const domain = useMemo(() => chartDomain(limits, values), [limits, values]);
  const stats = useMemo(() => monthlyStats(values), [values]);
  const counts = useMemo(() => countByStatus(values, limits), [values, limits]);
  const otherWeight = scale.controlWeight === 10 ? scale.primaryCalibrationWeight : 10;
  const otherConfig = getBalanceControlConfig(controlConfigs, scale.id, otherWeight);
  const otherSeries = buildMonthlySeries(monthRecords ?? [], month, otherWeight === 10 ? 10 : 100);
  const otherValues = otherSeries.map((point) => point.value);
  const otherBaselineStats = monthlyStats(controlBaselineValues(otherSeries, 20));
  const otherSavedLimits = computeLimits(otherConfig.mean, otherConfig.sd);
  const otherLimits = otherSavedLimits
    ?? (otherBaselineStats.n === 20 ? computeLimits(otherBaselineStats.mean, otherBaselineStats.sd) : null);
  const otherDigits = displayDigits(scale.decimals, otherLimits?.sd ?? otherConfig.sd);
  const otherDomain = chartDomain(otherLimits, otherValues);
  const otherStats = monthlyStats(otherValues);
  const otherCounts = countByStatus(otherValues, otherLimits);
  const chartPanels = [
    { weight: scale.controlWeight, config, series, limits, domain, digits, stats, baselineStats, counts },
    { weight: otherWeight, config: otherConfig, series: otherSeries, limits: otherLimits, domain: otherDomain, digits: otherDigits, stats: otherStats, baselineStats: otherBaselineStats, counts: otherCounts },
  ].sort((a, b) => a.weight - b.weight);
  const activeConfig = getBalanceControlConfig(controlConfigs, scale.id, configWeight ?? chartPanels[0].weight);
  const activeDigits = displayDigits(scale.decimals, activeConfig.sd);
  const weightConfigs = (controlConfigs?.filter((item) => item.scaleId === scale.id) ?? chartPanels.map((panel) => panel.config))
    .sort((a, b) => a.nominal - b.nominal);
  const historyPanel = chartPanels.find((panel) => panel.weight === historyWeight) ?? chartPanels[0];
  const recordedPoints = historyPanel.series.filter((point): point is RecordedPoint => point.record != null && point.value != null);
  const duePanels = chartPanels.filter((panel) => isControlUpdateDue(panel.config.updatedDate));

  const weightCodeMutation = useMutation({
    mutationFn: ({ nominal, weightCode }: { nominal: number; weightCode: string }) =>
      api.updateBalanceWeightCode(nominal, weightCode),
    onSuccess: (_data, vars) => {
      toast.success(`บันทึกรหัสตุ้ม ${vars.nominal} g แล้ว`);
      setWeightCodeDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.nominal];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["balance-control-config"] });
    },
    onError: (err: Error) => toast.error(err.message || "บันทึกรหัสตุ้มไม่สำเร็จ"),
  });

  const createMutation = useMutation({
    mutationFn: api.createDailyCheck,
    onSuccess: (_data, vars) => {
      const saved = BALANCE_SCALES.find(s => s.id === vars.scaleId);
      const name = saved?.name ?? vars.scaleName;
      const allPass = vars.status100 === "pass" && vars.status10 === "pass";
      if (allPass) toast.success(`${name} ผ่านการ Calibrate`);
      else toast.warning(`${name} ไม่ผ่านการ Calibrate`);

      queryClient.invalidateQueries({ queryKey: ["daily-checks"] });
      setMonth(vars.date.slice(0, 7));
      // เคลียร์ draft ของ scale นั้น — watcher จะปลดแจ้งเตือนเองเมื่อครบ
      setDrafts(prev => {
        const c = { ...prev };
        delete c[vars.scaleId];
        return c;
      });
    },
    onError: (err: Error) => toast.error(err.message || "บันทึกไม่สำเร็จ"),
  });

  const getDraft = (id: string): ScaleDraft => drafts[id] || emptyDraft();

  const updateWeight = (id: string, type: "100" | "10", index: number, value: string) => {
    const r = getDraft(id);
    const limitedValue = limitDecimalPlaces(value, scale.decimals);
    if (type === "100") {
      const w = [...r.weights100] as [string, string, string];
      w[index] = limitedValue;
      setDrafts(prev => ({ ...prev, [id]: { ...r, weights100: w, status100: "", status10: "", checkedAt: undefined } }));
    } else {
      const w = [...r.weights10] as [string, string, string];
      w[index] = limitedValue;
      setDrafts(prev => ({ ...prev, [id]: { ...r, weights10: w, status100: "", status10: "", checkedAt: undefined } }));
    }
  };

  const openWeightCamera = (type: "100" | "10", index: number) => {
    setCameraTarget({ type, index });
    cameraInputRef.current?.click();
  };

  const handleWeightPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !cameraTarget) return;
    if (!file.type.startsWith("image/")) {
      toast.error("กรุณาถ่ายหรือเลือกไฟล์รูปภาพ");
      return;
    }

    setReadingPhoto(true);
    try {
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
        reader.readAsDataURL(file);
      });
      const result = await readBalanceDisplayValueFromImage(imageDataUrl);
      if (!result.value || !isPositiveWeight(result.value)) {
        toast.error(result.error || "อ่านค่าจากหน้าจอไม่ได้ กรุณาถ่ายให้ตรงและชัดขึ้น");
        return;
      }
      updateWeight(scale.id, cameraTarget.type, cameraTarget.index, result.value);
      toast.success(`อ่านค่าได้ ${result.value} g`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อ่านรูปไม่สำเร็จ");
    } finally {
      setReadingPhoto(false);
    }
  };

  const handleCheck = (id: string) => {
    const r = getDraft(id);
    if (!recordDate) {
      toast.error("กรุณาเลือกวันที่บันทึก");
      return;
    }
    if (r.weights100.some(v => !v) || r.weights10.some(v => !v)) {
      toast.error("กรุณากรอกค่าน้ำหนักให้ครบทั้ง 6 ค่า");
      return;
    }
    if (![...r.weights100, ...r.weights10].every(isPositiveWeight)) {
      toast.error("ค่าน้ำหนักต้องเป็นตัวเลขที่มากกว่า 0");
      return;
    }
    if (!user?.name) {
      toast.error("ไม่พบชื่อผู้ใช้งานปัจจุบัน");
      return;
    }
    const avg100 = calcAvg(r.weights100);
    const avg10 = calcAvg(r.weights10);
    if (avg100 === null || avg10 === null) {
      toast.error("ค่าน้ำหนักไม่ถูกต้อง");
      return;
    }
    const target = BALANCE_SCALES.find(s => s.id === id) ?? scale;

    createMutation.mutate({
      scaleId: id,
      scaleName: target.name,
      date: recordDate,
      model: target.model,
      weights100: r.weights100,
      weights10: r.weights10,
      avg100,
      avg10,
      status100: evaluate(avg100, target.primaryCalibrationWeight),
      status10: evaluate(avg10, 10),
      tolerance: TOLERANCE,
      recorder: user.name,
      recorderId: user.id,
      recorderEmail: user.email,
    });
  };

  const handleRecheck = (id: string) => {
    setDrafts(prev => ({ ...prev, [id]: emptyDraft() }));
  };

  const handlePrint = () => {
    setPrintedAt(new Date().toISOString());
    setPrintOpen(true);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportBalanceControlExcel({ scale, config, limits, series, month });
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Export Excel ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  };

  const checkedCount = Object.keys(latestByScale).length;
  const passCount = Object.values(latestByScale).filter(r => r.status === "pass").length;

  const todayRec = latestByScale[scale.id];
  const draft = getDraft(scale.id);
  // มีผลวันนี้แล้วและยังไม่ได้เริ่มกรอกใหม่ → แสดงผลที่บันทึกไว้
  const showResult = !!todayRec && !drafts[scale.id];
  const savingThisScale = createMutation.isPending && createMutation.variables?.scaleId === scale.id;
  const hasInvalidWeight = [...draft.weights100, ...draft.weights10].some(value => value !== "" && !isPositiveWeight(value));

  // ค่าปัจจุบัน (กำลังกรอก หรือผลที่บันทึกแล้ววันนี้) เทียบกับเส้น Control
  const compareValue = scale.controlWeight === 10
    ? (showResult ? todayRec?.avg10 ?? null : calcAvg(draft.weights10))
    : (showResult ? todayRec?.avg100 ?? null : calcAvg(draft.weights100));
  const compareStatus = classifyPoint(compareValue, limits);

  const fmt = (value: number | null | undefined) => formatControlNumber(value, scale.decimals);
  const formatReading = (value: string | number | null | undefined) => {
    const numeric = Number(value);
    return value == null || value === "" || !Number.isFinite(numeric) ? "—" : formatControlNumber(numeric, scale.decimals);
  };

  const infoItems = [
    { label: "รหัสเครื่องมือ", value: scale.code },
    { label: "ยี่ห้อ", value: config.brand || "—" },
    { label: "รุ่น", value: config.model || "—" },
    { label: "รหัสตุ้มน้ำหนัก", value: config.weightCode || "—" },
    { label: "ตุ้ม Calibration", value: `10 g และ ${scale.primaryCalibrationWeight} g` },
    { label: "น้ำหนักตุ้ม Control Chart", value: `${scale.controlWeight} g` },
    { label: "ประจำเดือน/ปี", value: formatThaiMonth(month) },
  ];

  const weightBlock = (type: "100" | "10") => {
    const nominalWeight = type === "100" ? scale.primaryCalibrationWeight : 10;
    const weights = type === "100" ? draft.weights100 : draft.weights10;
    const savedWeights = type === "100" ? todayRec?.weights100 : todayRec?.weights10;
    const savedStatus = type === "100" ? todayRec?.status100 : todayRec?.status10;
    const savedAvg = type === "100" ? todayRec?.avg100 : todayRec?.avg10;
    return (
      <div>
        <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          น้ำหนักมาตรฐาน {nominalWeight} g (3 ครั้ง)
          {showResult && savedStatus === "pass" && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
          {showResult && savedStatus === "fail" && <span className="text-xs text-destructive">ไม่ผ่าน</span>}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex min-w-0 gap-1">
              <Input
                type="number"
                step={10 ** -scale.decimals}
                inputMode="decimal"
                placeholder={showResult && savedWeights ? String(savedWeights[i] ?? "") : `ครั้งที่ ${i + 1}`}
                value={weights[i]}
                onChange={e => updateWeight(scale.id, type, i, e.target.value)}
                onWheel={e => e.currentTarget.blur()}
                min={10 ** -scale.decimals}
                aria-invalid={weights[i] !== "" && (!isPositiveWeight(weights[i]) || Math.abs(Number(weights[i]) - nominalWeight) > TOLERANCE)}
                title={weights[i] !== "" && !isPositiveWeight(weights[i]) ? "ค่าน้ำหนักต้องมากกว่า 0" : undefined}
                disabled={createMutation.isPending}
                className="h-9 min-w-0 text-sm tabular-nums aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label={`ถ่ายรูปอ่านค่าน้ำหนัก ${nominalWeight} กรัม ครั้งที่ ${i + 1}`}
                onClick={() => openWeightCamera(type, i)}
                disabled={createMutation.isPending || readingPhoto}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        {showResult && savedAvg != null && (
          <p className={cn("mt-1 text-xs", savedStatus === "pass" ? "text-green-600" : "text-destructive")}>
            ค่าเฉลี่ย: {savedAvg.toFixed(scale.decimals)} g {savedStatus === "pass" ? "อยู่ในเกณฑ์" : "เกินเกณฑ์"} (±{TOLERANCE}g)
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleWeightPhoto} />
      {/* หัวรายงาน + ตัวเลือกเครื่อง/เดือน + ออกรายงาน */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:p-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 shrink-0 text-primary" />
              <h2 className="text-base font-semibold text-foreground">{"Quality Control Chart & Statistical Report"}</h2>
            </div>
            <p className="text-sm text-muted-foreground">แบบบันทึกการตรวจสอบเครื่องชั่งประจำวัน และกราฟควบคุมคุณภาพ</p>
            <p className="text-xs text-muted-foreground">
              ห้องเครื่องชั่ง — Calibrate เครื่องชั่ง · ประจำวัน — {todayLabel} · บันทึกได้ทุกเวลา
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="balance-month" className="text-xs text-muted-foreground">ประจำเดือน</Label>
              <Input
                id="balance-month"
                type="month"
                value={month}
                max={currentMonthStr()}
                onChange={e => {
                  if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value);
                }}
                className="sm:w-44"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={() => setWeightInfoOpen(true)}>
                <Scale className="h-4 w-4" /> รหัสตุ้มน้ำหนัก
              </Button>
              <Button className="gap-2" onClick={handlePrint}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button variant="success" className="gap-2" onClick={handleExport} disabled={exporting}>
                <FileSpreadsheet className="h-4 w-4" /> {exporting ? "กำลัง Export..." : "Export Excel"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {consecutiveAlert?.alert && consecutiveAlert.message && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{consecutiveAlert.message}</AlertDescription>
        </Alert>
      )}

      {duePanels.length > 0 && (
        <Alert className="border-destructive bg-destructive text-destructive-foreground [&>svg]:text-destructive-foreground">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>ครบ 3 เดือนแล้ว กรุณาอัปเดตค่า Control ใหม่สำหรับตุ้ม {duePanels.map((panel) => `${panel.weight} g`).join(" และ ")}</span>
            <div className="flex flex-wrap gap-2">
              {duePanels.map((panel) => (
                <Button key={panel.weight} type="button" variant="outline" size="sm" className="border-destructive-foreground/60 bg-transparent text-destructive-foreground hover:bg-destructive-foreground/10 hover:text-destructive-foreground" onClick={() => setConfigWeight(panel.weight)}>
                  แก้ไข {panel.weight} g
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* สถานะวันนี้ของทุกเครื่อง — คลิกเพื่อเลือกเครื่อง */}
      <section className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">สถานะการ Calibrate วันนี้</h3>
            <p className="text-sm text-muted-foreground">เลือกเครื่องเพื่อบันทึกผลและดูกราฟควบคุม</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {currentPeriod && <Badge variant="outline">รอบ{currentPeriodLabel}</Badge>}
            <Badge variant="outline">ตรวจแล้ว {checkedCount}/{BALANCE_SCALES.length}</Badge>
            <Badge variant="green-soft">ผ่าน {passCount}/{BALANCE_SCALES.length}</Badge>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {BALANCE_SCALES.map((s, index) => {
            const rec = latestByScale[s.id];
            const active = s.id === scale.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedScaleId(s.id)}
                className={cn(
                  "flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left shadow-sm transition-colors",
                  SCALE_CARD_COLORS[index % SCALE_CARD_COLORS.length],
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active && "border-primary ring-1 ring-primary",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium leading-snug text-foreground">{s.name}</span>
                  {rec ? (
                    <Badge variant={rec.status === "pass" ? "green-soft" : "red-soft"} className="shrink-0">
                      {rec.status === "pass" ? "ผ่าน" : "ไม่ผ่าน"}
                    </Badge>
                  ) : (
                    <Badge variant="gray-soft" className="shrink-0">ยังไม่ตรวจ</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {rec ? `${fmtTime(rec.checkedAt)} · ${rec.recorder}` : "ยังไม่ได้บันทึกวันนี้"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ข้อมูลเครื่องมือ */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 xl:grid-cols-6">
          {infoItems.map(item => (
            <div key={item.label} className="min-w-0">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="truncate text-sm font-semibold text-foreground">{item.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ฟอร์มบันทึกของเครื่องที่เลือก */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-primary" />
                {scale.code}
              </CardTitle>
              <CardDescription>{typeLabel}</CardDescription>
            </div>
            {todayRec ? (
              <Badge variant={todayRec.status === "pass" ? "green-soft" : "red-soft"}>
                {todayRec.status === "pass" ? "ผ่านวันนี้" : "ไม่ผ่านวันนี้"}
              </Badge>
            ) : (
              <Badge variant="gray-soft">ยังไม่ตรวจวันนี้</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="balance-record-date">วันที่บันทึก</Label>
              <Input
                id="balance-record-date"
                type="date"
                value={recordDate}
                max={todayStr()}
                required
                onChange={event => setRecordDate(event.target.value)}
              />
              {recordDate !== todayStr() && <p className="text-xs text-muted-foreground">กำลังบันทึกข้อมูลย้อนหลัง</p>}
            </div>
            {weightBlock("10")}
            {weightBlock("100")}

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">เทียบกับเส้น Control (ตุ้ม {scale.controlWeight} g)</p>
              {!limits ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  ยังไม่มีค่า Mean / STD ของเครื่องนี้ — กดปุ่มตั้งค่าเพื่อเริ่มเทียบกับกราฟ
                </p>
              ) : compareValue == null ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  กรอกค่าตุ้ม {scale.controlWeight} g ให้ครบ 3 ครั้ง ระบบจะเทียบกับเส้น Control ให้ทันที
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{fmt(compareValue)} g</p>
                    <p className="text-xs text-muted-foreground">
                      ต่างจาก Mean {signed(compareValue - limits.mean, digits)} (
                      {signed((compareValue - limits.mean) / limits.sd, 2)} SD)
                    </p>
                  </div>
                  {compareStatus && (
                    <Badge variant={STATUS_BADGE[compareStatus]}>{CONTROL_STATUS_LABEL[compareStatus]}</Badge>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">ผู้บันทึก</label>
              <Input
                value={showResult && todayRec ? todayRec.recorder : (user?.name ?? "")}
                readOnly
                disabled
                className="h-9 bg-muted/40 text-sm"
              />
            </div>

            {showResult ? (
              <Button variant="outline" className="w-full gap-2" onClick={() => handleRecheck(scale.id)}>
                <RotateCcw className="h-4 w-4" /> บันทึกซ้ำ
              </Button>
            ) : (
              <Button className="w-full gap-2" onClick={() => handleCheck(scale.id)} disabled={createMutation.isPending || hasInvalidWeight}>
                <CheckCircle2 className="h-4 w-4" />
                {savingThisScale ? "กำลังบันทึก..." : "บันทึกผล Calibrate"}
              </Button>
            )}

            {todayRec && (
              <p className="text-xs text-muted-foreground">
                ตรวจล่าสุด: {fmtTime(todayRec.checkedAt)} โดย {todayRec.recorder}
              </p>
            )}
          </CardContent>
        </Card>

        {/* กราฟควบคุมคุณภาพ */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="space-y-1">
              <CardTitle className="text-base">กราฟควบคุมคุณภาพ (Control Chart)</CardTitle>
              <CardDescription>
                แยกตามตุ้ม Calibration ทั้ง 2 เกณฑ์ของ {scale.code} — {formatThaiMonth(month)}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-2">
            {chartPanels.map((panel) => (
              <section key={panel.weight} className="space-y-3 rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">ตุ้ม {panel.weight} g</h3>
                    <p className="text-xs text-muted-foreground">ค่าเฉลี่ยรายวันและเส้น Control ของเกณฑ์นี้</p>
                    <p className="text-xs text-muted-foreground">
                      อัปเดตล่าสุด: {panel.config.updatedDate ? fmtDate(panel.config.updatedDate) : "—"} · ครบกำหนด: {controlDueMonth(panel.config.updatedDate)}
                    </p>
                  </div>
                  {panel.limits ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {isControlUpdateDue(panel.config.updatedDate) && <Badge variant="yellow-soft">ครบกำหนดอัปเดต</Badge>}
                      <Badge variant="green-soft">ในเกณฑ์ {panel.counts.in}</Badge>
                      <Badge variant="yellow-soft">เกิน 2SD {panel.counts.warning}</Badge>
                      <Badge variant="red-soft">เกิน 3SD {panel.counts.out}</Badge>
                      <Button variant="outline" size="sm" className="ml-1 h-7 gap-1 px-2" onClick={() => setConfigWeight(panel.weight)}>
                        <Settings2 className="h-3.5 w-3.5" /> แก้ไขค่า Control
                      </Button>
                    </div>
                  ) : null}
                </div>
                <dl className="grid grid-cols-3 gap-x-4 gap-y-2 border-y py-2 sm:grid-cols-6">
                  {[
                    ["Mean", formatControlNumber(panel.limits?.mean, panel.digits)],
                    ["STD", formatSd(panel.limits?.sd ?? panel.config.sd)],
                    ["UWL", formatControlNumber(panel.limits?.uwl, panel.digits)],
                    ["LWL", formatControlNumber(panel.limits?.lwl, panel.digits)],
                    ["UCL", formatControlNumber(panel.limits?.ucl, panel.digits)],
                    ["LCL", formatControlNumber(panel.limits?.lcl, panel.digits)],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 text-center">
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="truncate text-sm font-semibold tabular-nums text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
                {panel.domain ? (
                  <>
                    <BalanceControlChart series={panel.series} limits={panel.limits} domain={panel.domain} digits={panel.digits} className="h-[280px]" />
                    {panel.limits ? (
                      <BalanceControlLegend controlWeight={panel.weight} />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-center sm:flex-row">
                        <p className="text-sm text-muted-foreground">กราฟมีข้อมูลแล้ว แต่ยังไม่มีเส้น Mean/UWL/LWL/UCL/LCL</p>
                        <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => setConfigWeight(panel.weight)}>
                          <Settings2 className="h-4 w-4" /> ตั้งค่า {panel.weight} g
                        </Button>
                      </div>
                    )}
                    <p className="text-center text-xs text-muted-foreground">
                      ข้อมูล {panel.stats.n} วัน · baseline {panel.baselineStats.n}/20 ค่า
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed px-4 py-10 text-center">
                    <Activity className="h-7 w-7 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลหรือค่า Control สำหรับตุ้ม {panel.weight} g</p>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => setConfigWeight(panel.weight)}>
                      <Settings2 className="h-4 w-4" /> ตั้งค่า {panel.weight} g
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ตารางบันทึกรายวันของเดือน */}
      <section className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">บันทึกรายวัน — {formatThaiMonth(month)}</h3>
            <p className="text-sm text-muted-foreground">
              ใช้ผลการบันทึกล่าสุดของแต่ละวัน (ค่าเฉลี่ยตุ้ม {historyPanel.weight} g) เทียบกับเส้น Control
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="เลือกน้ำหนักสำหรับบันทึกรายวัน">
            {chartPanels.map((panel) => (
              <Button
                key={panel.weight}
                type="button"
                size="sm"
                variant={historyPanel.weight === panel.weight ? "default" : "outline"}
                aria-pressed={historyPanel.weight === panel.weight}
                aria-label={`แสดงบันทึกตุ้ม ${panel.weight} g`}
                onClick={() => setHistoryWeight(panel.weight)}
              >
                ตุ้ม {panel.weight} g
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">วันที่</th>
                <th className="px-3 py-2 text-right font-medium">ครั้งที่ 1</th>
                <th className="px-3 py-2 text-right font-medium">ครั้งที่ 2</th>
                <th className="px-3 py-2 text-right font-medium">ครั้งที่ 3</th>
                <th className="px-3 py-2 text-right font-medium">ค่าเฉลี่ย (g)</th>
                <th className="px-3 py-2 text-right font-medium">ส่วนต่างจาก Mean</th>
                <th className="px-3 py-2 text-left font-medium">สถานะ Control</th>
                <th className="px-3 py-2 text-left font-medium">ผล Calibrate</th>
                <th className="px-3 py-2 text-left font-medium">ผู้บันทึก</th>
                <th className="px-3 py-2 text-left font-medium">เวลา</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recordedPoints.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    {monthLoading ? "กำลังโหลดข้อมูล..." : "ยังไม่มีการบันทึกของเครื่องนี้ในเดือนที่เลือก"}
                  </td>
                </tr>
              ) : (
                recordedPoints.map(point => {
                  const status = classifyPoint(point.value, historyPanel.limits);
                  const calibrateStatus = historyPanel.weight === 10
                    ? point.record.status10 ?? point.record.status
                    : point.record.status100 ?? point.record.status;
                  const readings = historyPanel.weight === 10 ? point.record.weights10 : point.record.weights100;
                  return (
                    <tr key={point.date} className="hover:bg-accent">
                      <td className="px-3 py-2">{fmtDate(point.date)}</td>
                      {[0, 1, 2].map(index => (
                        <td key={index} className="px-3 py-2 text-right tabular-nums">{formatReading(readings[index])}</td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums">{formatControlNumber(point.value, scale.decimals)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {historyPanel.limits ? signed(point.value - historyPanel.limits.mean, historyPanel.digits) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {status ? (
                          <Badge variant={STATUS_BADGE[status]}>{CONTROL_STATUS_LABEL[status]}</Badge>
                        ) : (
                          <Badge variant="gray-soft">ยังไม่ตั้งค่า</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={calibrateStatus === "pass" ? "green-soft" : "red-soft"}>
                          {calibrateStatus === "pass" ? "ผ่าน" : "ไม่ผ่าน"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{point.record.recorder}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtTime(point.record.checkedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {printOpen && (
        <PrintPreviewDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          docType="daily-check-report"
          css={BALANCE_CONTROL_REPORT_CSS}
        >
          {chartPanels.map((panel, index) => (
            <BalanceControlReport
              key={panel.weight}
              scale={scale}
              config={panel.config}
              limits={panel.limits}
              series={panel.series}
              domain={panel.domain}
              digits={panel.digits}
              month={month}
              printedBy={user?.name ?? user?.email ?? ""}
              printedAt={printedAt || new Date().toISOString()}
              pageNumber={index + 1}
              totalPages={chartPanels.length}
            />
          ))}
        </PrintPreviewDialog>
      )}

      <Dialog open={weightInfoOpen} onOpenChange={setWeightInfoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ข้อมูลตุ้มน้ำหนักที่ใช้</DialogTitle>
            <DialogDescription>รหัสตุ้มผูกกับขนาดตุ้ม ใช้ร่วมกันทุกเครื่องชั่ง</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {weightConfigs.map((weightConfig) => (
              <div key={weightConfig.nominal} className="flex items-end justify-between gap-3 rounded-lg border bg-card p-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`weight-code-${weightConfig.nominal}`}>รหัสตุ้ม {weightConfig.nominal} g</Label>
                  <Input
                    id={`weight-code-${weightConfig.nominal}`}
                    value={weightCodeDrafts[weightConfig.nominal] ?? weightConfig.weightCode}
                    onChange={(event) => setWeightCodeDrafts((prev) => ({ ...prev, [weightConfig.nominal]: event.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={weightCodeMutation.isPending || (weightCodeDrafts[weightConfig.nominal] ?? weightConfig.weightCode).trim() === weightConfig.weightCode}
                  onClick={() => weightCodeMutation.mutate({ nominal: weightConfig.nominal, weightCode: (weightCodeDrafts[weightConfig.nominal] ?? "").trim() })}
                >
                  บันทึก
                </Button>
              </div>
            ))}
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="new-balance-weight">เพิ่มขนาดตุ้ม (g)</Label>
                <Input id="new-balance-weight" type="number" min="1" step="1" inputMode="numeric" value={newWeight} onChange={(event) => setNewWeight(event.target.value)} />
              </div>
              <Button
                type="button"
                className="gap-2"
                disabled={!Number.isInteger(Number(newWeight)) || Number(newWeight) <= 0 || weightConfigs.some((item) => item.nominal === Number(newWeight))}
                onClick={() => { weightCodeMutation.mutate({ nominal: Number(newWeight), weightCode: "" }); setNewWeight(""); }}
              >
                <Plus className="h-4 w-4" /> เพิ่มขนาดตุ้ม
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BalanceControlConfigDialog
        open={configWeight != null}
        onOpenChange={(open) => { if (!open) setConfigWeight(null); }}
        scale={scale}
        config={activeConfig}
        digits={activeDigits}
      />
    </div>
  );
};

export default BalanceRoomPage;
