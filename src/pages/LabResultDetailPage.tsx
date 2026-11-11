import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Calculator, ChevronDown, FileCheck2, FileText, FlaskConical, Loader2, Printer, type LucideIcon } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, type ParameterItem } from "@/lib/api";
import { usePetition, useLabRequestsByPetition } from "@/hooks/usePetition";
import { useItemGroupMembership } from "@/hooks/useItemGroupMembership";
import { buildApprovalGroups } from "@/lib/qcApprovalRows";
import { aiSubstancesForItem } from "@/lib/aiSubstanceFields";
import { buildLabResultReportPages } from "@/lib/labResultReport";
import { canPrintLabResult } from "@/lib/petitionPrintability";
import { petitionDepartmentLabel } from "@/lib/petitionDepartment";
import { itemSubmissionNoText } from "@/lib/petitionSampler";
import LabResultGroups from "@/components/petition/LabResultGroups";
import LabResultReportTemplate, { LAB_REPORT_CSS } from "@/components/petition/LabResultReportTemplate";
import ChemAnalysisReportTemplate, { CHEM_ANALYSIS_REPORT_CSS } from "@/components/petition/ChemAnalysisReportTemplate";
import { buildChemAnalysisSheets, canPrintChemAnalysisReport } from "@/lib/chemAnalysisReport";
import LabCalculationForm, { LAB_CALCULATION_CSS, hasCalculationData } from "@/components/petition/LabCalculationForm";
import PrintPreviewDialog from "@/components/lis/PrintPreviewDialog";
import type { QCTestResult } from "@/types/petition.types";
import { useAuth } from "@/hooks/useAuth";
import { normalizeRoles } from "@/lib/roles";
import LabHeadEditAction from "@/components/lis/approval/LabHeadEditAction";

const PHYSICAL_PARAMETER_NAME = "กายภาพ";

type PrintDocumentOption = {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  open: () => void;
};

function isLabReportSourceParameter(parameter: ParameterItem): boolean {
  return parameter.scope === "lab" || parameter.name?.trim() === PHYSICAL_PARAMETER_NAME;
}

