import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import DocumentManager from "@/components/lis/DocumentManager";

export default function DocumentsPage() {
  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader title="จัดการเอกสาร" description="สร้าง แก้ไข หรือนำเข้าเอกสาร Word ที่มีอยู่" />
        <DocumentManager />
      </div>
    </AppLayout>
  );
}
