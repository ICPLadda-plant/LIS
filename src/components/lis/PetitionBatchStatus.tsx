import { Badge } from "@/components/ui/badge";
import type { Petition } from "@/types/petition.types";
import { batchApprovalSummaries } from "@/lib/itemApprovals";

interface Props {
  petition: Petition;
  /** ค่า ถพ. ของรายการ (seq) — ว่าง = ยังไม่มีค่า */
  specificGravityFor?: (seq: number) => string;
}

/**
 * สถานะราย batch ด้านขวาของการ์ดคำร้องในหน้า /petition:
 * "กายภาพผ่าน" เมื่อ QC อนุมัติ (เฉพาะ batch ที่ส่ง QC), "%AI ผ่าน/ไม่ผ่าน/รอ" เฉพาะ batch ที่ส่ง Lab,
 * บรรทัดล่างเป็นค่า ถพ.
 */
export default function PetitionBatchStatus({ petition, specificGravityFor }: Props) {
  const batches = batchApprovalSummaries(petition);
  if (batches.length === 0) return null;
  return (
    <div className="space-y-2 lg:w-72 lg:shrink-0" aria-label="สถานะราย batch">
      {batches.map((batch) => {
        const sg = specificGravityFor
          ? batch.items.map((item) => specificGravityFor(item.seq)).find(Boolean) ?? ""
          : "";
        return (
          <div key={batch.key} className="rounded-lg border bg-card px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">{batch.batchNo ? `Batch ${batch.batchNo}` : `รายการที่ ${batch.items[0]?.seq}`}</span>
              <div className="flex flex-wrap justify-end gap-1">
                {batch.physical === "approved" && <Badge variant="green-soft">กายภาพผ่าน</Badge>}
                {batch.physical === "pending" && <Badge variant="yellow-soft">กายภาพ: รอ</Badge>}
                {batch.physical === "rejected" && <Badge variant="red-soft">กายภาพ: ส่งตรวจใหม่</Badge>}
                {batch.ai === "pass" && <Badge variant="green-soft">%AI ผ่าน</Badge>}
                {batch.ai === "fail" && <Badge variant="red-soft">%AI ไม่ผ่าน</Badge>}
                {batch.ai === "pending" && <Badge variant="yellow-soft">%AI รอ</Badge>}
              </div>
            </div>
            {sg && <p className="mt-1 text-xs text-muted-foreground">ถพ. {sg}</p>}
          </div>
        );
      })}
    </div>
  );
}
