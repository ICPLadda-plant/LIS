import { NavLink } from "react-router-dom";
import { usePetitionList } from "@/hooks/usePetition";
import { petitionStatusBadge } from "@/lib/statusBadge";
import StatusStepBadge from "@/components/lis/StatusStepBadge";
import { cn } from "@/lib/utils";

interface SplitPetitionListProps {
  title: string;
  /** route ของหน้ารายละเอียด เช่น "/lab-testing" → ลิงก์ "/lab-testing/:id" */
  basePath: string;
  status?: string;
  labPending?: boolean;
}

/**
 * รายการคำร้องฝั่งซ้ายของ split view (iPad แนวนอน 1024–1279) ให้สลับคำร้องได้โดยไม่ต้องย้อนกลับ
 * ponytail: ดึง 50 รายการล่าสุด ไม่มีค้นหา/แบ่งหน้า; ถ้าต้องการให้ย้าย filter จากหน้ารายการมาใช้ร่วม
 */
export default function SplitPetitionList({ title, basePath, status, labPending }: SplitPetitionListProps) {
  const { data, loading } = usePetitionList({ status, labPending, limit: 50 });
  const items = data?.items ?? [];
  return (
    <nav aria-label={title} className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{title}</div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {loading && !items.length && <li className="px-4 py-3 text-sm text-muted-foreground">กำลังโหลด...</li>}
        {!loading && !items.length && <li className="px-4 py-3 text-sm text-muted-foreground">ไม่มีคำร้อง</li>}
        {items.map((p) => {
          const badge = petitionStatusBadge(p);
          return (
            <li key={p._id}>
              <NavLink
                to={`${basePath}/${p._id}`}
                className={({ isActive }) => cn(
                  "block min-h-11 border-b border-border px-4 py-3 transition-colors hover:bg-accent",
                  isActive && "bg-accent border-l-4 border-l-primary",
                )}
              >
                <div className="whitespace-nowrap text-sm font-medium text-foreground">{p.petitionNo}</div>
                <div className="truncate text-xs text-muted-foreground">{p.items?.[0]?.sampleName ?? "-"}</div>
                <StatusStepBadge className="mt-1" label={badge.label} variant={badge.variant} status={p.status} />
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
