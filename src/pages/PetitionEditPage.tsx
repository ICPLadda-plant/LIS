import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import AppLayout from '@/components/lis/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PageHeader from '@/components/lis/PageHeader';
import ItemsStep, { type ItemRowValues } from '@/components/petition/wizard/ItemsStep';
import type { SubmitterValues } from '@/components/petition/wizard/SubmitterPicker';
import LabRequestStep, { type LabRequestRowValues } from '@/components/petition/wizard/LabRequestStep';
import {
  usePetition,
  useLabRequestsByPetition,
  updatePetition,
  updateLabRequest,
  createLabRequest,
} from '@/hooks/usePetition';
import { duplicateBatchError, isQcAndLabPetition, shouldSendItemToLab } from '@/lib/petitionRouting';
import type { LabRequest } from '@/types/labRequest.types';

type StepKey = 'items' | 'lab';

const PRODUCTION_STEPS: { key: StepKey; label: string }[] = [
  { key: 'items', label: '1. ผู้นำส่ง + รายการตัวอย่าง' },
  { key: 'lab', label: '2. ใบคำขอรับบริการ' },
];

const SIMPLE_STEPS: { key: StepKey; label: string }[] = [
  { key: 'items', label: '1. ผู้นำส่ง + รายการตัวอย่าง' },
];

function labRequestToFormValues(lr: LabRequest, sampleName: string): LabRequestRowValues {
  return {
    batchNo: lr.batchNo,
    sampleSeq: lr.sampleSeq,
    sampleName,
    requester: {
      fullName: lr.requester?.fullName ?? '',
      department: lr.requester?.department ?? '',
      address: lr.requester?.address ?? '',
      phone: lr.requester?.phone ?? '',
      fax: lr.requester?.fax ?? '',
      email: lr.requester?.email ?? '',
      contactName: lr.requester?.contactName ?? '',
      position: lr.requester?.position ?? '',
    },
    serviceAgreement: {
      sampleDelivery: lr.serviceAgreement.sampleDelivery,
      testMethod: lr.serviceAgreement.testMethod,
      testMethodDoneBefore: lr.serviceAgreement.testMethodDoneBefore ?? null,
      testMethodDetail: lr.serviceAgreement.testMethodDetail ?? '',
      testDuration: lr.serviceAgreement.testDuration,
      testDurationDays: lr.serviceAgreement.testDurationDays ?? null,
      requireUncertainty: lr.serviceAgreement.requireUncertainty,
      uncertaintyValue: lr.serviceAgreement.uncertaintyValue ?? '',
    },
    reportCustomerName: lr.reportCustomerName ?? '',
    reportAddressType: lr.reportAddressType ?? 'default',
    reportAddressOther: lr.reportAddressOther ?? '',
    invoiceAddressType: lr.invoiceAddressType ?? 'default',
    invoiceAddressOther: lr.invoiceAddressOther ?? '',
    testDelivery: lr.testDelivery ?? ['email'],
    storageCondition: lr.storageCondition ?? ['room'],
    packageType: lr.packageType ?? ['plasticBag'],
    packageTypeOther: lr.packageTypeOther ?? '',
    sampleReturn: lr.sampleReturn ?? 'return',
  };
}

