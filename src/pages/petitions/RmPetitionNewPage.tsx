// สร้างคำขอของแผนก RM จากฟอร์ม F-WAR-03-01,02
// submit 2 จังหวะ: สร้าง petition ก่อน แล้วค่อยผูกฟอร์ม — ถ้าจังหวะ 2 พังต้องลบ petition ทิ้ง
// ไม่งั้นจะเหลือคำขอลอยที่ไม่มีฟอร์มผูกอยู่
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/lis/AppLayout';
import { api } from '@/lib/api';
import { buildPetitionMasterItemOptions, normalizeMasterItemPayload } from '@/lib/petitionMasterItem';
import { createPetition, deletePetition } from '@/hooks/usePetition';
import { useAuth } from '@/hooks/useAuth';
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeRoles } from '@/lib/roles';
import { buildRmPetitionItems, type RmTestSelection } from '@/lib/rmPetitionMapping';
import type { GoodsReceiptReceipt, RawMaterialInspection } from '@/types/goodsReceipt.types';
import GoodsReceiptStep from '@/components/warehouse/GoodsReceiptStep';
import RawMaterialInspectionStep from '@/components/warehouse/RawMaterialInspectionStep';
import RmTestItemsStep from '@/components/warehouse/RmTestItemsStep';

const STEPS = ['ใบรับสินค้า', 'ใบตรวจสอบวัตถุดิบ', 'สินค้าอ้างอิง', 'ตรวจทาน'];

export default function RmPetitionNewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreateAdminOnly = normalizeRoles(user).includes('admin');
  const [adminOnlyPetition, setAdminOnlyPetition] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warehouse, setWarehouse] = useState('');
  const [receipt, setReceipt] = useState<GoodsReceiptReceipt>({});
  const [inspection, setInspection] = useState<RawMaterialInspection>({});
  const [selections, setSelections] = useState<RmTestSelection[]>([]);
  const sendBatches = useMemo(
    () => (receipt.productBatches ?? []).filter((b) => b.sendToLab),
    [receipt.productBatches],
  );

  // โหลด master item แบบเดียวกับ ProductionPetitionNewPage.tsx:566-580
  const { data: masterItemRows = [], isLoading: masterItemsLoading } = useQuery({
    queryKey: ['master-items-for-petition-new'],
    queryFn: async () => {
      const res = await api.get<unknown>('/master-items');
      return normalizeMasterItemPayload(res.data.data);
    },
  });
  const masterItemOptions = useMemo(
    () => buildPetitionMasterItemOptions(masterItemRows),
    [masterItemRows],
  );

  const handleSubmit = async () => {
    let items;
    try {
      items = buildRmPetitionItems(receipt, selections);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ข้อมูลไม่ครบ');
      return;
    }

    const batchKeys = new Map<string, { batchNo: string; sampleName: string }>(items.map((item) => {
      const batchNo = item.batchNo.trim();
      const sampleName = String(item.sampleName ?? '').trim();
      return [`${sampleName}|${batchNo}`, { batchNo, sampleName }] as const;
    }));
    for (const { batchNo, sampleName } of batchKeys.values()) {
      try {
        const { exists } = await api.batchExists(batchNo, sampleName);
        if (exists && !window.confirm(`${sampleName ? `${sampleName} ` : ''}Batch ${batchNo} เคยส่งไปแล้ว ต้องการส่งอีกใช่ไหม?`)) return;
      } catch {
        toast.error('ตรวจสอบประวัติ batch ไม่สำเร็จ กรุณาลองใหม่');
        return;
      }
    }

    setSaving(true);
    let petitionId: string | undefined;
    try {
      // payload ตาม rmPetitionFormSchema — ไม่มี labRequests เพราะ RM ไม่มีใบคำขอรับบริการ
      const created = await createPetition({
        dept: 'rm' as const,
        submittedBy: {
          employeeId: user?.employeeId || undefined,
          name: user?.name ?? '',
          department: 'คลังสินค้า RM',
        },
        items,
        cause: '',
        adminOnly: canCreateAdminOnly && adminOnlyPetition ? true : undefined,
      } as Parameters<typeof createPetition>[0]);
      petitionId = created._id;

      await api.createGoodsReceipt({
        petitionId: petitionId as string,
        warehouse,
        receipt,
        inspection,
      });

      toast.success('สร้างคำขอเรียบร้อย');
      navigate(`/petition/${petitionId}`);
    } catch (err) {
      // ผูกฟอร์มไม่สำเร็จ — ลบคำขอที่เพิ่งสร้างทิ้ง กันคำขอลอยไม่มีฟอร์ม
      if (petitionId) {
        try {
          await deletePetition(petitionId, user?.name);
        } catch {
          toast.error('บันทึกฟอร์มไม่สำเร็จ และลบคำขอที่ค้างไม่ได้ กรุณาแจ้งผู้ดูแลระบบ');
          return;
        }
      }
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold">คำขอตรวจวัตถุดิบ (RM)</h1>

      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={label}
            className={`px-3 py-1 rounded-full border ${i === step ? 'bg-sky-600 text-white border-sky-600' : 'text-grey-600'}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <GoodsReceiptStep value={receipt} onChange={setReceipt}
          warehouse={warehouse} onWarehouseChange={setWarehouse} />
      )}
      {step === 1 && (
        <RawMaterialInspectionStep value={inspection} onChange={setInspection}
          receiptNoHint="(ออกให้อัตโนมัติเมื่อบันทึก)"
          receiptDateHint={receipt.receivedAt ?? '—'} />
      )}
      {step === 2 && (
        <RmTestItemsStep batches={sendBatches} value={selections} onChange={setSelections}
          masterItemOptions={masterItemOptions} masterItemsLoading={masterItemsLoading} />
      )}
      {step === 3 && (
        <div className="space-y-4 text-sm">
          <p className="text-grey-600">ผู้นำส่งจะเลือกภายหลังเมื่อสแกน QR ที่หน้าส่งตัวอย่าง</p>
          <p>สินค้า: <span className="font-medium">{receipt.productName || '—'}</span></p>
          <p>แบชที่ส่งตรวจ: <span className="font-medium">
            {sendBatches.map((b) => b.batchNo).filter(Boolean).join(', ') || '—'}
          </span></p>
          <p className="text-grey-600">กดส่งเพื่อสร้างคำขอและบันทึกฟอร์ม</p>
        </div>
      )}

      {canCreateAdminOnly && step === STEPS.length - 1 && (
        <label className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
          <Checkbox
            checked={adminOnlyPetition}
            onCheckedChange={(checked) => setAdminOnlyPetition(checked === true)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-foreground">คำร้องเฉพาะ Admin</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              เห็นได้และมอบหมายได้เฉพาะผู้ใช้ที่เป็น Admin ไม่แสดงรวมกับคำร้องปกติ
            </span>
          </span>
        </label>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" disabled={step === 0 || saving}
          onClick={() => setStep((s) => s - 1)}>ย้อนกลับ</Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)}>ถัดไป</Button>
        ) : (
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            ส่งคำขอ
          </Button>
        )}
      </div>
    </div>
  );

  return <AppLayout>{content}</AppLayout>;
}
