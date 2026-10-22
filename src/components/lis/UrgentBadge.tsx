import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isUrgentPetition } from "@/lib/urgentPetition";

interface UrgentBadgeProps {
  petition: { priority?: unknown };
  className?: string;
}

/** ป้าย "ด่วน" สำหรับคำร้องที่ priority = 1 — ไม่แสดงอะไรถ้าเป็นงานปกติ */
export default function UrgentBadge({ petition, className }: UrgentBadgeProps) {
  if (!isUrgentPetition(petition)) return null;
  return (
    <Badge variant="destructive" className={cn("shrink-0", className)}>
      ด่วน
    </Badge>
  );
}
