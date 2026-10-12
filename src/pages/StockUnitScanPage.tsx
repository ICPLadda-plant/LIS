import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dateTime";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatStockQuantityWithUnit } from "@/lib/stockQuantity";
import { unitDerivedStatus } from "@/lib/stockUnit";
import DiscardDialog from "@/components/lis/stock/DiscardDialog";

export default function StockUnitScanPage() {
  const { qrId = "" } = useParams();
  const qc = useQueryClient();
  const [action, setAction] = useState<"discard" | null>(null);

  const { data: unit, isLoading, error } = useQuery({
    queryKey: ["stock", "unit", qrId],
    queryFn: () => api.getStockUnit(qrId),
    enabled: !!qrId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["stock", "unit", qrId] });
  const st = unit ? unitDerivedStatus(unit) : null;

  return (
    <AppLayout>
      <PageHeader className="mb-6" title={<span className="inline-flex items-center gap-2"><Package className="w-6 h-6" /> ขวด Standard</span>} description={qrId} />
      {isLoading && <p className="text-muted-foreground">กำลังโหลด...</p>}
      {error && <p className="text-destructive">ไม่พบขวดนี้</p>}
      {unit && (
        <Card className="max-w-md">
          <CardContent className="p-5 space-y-2">
            <div className="text-lg font-bold">{unit.itemName}</div>
            <div className="text-sm text-muted-foreground">{unit.itemCode} · Lot {unit.lotNo || "-"}</div>
            <div className="flex gap-2 text-sm">
              <Badge variant="outline">{unit.type || "primary"}</Badge>
              <span>เหลือ {formatStockQuantityWithUnit(unit.volume?.remaining, unit.volume?.unit)}</span>
              <span>EXP {formatDate(unit.exp)}</span>
            </div>
            <div className="pt-3 flex flex-col gap-2">
              {st === "discarded" ? (
                <p className="text-destructive font-medium">ขวดนี้ถูกทิ้งแล้ว ใช้งานต่อไม่ได้</p>
              ) : (
                <Button variant="destructive" onClick={() => setAction("discard")}>ทิ้งขวด</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {action === "discard" && <DiscardDialog qrId={qrId} onClose={() => setAction(null)} onSaved={refresh} />}
    </AppLayout>
  );
}
