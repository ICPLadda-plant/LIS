import type { Petition, QCTestResult } from '@/types/petition.types';
import type { LabRequest } from '@/types/labRequest.types';
import type { ParameterItem } from '@/lib/api';
import { buildApprovalGroups } from '@/lib/qcApprovalRows';
import { buildLabReportPages, type LabReportPage } from '@/lib/labReport';

const PHYSICAL_PARAMETER_NAME = 'กายภาพ';
// ค่า ถพ. (QC ที่แชร์ให้ Lab) ต้องเข้ารายงานเพื่อแสดง Density
const isDensityParam = (p: ParameterItem) => p.scope === 'qc' && p.shareWithLab === true && /ถ\.?\s*พ|density/i.test(p.name ?? '');

/**
 * รวม 3 ขั้นสร้าง "ผลวิเคราะห์ Lab" ให้เป็น code path เดียว: กรอง parameter เฉพาะฝั่ง Lab
 * (ไม่รวม param QC ที่แชร์ให้ Lab เช่น ค่า ถพ.) → buildApprovalGroups → buildLabReportPages
 */
export function buildLabResultReportPages(input: {
  petition: Petition;
  labRequests: LabRequest[];
  parameters: ParameterItem[];
  qcResults: QCTestResult[];
  groupMembership: Map<string, string[]>;
}): LabReportPage[] {
  const { petition, labRequests, parameters, qcResults, groupMembership } = input;
  const labParams = parameters.filter((parameter) => (
    (parameter.scope ?? 'qc') === 'lab'
    || parameter.name?.trim() === PHYSICAL_PARAMETER_NAME
    || isDensityParam(parameter)
  ));
  const groups = buildApprovalGroups(petition, labParams, qcResults, groupMembership);
  return buildLabReportPages(petition, labRequests, groups);
}
