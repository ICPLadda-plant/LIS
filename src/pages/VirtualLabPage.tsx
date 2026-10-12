import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BarChart3, Clock, FileText, FlaskConical, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type MachineItem, type VirtualLabInstrument, type VirtualLabStatus } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/dateTime";
import type { Petition } from "@/types/petition.types";

const STATUS: Record<VirtualLabStatus, { label: string; className: string }> = {
  idle: { label: "Idle", className: "bg-slate-100 text-slate-700 border-slate-200" },
  running: { label: "Running", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  error: { label: "Error", className: "bg-red-100 text-red-700 border-red-200" },
  maintenance: { label: "Maintenance", className: "bg-amber-100 text-amber-700 border-amber-200" },
  offline: { label: "Offline", className: "bg-zinc-200 text-zinc-700 border-zinc-300" },
};

const STATUS_KEYS = Object.keys(STATUS) as VirtualLabStatus[];

const machineLabel = (machine: MachineItem) =>
  [machine.code, machine.name].filter(Boolean).join(" - ");

const fmt = (iso?: string) => formatDateTime(iso);

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const isDensityMachine = (machine?: MachineItem) => {
  const text = `${machine?.code ?? ""} ${machine?.type ?? ""} ${machine?.name ?? ""} ${machine?.model ?? ""}`.toLowerCase();
  return text.includes("density") || text.includes("dma");
};

const densityField = (row: Record<string, unknown> | undefined, names: string[]) => {
  if (!row) return "";
  for (const name of names) {
    const value = row[name];
    if (value != null && value !== "") return String(value);
  }
  return "";
};

const hoursSince = (iso?: string) => {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 36e5) : 0;
};

const reportMatchesBatch = (row: Record<string, unknown>, batchNo: string) => {
  const batch = String(batchNo || "").replace(/^0+/, "");
  if (!batch) return false;
  const sample = String(row["Sample name"] ?? row["Sample ID"] ?? "");
  return sample.includes(batchNo) || sample.replace(/^0+/, "").includes(batch);
};

