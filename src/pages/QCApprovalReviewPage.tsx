import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical, Loader2, AlertTriangle, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePetition } from "@/hooks/usePetition";
import { api, type ParameterItem } from "@/lib/api";
import { useItemGroupMembership } from "@/hooks/useItemGroupMembership";
import { qcReceivedBy } from "@/lib/receiveStatus";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import type { Petition, QCTestResult } from "@/types/petition.types";
import { buildApprovalGroups, filterApprovalGroupsByScope, type ApprovalItemGroup } from "@/lib/qcApprovalRows";
import LabResultGroups from "@/components/petition/LabResultGroups";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { releaseBodyPointerLock, useConfirm } from "@/context/ConfirmDialog";
import ItemDecisionDialog from "@/components/lis/approval/ItemDecisionDialog";
import { useAccessibleTabs } from "@/hooks/useAccessibleTabs";
import { findItemApproval, itemSideStatus, itemsForSide, type ApprovalSide } from "@/lib/itemApprovals";
import { normalizeRoles } from "@/lib/roles";
import { formatDateTime as formatDateTimeValue } from "@/lib/dateTime";

type RejectTarget = "requester" | "qc" | "lab";

interface ParameterReferenceOption {
  id: string;
  label: string;
}

const formatDateTime = (value?: string | null) => formatDateTimeValue(value, "ยังไม่ยืนยันผล");

interface RejectDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  petitionNo: string;
  submitterName: string;
  references: ParameterReferenceOption[];
  /** ปลายทางที่ผู้ใช้มีสิทธิ์ส่งกลับ (QC Approver ไม่มี tab Lab จึงส่งกลับ Lab ไม่ได้) */
  allowedTargets?: RejectTarget[];
  onConfirm: (target: RejectTarget, note: string, referenceLabels: string[]) => Promise<void> | void;
}

