import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FlaskConical, Loader2, AlertTriangle, CheckCircle2, ClipboardCheck, RotateCcw } from "lucide-react";
import LabReasonDialog from "@/components/petition/LabReasonDialog";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePetition, useLabRequestsByPetition, saveLabAgreementReview } from "@/hooks/usePetition";
import { api, type ParameterItem } from "@/lib/api";
import { useItemGroupMembership } from "@/hooks/useItemGroupMembership";
import { labReceivedBy } from "@/lib/receiveStatus";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import type { QCTestResult } from "@/types/petition.types";
import { buildApprovalGroups } from "@/lib/qcApprovalRows";
import LabResultGroups from "@/components/petition/LabResultGroups";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm, releaseBodyPointerLock } from "@/context/ConfirmDialog";
import { useCanAccessPath } from "@/hooks/useCanAccessPath";
import LabAgreementReviewDialog from "@/components/review/LabAgreementReviewDialog";
import LabAgreementReviewView from "@/components/review/LabAgreementReviewView";
import { isReviewFilled } from "@/lib/labAgreementReview";

export default function LabApprovalReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { user } = useAuth();
  const confirm = useConfirm();
  const canAccessPath = useCanAccessPath();
  const canApproveLab = canAccessPath("/lab-approval");
  const [submitting, setSubmitting] = useState(false);
  const pendingApproveRef = useRef(false); // review dialog opened via the Approve button (vs the standalone edit button)
  const approveAfterSaveRef = useRef(false);

  const { data: petition, loading, error } = usePetition(id);
  const groupMembership = useItemGroupMembership();
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [results, setResults] = useState<QCTestResult[]>([]);
  const [petitionHasAbnormal, setPetitionHasAbnormal] = useState(false);
  const [abnormalLoaded, setAbnormalLoaded] = useState(false);

  const { data: labRequests, refresh: refreshLabRequests } = useLabRequestsByPetition(id);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const currentReview = labRequests?.[0]?.labAgreementReview ?? null;

  useEffect(() => {
    api.getParameters()
      .then((all) =>
        setParameters(
          all.filter((p) => p.scope === "lab" || (p.scope === "qc" && p.shareWithLab === true)),
        ),
      )
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
    api.getAbnormalFlags([id], { includeRestricted: false })
      .then((m) => { if (alive) setPetitionHasAbnormal(!!m[id]); })
      .catch(() => { if (alive) setPetitionHasAbnormal(false); })
      .finally(() => { if (alive) setAbnormalLoaded(true); });
    return () => { alive = false; };
  }, [id]);

  const runApprove = useCallback(async () => {
    if (!petition) return;
    // review dialog just closed; clear any lingering Radix body lock before stacking confirm.
    // belt-and-suspenders: the dialog's own close() already released it, this covers any other path.
    releaseBodyPointerLock();
    if (!(await confirm({ title: "ออกผล Lab", description: "ออกผลการทดสอบ Lab นี้?" }))) return;
    setSubmitting(true);
    try {
      await api.labApprovePetition(petition._id, user?.name ?? "system");
      toast.success("ออกผล Lab เรียบร้อย");
      navigate("/lab-approval");
    } catch {
      toast.error("ออกผลไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }, [petition, user, confirm, navigate]);

  const handleRecheck = useCallback(async (reason: string) => {
    if (!petition) return;
    try {
      await api.requestPetitionRecheck(petition._id, reason);
      toast.success("ส่ง Re-check แล้ว — งานกลับเข้าคิวรอมอบหมาย");
      navigate("/lab-approval");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ส่ง Re-check ไม่สำเร็จ");
      throw error;
    }
  }, [petition, navigate]);

  const handleSaveReview = useCallback(async (draft) => {
    if (!petition) return;
    try {
      await saveLabAgreementReview(petition._id, draft, user?.name ?? "system");
      toast.success("บันทึกการทบทวนข้อตกลงเรียบร้อย");
      refreshLabRequests();
      // if this dialog was opened by the Approve button, remember to approve after it closes
      approveAfterSaveRef.current = pendingApproveRef.current;
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
      throw new Error("save review failed");
    }
  }, [petition, user, refreshLabRequests]);

  const handleReviewDialogChange = useCallback((open: boolean) => {
    setReviewDialogOpen(open);
    if (open) return;
    // dialog is closing — clear the "opened via Approve" flag either way
    pendingApproveRef.current = false;
    // approveAfterSaveRef is set true only on a successful save in the approve flow,
    // and cleared here before runApprove() so a second onOpenChange(false) can't double-fire it
    if (approveAfterSaveRef.current) {
      approveAfterSaveRef.current = false;
      runApprove();
    }
  }, [runApprove]);

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
        <div className="text-center text-muted-foreground">{error || "ไม่พบข้อมูลคำร้อง"}</div>
      </AppLayout>
    );
  }

  const groups = buildApprovalGroups(petition, parameters, results, groupMembership, {
    includeResultOnlyFields: true,
    showAutoPassRange: false,
  });

  return (
    <AppLayout title={petition.petitionNo}>
      <div className="space-y-6 pb-28">
        <PageHeader
          onBack={() => navigate("/lab-approval")}
          title={
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary" />
              ออกผล Lab {petition.petitionNo}
            </span>
          }
          actions={
            <span className="text-sm text-muted-foreground">
              ผู้นำส่ง: {petition.submittedBy?.name ?? "-"}
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="blue-soft">{petitionDepartmentLabel(petition)}</Badge>
          <Badge variant="gray-soft" className="font-normal">
            ผู้รับงาน Lab: {labReceivedBy(petition) ?? "-"}
          </Badge>
          {petitionHasAbnormal ? (
            <span className="inline-flex items-center gap-1 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4" /> มีค่าผิดปกติ
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300 text-sm">
              <CheckCircle2 className="h-4 w-4" /> ผลปกติทุกรายการ
            </span>
          )}
        </div>

        {petition.labRedoExplanation && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-sm">
            <p className="font-semibold text-violet-700 dark:text-violet-300 mb-1">คำอธิบายการทำใหม่</p>
            <p className="text-foreground">Lab: {petition.labRedoExplanation}</p>
          </div>
        )}

        {(labRequests?.length ?? 0) > 0 && (
          <Card className="overflow-hidden">
            <CardHeader className="pb-3 bg-muted">
              <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  การทบทวนข้อตกลงการบริการทดสอบ — สำหรับหัวหน้าห้องปฏิบัติการ
                </span>
                {canApproveLab && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { pendingApproveRef.current = false; setReviewDialogOpen(true); }}
                  >
                    {isReviewFilled(currentReview) ? "แก้ไขการทบทวน" : "กรอกการทบทวน"}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {isReviewFilled(currentReview) ? (
                <LabAgreementReviewView data={currentReview!} />
              ) : (
                <p className="text-sm text-muted-foreground italic">ยังไม่กรอกการทบทวน</p>
              )}
            </CardContent>
          </Card>
        )}

        <LabResultGroups groups={groups} />

        {/* แผงตัดสิน — fixed bottom (เฉพาะผู้มีสิทธิ์ออกผล Lab) */}
        {canApproveLab && abnormalLoaded && (
          <div className="fixed bottom-3 left-0 right-0 z-50 md:left-72 px-4 sm:px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] border-t border-border bg-background/95 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRecheckOpen(true)}
                disabled={submitting}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Re-check
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  // ใบทบทวนกรอกครบแล้ว → ไปยืนยันออกผลเลย ไม่ต้องเปิดใบทบทวนซ้ำ
                  if (isReviewFilled(currentReview)) { runApprove(); return; }
                  pendingApproveRef.current = true;
                  setReviewDialogOpen(true);
                }}
                disabled={submitting}
                className="gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                ออกผล Lab
              </Button>
            </div>
          </div>
        )}

        <LabReasonDialog
          open={recheckOpen}
          onOpenChange={setRecheckOpen}
          title="Re-check งาน Lab"
          description="ผล Lab ปัจจุบันจะถูกล้าง (เก็บค่าเดิมไว้ในประวัติ) และงานจะกลับไปรอมอบหมายใหม่โดยอยู่ลำดับบนสุด"
          confirmLabel="ส่ง Re-check"
          destructive
          onConfirm={handleRecheck}
        />

        <LabAgreementReviewDialog
          open={reviewDialogOpen}
          onOpenChange={handleReviewDialogChange}
          initial={currentReview}
          onSave={handleSaveReview}
          testMethod={labRequests?.[0]?.serviceAgreement?.testMethod}
        />
      </div>
    </AppLayout>
  );
}
