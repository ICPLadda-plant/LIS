import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ItemDecisionDialog from "@/components/lis/approval/ItemDecisionDialog";
import { api } from "@/lib/api";
import { normalizeRoles } from "@/lib/roles";
import { useAuth } from "@/hooks/useAuth";
import type { Petition } from "@/types/petition.types";

/**
 * หัวหน้า Lab แก้ไขผล Lab ได้ทุกช่วง (หลังออกผล / หลัง Final Result) — ต้องระบุเหตุผล ระบบเก็บ log
 * และรายการที่แก้ถือว่าอนุมัติแล้ว (server: lab-result-action). กดแล้วไปแก้ค่าที่หน้าบันทึกผล Lab
 */
export default function LabHeadEditAction({ petition }: { petition: Petition }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const isLabHead = normalizeRoles(user).some((role) => role === "admin" || role === "lab-head");
  if (!isLabHead || !petition.labCompletedAt || petition.status === "rejected") return null;

  const editPath = `/lab-testing/${petition._id}`;
  if (petition.labEditSession) {
    return (
      <Button variant="primary-outline" className="gap-2" onClick={() => navigate(editPath)}>
        <Pencil className="h-4 w-4" /> ไปหน้าแก้ไขผล Lab
      </Button>
    );
  }

  return (
    <>
      <Button variant="primary-outline" className="gap-2" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> แก้ไขผล (หัวหน้า Lab)
      </Button>
      <ItemDecisionDialog
        open={open}
        onOpenChange={setOpen}
        title="แก้ไขผล Lab"
        description="ระบุเหตุผลที่ต้องแก้ไขผล ระบบจะเก็บค่าเดิมและเหตุผลไว้ในประวัติ รายการที่แก้จะถือว่าอนุมัติแล้ว"
        confirmLabel="เริ่มแก้ไข"
        onConfirm={async (reason) => {
          try {
            await api.labResultAction(petition._id, "edit-start", reason);
            toast.success("เปิดแก้ไขผล Lab แล้ว");
            navigate(editPath);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "เปิดแก้ไขไม่สำเร็จ");
            throw error;
          }
        }}
      />
    </>
  );
}