export default function PetitionEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = usePetition(id);
  const { data: existingLabRequests, loading: labLoading } = useLabRequestsByPetition(
    data?._id,
  );

  const [initialized, setInitialized] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  const [submitter, setSubmitter] = useState<SubmitterValues>({ employeeId: '', name: '' });
  const [deliverer, setDeliverer] = useState<SubmitterValues>({ employeeId: '', name: '' });
  const [items, setItems] = useState<ItemRowValues[]>([]);
  const [labRequest, setLabRequest] = useState<LabRequestRowValues | null>(null);
  const [existingLabReqId, setExistingLabReqId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  useEffect(() => {
    if (!data || labLoading || initialized) return;
    setSubmitter({
      employeeId: data.submittedBy.employeeId ?? '',
      name: data.submittedBy.name,
      email: data.submittedBy.email ?? '',
    });
    setDeliverer({
      employeeId: data.deliveredBy?.employeeId ?? data.submittedBy.employeeId ?? '',
      name: data.deliveredBy?.name ?? data.submittedBy.name,
      email: data.deliveredBy?.email ?? data.submittedBy.email ?? '',
    });
    const mappedItems: ItemRowValues[] = data.items.map((it) => ({
      seq: it.seq,
      // ต้องหอบมาด้วย ไม่งั้นการแก้คำขอจะล้างรหัสสินค้าทิ้ง แล้ว parameter ที่ผูกกับ
      // หมวดหมู่ย่อย/กลุ่ม item จะหายไปจากคำขอนั้นเงียบๆ
      itemNo: it.itemNo ?? '',
      sampleName: it.sampleName,
      commonName: it.commonName ?? '',
      batchNo: it.batchNo,
      lotNo: it.lotNo ?? '',
      productionDate: it.productionDate ?? null,
      packageUnit: it.packageUnit ?? '',
      submissionNo: it.submissionNo || data.petitionNo, // ใช้ค่าที่บันทึกไว้ ถ้าว่าง default = เลขคำขอ
      testUnit: it.testUnit ?? '',
      testItems: it.testItems ?? '',
      sendToLab: it.sendToLab,
      // ค่าที่ฝ่ายผลิตเลือก (ส่ง QC) — ต้องหอบไปด้วย ไม่งั้นบันทึกแล้ว sendToLab จะถูกกฎ LIS override
      sendToQc: it.sendToQc,
      sampleQuantity: it.sampleQuantity ?? 1,
      labelQuantity: it.labelQuantity ?? '',
      labelQuantities: it.labelQuantities ?? [],
      note: it.note ?? '',
    }));
    setItems(mappedItems);
    const labItems = mappedItems.filter((it) => shouldSendItemToLab(it));
    if (existingLabRequests.length > 0) {
      const lr = existingLabRequests[0];
      const matchItem = data.items.find((it) => it.batchNo === lr.batchNo);
      setLabRequest(labRequestToFormValues(lr, matchItem?.sampleName ?? ''));
      setExistingLabReqId(lr._id);
    } else if (labItems.length > 0) {
      const first = labItems[0];
      setLabRequest({
        batchNo: first.batchNo,
        sampleSeq: first.seq,
        sampleName: first.sampleName,
        requester: {
          fullName: data.submittedBy.name,
          department: '',
          address: '151 ม.8 ต.สามควายเผือก อ.เมืองนครปฐม จ.นครปฐม 73000',
          phone: '034-305281-2',
          fax: '',
          email: '',
          contactName: data.submittedBy.name,
          position: '',
        },
        serviceAgreement: {
          sampleDelivery: 'self',
          testMethod: 'standard',
          testMethodDoneBefore: null,
          testMethodDetail: '',
          testDuration: 'normal',
          testDurationDays: null,
          requireUncertainty: false,
          uncertaintyValue: '',
        },
        reportCustomerName: 'ICP Ladda Co., LTD.',
        reportAddressType: 'default',
        reportAddressOther: '',
        invoiceAddressType: 'default',
        invoiceAddressOther: '',
        testDelivery: ['email'],
        storageCondition: ['room'],
        packageType: ['plasticBag'],
        packageTypeOther: '',
        sampleReturn: 'return',
      });
    }
    setInitialized(true);
  }, [data, existingLabRequests, labLoading, initialized]);

  const labBatches = useMemo(
    () => items.filter((it) => shouldSendItemToLab(it)),
    [items],
  );

  useEffect(() => {
    if (!initialized || data?.dept !== 'production') return;
    if (labBatches.length === 0) {
      setLabRequest(null);
      return;
    }
    setLabRequest((prev) => {
      const current = prev ? labBatches.find((item) => item.batchNo === prev.batchNo) : null;
      if (prev && current) {
        return {
          ...prev,
          batchNo: current.batchNo,
          sampleSeq: current.seq,
          sampleName: current.sampleName,
        };
      }
      const first = labBatches[0];
      return {
        batchNo: first.batchNo,
        sampleSeq: first.seq,
        sampleName: first.sampleName,
        requester: {
          fullName: data.submittedBy.name,
          department: '',
          address: '151 ม.8 ต.สามควายเผือก อ.เมืองนครปฐม จ.นครปฐม 73000',
          phone: '034-305281-2',
          fax: '',
          email: '',
          contactName: data.submittedBy.name,
          position: '',
        },
        serviceAgreement: {
          sampleDelivery: 'self',
          testMethod: 'standard',
          testMethodDoneBefore: null,
          testMethodDetail: '',
          testDuration: 'normal',
          testDurationDays: null,
          requireUncertainty: false,
          uncertaintyValue: '',
        },
        reportCustomerName: 'ICP Ladda Co., LTD.',
        reportAddressType: 'default',
        reportAddressOther: '',
        invoiceAddressType: 'default',
        invoiceAddressOther: '',
        testDelivery: ['email'],
        storageCondition: ['room'],
        packageType: ['plasticBag'],
        packageTypeOther: '',
        sampleReturn: 'return',
      };
    });
  }, [data?.dept, data?.submittedBy.name, initialized, labBatches]);

  const steps = useMemo(() => {
    if (data?.dept !== 'production') return SIMPLE_STEPS;
    return PRODUCTION_STEPS;
  }, [data?.dept]);

  const currentStep = steps[stepIdx]?.key ?? 'items';

  function validateStep(): boolean {
    setStepError(null);
    if (currentStep === 'items') {
      if (!submitter.name.trim()) {
        setStepError('ไม่พบชื่อผู้ยื่นคำขอ');
        return false;
      }
      if (!deliverer.name.trim()) {
        setStepError('กรุณาเลือกผู้นำส่ง');
        return false;
      }
      if (items.length === 0) {
        setStepError('ต้องมีตัวอย่างอย่างน้อย 1 รายการ');
        return false;
      }
      for (const it of items) {
        if (!it.sampleName.trim()) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกชื่อตัวอย่าง`);
          return false;
        }
        if (!it.batchNo.trim()) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกเลขแบช`);
          return false;
        }
        if (!Number.isInteger(it.sampleQuantity ?? 1) || (it.sampleQuantity ?? 1) < 1) {
          setStepError(`ตัวอย่างลำดับ ${it.seq}: กรุณากรอกจำนวนตัวอย่างเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป`);
          return false;
        }
      }
      // ฝ่ายผลิตติ๊กส่ง Lab เพิ่ม/เอาออกได้โดยไม่ต้องใส่เหตุผล (server ข้ามเช่นกัน)
      const duplicateError = duplicateBatchError(items, {
        allowDuplicates: data?.dept === 'production' && !isQcAndLabPetition(data),
      });
      if (duplicateError) {
        setStepError(duplicateError);
        return false;
      }
    }
    return true;
  }

  function goNext() {
    if (!validateStep()) return;
    // items เป็น step ก่อน lab; ถ้าไม่มี batch ส่ง lab ให้บันทึกเลย
    if (currentStep === 'items' && labBatches.length === 0) {
      void handleSave();
      return;
    }
    setStepIdx((i) => Math.min(steps.length - 1, i + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setStepError(null);
    setStepIdx((i) => Math.max(0, i - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSave() {
    if (!validateStep()) return;
    if (!id || !data) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const mappedItems = items.map((it, idx) => ({ ...it, seq: idx + 1 }));
      const submittedBy = {
        employeeId: submitter.employeeId || undefined,
        name: submitter.name,
        email: submitter.email || undefined,
        department: data.submittedBy.department, // คงแผนกผู้ยื่นเดิม
        submittedAt: data.submittedBy.submittedAt,
      };
      const deliveredBy = {
        employeeId: deliverer.employeeId || undefined,
        name: deliverer.name,
        email: deliverer.email || undefined,
      };
      if (data.dept === 'production') {
        await updatePetition(
          id,
          {
            dept: 'production',
            submittedBy,
            deliveredBy,
            items: mappedItems,
            labRequests: [],
            cause: data.cause ?? '',
          },
          submitter.name,
        );
      } else {
        await updatePetition(
          id,
          {
            dept: data.dept as 'rm',
            submittedBy,
            deliveredBy,
            items: mappedItems,
            cause: data.cause ?? '',
          },
          submitter.name,
        );
      }
      if (labBatches.length > 0 && labRequest) {
        if (existingLabReqId) {
          await updateLabRequest(existingLabReqId, labRequest);
        } else {
          await createLabRequest({ ...labRequest, petitionId: id });
        }
      }
      navigate(`/petitions-old/${id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || labLoading) {
    return (
      <AppLayout>
        <p className="text-grey-500">กำลังโหลดข้อมูล...</p>
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="rounded-[10px] border border-red-500 bg-red-50 p-4 text-sm text-red-500">
          โหลดข้อมูลไม่สำเร็จ: {error ?? 'ไม่พบคำร้อง'}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          title={`แก้ไขคำร้อง ${data.petitionNo}`}
          onBack={() => navigate(`/petitions-old/${id}`)}
          backLabel="กลับไปหน้ารายละเอียด"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {steps.filter((s) => s.key !== 'lab' || labBatches.length > 0).map((s, i, arr) => {
            const active = i === stepIdx;
            const done = i < stepIdx;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={
                    active
                      ? 'font-semibold text-primary-500'
                      : done
                        ? 'text-grey-500'
                        : 'text-grey-400'
                  }
                >
                  {s.label}
                </span>
                {i < arr.length - 1 && <span className="text-grey-300">→</span>}
              </div>
            );
          })}
        </div>

        {stepError && (
          <div className="rounded-[10px] border border-red-500 bg-red-50 p-3 text-sm text-red-500">
            {stepError}
          </div>
        )}
        {submitError && (
          <div className="rounded-[10px] border border-red-500 bg-red-50 p-3 text-sm text-red-500 whitespace-pre-wrap">
            {submitError}
          </div>
        )}

        <Card>
          <CardContent className="p-4 md:p-5">
            {currentStep === 'items' && initialized && (
              <ItemsStep
                value={items}
                onChange={setItems}
                splitQcLab={isQcAndLabPetition(data)}
                submitter={submitter}
                onSubmitterChange={setSubmitter}
                submitterReadOnly
                submitterDepartment={data?.submittedBy?.department}
                deliverer={deliverer}
                onDelivererChange={setDeliverer}
              />
            )}
            {currentStep === 'lab' && labRequest && (
              <LabRequestStep
                items={labBatches}
                request={labRequest}
                onChange={setLabRequest}
              />
            )}
            {currentStep === 'lab' && !labRequest && initialized && (
              <p className="text-sm text-grey-500">ไม่มี batch ที่ต้องยื่นใบคำขอรับบริการ</p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={goBack} disabled={stepIdx === 0 || submitting}>
            <ArrowLeft className="h-4 w-4" />
            ย้อนกลับ
          </Button>
          <div className="flex gap-2">
            {stepIdx < steps.length - 1 ? (
              <Button onClick={goNext} disabled={submitting}>
                {currentStep === 'items' && labBatches.length === 0 ? (
                  <>
                    <Save className="h-4 w-4" />
                    บันทึก (ไม่มี batch ส่ง lab)
                  </>
                ) : (
                  <>
                    ถัดไป
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={submitting}>
                <Save className="h-4 w-4" />
                {submitting ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