export default function VirtualLabPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [roomId, setRoomId] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [machineId, setMachineId] = useState("");

  const roomsQuery = useQuery({
    queryKey: ["virtual-lab", "rooms"],
    queryFn: api.getVirtualLabRooms,
  });
  const machinesQuery = useQuery({
    queryKey: ["machines"],
    queryFn: api.getMachines,
  });

  const rooms = roomsQuery.data ?? [];
  const room = rooms.find((r) => r._id === roomId) ?? rooms[0];

  useEffect(() => {
    if (!roomId && rooms[0]?._id) setRoomId(rooms[0]._id);
  }, [roomId, rooms]);

  const logsQuery = useQuery({
    queryKey: ["virtual-lab", "logs", room?._id],
    queryFn: () => api.getVirtualLabLogs(room!._id),
    enabled: !!room?._id,
  });
  const todayDensityQuery = useQuery({
    queryKey: ["virtual-lab", "density-results", todayStr()],
    queryFn: () => api.getResultDensities({ page: 1, limit: 5, date: todayStr() }),
    refetchInterval: 30_000,
  });
  const latestDensityQuery = useQuery({
    queryKey: ["virtual-lab", "density-results", "latest"],
    queryFn: () => api.getResultDensities({ page: 1, limit: 1 }),
    refetchInterval: 30_000,
  });
  const densityReportsQuery = useQuery({
    queryKey: ["virtual-lab", "density-results", "recent"],
    queryFn: () => api.getResultDensities({ page: 1, limit: 500 }),
    refetchInterval: 30_000,
  });
  const activePetitionsQuery = useQuery({
    queryKey: ["virtual-lab", "active-petitions"],
    queryFn: () =>
      api
        .get<{ items: Petition[] }>("/petitions?status=sampleSent,pendingReview,inProgress&limit=100")
        .then((r) => r.data.data.items ?? []),
    refetchInterval: 30_000,
  });

  const refreshRoom = () => {
    queryClient.invalidateQueries({ queryKey: ["virtual-lab"] });
  };

  const createRoom = useMutation({
    mutationFn: api.createVirtualLabRoom,
    onSuccess: (created) => {
      setRoomId(created._id);
      setNewRoomName("");
      refreshRoom();
      toast.success("สร้างห้องแล้ว");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addInstrument = useMutation({
    mutationFn: ({ targetRoomId, targetMachineId }: { targetRoomId: string; targetMachineId: string }) =>
      api.addVirtualLabInstrument(targetRoomId, targetMachineId),
    onSuccess: () => {
      setMachineId("");
      refreshRoom();
      toast.success("เพิ่มเครื่องเข้าห้องแล้ว");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateInstrument = useMutation({
    mutationFn: ({
      instrument,
      patch,
    }: {
      instrument: VirtualLabInstrument;
      patch: Partial<Pick<VirtualLabInstrument, "x" | "y" | "status" | "note">>;
    }) => api.updateVirtualLabInstrument(room!._id, instrument._id, { ...patch, actor: user?.name ?? "system" }),
    onSuccess: refreshRoom,
    onError: (err: Error) => toast.error(err.message),
  });

  const removeInstrument = useMutation({
    mutationFn: (instrumentId: string) => api.deleteVirtualLabInstrument(room!._id, instrumentId),
    onSuccess: refreshRoom,
    onError: (err: Error) => toast.error(err.message),
  });
  const syncDensity = useMutation({
    mutationFn: api.triggerDensitySync,
    onSuccess: () => {
      toast.success("สั่ง n8n ดึง report จากเครื่อง Density แล้ว");
      queryClient.invalidateQueries({ queryKey: ["virtual-lab", "density-results"] });
      queryClient.invalidateQueries({ queryKey: ["result-densities"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const availableMachines = useMemo(() => {
    const used = new Set((room?.instruments ?? []).map((i) => i.machine?._id).filter(Boolean));
    return (machinesQuery.data ?? []).filter((m) => m._id && !used.has(m._id) && m.status !== "retired");
  }, [machinesQuery.data, room?.instruments]);

  const counts = useMemo(() => {
    const base = Object.fromEntries(STATUS_KEYS.map((s) => [s, 0])) as Record<VirtualLabStatus, number>;
    for (const item of room?.instruments ?? []) base[item.status] += 1;
    return base;
  }, [room?.instruments]);

  const densityMachines = useMemo(
    () => (room?.instruments ?? []).filter((item) => isDensityMachine(item.machine)),
    [room?.instruments],
  );
  const todayDensityDocs = todayDensityQuery.data?.docs ?? [];
  const latestDensity = todayDensityDocs[0] ?? latestDensityQuery.data?.docs?.[0];
  const latestDensityAt = densityField(latestDensity, ["Date & time"]);
  const latestDensityValue = densityField(latestDensity, ["Density [g/cm³]", "Density [g/cmÂ³]"]);
  const latestDensitySample = densityField(latestDensity, ["Sample ID", "Sample name"]);
  const densityReports = densityReportsQuery.data?.docs ?? [];
  const activePetitions = activePetitionsQuery.data ?? [];
  const workQueue = useMemo(() => {
    const machineCodes = new Set((room?.instruments ?? []).map((i) => i.machine?.code).filter(Boolean));
    const machineIds = new Set((room?.instruments ?? []).map((i) => i.machine?._id).filter(Boolean));
    return activePetitions.flatMap((petition) =>
      (petition.assignedMachines ?? [])
        .filter((machine) => machineCodes.has(machine.code) || machineIds.has(machine.machineId))
        .map((machine) => {
          const item = petition.items.find((i) =>
            (!machine.sampleName || i.sampleName === machine.sampleName) &&
            (!machine.commonName || i.commonName === machine.commonName)
          ) ?? petition.items[0];
          const assignedAt = petition.assignedTo?.assignedAt ?? petition.updatedAt ?? petition.createdAt;
          const hasReport = isDensityMachine(machine as MachineItem) && !!item?.batchNo
            ? densityReports.some((row) => reportMatchesBatch(row, item.batchNo))
            : false;
          return { petition, machine, item, assignedAt, ageHours: hoursSince(assignedAt), hasReport };
        }),
    );
  }, [activePetitions, densityReports, room?.instruments]);
  const staleJobs = workQueue.filter((job) => !job.hasReport && job.ageHours >= 4);
  const utilizationByMachine = useMemo(() => {
    const map = new Map<string, { queued: number; stale: number; reports: number }>();
    for (const item of room?.instruments ?? []) {
      map.set(item.machine?.code ?? item._id, {
        queued: workQueue.filter((job) => job.machine.code === item.machine?.code).length,
        stale: staleJobs.filter((job) => job.machine.code === item.machine?.code).length,
        reports: isDensityMachine(item.machine) ? todayDensityQuery.data?.total ?? 0 : 0,
      });
    }
    return map;
  }, [room?.instruments, staleJobs, todayDensityQuery.data?.total, workQueue]);

  const busy =
    createRoom.isPending ||
    addInstrument.isPending ||
    updateInstrument.isPending ||
    removeInstrument.isPending ||
    syncDensity.isPending;

  return (
    <AppLayout title="Virtual Lab">
      <PageHeader
        className="mb-5"
        title="Virtual Lab"
        description="จำลองห้องและสถานะเครื่องมือจากรายการเครื่องจริงในระบบ"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="ชื่อห้อง"
              className="h-9 w-44"
            />
            <Button
              className="h-9 gap-2"
              disabled={busy || !newRoomName.trim()}
              onClick={() => createRoom.mutate(newRoomName)}
            >
              <Plus className="h-4 w-4" />
              สร้างห้อง
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={room?._id ?? ""}
            onChange={(e) => setRoomId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {rooms.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>
          <select
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            className="h-9 min-w-64 rounded-md border border-input bg-background px-3 text-sm"
            disabled={!room || availableMachines.length === 0}
          >
            <option value="">เลือกเครื่องมือ</option>
            {availableMachines.map((machine) => (
              <option key={machine._id} value={machine._id}>{machineLabel(machine)}</option>
            ))}
          </select>
          <Button
            variant="outline"
            className="h-9 gap-2"
            disabled={!room || !machineId || busy}
            onClick={() => addInstrument.mutate({ targetRoomId: room!._id, targetMachineId: machineId })}
          >
            <Plus className="h-4 w-4" />
            เพิ่มเครื่อง
          </Button>
        </div>

        {room && (
          <div className="flex flex-wrap gap-2">
            {STATUS_KEYS.map((status) => (
              <Badge key={status} variant="outline" className={cn("gap-1", STATUS[status].className)}>
                {STATUS[status].label}: {counts[status]}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {roomsQuery.isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">กำลังโหลด Virtual Lab...</div>
      ) : !room ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          สร้างห้องแรกเพื่อเริ่มวางเครื่องมือ
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-h-[520px] rounded-md border bg-muted/20 p-4">
            <div className="mb-4 rounded-md border bg-background p-3 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">Density report connector</h2>
                    <Badge variant="outline" className={todayDensityDocs.length ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>
                      {todayDensityDocs.length ? "reported" : "waiting report"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    192.168.0.146 → n8n → Result-Density · วันนี้ {todayDensityQuery.data?.total ?? 0} report
                  </p>
                  <p className="mt-1 truncate text-xs">
                    ล่าสุด: {latestDensitySample || "-"} {latestDensityValue ? `· ${latestDensityValue} g/cm³` : ""} {latestDensityAt ? `· ${latestDensityAt}` : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="h-9 gap-2"
                  disabled={busy}
                  onClick={() => syncDensity.mutate()}
                >
                  <RefreshCw className={cn("h-4 w-4", syncDensity.isPending && "animate-spin")} />
                  Sync Density Report
                </Button>
              </div>
              {densityMachines.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  เพิ่มเครื่อง Density Meter / DMA เข้าห้องนี้ เพื่อให้ badge report แสดงบนการ์ดเครื่อง
                </p>
              )}
            </div>

            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">{room.name}</h2>
              <span className="text-sm text-muted-foreground">{room.instruments.length} เครื่อง</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {room.instruments.map((item) => (
                <article
                  key={item._id}
                  className="rounded-md border bg-background p-3 shadow-sm"
                  style={{ order: item.y * 10 + item.x }}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 shrink-0 text-primary" />
                        <h3 className="truncate text-sm font-semibold">{item.machine?.name ?? "Unknown machine"}</h3>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.machine?.code}{item.machine?.location ? ` · ${item.machine.location}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      disabled={busy}
                      onClick={() => removeInstrument.mutate(item._id)}
                      aria-label="นำเครื่องออก"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <Badge variant="outline" className={cn("mb-3", STATUS[item.status].className)}>
                    <Activity className="mr-1 h-3 w-3" />
                    {STATUS[item.status].label}
                  </Badge>
                  {isDensityMachine(item.machine) && (
                    <div className="mb-3 rounded-md border bg-muted/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className={todayDensityDocs.length ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>
                          {todayDensityDocs.length ? "report received" : "waiting report"}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {latestDensityAt || "-"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs">
                        {latestDensitySample || "ยังไม่มี report วันนี้"} {latestDensityValue ? `· ${latestDensityValue} g/cm³` : ""}
                      </p>
                    </div>
                  )}
                  {(() => {
                    const usage = utilizationByMachine.get(item.machine?.code ?? item._id);
                    if (!usage) return null;
                    return (
                      <div className="mb-3 grid grid-cols-3 gap-1 text-center text-[11px]">
                        <div className="rounded border bg-muted/20 p-1">
                          <div className="font-semibold">{usage.queued}</div>
                          <div className="text-muted-foreground">queue</div>
                        </div>
                        <div className={cn("rounded border p-1", usage.stale ? "bg-red-50 text-red-700" : "bg-muted/20")}>
                          <div className="font-semibold">{usage.stale}</div>
                          <div className="text-muted-foreground">SLA</div>
                        </div>
                        <div className="rounded border bg-muted/20 p-1">
                          <div className="font-semibold">{usage.reports}</div>
                          <div className="text-muted-foreground">reports</div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {STATUS_KEYS.map((status) => (
                      <Button
                        key={status}
                        variant={item.status === status ? "default" : "outline"}
                        className="h-8 px-2 text-xs"
                        disabled={busy}
                        onClick={() => updateInstrument.mutate({ instrument: item, patch: { status } })}
                      >
                        {STATUS[status].label}
                      </Button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted-foreground">
                      Col
                      <Input
                        type="number"
                        min={1}
                        defaultValue={item.x}
                        className="mt-1 h-8"
                        onBlur={(e) => updateInstrument.mutate({ instrument: item, patch: { x: Number(e.target.value) } })}
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Row
                      <Input
                        type="number"
                        min={1}
                        defaultValue={item.y}
                        className="mt-1 h-8"
                        onBlur={(e) => updateInstrument.mutate({ instrument: item, patch: { y: Number(e.target.value) } })}
                      />
                    </label>
                  </div>

                  <Input
                    className="mt-2 h-8 text-xs"
                    defaultValue={item.note ?? ""}
                    placeholder="หมายเหตุ"
                    onBlur={(e) => updateInstrument.mutate({ instrument: item, patch: { note: e.target.value } })}
                  />
                  <p className="mt-2 text-[11px] text-muted-foreground">อัปเดตล่าสุด: {fmt(item.updatedAt)}</p>
                </article>
              ))}
            </div>
          </section>

          <aside className="rounded-md border bg-background p-4">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              SLA Alert
            </h2>
            <div className="mb-5 space-y-2">
              {staleJobs.length === 0 ? (
                <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">ไม่มีงานค้างเกิน 4 ชั่วโมง</p>
              ) : (
                staleJobs.slice(0, 6).map((job) => (
                  <div key={`${job.petition._id}-${job.machine.code}-${job.item?.seq}`} className="rounded-md border border-red-200 bg-red-50 p-2 text-sm">
                    <div className="font-medium text-red-700">{job.machine.code} · {job.petition.petitionNo}</div>
                    <div className="text-xs text-red-700/80">{job.item?.sampleName ?? "-"} · {Math.floor(job.ageHours)} ชม. ยังไม่มี report</div>
                  </div>
                ))
              )}
            </div>

            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <FileText className="h-4 w-4 text-primary" />
              Work Queue
            </h2>
            <div className="mb-5 space-y-2">
              {workQueue.length === 0 ? (
                <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">ยังไม่มีงาน assign เข้าเครื่องในห้องนี้</p>
              ) : (
                workQueue.slice(0, 8).map((job) => (
                  <div key={`${job.petition._id}-${job.machine.code}-${job.item?.seq}`} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{job.machine.code} · {job.petition.petitionNo}</span>
                      <Badge variant="outline" className={job.hasReport ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>
                        {job.hasReport ? "reported" : "waiting"}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{job.item?.sampleName ?? "-"} · batch {job.item?.batchNo ?? "-"}</div>
                  </div>
                ))
              )}
            </div>

            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <BarChart3 className="h-4 w-4 text-primary" />
              Utilization
            </h2>
            <div className="mb-5 space-y-2">
              {room.instruments.map((item) => {
                const usage = utilizationByMachine.get(item.machine?.code ?? item._id);
                if (!usage) return null;
                return (
                  <div key={item._id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span className="truncate">{item.machine?.code} {item.machine?.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Q {usage.queued} · SLA {usage.stale} · R {usage.reports}
                    </span>
                  </div>
                );
              })}
            </div>

            <h2 className="mb-3 text-base font-semibold">Status Log</h2>
            <div className="space-y-3">
              {(logsQuery.data ?? []).length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มี log</p>
              )}
              {(logsQuery.data ?? []).map((log) => (
                <div key={log._id} className="border-b pb-3 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{log.machine?.code ?? ""} {log.machine?.name ?? ""}</p>
                    <Badge variant="outline" className={STATUS[log.newStatus].className}>
                      {STATUS[log.newStatus].label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {log.oldStatus || "-"} → {log.newStatus} · {fmt(log.createdAt)}
                  </p>
                  {log.actor && <p className="text-xs text-muted-foreground">โดย {log.actor}</p>}
                  {log.note && <p className="mt-1 text-xs">{log.note}</p>}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </AppLayout>
  );
}
