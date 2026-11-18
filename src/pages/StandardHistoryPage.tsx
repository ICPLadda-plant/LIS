import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, History } from "lucide-react";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import StandardHistoryPanel from "@/components/lis/stock/StandardHistoryPanel";

/** หน้าประวัติทั้งหมดของสาร Standard หนึ่งตัว (เปิดจากปุ่มใน drawer รายละเอียด) */
export default function StandardHistoryPage() {
  const { id = "" } = useParams();
  const { data: standards, isLoading } = useQuery({
    queryKey: ["stock", "standards"],
    queryFn: () => api.getStandards(),
  });
  const standard = standards?.find((s) => s._id === id);

  return (
    <AppLayout>
      <PageHeader
        className="mb-6"
        title={<span className="inline-flex items-center gap-2"><History className="w-6 h-6" /> ประวัติทั้งหมด{standard ? ` · ${standard.name}` : ""}</span>}
        description={standard?.code}
        actions={<Button variant="outline" asChild><Link to="/stock"><ArrowLeft className="w-4 h-4 mr-1" /> กลับหน้าคลัง</Link></Button>}
      />
      {isLoading && <p className="text-muted-foreground">กำลังโหลด...</p>}
      {!isLoading && !standard && <p className="text-destructive">ไม่พบสาร Standard นี้</p>}
      {standard && (
        <Card>
          <CardContent className="p-5">
            <StandardHistoryPanel standard={standard} />
          </CardContent>
        </Card>
      )}
    </AppLayout>
  );
}
