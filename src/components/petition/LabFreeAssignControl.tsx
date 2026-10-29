import { useState } from 'react';
import { Unlock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  FREE_ASSIGN_MAX_DAYS,
  FREE_ASSIGN_PRESETS,
  formatFreeAssignUntil,
  freeAssignUntilFromDuration,
  freeAssignUntilFromPreset,
  type FreeAssignUnit,
  type LabFreeAssignState,
} from '@/lib/labFreeAssign';
import { cn } from '@/lib/utils';

interface LabFreeAssignControlProps {
  state: LabFreeAssignState | null;
  active: boolean;
  /** หัวหน้า Lab / admin — เปิด/ปิดได้; คนอื่นเห็นเป็นสถานะอย่างเดียว */
  canManage: boolean;
  saving: boolean;
  onChange: (until: Date | null) => Promise<boolean>;
}

export default function LabFreeAssignControl({ state, active, canManage, saving, onChange }: LabFreeAssignControlProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('2');
  const [unit, setUnit] = useState<FreeAssignUnit>('hour');

  const untilLabel = active && state?.freeUntil ? formatFreeAssignUntil(state.freeUntil) : null;

  if (!canManage) {
    return untilLabel ? (
      <Badge variant="green-soft" className="h-9 gap-1.5 px-3 text-sm font-medium">
        <Unlock className="h-4 w-4" />
        มอบหมายอิสระถึง {untilLabel}
      </Badge>
    ) : (
      <Badge variant="gray-soft" className="h-9 px-3 text-sm font-normal">
        รอหัวหน้า Lab มอบหมายงาน
      </Badge>
    );
  }

  const customUntil = freeAssignUntilFromDuration(Number(amount), unit);

  async function apply(until: Date | null) {
    const ok = await onChange(until);
    if (ok) setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={active ? 'primary' : 'primary-outline'} className="gap-2">
          <Unlock className="h-4 w-4" />
          {untilLabel ? `มอบหมายอิสระถึง ${untilLabel}` : 'มอบหมายอิสระ'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-base font-semibold text-foreground">มอบหมายอิสระ</p>
          <p className="text-sm text-muted-foreground">
            เจ้าหน้าที่ Lab กดรับงานที่ยังไม่มีผู้รับได้เอง และงานจะเป็นของคนที่กดรับทันที
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {FREE_ASSIGN_PRESETS.map(({ label, preset }) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => apply(freeAssignUntilFromPreset(preset))}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">หรือกำหนดเอง</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-20"
              aria-label="ระยะเวลา"
            />
            <div className="inline-flex rounded-md border border-border p-0.5">
              {(['hour', 'day'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setUnit(value)}
                  className={cn(
                    'rounded px-3 py-1 text-sm transition-colors',
                    unit === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {value === 'hour' ? 'ชั่วโมง' : 'วัน'}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" disabled={saving || !customUntil} onClick={() => customUntil && apply(customUntil)}>
              เปิด
            </Button>
          </div>
          {!customUntil && (
            <p className="text-xs text-destructive">ระบุได้ตั้งแต่ 1 ชั่วโมง ถึง {FREE_ASSIGN_MAX_DAYS} วัน</p>
          )}
        </div>

        {active && (
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">
              เปิดอยู่ถึง {untilLabel}{state?.setBy ? ` · โดย ${state.setBy}` : ''}
            </p>
            <Button size="sm" variant="destructive" disabled={saving} onClick={() => apply(null)}>
              ปิดตอนนี้
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
