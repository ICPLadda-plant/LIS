import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/dateTime';
import {
  PETITION_AUDIT_EVENT_LABELS,
  PETITION_STATUS_CONFIG,
  type PetitionAuditEvent,
  type PetitionAuditLogEntry,
  type PetitionStatus,
} from '@/types/petition.types';

const EVENT_VARIANT: Record<PetitionAuditEvent, 'gray-soft' | 'primary-soft' | 'yellow-soft' | 'blue-soft' | 'green-soft' | 'red-soft'> = {
  created: 'primary-soft',
  statusChanged: 'blue-soft',
  assigned: 'yellow-soft',
  reviewed: 'green-soft',
  updated: 'gray-soft',
  deleted: 'red-soft',
  received: 'primary-soft',
  resultEntered: 'green-soft',
  resultUpdated: 'yellow-soft',
};

function statusLabel(status?: string) {
  if (!status) return null;
  return PETITION_STATUS_CONFIG[status as PetitionStatus]?.label ?? status;
}

export default function PetitionAuditLog({
  entries,
  loading,
  error,
}: {
  entries: PetitionAuditLogEntry[];
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return <p className="text-sm text-grey-500">กำลังโหลด audit log...</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-red-500">โหลด audit log ไม่สำเร็จ: {error}</p>
    );
  }
  if (entries.length === 0) {
    return <p className="text-sm text-grey-500">ยังไม่มีรายการ audit log</p>;
  }
  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const from = statusLabel(entry.fromStatus);
        const to = statusLabel(entry.toStatus);
        return (
          <div
            key={entry._id}
            className="rounded-[10px] border border-black-50 bg-grey-50 p-3 space-y-1"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <Badge variant={EVENT_VARIANT[entry.event]}>
                {PETITION_AUDIT_EVENT_LABELS[entry.event]}
              </Badge>
              {to && (
                <span className="text-sm font-medium text-black-500">
                  {from && from !== to ? (
                    <>
                      <span className="text-grey-500">{from}</span>
                      <span className="text-grey-400 mx-1">→</span>
                      <span>{to}</span>
                    </>
                  ) : (
                    to
                  )}
                </span>
              )}
              <span className="text-xs text-grey-500 ml-auto">
                {formatDateTime(entry.createdAt)}
              </span>
            </div>
            <p className="text-xs text-grey-500">
              โดย <span className="text-black-500">{entry.actor || 'system'}</span>
              {entry.note && (
                <>
                  {' '}· <span className="text-black-500">{entry.note}</span>
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
