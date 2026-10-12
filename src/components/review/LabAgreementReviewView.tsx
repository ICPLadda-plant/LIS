import type { LabAgreementReview } from '@/types/labRequest.types';
import { formatDateTime } from '@/lib/dateTime';
import {
  PERSONNEL_ABLE_REASON_LABELS, PERSONNEL_UNABLE_REASON_LABELS,
  WORKLOAD_LABELS, EQUIP_READY_REASON_LABELS, EQUIP_NOT_READY_REASON_LABELS,
} from '@/lib/labAgreementReview';

const Line = ({ label, value }: { label: string; value?: string }) =>
  value ? (
    <p className="text-sm py-0.5">
      <span className="text-grey-500">{label}: </span>
      <span className="text-black-600 font-medium">{value}</span>
    </p>
  ) : null;

function joinLabels<T extends string>(keys: T[] | undefined, map: Record<T, string>): string {
  return (keys ?? []).map((k) => map[k]).filter(Boolean).join(', ');
}

export default function LabAgreementReviewView({ data }: { data: LabAgreementReview }) {
  return (
    <div className="space-y-1">
      {data.personnel && (
        <Line
          label="บุคลากร"
          value={data.personnel === 'able'
            ? `ทำได้ (${joinLabels(data.personnelAbleReasons, PERSONNEL_ABLE_REASON_LABELS) || '-'})`
            : `ไม่สามารถทำได้ (${joinLabels(data.personnelUnableReasons, PERSONNEL_UNABLE_REASON_LABELS) || '-'})`}
        />
      )}
      {data.workload && <Line label="ปริมาณงาน" value={WORKLOAD_LABELS[data.workload]} />}
      {data.subcontractor && (
        <Line label="ผู้รับเหมาช่วง"
          value={data.subcontractor === 'none' ? 'ไม่ใช้' : `ใช้: ${data.subcontractorName || '-'}`} />
      )}
      {data.methodSuitable !== undefined && (
        <Line label="พิจารณาวิธีเฉพาะ"
          value={data.methodSuitable ? 'เหมาะสม' : `ไม่เหมาะสม (${data.methodSuitableReason || '-'})`} />
      )}
      {data.equipment && (
        <Line label={`เครื่องมือ${data.equipmentName ? ` (${data.equipmentName})` : ''}`}
          value={data.equipment === 'ready'
            ? `พร้อม (${joinLabels(data.equipmentReadyReasons, EQUIP_READY_REASON_LABELS) || '-'})`
            : `ไม่พร้อม (${joinLabels(data.equipmentNotReadyReasons, EQUIP_NOT_READY_REASON_LABELS) || '-'})`} />
      )}
      {data.acceptable !== undefined && (
        <Line label="สรุป"
          value={data.acceptable ? 'พร้อมรับงาน' : `ไม่พร้อมรับงาน (${data.notAcceptableReason || '-'})`} />
      )}
      <Line label="หมายเหตุ" value={data.remark} />
      <p className="text-xs text-grey-500 pt-2">
        โดย {data.reviewedBy} ·{' '}
        {formatDateTime(data.reviewedAt)}
      </p>
    </div>
  );
}
