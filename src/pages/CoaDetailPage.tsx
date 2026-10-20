import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, FileCheck2, Printer, XCircle } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import PrintPreviewDialog from "@/components/lis/PrintPreviewDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import CoaAuditTimeline from "@/components/coa/CoaAuditTimeline";
import CoaManualDialog from "@/components/coa/CoaManualDialog";
import CoaReportTemplate, { COA_REPORT_CSS } from "@/components/coa/CoaReportTemplate";
import CoaStatusBadge from "@/components/coa/CoaStatusBadge";
import { api } from "@/lib/api";
import { buildCoaReportPages } from "@/lib/coaReport";
import { allowedCoaActions, canPrintCoa, canReviewCoa, isCoaQcHead } from "@/lib/coaStatus";
import { openPrintPdf } from "@/lib/print";
import { useAuth } from "@/hooks/useAuth";
import { normalizeRoles, primaryRole } from "@/lib/roles";

export default function CoaDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [printOpen, setPrintOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [remark, setRemark] = useState("");
  const pdfRef = useRef<HTMLDivElement>(null);
  const pdfDownloadKeyRef = useRef("");
  const { data: doc, isLoading, isError, error } = useQuery({
    queryKey: ["coa", id],
    queryFn: () => api.getCoaDocument(id),
    enabled: Boolean(id),
  });
  const roles = normalizeRoles(user);
  const activeRole = user?.role || primaryRole(roles);
  const actor = {
    name: user?.name,
    email: user?.email,
    role: activeRole,
    activeRole,
    roles,
    permissions: user?.permissions ?? [],
    position: user?.position,
  };
  const isQcHead = isCoaQcHead(actor);
  const pages = useMemo(() => (doc ? buildCoaReportPages(doc) : []), [doc]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["coa", id] });
  const submit = useMutation({ mutationFn: () => api.submitCoaDocument(id, { _user: actor }), onSuccess: invalidate });
  const save = useMutation({ mutationFn: () => api.updateCoaDocument(id, { remark, _user: actor }), onSuccess: invalidate });
  const approve = useMutation({
    mutationFn: () => api.approveCoaDocument(id, { _user: actor }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["coa", id] });
      setPrintOpen(true);
    },
  });
  const reject = useMutation({
    mutationFn: () => api.rejectCoaDocument(id, { reason: reason.trim(), _user: actor }),
    onSuccess: () => {
      void invalidate();
      setRejectOpen(false);
      setPrintOpen(false);
      setReason("");
    },
  });
  const revise = useMutation({ mutationFn: () => api.reviseCoaDocument(id, { _user: actor }), onSuccess: (next) => navigate(`/coa/${next._id}`) });
  const cancel = useMutation({ mutationFn: () => api.cancelCoaDocument(id, { reason, _user: actor }), onSuccess: invalidate });
  const recordPrint = useMutation({
    mutationFn: (meta: { copies: number; outputMode: string }) => api.recordCoaPrintEvent(id, { event: "printDialogOpened", ...meta, _user: actor }),
    onSuccess: invalidate,
  });
  const canReview = doc ? canReviewCoa(actor, doc) : false;
  const actions = doc ? allowedCoaActions(doc.status, canReview) : [];
  const printable = doc ? actions.includes("print") && canPrintCoa(doc.status) : false;

  useEffect(() => {
    if (doc) setRemark(doc.remark ?? "");
  }, [doc]);

  useEffect(() => {
    if (searchParams.get("print") === "1" && printable) {
      setPrintOpen(true);
    }
  }, [printable, searchParams]);

  useEffect(() => {
    if (searchParams.get("preview") === "1") {
      setPrintOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("pdf") !== "1" || !printable || !doc || !pdfRef.current) return;
    const key = `${id}:${doc.coaNo || "draft"}`;
    if (pdfDownloadKeyRef.current === key) return;
    pdfDownloadKeyRef.current = key;
    void openPrintPdf("coa", pdfRef.current, {
      css: COA_REPORT_CSS,
      fileName: `COA-${doc.coaNo || id}.pdf`,
    });
  }, [doc, id, printable, searchParams]);

  if (isLoading || !doc) {
    if (isError) {
      return <AppLayout><div className="text-destructive">{error instanceof Error ? error.message : "ไม่สามารถโหลด COA ได้"}</div></AppLayout>;
    }
    return <AppLayout><div className="text-muted-foreground">กำลังโหลด...</div></AppLayout>;
  }

  return (
    <AppLayout title={doc.coaNo || "COA"}>
      <div className="space-y-6">
        <PageHeader
          onBack={() => navigate("/coa")}
          title={<span className="inline-flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-primary-500" />{doc.coaNo || "ร่าง COA"}</span>}
          actions={<Button className="gap-2 bg-primary-500 text-white hover:bg-primary-600" onClick={() => setPrintOpen(true)}><Printer className="h-4 w-4" />{printable ? "พิมพ์ COA" : "เปิดดูไฟล์"}</Button>}
        />
        <div className="flex flex-wrap items-center gap-2">
          <CoaStatusBadge status={doc.status} />
          <span className="text-sm text-muted-foreground">{doc.petitionNoSnapshot}</span>
          {doc.revision > 0 && <span className="text-sm text-muted-foreground">Rev.{doc.revision}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.includes("save") && <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>บันทึกฟอร์ม</Button>}
          {actions.includes("submit") && <Button className="bg-primary-500 text-white hover:bg-primary-600" onClick={() => submit.mutate()}>เสร็จสิ้น</Button>}
          {actions.includes("approve") && (
            <>
              <Button className="bg-primary-500 text-white hover:bg-primary-600" onClick={() => approve.mutate()}>อนุมัติ</Button>
              <Button variant="destructive" onClick={() => { setReason(""); setRejectOpen(true); }}>ไม่อนุมัติ</Button>
            </>
          )}
          {actions.includes("revise") && (
            <>
              <Button variant="outline" onClick={() => revise.mutate()}>สร้างฉบับแก้ไข</Button>
              {isQcHead && <Button variant="destructive" disabled={!reason.trim()} onClick={() => cancel.mutate()}>ยกเลิก COA</Button>}
            </>
          )}
        </div>
        {actions.includes("save") && (
          <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
            <h2 className="mb-3 font-semibold text-foreground">ข้อมูลในฟอร์ม COA</h2>
            {doc.sourceType === "erpManual" && <Button variant="outline" className="mb-3" onClick={() => setManualOpen(true)}>แก้ไขข้อมูลและผลทดสอบ</Button>}
            <Textarea value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="หมายเหตุหรือข้อมูลประกอบในฟอร์ม COA" />
          </section>
        )}
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เหตุผลสำหรับไม่อนุมัติหรือยกเลิก" />
        {doc.sourceType === "erpManual" && actions.includes("save") && <CoaManualDialog open={manualOpen} onOpenChange={setManualOpen} request={doc} onSaved={() => { void invalidate(); void queryClient.invalidateQueries({ queryKey: ["coa"] }); }} />}
        <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
          <h2 className="mb-3 font-semibold text-foreground">ตัวอย่างและผลทดสอบ</h2>
          {doc.sampleSnapshots.map((sample) => (
            <div key={sample.itemSeq} className="mb-4 rounded-md border bg-muted/50 p-3 last:mb-0">
              <div className="font-medium text-foreground">{sample.sampleName || sample.commonName || `Sample ${sample.itemSeq}`}</div>
              <div className="text-sm text-muted-foreground">{sample.batchNo || sample.lotNo || "-"}</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-foreground">
                {doc.resultSnapshots.filter((row) => row.itemSeq === sample.itemSeq).map((row, index) => (
                  <li key={index}>{row.testItem}: {row.result}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section>
          <h2 className="mb-3 font-semibold text-foreground">ประวัติเอกสาร</h2>
          <CoaAuditTimeline audit={doc.audit} />
        </section>
      </div>
      <PrintPreviewDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        docType="coa"
        css={COA_REPORT_CSS}
        onPrinted={(meta) => recordPrint.mutate(meta)}
        previewOnly={!printable}
        headerActions={actions.includes("approve") ? (
          <>
            <Button type="button" size="sm" className="gap-2" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate()}>
              <CheckCircle2 className="h-4 w-4" />
              อนุมัติ
            </Button>
            <Button type="button" variant="destructive" size="sm" className="gap-2" disabled={approve.isPending || reject.isPending} onClick={() => { setReason(""); setRejectOpen(true); }}>
              <XCircle className="h-4 w-4" />
              ไม่อนุมัติ
            </Button>
          </>
        ) : undefined}
      >
        <CoaReportTemplate pages={pages} />
      </PrintPreviewDialog>
      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!reject.isPending) setRejectOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ไม่อนุมัติ COA {doc.coaNo || doc.petitionNoSnapshot || doc._id}</DialogTitle>
            <DialogDescription>ระบุเหตุผลเพื่อส่งเอกสารกลับให้แก้ไข และบันทึกไว้ในประวัติเอกสาร</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เหตุผลที่ไม่อนุมัติ" rows={4} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={reject.isPending} onClick={() => setRejectOpen(false)}>ยกเลิก</Button>
            <Button type="button" variant="destructive" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate()}>
              {reject.isPending ? "กำลังส่งกลับ..." : "ยืนยันไม่อนุมัติ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div ref={pdfRef} className="fixed -left-[10000px] top-0 bg-white" aria-hidden="true">
        <CoaReportTemplate pages={pages} />
      </div>
    </AppLayout>
  );
}
