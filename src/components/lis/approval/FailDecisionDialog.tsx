import { useEffect, useMemo, useState } from "react";
import { Loader2, XCircle } from "lucide-react";
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
import type { ApprovalSide } from "@/lib/itemApprovals";

export interface FailOption {
  id: string;
  seq: number;
  label: string;
}

export interface FailSection {
  side: ApprovalSide;
  /** หัวข้อกลุ่ม เช่น "กายภาพไม่ผ่าน" / "AI ไม่ผ่าน" */
  label: string;
  options: FailOption[];
}

export interface FailDecision {
  /** ฝั่งที่ไม่ผ่าน พร้อมรายการ (seq) และ label ของสิ่งที่ติ๊ก */
  sides: { side: ApprovalSide; seqs: number[]; labels: string[] }[];
  /** ส่งคืนผู้ยื่นทั้งคำร้องแทนการส่งกลับทดสอบใหม่ */
  toRequester: boolean;
  note: string;
}

interface FailDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  petitionNo: string;
  submitterName: string;
  sections: FailSection[];
  onConfirm: (decision: FailDecision) => Promise<void> | void;
}

/** dialog "ผลไม่ผ่าน" ของหน้า /qc-approval — ติ๊กเลือกว่ากายภาพ / AI ข้อไหนไม่ผ่าน แล้วส่งกลับทดสอบใหม่ */
export default function FailDecisionDialog({
  open,
  onOpenChange,
  petitionNo,
  submitterName,
  sections,
  onConfirm,
}: FailDecisionDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [toRequester, setToRequester] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setToRequester(false);
      setNote("");
      setSubmitting(false);
    }
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (ids: string[], checked: boolean) => {
    setSelected((prev) => (checked
      ? Array.from(new Set([...prev, ...ids]))
      : prev.filter((id) => !ids.includes(id))));
  };

  const decisionSides = sections
    .map((section) => {
      const picked = section.options.filter((option) => selectedSet.has(option.id));
      return {
        side: section.side,
        seqs: Array.from(new Set(picked.map((option) => option.seq))),
        labels: picked.map((option) => option.label),
      };
    })
    .filter((entry) => entry.seqs.length > 0);

  const canConfirm = note.trim().length > 0 && (toRequester || decisionSides.length > 0) && !submitting;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm({ sides: toRequester ? [] : decisionSides, toRequester, note: note.trim() });
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            ผลไม่ผ่าน — {petitionNo}
          </DialogTitle>
          <DialogDescription>
            ติ๊กเลือกข้อที่ไม่ผ่าน ระบบจะส่งกลับให้ฝั่งนั้นทดสอบใหม่ ส่วนที่ผ่านแล้วคงสถานะเดิม
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {sections.length === 0 && (
            <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
              ไม่มีผลที่รอตัดสินให้เลือก
            </p>
          )}
          {sections.map((section) => {
            const ids = section.options.map((option) => option.id);
            const pickedCount = ids.filter((id) => selectedSet.has(id)).length;
            const allPicked = ids.length > 0 && pickedCount === ids.length;
            return (
              <fieldset key={section.side} className="space-y-1 rounded-lg border p-3" disabled={toRequester || submitting}>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
                  <input
                    type="checkbox"
                    aria-label={section.label}
                    checked={allPicked}
                    ref={(el) => { if (el) el.indeterminate = pickedCount > 0 && !allPicked; }}
                    onChange={(e) => toggle(ids, e.target.checked)}
                  />
                  {section.label}
                  <span className="font-normal text-muted-foreground">(เลือก {pickedCount}/{ids.length})</span>
                </label>
                <div className="space-y-0.5 pl-6">
                  {section.options.map((option) => (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        aria-label={option.label}
                        checked={selectedSet.has(option.id)}
                        onChange={(e) => toggle([option.id], e.target.checked)}
                        className="mt-1"
                      />
                      <span className="break-words">{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              aria-label="ส่งคืนผู้ยื่นทั้งคำร้อง"
              checked={toRequester}
              onChange={(e) => setToRequester(e.target.checked)}
              disabled={submitting}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-foreground">ส่งคืนผู้ยื่นทั้งคำร้อง</span>
              <span className="block text-xs text-muted-foreground">ส่งกลับให้ {submitterName} แทนการส่งทดสอบใหม่</span>
            </span>
          </label>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="fail-detail">
              เหตุผล <span className="text-destructive">*</span>
            </label>
            <textarea
              id="fail-detail"
              aria-label="เหตุผล"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              placeholder="ระบุเหตุผลหรือสิ่งที่ต้องแก้ไข..."
              className="min-h-[100px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canConfirm} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            ยืนยันผลไม่ผ่าน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
