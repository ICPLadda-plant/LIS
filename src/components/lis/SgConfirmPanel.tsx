import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dateTime";
import { SG_PENDING_LABEL } from "@/lib/sgConfirmation";

interface SgConfirmPanelProps {
  /** ค่า ถพ. / อุณหภูมิ ที่กรอกอยู่ตอนนี้ */
  value: string;
  temperature: string;
  confirmedAt?: string | null;
  confirmedBy?: string;
  confirmedValue?: string;
  confirmedTemperature?: string;
  disabled?: boolean;
  confirming?: boolean;
  onConfirm: () => void;
}

/**
 * ตัวอย่างกลุ่มน้ำที่ส่ง Lab: QC ต้องยืนยันค่า ถพ. + อุณหภูมิ ก่อน Lab จะรับงานได้
 * ยืนยันแล้วยังแก้ค่าได้ (Lab เห็นค่าใหม่ทันที) และกดยืนยันค่าใหม่ซ้ำได้
 */
export default function SgConfirmPanel({
  value,
  temperature,
  confirmedAt,
  confirmedBy,
  confirmedValue,
  confirmedTemperature,
  disabled,
  confirming,
  onConfirm,
}: SgConfirmPanelProps) {
  const ready = value.trim() !== "" && temperature.trim() !== "";
  const confirmed = Boolean(confirmedAt);
  const changedAfterConfirm =
    confirmed && (String(confirmedValue ?? "") !== value.trim() || String(confirmedTemperature ?? "") !== temperature.trim());

  return (
    <div className="space-y-1 rounded-lg border bg-card px-3 py-2" data-testid="sg-confirm-panel">
      <div className="flex flex-wrap items-center gap-2">
        {confirmed ? (
          <Badge variant="green-soft">ยืนยันค่า ถพ. แล้ว</Badge>
        ) : (
          <Badge variant="yellow-soft">{SG_PENDING_LABEL}</Badge>
        )}
        <span className="flex-1 text-sm text-muted-foreground">
          {confirmed
            ? `โดย ${confirmedBy || "-"} · ${formatDateTime(confirmedAt)}`
            : "Lab จะรับตัวอย่างได้หลัง QC ยืนยันค่า ถพ."}
        </span>
        <Button
          type="button"
          size="sm"
          variant={confirmed ? "outline" : "primary"}
          disabled={!ready || disabled || confirming}
          onClick={onConfirm}
        >
          {confirming && <Loader2 className="animate-spin" />}
          {confirmed ? "ยืนยันค่าใหม่" : "ยืนยันค่า ถพ."}
        </Button>
      </div>
      {!ready && <p className="text-xs text-muted-foreground">กรอกค่า ถพ. และอุณหภูมิก่อนกดยืนยัน</p>}
      {changedAfterConfirm && (
        <p className="text-xs text-amber-700">
          ค่าถูกแก้หลังยืนยัน (ยืนยันไว้ {confirmedValue || "-"} ที่ {confirmedTemperature || "-"} °C) — Lab เห็นค่าใหม่แล้ว
        </p>
      )}
    </div>
  );
}