export default function LabResultDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canSeeRestrictedStandards = normalizeRoles(user).some((role) => role === "admin" || role === "qc-head");

  const { data: petition, loading, error } = usePetition(id);
  const { data: labRequests } = useLabRequestsByPetition(id);
  const groupMembership = useItemGroupMembership();
  const [parameters, setParameters] = useState<ParameterItem[]>([]);
  const [results, setResults] = useState<QCTestResult[]>([]);
  const [paramsLoaded, setParamsLoaded] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [bromPrintOpen, setBromPrintOpen] = useState(false);
  const [chemReportOpen, setChemReportOpen] = useState(false);

  // รายงานต้องใช้ Lab parameters + กายภาพ เพื่อเติมสภาพตัวอย่างใน header
  useEffect(() => {
    api
      .getParameters()
      .then((all) => setParameters(all.filter(isLabReportSourceParameter)))
      .catch(() => setParameters([]))
      .finally(() => setParamsLoaded(true));
  }, []);

  useEffect(() => {
    if (!id) return;
    api.getQCResults(id).then(setResults).catch(() => setResults([]));
  }, [id]);

  const groups = useMemo(() => {
    if (!petition) return [];
    return buildApprovalGroups(petition, parameters.filter((parameter) => parameter.scope === "lab"), results, groupMembership, {
      includeRestrictedStandards: canSeeRestrictedStandards,
      showAutoPassRange: false,
      includeResultOnlyFields: true,
    })
      // รายการที่ไม่มีพารามิเตอร์ฝั่ง Lab ไม่ต้องแสดงในหน้าผลวิเคราะห์ Lab
      .filter((group) => !group.unmatched)
      .map((group) => {
        const item = petition.items?.find((entry) => entry.seq === group.seq);
        return item ? { ...group, submissionNo: itemSubmissionNoText(petition, item, "lab") || undefined } : group;
      });
  }, [petition, parameters, results, groupMembership, canSeeRestrictedStandards]);

  const pages = useMemo(
    () => (petition ? buildLabResultReportPages({ petition, labRequests: labRequests ?? [], parameters, qcResults: results, groupMembership }) : []),
    [petition, labRequests, parameters, results, groupMembership],
  );

  const report = <LabResultReportTemplate pages={pages} />;
  const labResultPrintable = petition ? canPrintLabResult(petition) && pages.length > 0 : false;
  const chemSheets = useMemo(() => (petition ? buildChemAnalysisSheets(petition, pages) : []), [petition, pages]);
  const chemReportPrintable = petition ? canPrintChemAnalysisReport(petition) && chemSheets.length > 0 : false;
  // ใบคำนวณใช้ได้ทุกสาร: หัวกระดาษจากหน้ารายงาน แต่ค่าดิบ (Area Inj / % Sample) มาจาก groups
  // ของหน้านี้ ซึ่งเปิด includeResultOnlyFields — รายงาน Lab ปกติไม่มีแถวเหล่านี้
  const calcPages = pages
    .flatMap((page, i) => {
      const seq = petition?.items?.[i]?.seq;
      const group = groups.find((g) => g.seq === seq);
      if (!group) return [page];
      const rows = group.params.flatMap((p) => p.rows.map((r) => ({
        testItem: `${r.label}${r.unit ? ` (${r.unit})` : ""}`,
        result: r.value || "-",
        criteria: "-",
        method: "-",
      })));
      // ยาผสม: ใบคำนวณแยกหน้าละสาร ใช้ค่าชุด %AI ของสารนั้น (ตัด " — ชื่อสาร" ออกจากชื่อช่อง)
      const substances = aiSubstancesForItem(group.commonName);
      if (substances.length === 0) return [{ ...page, rows: [...rows, ...page.rows] }];
      return substances.map((substance) => {
        const suffix = new RegExp(`\\s+—\\s+${substance.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s*(·|\\(|$))`, "i");
        const ownRows = rows
          .filter((row) => !/\s—\s/.test(row.testItem) || suffix.test(row.testItem))
          .map((row) => ({ ...row, testItem: row.testItem.replace(suffix, "") }));
        return { ...page, sample: { ...page.sample, name: substance.raw }, rows: [...ownRows, ...page.rows] };
      });
    })
    .filter(hasCalculationData);
  // พิมพ์ได้ทันทีที่ Lab ออกผล ไม่ต้องรอ QC อนุมัติ
  const calcPrintable = Boolean(petition && (petition.labCompletedAt || petition.labApprovedAt) && calcPages.length > 0);

  // รวมเอกสารพิมพ์ทั้งหมดไว้ในปุ่มเดียว ผู้ใช้เลือกจากชื่อและคำอธิบาย แทนการไล่อ่านหลายปุ่ม
  const printOptions: PrintDocumentOption[] = [
    {
      key: "labResult",
      label: "ผลวิเคราะห์ Lab",
      description: labResultPrintable ? "ผลวิเคราะห์ของทุกตัวอย่างในคำร้องนี้" : "พิมพ์ได้หลังหัวหน้า Lab อนุมัติผล",
      icon: FileText,
      enabled: labResultPrintable,
      open: () => setPrintOpen(true),
    },
    ...(calcPages.length > 0
      ? [{
          key: "calculation",
          label: "ใบคำนวณ",
          description: calcPrintable ? "ค่าดิบและการคำนวณสารสำคัญ" : "พิมพ์ได้หลัง Lab ออกผล",
          icon: Calculator,
          enabled: calcPrintable,
          open: () => setBromPrintOpen(true),
        }]
      : []),
    ...(chemReportPrintable
      ? [{
          key: "chemReport",
          label: "ใบรายงานผลการวิเคราะห์",
          description: "แบบฟอร์ม F-CHM-01-01 สำหรับส่งออก",
          icon: FileCheck2,
          enabled: true,
          open: () => setChemReportOpen(true),
        }]
      : []),
  ];
  const anyPrintable = printOptions.some((option) => option.enabled);

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

  return (
    <AppLayout title={petition.petitionNo}>
      <div className="space-y-6 pb-10">
        <PageHeader
          onBack={() => navigate("/lab-results")}
          title={
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-sky-500" />
              ผลวิเคราะห์ Lab {petition.petitionNo}
            </span>
          }
          actions={
            <div className="flex flex-wrap justify-end gap-2">
              <LabHeadEditAction petition={petition} />
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="primary-outline" disabled={!anyPrintable} className="gap-2">
                    <Printer className="h-4 w-4" /> พิมพ์เอกสาร
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">เลือกเอกสารที่ต้องการพิมพ์</DropdownMenuLabel>
                  {printOptions.map(({ key, label, description, icon: Icon, enabled, open }) => (
                    <DropdownMenuItem key={key} disabled={!enabled} onSelect={open} className="cursor-pointer items-start gap-3 py-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">{label}</span>
                        <span className="text-xs text-muted-foreground">{description}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="blue-soft">{petitionDepartmentLabel(petition)}</Badge>
          <Badge variant="gray-soft" className="font-normal">
            ผู้นำส่ง: {petition.submittedBy?.name ?? "-"}
          </Badge>
        </div>

        {!paramsLoaded ? (
          <div className="flex items-center justify-center py-16 text-grey-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังโหลด…
          </div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center text-grey-400">ไม่มีรายการทดสอบ</div>
        ) : (
          <LabResultGroups groups={groups} />
        )}
      </div>

      <PrintPreviewDialog open={printOpen} onOpenChange={setPrintOpen} docType="coa" title="ใบรายงานผลการทดสอบ" css={LAB_REPORT_CSS}>
        {report}
      </PrintPreviewDialog>
      {chemReportPrintable && <PrintPreviewDialog open={chemReportOpen} onOpenChange={setChemReportOpen} docType="coa" title="ใบรายงานผลการวิเคราะห์" css={CHEM_ANALYSIS_REPORT_CSS}>
        <ChemAnalysisReportTemplate sheets={chemSheets} />
      </PrintPreviewDialog>}
      {calcPages.length > 0 && <PrintPreviewDialog open={bromPrintOpen} onOpenChange={setBromPrintOpen} docType="coa" title="ใบคำนวณผลวิเคราะห์" css={LAB_CALCULATION_CSS}>
        {calcPages.map((page, i) => (
          <LabCalculationForm key={`${page.reportNo}-${i}`} page={page} />
        ))}
      </PrintPreviewDialog>}
    </AppLayout>
  );
}
