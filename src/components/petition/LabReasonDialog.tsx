import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface LabReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  defaultReason?: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}

/** Popup ขอเหตุผล (บังคับกรอก) ก่อนแก้ไข / ล้างค่า / Re-check ผล Lab */
export default function LabReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  defaultReason = '',
  destructive = false,
  onConfirm,
}: LabReasonDialogProps) {
  const [reason, setReason] = useState(defaultReason);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setReason(defaultReason);
  }, [open, defaultReason]);

  const trimmed = reason.trim();

  const submit = async () => {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
    } catch {
      // ผู้เรียกแสดง toast เอง — คง dialog ไว้ให้ลองใหม่
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="lab-reason" className="text-sm font-medium text-foreground">
            เหตุผล <span className="text-destructive">*</span>
          </label>
          <Textarea
            id="lab-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="ระบุเหตุผล"
            disabled={submitting}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            onClick={() => void submit()}
            disabled={!trimmed || submitting}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
