import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Thermometer, Droplets, CheckCircle2, Clock, RotateCcw,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api, type EnvCheckRecord, type LiveTempHum } from "@/lib/api";
import { evaluateEnv, isReadingStale, type EnvRoom } from "@/lib/dailyCheckEnv";
import { getCurrentDailyCheckPeriod, getDailyCheckPeriod, getDailyCheckPeriodLabel } from "@/lib/dailyCheckPeriod";
import { useAuth } from "@/context/AuthContext";
import { useEnvRooms } from "@/hooks/useEnvRooms";
import { formatDate, formatTime } from "@/lib/dateTime";

interface EnvDraft {
  temperature: string;
  humidity: string;
  note: string;
  prefilledFrom?: string; // receivedAt ของค่าสดที่ pre-fill ไว้ (กันการ pre-fill ซ้ำ)
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtTime = (iso: string) => formatTime(iso);
const emptyDraft = (): EnvDraft => ({ temperature: "", humidity: "", note: "" });

const EnvironmentCheckPage = () => {
  const { user } = useAuth();
  const { rooms } = useEnvRooms();
  const queryClient = useQueryClient();
  const todayLabel = formatDate(new Date());
  const currentPeriod = getCurrentDailyCheckPeriod();
  const currentPeriodLabel = getDailyCheckPeriodLabel(currentPeriod);
  const currentPeriodHint = currentPeriod === "morning"
    ? "08:00–12:00"
    : currentPeriod === "afternoon"
      ? "13:00–17:00"
      : "เปิด 08:00–12:00 และ 13:00–17:00";

  const [drafts, setDrafts] = useState<Record<string, EnvDraft>>({});

  const { data: todayRecords = [] } = useQuery({
    queryKey: ["env-checks", "today"],
    queryFn: () => api.getEnvChecks({ date: todayStr() }),
    refetchOnWindowFocus: true,
  });

  const { data: liveReadings = [] } = useQuery({
    queryKey: ["temphum", "live"],
    queryFn: api.getLiveTempHum,
    refetchInterval: 30000, // Node-RED pushes ~every 60s; poll at 30s
    refetchOnWindowFocus: true,
  });

  // GET /temphum คืน history เรียงใหม่สุดก่อน → เก็บ "ค่าล่าสุดต่อ board"
  // (ค่าที่บันทึกล่าสุด ไม่ใช่ stream สดต่อเนื่อง — การ capture สดผ่าน trigger flow
  //  ของ /temphum รอทำภายหลัง)
  const liveByBoard = useMemo(() => {
    const map: Record<string, LiveTempHum> = {};
    for (const r of liveReadings) if (!map[r.board]) map[r.board] = r;
    return map;
  }, [liveReadings]);

  const sensorAgeMinutes = useMemo(() => {
    if (liveReadings.length === 0) return null;
    // Find the most stale reading across all boards
    let maxAge = 0;
    for (const r of liveReadings) {
      if (!r.receivedAt) continue;
      const diff = Date.now() - new Date(r.receivedAt).getTime();
      const age = Math.floor(diff / 60000);
      if (age > maxAge) maxAge = age;
    }
    return maxAge > 0 ? maxAge : null;
  }, [liveReadings]);

  const latestByRoom = useMemo(() => {
    const map: Record<string, EnvCheckRecord> = {};
    if (!currentPeriod) return map;
    for (const r of todayRecords) {
      const recordPeriod = r.period ?? getDailyCheckPeriod(r.checkedAt);
      if (recordPeriod !== currentPeriod) continue;
      if (!map[r.room]) map[r.room] = r;
    }
    return map;
  }, [todayRecords, currentPeriod]);

  const liveForRoom = (room: EnvRoom): LiveTempHum | undefined =>
    room.boardId ? liveByBoard[room.boardId] : undefined;

  const getDraft = (room: EnvRoom): EnvDraft => {
    const existing = drafts[room.slug];
    if (existing) return existing;
    // pre-fill ครั้งแรกจากค่าสด (ถ้ามี)
    const live = liveForRoom(room);
    if (live && (live.temp != null || live.hum != null)) {
      return {
        temperature: live.temp != null ? String(live.temp) : "",
        humidity: live.hum != null ? String(live.hum) : "",
        note: "",
        prefilledFrom: live.receivedAt,
      };
    }
    return emptyDraft();
  };

  const setField = (slug: string, patch: Partial<EnvDraft>) =>
    setDrafts((prev) => ({ ...prev, [slug]: { ...(prev[slug] ?? emptyDraft()), ...patch } }));

  const pullLatest = (room: EnvRoom) => {
    const live = liveForRoom(room);
    if (!live) {
      toast.error("ยังไม่มีค่าจากเซนเซอร์");
      return;
    }
    setField(room.slug, {
      temperature: live.temp != null ? String(live.temp) : "",
      humidity: live.hum != null ? String(live.hum) : "",
      prefilledFrom: live.receivedAt,
    });
  };

  const createMutation = useMutation({
    mutationFn: api.createEnvCheck,
    onSuccess: (_data, vars) => {
      const room = rooms.find((r) => r.slug === vars.room)!;
      const pass = evaluateEnv(vars.temperature, vars.humidity, room).status === "pass";
      if (pass) toast.success(`${room.label} อยู่ในเกณฑ์`);
      else toast.warning(`${room.label} เกินเกณฑ์`);
      queryClient.invalidateQueries({ queryKey: ["env-checks"] });
      setDrafts((prev) => {
        const c = { ...prev };
        delete c[vars.room];
        return c;
      });
    },
    onError: (err: Error) => toast.error(err.message || "บันทึกไม่สำเร็จ"),
  });

  const handleSave = (room: EnvRoom) => {
    if (!currentPeriod) {
      toast.error("Daily Check บันทึกได้เฉพาะช่วงเช้า 08:00-12:00 หรือบ่าย 13:00-17:00");
      return;
    }
    const d = getDraft(room);
    if (d.temperature === "" || d.humidity === "") {
      toast.error("กรุณากรอกอุณหภูมิและความชื้น");
      return;
    }
    const temperature = parseFloat(d.temperature);
    const humidity = parseFloat(d.humidity);
    if (isNaN(temperature) || isNaN(humidity)) {
      toast.error("ค่าอุณหภูมิ/ความชื้นไม่ถูกต้อง");
      return;
    }
    if (!user?.name) {
      toast.error("ไม่พบชื่อผู้ใช้งานปัจจุบัน");
      return;
    }
    createMutation.mutate({
      room: room.slug,
      roomName: room.label,
      temperature,
      humidity,
      tempMin: room.tempMin,
      tempMax: room.tempMax,
      humidityMax: room.humidityMax,
      note: d.note.trim(),
      recorder: user.name,
      recorderId: user.id,
      recorderEmail: user.email,
    });
  };

  const handleRecheck = (slug: string) =>
    setDrafts((prev) => ({ ...prev, [slug]: emptyDraft() }));

  const checkedCount = Object.keys(latestByRoom).length;
  const passCount = Object.values(latestByRoom).filter((r) => r.status === "pass").length;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            อุณหภูมิ/ความชื้น — ตรวจประจำวัน
          </h2>
          <p className="text-sm text-muted-foreground">ประจำวัน — {todayLabel} · รอบ{currentPeriodLabel} ({currentPeriodHint})</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-sm gap-1 py-1 px-3">
            รอบ{currentPeriodLabel}
          </Badge>
          <Badge variant="outline" className="text-sm gap-1 py-1 px-3">
            <Clock className="w-3.5 h-3.5" /> ตรวจแล้ว {checkedCount}/{rooms.length}
          </Badge>
          <Badge className="text-sm gap-1 py-1 px-3 bg-green-100 text-green-700 border-green-300">
            <CheckCircle2 className="w-3.5 h-3.5" /> ผ่าน {passCount}/{rooms.length}
          </Badge>
        </div>
      </div>

      {sensorAgeMinutes != null && sensorAgeMinutes > 10 && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 mb-3">
          <span>🔴</span>
          <span>ข้อมูล sensor เก่า {sensorAgeMinutes} นาที — กรุณาตรวจสอบ Node-RED</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {rooms.map((room) => {
              const todayRec = latestByRoom[room.slug];
              const d = getDraft(room);
              const live = liveForRoom(room);
              const liveStale = live ? isReadingStale(live.receivedAt, Date.now()) : false;
              const isCheckedToday = !!todayRec;
              const dirty = !!drafts[room.slug] && (drafts[room.slug].temperature !== "" || drafts[room.slug].humidity !== "");
              const showResult = isCheckedToday && !dirty;
              const allPass = todayRec?.status === "pass";

              const tNum = parseFloat(d.temperature);
              const hNum = parseFloat(d.humidity);
              const liveEval =
                !showResult && !isNaN(tNum) && !isNaN(hNum)
                  ? evaluateEnv(tNum, hNum, room)
                  : null;
              const outOfRange = liveEval?.status === "fail";

              return (
                <Card
                  key={room.slug}
                  className={`shadow-sm transition-all ${
                    showResult ? (allPass ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30") : ""
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Thermometer className="w-4 h-4 text-primary" />
                        {room.label}
                      </CardTitle>
                      {showResult && todayRec && (
                        <Badge className={`text-xs gap-1 ${allPass ? "bg-green-100 text-green-700 border-green-300" : "bg-red-100 text-red-700 border-red-300"}`}>
                          {allPass ? <><CheckCircle2 className="w-3 h-3" /> ผ่าน</> : "ไม่ผ่าน"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      เกณฑ์ {room.tempMin}–{room.tempMax}°C / ≤{room.humidityMax}%RH
                    </p>
                    {showResult && todayRec && (
                      <p className="text-xs text-muted-foreground">
                        ตรวจล่าสุด: {fmtTime(todayRec.checkedAt)} โดย {todayRec.recorder}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* แหล่งค่า */}
                    {!showResult && (
                      <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                        <span className={`flex items-center gap-1.5 text-xs ${liveStale ? "text-amber-600" : "text-muted-foreground"}`}>
                          <Radio className={`w-3.5 h-3.5 ${live ? (liveStale ? "text-amber-500" : "text-green-500") : "text-muted-foreground/50"}`} />
                          {live
                            ? liveStale
                              ? `เซนเซอร์ค้าง • ล่าสุด ${live.receivedAt ? fmtTime(live.receivedAt) : "-"}`
                              : `เซนเซอร์ • อัปเดต ${live.receivedAt ? fmtTime(live.receivedAt) : "-"}`
                            : "ไม่มีเซนเซอร์ — กรอกเอง"}
                        </span>
                        {live && (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => pullLatest(room)}>
                            ดึงค่าล่าสุด
                          </Button>
                        )}
                      </div>
                    )}

                    {/* อุณหภูมิ */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Thermometer className="w-3.5 h-3.5" /> อุณหภูมิ (°C)
                      </label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder={showResult && todayRec ? String(todayRec.temperature) : "เช่น 22.5"}
                        value={d.temperature}
                        onChange={(e) => setField(room.slug, { temperature: e.target.value })}
                        disabled={createMutation.isPending || !currentPeriod}
                        className="text-sm h-9"
                      />
                    </div>

                    {/* ความชื้น */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Droplets className="w-3.5 h-3.5" /> ความชื้น (%RH)
                      </label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder={showResult && todayRec ? String(todayRec.humidity) : "เช่น 55"}
                        value={d.humidity}
                        onChange={(e) => setField(room.slug, { humidity: e.target.value })}
                        disabled={createMutation.isPending || !currentPeriod}
                        className="text-sm h-9"
                      />
                    </div>

                    {liveEval && (
                      <p className={`text-xs ${liveEval.status === "pass" ? "text-green-600" : "text-red-600"}`}>
                        {liveEval.status === "pass" ? "อยู่ในเกณฑ์" : "เกินเกณฑ์"}
                        {liveEval.tempStatus === "fail" ? " • อุณหภูมิ" : ""}
                        {liveEval.humidityStatus === "fail" ? " • ความชื้น" : ""}
                      </p>
                    )}

                    {/* หมายเหตุ (แนะนำเมื่อเกินเกณฑ์) */}
                    {!showResult && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                          หมายเหตุ {outOfRange && <span className="text-red-500">(ควรระบุการแก้ไขเมื่อเกินเกณฑ์)</span>}
                        </label>
                        <Textarea
                          rows={2}
                          placeholder="บันทึกเพิ่มเติม / การแก้ไข"
                          value={d.note}
                          onChange={(e) => setField(room.slug, { note: e.target.value })}
                          disabled={createMutation.isPending || !currentPeriod}
                          className="text-sm"
                        />
                      </div>
                    )}

                    {showResult && todayRec?.note && (
                      <p className="text-xs text-muted-foreground">หมายเหตุ: {todayRec.note}</p>
                    )}

                    {/* ผู้บันทึก */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">ผู้บันทึก</label>
                      <Input value={showResult && todayRec ? todayRec.recorder : (user?.name ?? "")} readOnly disabled className="text-xs h-8 bg-muted/40" />
                    </div>

                    {showResult ? (
                      <Button variant="outline" className="w-full gap-2" onClick={() => handleRecheck(room.slug)}>
                        <RotateCcw className="w-4 h-4" /> บันทึกซ้ำ
                      </Button>
                    ) : (
                      <Button
                        className="w-full gap-2"
                        onClick={() => handleSave(room)}
                        disabled={createMutation.isPending || !currentPeriod}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {!currentPeriod
                          ? "นอกเวลาบันทึก"
                          : createMutation.isPending && createMutation.variables?.room === room.slug
                            ? "กำลังบันทึก..."
                            : "บันทึกผล"}
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

export default EnvironmentCheckPage;
