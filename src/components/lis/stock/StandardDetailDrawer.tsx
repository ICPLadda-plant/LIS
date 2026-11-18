import { Link } from "react-router-dom";
import { History, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { summarizeStandard, isUsableBottle } from "@/lib/stockStatus";
import StandardUnitsPanel from "./StandardUnitsPanel";
import type { StockStandardItem, StockUnitItem } from "@/types/stock";

/** Drawer รายละเอียดสาร Standard — เปิดจากการคลิกแถวในตาราง /stock:
 *  หัว = สถานะ/คงคลัง (ชุดตรรกะเดียวกับ badge ในแถวตาราง), ข้อมูลสาร,
 *  และตารางรายขวด (StandardUnitsPanel) พร้อมปุ่มแก้ไขข้างปุ่มเพิ่มขวด */
export default function StandardDetailDrawer({
  standard, units, onEdit, onClose,
}: {
  standard: StockStandardItem;
  units: StockUnitItem[];
  onEdit: () => void;
  onClose: () => void;
}) {
  const now = new Date();
  const sum = summarizeStandard(units, now);
  const tierParts = (["primary", "working", "supplier"] as const)
    .map(t => [t, units.filter(u => isUsableBottle(u, now) && (u.type || "primary") === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t} ${n}`);

  const info: [string, string][] = [
    ["ความถี่/1 ครั้ง", standard.frequency || "-"],
    ["อุณหภูมิที่เก็บ (°C)", standard.storageTemp || "-"],
    ["อัตราการใช้/ครั้ง (mg)", standard.usagePerUseMg != null && standard.usagePerUseMg !== "" ? String(standard.usagePerUseMg) : "-"],
    ["หมายเหตุ", standard.status || "-"],
  ];

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-2 border-b border-border p-5 pr-16 text-left">
          <SheetTitle className="text-xl font-bold">{standard.name}</SheetTitle>
          <SheetDescription className="font-semibold text-primary">{standard.code}</SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5">
            {sum.usable === 0 && <Badge className="bg-destructive/15 text-destructive text-xs">หมด</Badge>}
            {sum.expired > 0 && <Badge className="bg-destructive/15 text-destructive text-xs">หมดอายุ {sum.expired}</Badge>}
            {sum.expiringSoon > 0 && <Badge className="bg-amber-100 text-amber-700 text-xs">ใกล้หมดอายุ {sum.expiringSoon}</Badge>}
            {sum.usable > 0 && sum.expired === 0 && sum.expiringSoon === 0 && <Badge className="bg-emerald-100 text-emerald-700 text-xs">ปกติ</Badge>}
            <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
              <Package className="w-3.5 h-3.5" /> คงคลัง {sum.usable} ขวด{tierParts.length > 0 ? ` (${tierParts.join(" · ")})` : ""}
            </span>
          </div>
        </SheetHeader>
        <div className="p-5 space-y-5">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {info.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">{label}:</dt>
                <dd className="font-medium break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <div className="font-semibold mb-2">รายขวด</div>
            <StandardUnitsPanel standard={standard} onEdit={onEdit} />
          </div>
          <Button variant="outline" asChild>
            <Link to={`/stock/standards/${standard._id}/history`}><History className="w-4 h-4 mr-1" /> ดูประวัติทั้งหมด</Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
