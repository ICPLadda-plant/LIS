import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from '@/lib/statusBadge';
import { statusShortLabel, statusStep } from '@/lib/statusShortLabel';
import { cn } from '@/lib/utils';

interface StatusStepBadgeProps {
  /** ชื่อสถานะเต็ม (จาก statusBadge / labTrackStatusBadge ฯลฯ) */
  label: string;
  variant: BadgeVariant;
  /** petition.status ใช้คำนวณ "ขั้น n/N" ตาม workflow; ไม่ส่ง = ไม่แสดงแถบขั้น */
  status?: string;
  className?: string;
}

/** Badge บรรทัดเดียวแบบป้ายสั้น + แถบขั้นตอน; ชื่อเต็มอยู่ใน title/aria-label */
export function StatusStepBadge({ label, variant, status, className }: StatusStepBadgeProps) {
  const short = statusShortLabel(label);
  const step = statusStep(status);
  const stepText = step ? `ขั้น ${step.step}/${step.total}` : '';
  const fullText = step ? `${label} (${stepText})` : label;
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-2 whitespace-nowrap', className)}
      title={fullText}
      aria-label={fullText}
      role="img"
    >
      <Badge variant={variant} className="whitespace-nowrap" aria-hidden="true">
        {short}
      </Badge>
      {step && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-hidden="true">
          <span className="inline-flex items-center gap-0.5">
            {Array.from({ length: step.total }, (_, i) => (
              <span
                key={i}
                className={cn('h-1.5 w-1.5 rounded-full', i < step.step ? 'bg-primary' : 'bg-border')}
              />
            ))}
          </span>
          {stepText}
        </span>
      )}
    </span>
  );
}

export default StatusStepBadge;
