import { CheckCircle2 } from 'lucide-react';
import type { SideLabel } from '@/lib/labelReceipt';

/** เลือกเลขป้ายนำส่งที่รับในรอบนี้ (คำขอที่มีหลายเลขป้ายต่อฝั่ง) */
export default function LabelReceiptPicker({
  labels,
  selected,
  onChange,
}: {
  labels: SideLabel[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const received = labels.filter((label) => label.received).length;
  return (
    <fieldset className="space-y-1.5 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">
        เลขป้ายที่รับรอบนี้ (รับแล้ว {received}/{labels.length})
      </legend>
      {labels.map((label) => (
        <label
          key={label.key}
          className={`flex items-center gap-2 text-sm ${label.received ? 'text-muted-foreground' : 'cursor-pointer text-foreground'}`}
        >
          {label.received ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
          ) : (
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={selected.includes(label.key)}
              onChange={(e) => onChange(e.target.checked ? [...selected, label.key] : selected.filter((key) => key !== label.key))}
            />
          )}
          <span className="font-semibold">เลขที่ {label.label}</span>
          {label.received && <span className="text-xs">รับแล้ว</span>}
        </label>
      ))}
    </fieldset>
  );
}
