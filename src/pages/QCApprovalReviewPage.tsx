import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FlaskConical, Loader2, AlertTriangle, CheckCircle2, FileCheck2, XCircle } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePetition } from "@/hooks/usePetition";
import { api, type ParameterItem } from "@/lib/api";
import { useItemGroupMembership } from "@/hooks/useItemGroupMembership";
import { qcReceivedBy } from "@/lib/receiveStatus";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import type { Petition, QCTestResult } from "@/types/petition.types";
import { buildApprovalGroups, filterApprovalGroupsByScope, type ApprovalItemGroup } from "@/lib/qcApprovalRows";
import LabResultGroups from "@/components/petition/LabResultGroups";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/context/ConfirmDialog";
import ItemDecisionDialog from "@/components/lis/approval/ItemDecisionDialog";
import FailDecisionDialog, { type FailDecision, type FailSection } from "@/components/lis/approval/FailDecisionDialog";
import SideApprovalBadge from "@/components/lis/approval/SideApprovalBadge";
import { useAccessibleTabs } from "@/hooks/useAccessibleTabs";
import {
  APPROVAL_SIDE_LABEL,
  awaitingFinalReport,
  findItemApproval,
  itemSideStatus,
  itemsForSide,
  sideApprovalState,
  sideResultLabel,
  type ApprovalSide,
} from "@/lib/itemApprovals";
import { normalizeRoles } from "@/lib/roles";
import { formatDateTime as formatDateTimeValue } from "@/lib/dateTime";

const formatDateTime = (value?: string | null) => formatDateTimeValue(value, "ยังไม่ยืนยันผล");

const SIDES: ApprovalSide[] = ["qc", "lab"];
const SECTION_LABEL: Record<ApprovalSide, string> = { qc: "ค่ากายภาพ (QC)", lab: "AI (Lab)" };
const TRACK_LABEL: Record<ApprovalSide, string> = { qc: "QC", lab: "Lab" };

function groupHasAbnormal(group: ApprovalItemGroup) {
  return group.params.some((param) => param.rows.some((row) => row.abnormal));
}

