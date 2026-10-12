import { Badge } from '@/components/ui/badge';
import type { ReviewEntry } from '@/types/petition.types';
import { formatDateTime } from '@/lib/dateTime';

const ACTION_LABEL = {
  note: 'บันทึก QC',
  approve: 'ออกผล',
  reject: 'ไม่ผ่าน',
  startTesting: 'เริ่มตรวจ',
} as const;

const ACTION_VARIANT = {
  note: 'gray-soft',
  approve: 'green-soft',
  reject: 'red-soft',
  startTesting: 'blue-soft',
} as const;

export default function ReviewHistory({ history }: { history: ReviewEntry[] }) {
  if (!history || history.length === 0) return null;
  return (
    <div className="space-y-3">
      {history.map((entry, idx) => (
        <div
          key={idx}
          className="rounded-[10px] border border-black-50 bg-grey-50 p-3 space-y-1"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <Badge variant={ACTION_VARIANT[entry.action]}>
              {ACTION_LABEL[entry.action]}
            </Badge>
            <span className="text-xs text-grey-500">
              โดย {entry.reviewedBy} ·{' '}
              {formatDateTime(entry.reviewedAt)}
            </span>
          </div>
          {entry.note && (
            <p className="text-sm text-black-500 whitespace-pre-wrap">{entry.note}</p>
          )}
        </div>
      ))}
    </div>
  );
}
