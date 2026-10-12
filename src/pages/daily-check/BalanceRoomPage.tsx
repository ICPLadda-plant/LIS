import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDailyCheckTrend, type DailyCheckTrend } from '@/lib/aiApi';
import { Scale, CheckCircle2, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api, type DailyCheckRecord } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getCurrentDailyCheckPeriod, getDailyCheckPeriod, getDailyCheckPeriodLabel } from "@/lib/dailyCheckPeriod";
import { formatDate, formatTime } from "@/lib/dateTime";

interface ScaleDraft {
  weights100: [string, string, string];
  weights10: [string, string, string];
  status100: "pass" | "fail" | "";
  status10: "pass" | "fail" | "";
  avg100?: number;
  avg10?: number;
  checkedAt?: string;
}

const SCALES = [
  { id: "scale-1", name: "เครื่องชั่ง 1", model: "Balance A" },
  { id: "scale-2", name: "เครื่องชั่ง 2", model: "Balance B" },
  { id: "scale-3", name: "เครื่องชั่ง 3", model: "Balance C" },
  { id: "scale-4", name: "เครื่องชั่ง 4", model: "Balance D" },
  { id: "scale-5", name: "เครื่องชั่ง 5", model: "Balance E" },
];

const TOLERANCE = 0.05;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtTime = (iso: string) => formatTime(iso);

const emptyDraft = (): ScaleDraft => ({
  weights100: ["", "", ""],
  weights10: ["", "", ""],
  status100: "",
  status10: "",
});

const BalanceRoomPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const todayLabel = formatDate(new Date());
  const currentPeriod = getCurrentDailyCheckPeriod();
  const currentPeriodLabel = getDailyCheckPeriodLabel(currentPeriod);
  const currentPeriodHint = currentPeriod === "morning"
    ? "08:00–12:00"
    : currentPeriod === "afternoon"
      ? "13:00–17:00"
      : "เปิด 08:00–12:00 และ 13:00–17:00";

  const [drafts, setDrafts] = useState<Record<string, ScaleDraft>>({});
  const [consecutiveAlert, setConsecutiveAlert] = useState<DailyCheckTrend | null>(null);

  useEffect(() => {
    const sid = SCALES[0]?.id ?? '01';
    if (!sid) return;
    getDailyCheckTrend({ type: 'consecutive', scaleId: sid, days: 7 }).then(setConsecutiveAlert);
  }, []);

  // วันนี้ (สำหรับแสดง record ของวันนี้บนการ์ดเช็ค)
  const { data: todayRecords = [] } = useQuery({
    queryKey: ["daily-checks", "today"],
    queryFn: () => api.getDailyChecks({ date: todayStr() }),
    refetchOnWindowFocus: true,
  });

  const latestByScale = useMemo(() => {
    const map: Record<string, DailyCheckRecord> = {};
    if (!currentPeriod) return map;
    for (const r of todayRecords) {
      const recordPeriod = r.period ?? getDailyCheckPeriod(r.checkedAt);
      if (recordPeriod !== currentPeriod) continue;
      if (!map[r.scaleId]) map[r.scaleId] = r;
    }
    return map;
  }, [todayRecords, currentPeriod]);

  const createMutation = useMutation({
    mutationFn: api.createDailyCheck,
    onSuccess: (_data, vars) => {
      const scale = SCALES.find(s => s.id === vars.scaleId)!;
      const allPass = vars.status100 === "pass" && vars.status10 === "pass";
      if (allPass) toast.success(`${scale.name} ผ่านการ Calibrate`);
      else toast.warning(`${scale.name} ไม่ผ่านการ Calibrate`);

      queryClient.invalidateQueries({ queryKey: ["daily-checks"] });
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
    if (type === "100") {
      const w = [...r.weights100] as [string, string, string];
      w[index] = value;
      setDrafts(prev => ({ ...prev, [id]: { ...r, weights100: w, status100: "", status10: "", checkedAt: undefined } }));
    } else {
      const w = [...r.weights10] as [string, string, string];
      w[index] = value;
      setDrafts(prev => ({ ...prev, [id]: { ...r, weights10: w, status100: "", status10: "", checkedAt: undefined } }));
    }
  };

  const calcAvg = (vals: string[]): number | null => {
    const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n));
    if (nums.length !== 3) return null;
    return nums.reduce((a, b) => a + b, 0) / 3;
  };

  const evaluate = (avg: number, target: number): "pass" | "fail" =>
    Math.abs(avg - target) <= TOLERANCE ? "pass" : "fail";

  const handleCheck = (id: string) => {
    if (!currentPeriod) {
      toast.error("Daily Check บันทึกได้เฉพาะช่วงเช้า 08:00-12:00 หรือบ่าย 13:00-17:00");
      return;
    }
    const r = getDraft(id);
    if (r.weights100.some(v => !v) || r.weights10.some(v => !v)) {
      toast.error("กรุณากรอกค่าน้ำหนักให้ครบทั้ง 6 ค่า");
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
    const s100 = evaluate(avg100, 100);
    const s10 = evaluate(avg10, 10);
    const scale = SCALES.find(s => s.id === id)!;

    createMutation.mutate({
      scaleId: id,
      scaleName: scale.name,
      model: scale.model,
      weights100: r.weights100,
      weights10: r.weights10,
      avg100, avg10,
      status100: s100, status10: s10,
      tolerance: TOLERANCE,
      recorder: user.name,
      recorderId: user.id,
      recorderEmail: user.email,
    });
  };

  const handleRecheck = (id: string) => {
    setDrafts(prev => ({ ...prev, [id]: emptyDraft() }));
  };

  const checkedCount = Object.keys(latestByScale).length;
  const passCount = Object.values(latestByScale).filter(r => r.status === "pass").length;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            ห้องเครื่องชั่ง — Calibrate เครื่องชั่ง
          </h2>
          <p className="text-sm text-muted-foreground">ประจำวัน — {todayLabel} · รอบ{currentPeriodLabel} ({currentPeriodHint})</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-sm gap-1 py-1 px-3">
            รอบ{currentPeriodLabel}
          </Badge>
          <Badge variant="outline" className="text-sm gap-1 py-1 px-3">
            <Clock className="w-3.5 h-3.5" /> ตรวจแล้ว {checkedCount}/{SCALES.length}
          </Badge>
          <Badge className="text-sm gap-1 py-1 px-3 bg-green-100 text-green-700 border-green-300">
            <CheckCircle2 className="w-3.5 h-3.5" /> ผ่าน {passCount}/{SCALES.length}
          </Badge>
        </div>
      </div>

      {consecutiveAlert?.alert && consecutiveAlert.message && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 mb-4">
          <span>🚨</span>
          <span>{consecutiveAlert.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {SCALES.map(scale => {
              const todayRec = latestByScale[scale.id];
              const r = getDraft(scale.id);
              const isCheckedToday = !!todayRec;
              const showResult = isCheckedToday && !drafts[scale.id]?.weights100.some(v => v);
              const allPass = todayRec?.status === "pass";

              return (
                <Card
                  key={scale.id}
                  className={`shadow-sm transition-all ${
                    showResult ? (allPass ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30") : ""
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Scale className="w-4 h-4 text-primary" />
                        {scale.name}
                      </CardTitle>
                      {showResult && todayRec && (
                        <Badge className={`text-xs gap-1 ${allPass ? "bg-green-100 text-green-700 border-green-300" : "bg-red-100 text-red-700 border-red-300"}`}>
                          {allPass ? <><CheckCircle2 className="w-3 h-3" /> ผ่าน</> : "ไม่ผ่าน"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{scale.model}</p>
                    {showResult && todayRec && (
                      <p className="text-xs text-muted-foreground">ตรวจล่าสุด: {fmtTime(todayRec.checkedAt)} โดย {todayRec.recorder}</p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 100g x3 */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        น้ำหนักมาตรฐาน 100 g (3 ครั้ง)
                        {showResult && todayRec?.status100 === "pass" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                        {showResult && todayRec?.status100 === "fail" && <span className="text-red-500 text-xs">ไม่ผ่าน</span>}
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[0, 1, 2].map(i => (
                          <Input
                            key={i}
                            type="number"
                            step="0.001"
                            placeholder={showResult && todayRec ? todayRec.weights100[i] : `ครั้งที่ ${i + 1}`}
                            value={r.weights100[i]}
                            onChange={e => updateWeight(scale.id, "100", i, e.target.value)}
                            disabled={createMutation.isPending || !currentPeriod}
                            className="text-xs h-8"
                          />
                        ))}
                      </div>
                      {showResult && todayRec && (
                        <p className={`text-xs mt-1 ${todayRec.status100 === "pass" ? "text-green-600" : "text-red-600"}`}>
                          ค่าเฉลี่ย: {todayRec.avg100.toFixed(4)} g {todayRec.status100 === "pass" ? "อยู่ในเกณฑ์" : "เกินเกณฑ์"} (±{TOLERANCE}g)
                        </p>
                      )}
                    </div>

                    {/* 10g x3 */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        น้ำหนักมาตรฐาน 10 g (3 ครั้ง)
                        {showResult && todayRec?.status10 === "pass" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                        {showResult && todayRec?.status10 === "fail" && <span className="text-red-500 text-xs">ไม่ผ่าน</span>}
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[0, 1, 2].map(i => (
                          <Input
                            key={i}
                            type="number"
                            step="0.001"
                            placeholder={showResult && todayRec ? todayRec.weights10[i] : `ครั้งที่ ${i + 1}`}
                            value={r.weights10[i]}
                            onChange={e => updateWeight(scale.id, "10", i, e.target.value)}
                            disabled={createMutation.isPending || !currentPeriod}
                            className="text-xs h-8"
                          />
                        ))}
                      </div>
                      {showResult && todayRec && (
                        <p className={`text-xs mt-1 ${todayRec.status10 === "pass" ? "text-green-600" : "text-red-600"}`}>
                          ค่าเฉลี่ย: {todayRec.avg10.toFixed(4)} g {todayRec.status10 === "pass" ? "อยู่ในเกณฑ์" : "เกินเกณฑ์"} (±{TOLERANCE}g)
                        </p>
                      )}
                    </div>

                    {/* Recorder (auto from logged-in user) */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">ผู้บันทึก</label>
                      <Input
                        value={showResult && todayRec ? todayRec.recorder : (user?.name ?? "")}
                        readOnly
                        disabled
                        className="text-xs h-8 bg-muted/40"
                      />
                    </div>

                    {showResult ? (
                      <Button variant="outline" className="w-full gap-2" onClick={() => handleRecheck(scale.id)}>
                        <RotateCcw className="w-4 h-4" /> บันทึกซ้ำ
                      </Button>
                    ) : (
                      <Button
                        className="w-full gap-2"
                        onClick={() => handleCheck(scale.id)}
                        disabled={createMutation.isPending || !currentPeriod}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {!currentPeriod
                          ? "นอกเวลาบันทึก"
                          : createMutation.isPending && createMutation.variables?.scaleId === scale.id
                            ? "กำลังบันทึก..."
                            : "บันทึกผล Calibrate"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
      </div>
    </>
  );
};

export default BalanceRoomPage;
