import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { releaseBodyPointerLock } from "@/context/ConfirmDialog";

interface ItemDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** ข้อความเตือนเพิ่มเติม (เช่น มีค่าผิดปกติ) */
  warning?: string;
  onConfirm: (note: string) => Promise<void> | void;
}

/** dialog ระบุเหตุผล (บังคับกรอก) สำหรับอนุมัติผลไม่ปกติ / ไม่อนุมัติรายรายการ ในหน้า /qc-approval */
export default function ItemDecisionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  warning,
  onConfirm,
}: ItemDecisionDialogProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setNote("");
      setSubmitting(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
      releaseBodyPointerLock();
    } catch {
      // คง dialog ไว้ให้ลองใหม่
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="item-decision-note">
            เหตุผล <span className="text-destructive">*</span>
          </label>
          <textarea
            id="item-decision-note"
            aria-label="เหตุผล"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
            placeholder="ระบุเหตุผล..."
            className="min-h-[110px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {warning && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {warning}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={handleConfirm}
            disabled={!note.trim() || submitting}
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

