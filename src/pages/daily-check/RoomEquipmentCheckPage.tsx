import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { getCurrentDailyCheckPeriod, getDailyCheckPeriod, getDailyCheckPeriodLabel } from "@/lib/dailyCheckPeriod";
import { getRoomBySlug } from "@/lib/dailyCheckRooms";
import { api, type EquipmentCheckRecord, type EquipmentReading } from "@/lib/api";
import { getRoomCatalog } from "@/lib/roomEquipment";
import { formatDate, formatTime } from "@/lib/dateTime";

type StatusVal = "normal" | "abnormal" | "";

interface CheckDraft {
  status: StatusVal;
  readingValues: Record<string, string>;
  note: string;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtTime = (iso: string) => formatTime(iso);

const emptyDraft = (): CheckDraft => ({ status: "", readingValues: {}, note: "" });

interface RoomEquipmentCheckPageProps {
  roomSlug: string;
}

const RoomEquipmentCheckPage = ({ roomSlug }: RoomEquipmentCheckPageProps) => {
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

  const room = getRoomBySlug(roomSlug);
  const catalog = getRoomCatalog(roomSlug);
  const [drafts, setDrafts] = useState<Record<string, CheckDraft>>({});

  const { data: todayRecords = [] } = useQuery({
    queryKey: ["equipment-checks", "today", roomSlug, todayStr()],
    queryFn: () => api.getEquipmentChecks({ room: roomSlug, date: todayStr() }),
    refetchOnWindowFocus: true,
    enabled: !!catalog,
  });

  const latestByInstrument = useMemo(() => {
    const map: Record<string, EquipmentCheckRecord> = {};
    if (!currentPeriod) return map;
    for (const row of todayRecords) {
      const recordPeriod = row.period ?? getDailyCheckPeriod(row.checkedAt);
      if (recordPeriod !== currentPeriod) continue;
      if (!map[row.instrumentId]) map[row.instrumentId] = row;
    }
    return map;
  }, [todayRecords, currentPeriod]);

  const createMutation = useMutation({
    mutationFn: api.createEquipmentCheck,
    onSuccess: (_data, vars) => {
      if (vars.status === "normal") toast.success(`${vars.instrumentName} ใช้งานได้ปกติ`);
      else toast.warning(`${vars.instrumentName} ผิดปกติ - บันทึกแล้ว`);
      queryClient.invalidateQueries({ queryKey: ["equipment-checks"] });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.instrumentId];
        return next;
      });
    },
    onError: (err: Error) => toast.error(err.message || "บันทึกไม่สำเร็จ"),
  });

  if (!room || !catalog) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        ไม่พบห้องที่ระบุ
      </p>
    );
  }

  const instruments = catalog.instruments;
  const groups = catalog.groups;
  const total = instruments.length;
  const RoomIcon = room.icon;

  const getDraft = (id: string): CheckDraft => drafts[id] || emptyDraft();

  const setStatus = (id: string, status: StatusVal) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...getDraft(id), status } }));

  const setReading = (id: string, key: string, value: string) =>
    setDrafts((prev) => {
      const draft = getDraft(id);
      return {
        ...prev,
        [id]: { ...draft, readingValues: { ...draft.readingValues, [key]: value } },
      };
    });

  const setNote = (id: string, note: string) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...getDraft(id), note } }));

  const handleSave = (instrumentId: string) => {
    if (!currentPeriod) {
      toast.error("Daily Check บันทึกได้เฉพาะช่วงเช้า 08:00-12:00 หรือบ่าย 13:00-17:00");
      return;
    }
    const instrument = instruments.find((row) => row.id === instrumentId);
    if (!instrument) return;

    const draft = getDraft(instrumentId);
    if (draft.status !== "normal" && draft.status !== "abnormal") {
      toast.error("กรุณาเลือกสถานะ (ปกติ / ผิดปกติ)");
      return;
    }
    if (!user?.name) {
      toast.error("ไม่พบชื่อผู้ใช้งานปัจจุบัน");
      return;
    }

    const readings: EquipmentReading[] = [];
    for (const field of instrument.readings) {
      const raw = draft.readingValues[field.key];
      const value = parseFloat(raw);
      if (raw == null || raw === "" || Number.isNaN(value)) {
        toast.error(`กรุณากรอกค่า ${field.label} เป็นตัวเลข`);
        return;
      }
      readings.push({ key: field.key, label: field.label, value, unit: field.unit });
    }

    createMutation.mutate({
      roomSlug,
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      brand: instrument.brand,
      status: draft.status,
      readings,
      note: draft.note,
      recorder: user.name,
      recorderId: user.id ?? "",
      recorderEmail: user.email ?? "",
    });
  };

  const handleRecheck = (id: string) =>
    setDrafts((prev) => ({ ...prev, [id]: emptyDraft() }));

  const checkedCount = Object.keys(latestByInstrument).length;
  const normalCount = Object.values(latestByInstrument).filter((row) => row.status === "normal").length;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {room.label} - เช็กการทำงานเครื่องมือ
          </h2>
          <p className="text-sm text-muted-foreground">ประจำวัน - {todayLabel} · รอบ{currentPeriodLabel} ({currentPeriodHint})</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="gap-1 px-3 py-1 text-sm">
            รอบ{currentPeriodLabel}
          </Badge>
          <Badge variant="outline" className="gap-1 px-3 py-1 text-sm">
            <Clock className="h-3.5 w-3.5" /> ตรวจแล้ว {checkedCount}/{total}
          </Badge>
          <Badge className="gap-1 border-green-300 bg-green-100 px-3 py-1 text-sm text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> ปกติ {normalCount}/{total}
          </Badge>
        </div>
      </div>

      <div className="space-y-6">
        {groups.map((group) => {
          const items = instruments.filter((instrument) => instrument.group === group.key);
          if (items.length === 0) return null;

          return (
            <div key={group.key} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">{group.label}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((instrument) => {
                  const todayRec = latestByInstrument[instrument.id];
                  const draft = getDraft(instrument.id);
                  const isCheckedToday = Boolean(todayRec);
                  const isDirty = Boolean(drafts[instrument.id]) && (
                    draft.status !== "" ||
                    draft.note !== "" ||
                    Object.values(draft.readingValues).some((value) => value !== "")
                  );
                  const showResult = isCheckedToday && !isDirty;
                  const normal = todayRec?.status === "normal";

                  return (
                    <Card
                      key={instrument.id}
                      className={`shadow-sm transition-all ${
                        showResult
                          ? normal
                            ? "border-green-200 bg-green-50/30"
                            : "border-red-200 bg-red-50/30"
                          : ""
                      }`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <RoomIcon className="h-4 w-4 text-primary" />
                            {instrument.name}
                          </CardTitle>
                          {showResult && todayRec && (
                            <Badge
                              className={`gap-1 text-xs ${
                                normal
                                  ? "border-green-300 bg-green-100 text-green-700"
                                  : "border-red-300 bg-red-100 text-red-700"
                              }`}
                            >
                              {normal ? (
                                <>
                                  <CheckCircle2 className="h-3 w-3" /> ปกติ
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="h-3 w-3" /> ผิดปกติ
                                </>
                              )}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {instrument.id}
                          {instrument.brand ? ` · ${instrument.brand}` : ""}
                        </p>
                        {showResult && todayRec && (
                          <p className="text-xs text-muted-foreground">
                            ตรวจล่าสุด: {fmtTime(todayRec.checkedAt)} โดย {todayRec.recorder}
                          </p>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted-foreground">
                            สถานะการทำงาน
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <Button
                              type="button"
                              variant={draft.status === "normal" ? "default" : "outline"}
                              className="h-8 gap-1 text-xs"
                              disabled={createMutation.isPending || !currentPeriod}
                              onClick={() => setStatus(instrument.id, "normal")}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> ปกติ
                            </Button>
                            <Button
                              type="button"
                              variant={draft.status === "abnormal" ? "destructive" : "outline"}
                              className="h-8 gap-1 text-xs"
                              disabled={createMutation.isPending || !currentPeriod}
                              onClick={() => setStatus(instrument.id, "abnormal")}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" /> ผิดปกติ
                            </Button>
                          </div>
                        </div>

                        {instrument.readings.map((field) => (
                          <div key={field.key}>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">
                              {field.label}
                              {field.unit ? ` (${field.unit})` : ""}
                            </label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={
                                showResult && todayRec
                                  ? String(todayRec.readings.find((row) => row.key === field.key)?.value ?? "")
                                  : field.label
                              }
                              value={draft.readingValues[field.key] ?? ""}
                              onChange={(e) => setReading(instrument.id, field.key, e.target.value)}
                              disabled={createMutation.isPending || !currentPeriod}
                              className="h-8 text-xs"
                            />
                          </div>
                        ))}

                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted-foreground">
                            หมายเหตุ
                          </label>
                          <Input
                            value={draft.note}
                            placeholder={showResult && todayRec?.note ? todayRec.note : "-"}
                            onChange={(e) => setNote(instrument.id, e.target.value)}
                            disabled={createMutation.isPending || !currentPeriod}
                            className="h-8 text-xs"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted-foreground">
                            ผู้บันทึก
                          </label>
                          <Input value={showResult && todayRec ? todayRec.recorder : (user?.name ?? "")} readOnly disabled className="h-8 bg-muted/40 text-xs" />
                        </div>

                        {showResult ? (
                          <Button
                            variant="outline"
                            className="w-full gap-2"
                            onClick={() => handleRecheck(instrument.id)}
                          >
                            <RotateCcw className="h-4 w-4" /> บันทึกซ้ำ
                          </Button>
                        ) : (
                          <Button
                            className="w-full gap-2"
                            onClick={() => handleSave(instrument.id)}
                            disabled={createMutation.isPending || !currentPeriod}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {!currentPeriod
                              ? "นอกเวลาบันทึก"
                              : createMutation.isPending && createMutation.variables?.instrumentId === instrument.id
                                ? "กำลังบันทึก..."
                                : "บันทึกผล"}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default RoomEquipmentCheckPage;
