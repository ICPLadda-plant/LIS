import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical, Loader2, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
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
import type { QCTestResult } from "@/types/petition.types";
import { buildApprovalGroups, filterApprovalGroupsByScope } from "@/lib/qcApprovalRows";
import LabResultGroups from "@/components/petition/LabResultGroups";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { releaseBodyPointerLock, useConfirm } from "@/context/ConfirmDialog";
import { RevisionRequestDialog } from "@/components/petition/RevisionRequestDialog";
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
  onConfirm: (target: RejectTarget, note: string, referenceLabels: string[]) => Promise<void> | void;
}

function QCRejectDecisionDialog({
  open,
  onOpenChange,
  petitionNo,
  submitterName,
  references,
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
              ] as const).map((option) => (
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

export default function QCApprovalReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { user } = useAuth();
  const canSeeRestrictedStandards = normalizeRoles(user).some((role) => role === "admin" || role === "qc-head");
  const confirm = useConfirm();
  const [submitting, setSubmitting] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [acceptReasonDialogOpen, setAcceptReasonDialogOpen] = useState(false);

  const { data: petition, loading, error } = usePetition(id);
  const groupMembership = useItemGroupMembership();
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [results, setResults] = useState<QCTestResult[]>([]);
  const [petitionHasAbnormal, setPetitionHasAbnormal] = useState(false);
  const [abnormalLoaded, setAbnormalLoaded] = useState(false);

  useEffect(() => {
    // โหลดทุก scope (Lab + QC) — หัวหน้า QC ต้องเห็นผลครบทั้งสองฝั่ง.
    // buildApprovalGroups (ผ่าน matchParametersForItem) กรอง lab param ให้เฉพาะ
    // lab item + ตัด inactive ให้เองอยู่แล้ว จึงส่ง param ดิบเข้าไปได้.
    api.getParameters()
      .then(setParameters)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    api.getQCResults(id).then(setResults).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) { setPetitionHasAbnormal(false); setAbnormalLoaded(false); return; }
    setAbnormalLoaded(false);
    let alive = true;
    api.getAbnormalFlags([id], { includeRestricted: canSeeRestrictedStandards })
      .then((m) => { if (alive) setPetitionHasAbnormal(!!m[id]); })
      .catch(() => { if (alive) setPetitionHasAbnormal(false); })
      .finally(() => { if (alive) setAbnormalLoaded(true); });
    return () => { alive = false; };
  }, [id, canSeeRestrictedStandards]);

  const doApprove = useCallback(async (conclusion: "pass" | "accepted-oos", note?: string) => {
    if (!petition) return;
    setSubmitting(true);
    try {
      await api.approvePetition(petition._id, user?.name ?? "system", conclusion, note);
      toast.success(conclusion === "accepted-oos" ? "ยอมรับผลเรียบร้อย" : "ออก Final Result เรียบร้อย");
      navigate("/qc-approval");
    } catch {
      toast.error("ดำเนินการไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }, [petition, user, navigate]);

  const handleApprovePass = useCallback(async () => {
    if (!(await confirm({ title: "อนุมัติ", description: "ยืนยันว่าอนุมัติและออก Final Result ของคำร้องนี้?" }))) return;
    await doApprove("pass");
  }, [confirm, doApprove]);

  const handleAcceptOos = useCallback(async (note: string) => {
    setAcceptReasonDialogOpen(false);
    await doApprove("accepted-oos", note);
  }, [doApprove]);

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

  useEffect(() => {
    const decision = searchParams.get("decision");
    if (!petition || !abnormalLoaded || submitting || !decision) return;

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("decision");
      return next;
    }, { replace: true });

    if (decision === "approve") {
      if (petitionHasAbnormal) {
        setAcceptReasonDialogOpen(true);
      } else {
        handleApprovePass();
      }
      return;
    }

    if (decision === "reject") {
      setRejectDialogOpen(true);
    }
  }, [
    abnormalLoaded,
    handleApprovePass,
    petition,
    petitionHasAbnormal,
    searchParams,
    setSearchParams,
    submitting,
  ]);

  if (loading) {
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

  const groups = buildApprovalGroups(petition, parameters, results, groupMembership, {
    includeRestrictedStandards: canSeeRestrictedStandards,
    includeResultOnlyFields: true,
  });
  const qcGroups = filterApprovalGroupsByScope(groups, "qc");
  const labGroups = filterApprovalGroupsByScope(groups, "lab", { aiSummaryOnly: true });
  const defaultTab = searchParams.get("tab") === "lab" ? "lab" : "qc";
  const parameterReferences: ParameterReferenceOption[] = [...qcGroups, ...labGroups].flatMap((g) =>
    g.params.flatMap((param) =>
      param.rows.map((row) => ({
        id: `${g.seq}__${param.parameterId}__${row.key}`,
        label: `รายการที่ ${g.seq}: ${g.sampleName} / ${param.parameterName} / ${row.label}`,
      })),
    ),
  );

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

        <Tabs key={defaultTab} defaultValue={defaultTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="qc">ผล QC</TabsTrigger>
            <TabsTrigger value="lab">ผล Lab</TabsTrigger>
          </TabsList>
          <TabsContent value="qc" className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">การยืนยันผล QC</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {petition.qcCompletedBy ? `${petition.qcCompletedBy} · ` : ""}{formatDateTime(petition.qcCompletedAt)}
              </CardContent>
            </Card>
            {petition.qcCompletedAt && qcGroups.length > 0 ? <LabResultGroups groups={qcGroups} /> : <p className="text-sm text-muted-foreground">QC ยังไม่ยืนยันผล</p>}
          </TabsContent>
          <TabsContent value="lab" className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">การยืนยันผล Lab</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>{petition.labCompletedBy ? `${petition.labCompletedBy} · ` : ""}{formatDateTime(petition.labCompletedAt)}</p>
                {petition.labApprovedAt && <p>หัวหน้า Lab ออกผล: {petition.labApprovedBy ? `${petition.labApprovedBy} · ` : ""}{formatDateTime(petition.labApprovedAt)}</p>}
              </CardContent>
            </Card>
            {petition.labCompletedAt && labGroups.length > 0 ? <LabResultGroups groups={labGroups} /> : <p className="text-sm text-muted-foreground">Lab ยังไม่ยืนยันผล</p>}
          </TabsContent>
        </Tabs>

        {/* แผงตัดสิน — fixed bottom */}
        {(petition.status === "success" || petition.qcCompletedAt || petition.labCompletedAt) && abnormalLoaded && (<div className="fixed bottom-3 left-0 right-0 z-50 md:left-72 px-4 sm:px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-background border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col items-end gap-2">
            {!petitionHasAbnormal ? (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="primary" size="sm" onClick={handleApprovePass} disabled={submitting} className="gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  อนุมัติ
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejectDialogOpen(true)} disabled={submitting} className="gap-2">
                  <RotateCcw className="h-4 w-4" /> ไม่อนุมัติ
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="primary" size="sm" onClick={() => setAcceptReasonDialogOpen(true)} disabled={submitting} className="gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  อนุมัติ
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejectDialogOpen(true)} disabled={submitting} className="gap-2">
                  <RotateCcw className="h-4 w-4" /> ไม่อนุมัติ
                </Button>
              </div>
            )}
          </div>
        </div>)}

        <QCRejectDecisionDialog
          open={rejectDialogOpen}
          onOpenChange={setRejectDialogOpen}
          petitionNo={petition.petitionNo}
          submitterName={petition.submittedBy?.name ?? "ผู้ยื่น"}
          references={parameterReferences}
          onConfirm={handleRejectDecision}
        />
        <RevisionRequestDialog
          open={acceptReasonDialogOpen}
          onOpenChange={setAcceptReasonDialogOpen}
          petitionNo={petition.petitionNo}
          submitterName={petition.submittedBy?.name ?? "ผู้ยื่น"}
          recipientLabel="ยอมรับผลไม่ปกติ"
          warning="คำร้องจะออก Final Result โดยบันทึกผลไม่ปกติเป็นผลจริง — โปรดระบุเหตุผล"
          onConfirm={handleAcceptOos}
        />
      </div>
    </AppLayout>
  );
}
