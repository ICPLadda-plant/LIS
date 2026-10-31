import { useEffect, useId, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ParameterRemarkFieldProps {
  /** หมายเหตุที่บันทึกไว้แล้ว (QCTestResult.remark) */
  value?: string;
  disabled?: boolean;
  /** บันทึกเมื่อออกจากช่อง และข้อความเปลี่ยนจากค่าที่บันทึกไว้ */
  onSave: (remark: string) => Promise<void>;
  className?: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** ช่องหมายเหตุเล็กใต้ parameter (ไม่บังคับ) — ใช้ทั้งหน้าบันทึกผล QC และ Lab */
export default function ParameterRemarkField({ value = "", disabled, onSave, className }: ParameterRemarkFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  const savedRef = useRef(value);

  // ค่าจาก server เปลี่ยน (โหลดใหม่/รอบตัวอย่างใหม่) → sync ถ้าผู้ใช้ไม่ได้แก้ค้างอยู่
  useEffect(() => {
    setText((current) => (current === savedRef.current ? value : current));
    savedRef.current = value;
  }, [value]);

  const save = async () => {
    const next = text.trim();
    if (next === savedRef.current.trim()) return;
    setState("saving");
    try {
      await onSave(next);
      savedRef.current = next;
      setText(next);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        หมายเหตุ
      </label>
      <Textarea
        id={id}
        value={text}
        disabled={disabled}
        maxLength={1000}
        rows={1}
        placeholder="หมายเหตุ (ไม่บังคับ)"
        className="min-h-[36px] py-1.5 text-sm"
        onChange={(event) => {
          setText(event.target.value);
          if (state !== "idle") setState("idle");
        }}
        onBlur={() => void save()}
      />
      {state === "saving" && <p className="text-xs text-muted-foreground">กำลังบันทึกหมายเหตุ...</p>}
      {state === "saved" && <p className="text-xs text-muted-foreground">บันทึกหมายเหตุแล้ว</p>}
      {state === "error" && <p className="text-xs text-destructive">บันทึกหมายเหตุไม่สำเร็จ</p>}
    </div>
  );
}