export default function QCApprovalReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { user } = useAuth();
  const canSeeRestrictedStandards = normalizeRoles(user).some((role) => role === "admin" || role === "qc-head");
  const confirm = useConfirm();
  const { isVisible } = useAccessibleTabs("/qc-approval");
  const canSeeQc = isVisible("qc");
  const canSeeLab = isVisible("lab");
  // หัวหน้า QC / admin เห็นทั้งกายภาพและ AI; QC Approver เห็นแค่กายภาพ
  const allowedSides = useMemo<ApprovalSide[]>(
    () => [canSeeQc && "qc", canSeeLab && "lab"].filter(Boolean) as ApprovalSide[],
    [canSeeQc, canSeeLab],
  );
  const [submitting, setSubmitting] = useState(false);
  const [failDialogOpen, setFailDialogOpen] = useState(false);
  /** อนุมัติที่มีค่าผิดปกติ → ต้องระบุเหตุผลที่ยอมรับผล */
  const [oosApprove, setOosApprove] = useState<ApprovalSide[] | null>(null);

  const { data: fetchedPetition, loading, error, refresh } = usePetition(id);
  // ผลจาก API อนุมัติ — ใช้แสดงทันทีจนกว่าการโหลดรอบถัดไปจะได้ข้อมูลล่าสุด
  const [updatedPetition, setUpdatedPetition] = useState<Petition | null>(null);
  useEffect(() => setUpdatedPetition(null), [fetchedPetition]);
  const petition = updatedPetition ?? fetchedPetition;

  const groupMembership = useItemGroupMembership();
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [results, setResults] = useState<QCTestResult[]>([]);
  const [dataLoaded, setDataLoaded] = useState({ params: false, results: false });
  const [petitionHasAbnormal, setPetitionHasAbnormal] = useState(false);

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
  /** ฝั่งที่ผู้ใช้กดผ่าน/ไม่ผ่านได้ตอนนี้ (ยืนยันผลแล้วและยังมีรายการรอ) */
  const decidableSides = SIDES.filter((s) => canDecide(s) && side[s].pending.length > 0);
  const requiredSides = SIDES.filter((s) => side[s].items.length > 0);
  // ออก Final Report ได้เฉพาะผู้ที่เห็นทั้งกายภาพและ AI (หัวหน้า QC / admin); QC Approver ออกได้แค่ Pre Result
  const canFinalizeRole = canSeeQc && canSeeLab;
  /** ผ่านครบทุกรายการแล้ว (Pre Result) รอออก Final Report */
  const preResultIssued = petition ? awaitingFinalReport(petition) : false;
  const qcOnly = side.qc.items.length > 0 && side.lab.items.length === 0;
  // ทุกฝั่งที่ต้องอนุมัติ ผ่านแล้วหรือพร้อมให้ผ่านในครั้งเดียว
  const canIssueFinal = canFinalizeRole && !isClosed && (preResultIssued || (decidableSides.length > 0 &&
    requiredSides.every((s) => side[s].pending.length === 0 || decidableSides.includes(s))));
  const sideButtonLabel = (s: ApprovalSide) =>
    s === "qc" && qcOnly && !canFinalizeRole ? "ออกผลกายภาพ (Pre Result)" : sideResultLabel(s, true);

  const approveSides = useCallback(async (sides: ApprovalSide[], note?: string) => {
    if (!petition || sides.length === 0) return;
    setSubmitting(true);
    try {
      let latest: Petition | null = null;
      for (const s of sides) {
        const seqs = side[s].pending;
        if (seqs.length === 0) continue;
        latest = await api.decideApprovalItems(petition._id, {
          side: s,
          decision: "approve",
          note,
          items: seqs.map((seq) => ({ seq, abnormal: side[s].abnormal.has(seq) })),
        });
      }
      if (latest) setUpdatedPetition(latest);
      refresh?.();
      if (latest?.status === "approved") {
        toast.success("ออก Final Report เรียบร้อย");
      } else if (latest && awaitingFinalReport(latest)) {
        toast.success("ออก Pre Result แล้ว — รอหัวหน้า QC ออก Final Report");
      } else {
        toast.success(`บันทึก${sides.map((s) => sideResultLabel(s, true)).join(" และ ")}แล้ว`);
      }
      navigate("/qc-approval");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "ดำเนินการไม่สำเร็จ");
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [petition, side, refresh, navigate]);

  const issueFinal = useCallback(async () => {
    if (!petition) return;
    setSubmitting(true);
    try {
      const updated = await api.issueFinalReport(petition._id);
      setUpdatedPetition(updated);
      refresh?.();
      toast.success("ออก Final Report เรียบร้อย");
      navigate("/qc-approval");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "ออก Final Report ไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }, [petition, refresh, navigate]);

  const requestApprove = useCallback(async (sides: ApprovalSide[], final: boolean) => {
    if (final && sides.length === 0) {
      // ผ่านครบแล้ว (Pre Result) — เหลือแค่ออก Final Report
      const ok = await confirm({
        title: "ออก Final Report",
        description: `ยืนยันออก Final Report ของคำร้อง ${petition?.petitionNo ?? ""}?`,
      });
      if (ok) await issueFinal();
      return;
    }
    if (sides.length === 0) return;
    if (sides.some((s) => side[s].pending.some((seq) => side[s].abnormal.has(seq)))) {
      setOosApprove(sides);
      return;
    }
    const label = sides.map(sideButtonLabel).join(" และ ");
    const ok = await confirm({
      title: final ? "ออก Final Report" : label,
      description: final
        ? `ยืนยัน${label} และออก Final Report ของคำร้อง ${petition?.petitionNo ?? ""}?`
        : `ยืนยันให้${label} ของคำร้อง ${petition?.petitionNo ?? ""}?`,
    });
    if (!ok) return;
    await approveSides(sides).catch(() => {});
    // sideButtonLabel อ่านจาก side/canFinalizeRole ที่อยู่ใน deps แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, approveSides, issueFinal, side, canFinalizeRole, petition?.petitionNo]);

  const handleFail = useCallback(async (decision: FailDecision) => {
    if (!petition) return;
    setSubmitting(true);
    try {
      if (decision.toRequester) {
        await api.rejectPetition(petition._id, user?.name ?? "system", decision.note, "requester");
        toast.success("ส่งคืนผู้ยื่นเรียบร้อย", { description: `ส่งให้ ${petition.submittedBy?.name ?? "ผู้ยื่น"}` });
      } else {
        for (const entry of decision.sides) {
          const note = `${decision.note}\n\nไม่ผ่าน: ${entry.labels.join("; ")}`;
          await api.decideApprovalItems(petition._id, {
            side: entry.side,
            decision: "reject",
            note,
            items: entry.seqs.map((seq) => ({ seq, abnormal: false })),
          });
        }
        toast.success(`ส่งกลับ ${decision.sides.map((entry) => TRACK_LABEL[entry.side]).join(" และ ")} ทดสอบใหม่เรียบร้อย`);
      }
      navigate("/qc-approval");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "ส่งกลับไม่สำเร็จ");
      refresh?.();
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [petition, user, navigate, refresh]);

  const ready = Boolean(petition) && dataLoaded.params && dataLoaded.results;

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
        <div className="text-center text-muted-foreground">{error || "ไม่พบข้อมูลคำร้อง"}</div>
      </AppLayout>
    );
  }

  // ตัวเลือก "ไม่ผ่าน": parameter ของรายการที่ยังรอตัดสิน แยกตามฝั่งที่ผู้ใช้ตัดสินได้
  // ออก Pre Result แล้ว → ยังกด "ผลไม่ผ่าน" กับรายการที่ผ่านไปแล้วได้ก่อนออก Final Report
  const failSides = SIDES.filter((s) => canDecide(s) && (side[s].pending.length > 0 || preResultIssued));
  const failSections: FailSection[] = failSides.map((s) => {
    const pending = new Set(side[s].pending.length > 0 ? side[s].pending : side[s].items.map((item) => item.seq));
    const options = side[s].groups
      .filter((group) => pending.has(group.seq))
      .flatMap((group) => group.params.flatMap((param) => param.rows.map((row) => ({
        id: `${s}__${group.seq}__${param.parameterId}__${row.key}`,
        seq: group.seq,
        label: `รายการที่ ${group.seq}: ${group.sampleName} / ${param.parameterName}${row.label && row.label !== param.parameterName ? ` / ${row.label}` : ""}`,
      }))));
    const covered = new Set(options.map((option) => option.seq));
    const fallback = side[s].items
      .filter((item) => pending.has(item.seq) && !covered.has(item.seq))
      .map((item) => ({ id: `${s}__${item.seq}`, seq: item.seq, label: `รายการที่ ${item.seq}: ${item.sampleName ?? "-"}` }));
    return { side: s, label: sideResultLabel(s, false), options: [...options, ...fallback] };
  });

  const renderItemStatus = (s: ApprovalSide) => (group: ApprovalItemGroup) => {
    const item = petition.items.find((it) => it.seq === group.seq);
    if (!item) return null;
    const status = itemSideStatus(petition, item, s);
    const entry = findItemApproval(petition, group.seq, s);
    if (status === "approved") {
      const text = entry?.source === "lab-head-edit"
        ? "ผ่าน (หัวหน้า Lab แก้ไข)"
        : entry?.conclusion === "accepted-oos" ? "ผ่าน (ยอมรับผลไม่ปกติ)" : "ผ่าน";
      return <Badge variant="green-soft" title={entry?.note}>{entry?.by ? `${text} · ${entry.by}` : text}</Badge>;
    }
    if (status === "rejected") return <Badge variant="red-soft" title={entry?.note}>ไม่ผ่าน — ส่งกลับทดสอบใหม่</Badge>;
    return <Badge variant="yellow-soft">รอตัดสิน</Badge>;
  };

  const renderSide = (s: ApprovalSide) => {
    const info = side[s];
    const completedAt = s === "qc" ? petition.qcCompletedAt : petition.labCompletedAt;
    const completedBy = s === "qc" ? petition.qcCompletedBy : petition.labCompletedBy;
    return (
      <section key={s} aria-labelledby={`approval-section-${s}`} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
          <h2 id={`approval-section-${s}`} className="text-base font-semibold text-foreground">{SECTION_LABEL[s]}</h2>
          <p className="text-sm text-muted-foreground">
          {TRACK_LABEL[s]} ยืนยันผล: {completedBy ? `${completedBy} · ` : ""}{formatDateTime(completedAt)}
          {s === "lab" && petition.labApprovedAt && (
            <> · หัวหน้า Lab ออกผล: {petition.labApprovedBy ? `${petition.labApprovedBy} · ` : ""}{formatDateTime(petition.labApprovedAt)}</>
          )}
          </p>
        </div>
        {completedAt && info.groups.length > 0 ? (
          <LabResultGroups groups={info.groups} renderGroupActions={renderItemStatus(s)} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {info.items.length === 0 ? `คำร้องนี้ไม่มีผล${APPROVAL_SIDE_LABEL[s]}` : `รอผล ${TRACK_LABEL[s]}`}
          </p>
        )}
      </section>
    );
  };

  const statusSides = allowedSides.filter((s) => side[s].items.length > 0);
  const showDecisionBar = ready && !isClosed && allowedSides.length > 0;
  // final พร้อมแล้ว และเหลือรอแค่ฝั่งเดียว → ปุ่มฝั่งนั้นกับ Final Report ทำงานเหมือนกัน แสดงแค่ Final Report
  const sideButtons = canIssueFinal && decidableSides.length === 1 ? [] : decidableSides;

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
            <span className="text-sm text-muted-foreground">
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
            <span className="inline-flex items-center gap-1 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> มีค่าผิดปกติ
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-green-600 text-sm">
              <CheckCircle2 className="h-4 w-4" /> ผลปกติทุกรายการ
            </span>
          )}
        </div>

        {statusSides.length > 0 && (
          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
              {statusSides.map((s) => {
                const state = sideApprovalState(petition, s);
                return (
                  <div key={s} className="space-y-1">
                    <p className="text-base font-semibold text-foreground">{s === "qc" ? "ค่ากายภาพ" : "AI"}</p>
                    <SideApprovalBadge state={state} />
                    {state.kind === "approved" && state.approvedBy && (
                      <p className="text-sm text-muted-foreground">
                        มีคนให้{s === "lab" ? " " : ""}{sideResultLabel(s, true)}แล้ว: {state.approvedBy}
                        {state.approvedAt ? ` · ${formatDateTimeValue(state.approvedAt)}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
            {preResultIssued && (
              <p className="border-t px-4 py-3 text-sm text-muted-foreground">
                ออก Pre Result แล้ว — {canFinalizeRole ? "กด “ออก Final Report” เพื่อปิดคำร้อง" : "รอหัวหน้า QC ออก Final Report"}
              </p>
            )}
          </Card>
        )}

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
          <div className="space-y-8">{allowedSides.map(renderSide)}</div>
        )}

        {/* แผงตัดสิน — จุดเดียวที่ให้ผ่าน/ไม่ผ่าน (fixed bottom) */}
        {showDecisionBar && (<div className="fixed bottom-3 left-0 right-0 z-50 md:left-72 px-4 sm:px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-background border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-center justify-end gap-3">
            {decidableSides.length === 0 && (
              <span className="mr-auto text-sm text-muted-foreground">
                {allowedSides.map((s) => `${APPROVAL_SIDE_LABEL[s]}: ${sideApprovalState(petition, s).label}`).join(" · ")}
              </span>
            )}
            {sideButtons.map((s) => (
              <Button
                key={s}
                variant={canIssueFinal ? "outline" : "primary"}
                size="sm"
                onClick={() => void requestApprove([s], false)}
                disabled={submitting}
                className="gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {sideButtonLabel(s)}
              </Button>
            ))}
            {canIssueFinal && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void requestApprove(decidableSides, true)}
                disabled={submitting}
                className="gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                ออก Final Report
              </Button>
            )}
            <Button
              variant="danger-outline"
              size="sm"
              onClick={() => setFailDialogOpen(true)}
              disabled={submitting}
              className="gap-2"
            >
              <XCircle className="h-4 w-4" /> ผลไม่ผ่าน
            </Button>
          </div>
        </div>)}

        <FailDecisionDialog
          open={failDialogOpen}
          onOpenChange={setFailDialogOpen}
          petitionNo={petition.petitionNo}
          submitterName={petition.submittedBy?.name ?? "ผู้ยื่น"}
          sections={failSections}
          onConfirm={handleFail}
        />
        <ItemDecisionDialog
          open={oosApprove !== null}
          onOpenChange={(open) => { if (!open) setOosApprove(null); }}
          title={`ยอมรับผลไม่ปกติ (${(oosApprove ?? []).map((s) => APPROVAL_SIDE_LABEL[s]).join(" / ")})`}
          description="มีรายการที่ค่าผิดปกติ โปรดระบุเหตุผลที่ยอมรับผลก่อนให้ผ่าน"
          confirmLabel="ยืนยันให้ผ่าน"
          onConfirm={async (note) => {
            if (!oosApprove) return;
            await approveSides(oosApprove, note);
          }}
        />
      </div>
    </AppLayout>
  );
}