function QCRejectDecisionDialog({
  open,
  onOpenChange,
  petitionNo,
  submitterName,
  references,
  allowedTargets,
  onConfirm,
}: RejectDecisionDialogProps) {
  const [target, setTarget] = useState<RejectTarget | "">("");
  const [note, setNote] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTarget("");
      setNote("");
      setSelectedRefs([]);
      setSubmitting(false);
    }
  }, [open]);

  const toggleRef = (id: string, checked: boolean) => {
    setSelectedRefs((prev) => (
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)
    ));
  };

  const canConfirm = !!target && note.trim().length > 0 && !submitting;

  const handleConfirm = async () => {
    if (!target) return;
    const trimmed = note.trim();
    if (!trimmed) return;
    const selectedLabels = references
      .filter((ref) => selectedRefs.includes(ref.id))
      .map((ref) => ref.label);
    setSubmitting(true);
    try {
      await onConfirm(target, trimmed, selectedLabels);
      setNote("");
      setTarget("");
      setSelectedRefs([]);
      onOpenChange(false);
      releaseBodyPointerLock();
    } catch {
      // keep dialog open so the reviewer can retry or edit the detail
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-orange-500" />
            ไม่อนุมัติคำร้อง {petitionNo}
          </DialogTitle>
          <DialogDescription>
            เลือกปลายทาง ระบุรายละเอียด และอ้างอิง parameter ที่เกี่ยวข้องได้
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">ส่งให้ใคร</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                { value: "requester", label: "ผู้ยื่น", description: submitterName },
                { value: "qc", label: "QC", description: "ส่งกลับ QC ทดสอบใหม่" },
                { value: "lab", label: "Lab", description: "ส่งกลับ Lab ทดสอบใหม่" },
              ] as const).filter((option) => !allowedTargets || allowedTargets.includes(option.value)).map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-grey-200 p-3 text-sm hover:bg-grey-50"
                >
                  <input
                    type="radio"
                    name="reject-target"
                    aria-label={option.label}
                    value={option.value}
                    checked={target === option.value}
                    onChange={() => setTarget(option.value)}
                    disabled={submitting}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-grey-800">{option.label}</span>
                    <span className="block text-xs text-grey-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="reject-detail">
              รายละเอียด <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reject-detail"
              aria-label="รายละเอียด"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              placeholder="ระบุเหตุผลหรือสิ่งที่ต้องแก้ไข..."
              className="w-full rounded border px-3 py-2 text-sm min-h-[120px] focus:outline-none focus:ring-1 focus:ring-primary-300 disabled:bg-grey-50"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">อ้างอิง parameter</legend>
            {references.length > 0 ? (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-grey-200 p-2">
                {references.map((ref) => (
                  <label
                    key={ref.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-grey-50"
                  >
                    <input
                      type="checkbox"
                      aria-label={ref.label}
                      checked={selectedRefs.includes(ref.id)}
                      onChange={(e) => toggleRef(ref.id, e.target.checked)}
                      disabled={submitting}
                      className="mt-1"
                    />
                    <span className="break-words">{ref.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-grey-200 bg-grey-50 px-3 py-2 text-sm text-grey-500">
                ไม่มี parameter ให้เลือกอ้างอิง
              </p>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canConfirm} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            ส่งกลับ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ItemDialogState = { kind: "approve-oos" | "reject"; side: ApprovalSide; seqs: number[] } | null;

const SIDE_LABEL: Record<ApprovalSide, string> = { qc: "QC", lab: "Lab" };

function groupHasAbnormal(group: ApprovalItemGroup) {
  return group.params.some((param) => param.rows.some((row) => row.abnormal));
}

export default function QCApprovalReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { user } = useAuth();
  const canSeeRestrictedStandards = normalizeRoles(user).some((role) => role === "admin" || role === "qc-head");
  const confirm = useConfirm();
  const { isVisible } = useAccessibleTabs("/qc-approval");
  const canSeeQc = isVisible("qc");
  const canSeeLab = isVisible("lab");
  const allowedSides = useMemo<ApprovalSide[]>(
    () => [canSeeQc && "qc", canSeeLab && "lab"].filter(Boolean) as ApprovalSide[],
    [canSeeQc, canSeeLab],
  );
  const [submitting, setSubmitting] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [itemDialog, setItemDialog] = useState<ItemDialogState>(null);

  const { data: fetchedPetition, loading, error, refresh } = usePetition(id);
  // ผลจาก API อนุมัติรายรายการ — ใช้แสดงทันทีจนกว่าการโหลดรอบถัดไปจะได้ข้อมูลล่าสุด
  const [updatedPetition, setUpdatedPetition] = useState<Petition | null>(null);
  useEffect(() => setUpdatedPetition(null), [fetchedPetition]);
  const petition = updatedPetition ?? fetchedPetition;

  const groupMembership = useItemGroupMembership();
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [results, setResults] = useState<QCTestResult[]>([]);
  const [dataLoaded, setDataLoaded] = useState({ params: false, results: false });
  const [petitionHasAbnormal, setPetitionHasAbnormal] = useState(false);

  const requestedTab: ApprovalSide = searchParams.get("tab") === "lab" ? "lab" : "qc";
  const [activeTab, setActiveTab] = useState<ApprovalSide>(requestedTab);
  useEffect(() => {
    if (allowedSides.length > 0 && !allowedSides.includes(activeTab)) setActiveTab(allowedSides[0]);
  }, [activeTab, allowedSides]);

  useEffect(() => {
    // โหลดทุก scope (Lab + QC) — buildApprovalGroups กรอง lab param ให้เฉพาะ lab item + ตัด inactive เอง
    api.getParameters()
      .then(setParameters)
      .catch(() => {})
      .finally(() => setDataLoaded((prev) => ({ ...prev, params: true })));
  }, []);

  useEffect(() => {
    if (!id) return;
    api.getQCResults(id)
      .then(setResults)
      .catch(() => {})
      .finally(() => setDataLoaded((prev) => ({ ...prev, results: true })));
  }, [id]);

  useEffect(() => {
    if (!id) { setPetitionHasAbnormal(false); return; }
    let alive = true;
    api.getAbnormalFlags([id], { includeRestricted: canSeeRestrictedStandards })
      .then((m) => { if (alive) setPetitionHasAbnormal(!!m[id]); })
      .catch(() => { if (alive) setPetitionHasAbnormal(false); });
    return () => { alive = false; };
  }, [id, canSeeRestrictedStandards]);

  const groups = useMemo(() => (petition
    ? buildApprovalGroups(petition, parameters, results, groupMembership, {
      includeRestrictedStandards: canSeeRestrictedStandards,
      includeResultOnlyFields: true,
    })
    : []), [petition, parameters, results, groupMembership, canSeeRestrictedStandards]);

  const side = useMemo(() => {
    const build = (s: ApprovalSide) => {
      const items = petition ? itemsForSide(petition, s) : [];
      const seqs = new Set(items.map((item) => item.seq));
      const sideGroups = filterApprovalGroupsByScope(groups, s, s === "lab" ? { aiSummaryOnly: true } : undefined)
        .filter((group) => seqs.has(group.seq));
      const abnormal = new Set(sideGroups.filter(groupHasAbnormal).map((group) => group.seq));
      const pending = petition
        ? items.filter((item) => itemSideStatus(petition, item, s) !== "approved").map((item) => item.seq)
        : [];
      return { items, groups: sideGroups, abnormal, pending };
    };
    return { qc: build("qc"), lab: build("lab") };
  }, [petition, groups]);

  const isClosed = petition ? ["approved", "rejected"].includes(petition.status) : true;
  const trackDone = (s: ApprovalSide) => Boolean(s === "qc" ? petition?.qcCompletedAt : petition?.labCompletedAt);
  const canDecide = (s: ApprovalSide) => !isClosed && trackDone(s) && allowedSides.includes(s);

  const decide = useCallback(async (s: ApprovalSide, decision: "approve" | "reject", seqs: number[], note?: string) => {
    if (!petition || seqs.length === 0) return;
    setSubmitting(true);
    try {
      const updated = await api.decideApprovalItems(petition._id, {
        side: s,
        decision,
        note,
        items: seqs.map((seq) => ({ seq, abnormal: decision === "approve" && side[s].abnormal.has(seq) })),
      });
      setUpdatedPetition(updated);
      refresh?.();
      if (updated?.status === "approved") {
        toast.success("อนุมัติครบทุกรายการ — ออก Final Result เรียบร้อย");
        navigate("/qc-approval");
      } else if (decision === "approve") {
        toast.success(`อนุมัติผล ${SIDE_LABEL[s]} รายการที่ ${seqs.join(", ")} แล้ว`);
      } else {
        toast.success(`ส่งกลับ ${SIDE_LABEL[s]} ทดสอบใหม่เรียบร้อย`);
        navigate("/qc-approval");
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "ดำเนินการไม่สำเร็จ");
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [petition, side, refresh, navigate]);

  const requestApprove = useCallback(async (s: ApprovalSide, seqs: number[]) => {
    if (seqs.length === 0) return;
    if (seqs.some((seq) => side[s].abnormal.has(seq))) {
      setItemDialog({ kind: "approve-oos", side: s, seqs });
      return;
    }
    const all = seqs.length > 1;
    const ok = await confirm({
      title: all ? "อนุมัติทั้งหมด" : "อนุมัติ",
      description: all
        ? `ยืนยันอนุมัติผล ${SIDE_LABEL[s]} ทั้ง ${seqs.length} รายการ?`
        : `ยืนยันอนุมัติผล ${SIDE_LABEL[s]} รายการที่ ${seqs[0]}?`,
    });
    if (!ok) return;
    await decide(s, "approve", seqs).catch(() => {});
  }, [confirm, decide, side]);

  const handleRejectDecision = useCallback(async (
    target: RejectTarget,
    note: string,
    referenceLabels: string[],
  ) => {
    if (!petition) return;
    const fullNote = referenceLabels.length > 0
      ? `${note}\n\nอ้างอิง parameter: ${referenceLabels.join("; ")}`
      : note;
    setSubmitting(true);
    try {
      await api.rejectPetition(petition._id, user?.name ?? "system", fullNote, target);
      if (target === "requester") {
        toast.success("ส่งคืนผู้ยื่นเรียบร้อย", { description: `ส่งให้ ${petition.submittedBy?.name ?? "ผู้ยื่น"}` });
      } else {
        toast.success(`ส่งกลับให้ ${target === "lab" ? "Lab" : "QC"} ทดสอบใหม่เรียบร้อย`);
      }
      setRejectDialogOpen(false);
      releaseBodyPointerLock();
      navigate("/qc-approval");
    } catch {
      toast.error("ส่งกลับไม่สำเร็จ");
      throw new Error("reject failed");
    } finally {
      setSubmitting(false);
    }
  }, [petition, user, navigate]);

  // ปุ่ม "อนุมัติ"/"ไม่อนุมัติ" จากหน้ารายการ → อนุมัติทั้งหมดของ tab นั้น / เปิด dialog ส่งกลับทั้งคำร้อง
  const ready = Boolean(petition) && dataLoaded.params && dataLoaded.results;
  useEffect(() => {
    const decision = searchParams.get("decision");
    if (!ready || submitting || !decision) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("decision");
      return next;
    }, { replace: true });
    if (decision === "approve" && canDecide(activeTab)) {
      void requestApprove(activeTab, side[activeTab].pending);
      return;
    }
    if (decision === "reject") setRejectDialogOpen(true);
    // canDecide อ่านจาก petition/allowedSides ที่ side และ activeTab ครอบคลุมอยู่แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, submitting, searchParams, setSearchParams, activeTab, requestApprove, side]);

  if (loading && !petition) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      </AppLayout>
    );
  }
  if (error || !petition) {
    return (
      <AppLayout>
        <div className="text-center text-grey-500">{error || "ไม่พบข้อมูลคำร้อง"}</div>
      </AppLayout>
    );
  }

  const parameterReferences: ParameterReferenceOption[] = [...side.qc.groups, ...side.lab.groups].flatMap((g) =>
    g.params.flatMap((param) =>
      param.rows.map((row) => ({
        id: `${g.seq}__${param.parameterId}__${row.key}`,
        label: `รายการที่ ${g.seq}: ${g.sampleName} / ${param.parameterName} / ${row.label}`,
      })),
    ),
  );
  const rejectTargets: RejectTarget[] = ["requester", ...allowedSides];

  const renderItemStatus = (s: ApprovalSide) => (group: ApprovalItemGroup) => {
    const item = petition.items.find((it) => it.seq === group.seq);
    if (!item) return null;
    const status = itemSideStatus(petition, item, s);
    const entry = findItemApproval(petition, group.seq, s);
    const showActions = canDecide(s) && status !== "approved";
    return (
      <div className="flex flex-wrap items-center gap-2">
        {status === "approved" ? (
          <Badge variant="green-soft" title={entry?.note}>
            {entry?.source === "lab-head-edit"
              ? "อนุมัติแล้ว (หัวหน้า Lab แก้ไข)"
              : entry?.conclusion === "accepted-oos" ? "อนุมัติ (ยอมรับผลไม่ปกติ)" : "อนุมัติแล้ว"}
          </Badge>
        ) : status === "rejected" ? (
          <Badge variant="red-soft" title={entry?.note}>ไม่อนุมัติ — ส่งกลับทดสอบใหม่</Badge>
        ) : (
          <Badge variant="yellow-soft">รออนุมัติ</Badge>
        )}
        {showActions && (
          <>
            <Button
              size="sm"
              variant="primary"
              className="gap-1.5"
              aria-label={`อนุมัติรายการที่ ${group.seq}`}
              disabled={submitting}
              onClick={() => void requestApprove(s, [group.seq])}
            >
              <CheckCircle2 className="h-4 w-4" /> อนุมัติ
            </Button>
            <Button
              size="sm"
              variant="danger-outline"
              className="gap-1.5"
              aria-label={`ไม่อนุมัติรายการที่ ${group.seq}`}
              disabled={submitting}
              onClick={() => setItemDialog({ kind: "reject", side: s, seqs: [group.seq] })}
            >
              <XCircle className="h-4 w-4" /> ไม่อนุมัติ
            </Button>
          </>
        )}
      </div>
    );
  };

  const renderSide = (s: ApprovalSide) => {
    const info = side[s];
    const approvedCount = info.items.length - info.pending.length;
    const completedAt = s === "qc" ? petition.qcCompletedAt : petition.labCompletedAt;
    const completedBy = s === "qc" ? petition.qcCompletedBy : petition.labCompletedBy;
    return (
      <TabsContent key={s} value={s} className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">การยืนยันผล {SIDE_LABEL[s]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>{completedBy ? `${completedBy} · ` : ""}{formatDateTime(completedAt)}</p>
            {s === "lab" && petition.labApprovedAt && (
              <p>หัวหน้า Lab ออกผล: {petition.labApprovedBy ? `${petition.labApprovedBy} · ` : ""}{formatDateTime(petition.labApprovedAt)}</p>
            )}
            <p>อนุมัติแล้ว {approvedCount}/{info.items.length} รายการ</p>
          </CardContent>
        </Card>
        {completedAt && info.groups.length > 0 ? (
          <LabResultGroups groups={info.groups} renderGroupActions={renderItemStatus(s)} />
        ) : (
          <p className="text-sm text-muted-foreground">{SIDE_LABEL[s]} ยังไม่ยืนยันผล</p>
        )}
      </TabsContent>
    );
  };

  const activeInfo = side[activeTab];
  const showDecisionBar = ready && !isClosed && allowedSides.length > 0 &&
    (petition.status === "success" || Boolean(petition.qcCompletedAt) || Boolean(petition.labCompletedAt));
  const dialogSide = itemDialog?.side ?? "qc";
  const dialogSeqs = itemDialog?.seqs.join(", ") ?? "";

  return (
    <AppLayout title={petition.petitionNo}>
      <div className="space-y-6 pb-28">
        <PageHeader
          onBack={() => navigate("/qc-approval")}
          title={
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary-500" />
              ออก Final Result {petition.petitionNo}
            </span>
          }
          actions={
            <span className="text-sm text-grey-500">
              ผู้นำส่ง: {petition.submittedBy?.name ?? "-"}
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="blue-soft">{petitionDepartmentLabel(petition)}</Badge>
          <Badge variant="gray-soft" className="font-normal">
            ผู้รับงาน QC: {qcReceivedBy(petition) ?? "-"}
          </Badge>
          {petitionHasAbnormal ? (
            <span className="inline-flex items-center gap-1 text-red-600 text-sm">
              <AlertTriangle className="h-4 w-4" /> มีค่าผิดปกติ
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-green-600 text-sm">
              <CheckCircle2 className="h-4 w-4" /> ผลปกติทุกรายการ
            </span>
          )}
        </div>

        {(petition.labRedoExplanation || petition.qcRedoExplanation) && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
            <p className="font-semibold text-violet-700 mb-1">คำอธิบายการทำใหม่</p>
            {petition.labRedoExplanation && <p className="text-violet-800">Lab: {petition.labRedoExplanation}</p>}
            {petition.qcRedoExplanation && <p className="text-violet-800">QC: {petition.qcRedoExplanation}</p>}
          </div>
        )}

        {allowedSides.length === 0 ? (
          <p className="text-sm text-muted-foreground">ไม่มีสิทธิ์ดูผลในหน้านี้</p>
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ApprovalSide)} className="space-y-4">
            <TabsList>
              {allowedSides.map((s) => (
                <TabsTrigger key={s} value={s}>ผล {SIDE_LABEL[s]}</TabsTrigger>
              ))}
            </TabsList>
            {allowedSides.map(renderSide)}
          </Tabs>
        )}

        {/* แผงตัดสิน — fixed bottom */}
        {showDecisionBar && (<div className="fixed bottom-3 left-0 right-0 z-50 md:left-72 px-4 sm:px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-background border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void requestApprove(activeTab, activeInfo.pending)}
              disabled={submitting || !canDecide(activeTab) || activeInfo.pending.length === 0}
              className="gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              อนุมัติทั้งหมด
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRejectDialogOpen(true)} disabled={submitting} className="gap-2">
              <RotateCcw className="h-4 w-4" /> ไม่อนุมัติทั้งคำร้อง
            </Button>
          </div>
        </div>)}

        <QCRejectDecisionDialog
          open={rejectDialogOpen}
          onOpenChange={setRejectDialogOpen}
          petitionNo={petition.petitionNo}
          submitterName={petition.submittedBy?.name ?? "ผู้ยื่น"}
          references={parameterReferences}
          allowedTargets={rejectTargets}
          onConfirm={handleRejectDecision}
        />
        <ItemDecisionDialog
          open={itemDialog !== null}
          onOpenChange={(open) => { if (!open) setItemDialog(null); }}
          title={itemDialog?.kind === "reject"
            ? `ไม่อนุมัติผล ${SIDE_LABEL[dialogSide]} รายการที่ ${dialogSeqs}`
            : `ยอมรับผลไม่ปกติ (${SIDE_LABEL[dialogSide]})`}
          description={itemDialog?.kind === "reject"
            ? `ผล ${SIDE_LABEL[dialogSide]} จะถูกส่งกลับให้ ${SIDE_LABEL[dialogSide]} ทดสอบใหม่ รายการที่อนุมัติแล้วคงสถานะเดิม`
            : `อนุมัติรายการที่ ${dialogSeqs} — มีรายการที่ค่าผิดปกติ โปรดระบุเหตุผลที่ยอมรับผล`}
          confirmLabel={itemDialog?.kind === "reject" ? "ส่งกลับ" : "อนุมัติ"}
          destructive={itemDialog?.kind === "reject"}
          onConfirm={async (note) => {
            if (!itemDialog) return;
            await decide(itemDialog.side, itemDialog.kind === "reject" ? "reject" : "approve", itemDialog.seqs, note);
          }}
        />
      </div>
    </AppLayout>
  );
}
