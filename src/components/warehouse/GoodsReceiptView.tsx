// อ่านอย่างเดียว — ฟิลด์ที่ว่างจะไม่แสดง (pattern เดียวกับ LabAgreementReviewView)
import type { GoodsReceipt } from '@/types/goodsReceipt.types';
import { formatDate } from '@/lib/dateTime';
import {
  APPEARANCE_LABELS, CONTAINER_CONDITION_LABELS, CONTAINER_TYPE_LABELS,
  LATE_DELIVERY_LABELS, PRESENCE_LABELS, QUANTITY_UNIT_LABELS,
  RECEIPT_REFERENCE_LABELS, TOLERANCE_RESULT_LABELS, WEIGHT_UNIT_LABELS,
  joinLabels,
} from '@/lib/goodsReceipt';

const Line = ({ label, value }: { label: string; value?: string | number | null }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <p className="text-sm">
      <span className="text-grey-600">{label}: </span>
      <span>{value}</span>
    </p>
  );
};

const thDate = (iso?: string) => (iso ? formatDate(iso) : undefined);

export default function GoodsReceiptView({ doc }: { doc: GoodsReceipt }) {
  const r = doc.receipt ?? {};
  const i = doc.inspection ?? {};

  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <h3 className="font-medium">ใบรับสินค้า {doc.receiptNo ?? ''}</h3>
        <Line label="คลังสินค้า" value={doc.warehouse} />
        <Line label="อ้างถึง" value={joinLabels(r.references, RECEIPT_REFERENCE_LABELS)} />
        <Line label="ใบสั่งซื้อเลขที่" value={r.purchaseOrderNo} />
        <Line label="วันที่ใบสั่งซื้อ" value={thDate(r.purchaseOrderDate)} />
        <Line label="เลขที่ใบส่งของ" value={r.deliveryNoteNo} />
        <Line label="รหัสสินค้า" value={r.productCode} />
        <Line label="ชื่อสินค้า" value={r.productName} />
        <Line label="% สารออกฤทธิ์" value={r.activeIngredientPercent} />
        <Line label="ขนาดบรรจุ" value={r.packageSize} />
        <Line label="จำนวน" value={r.quantity != null
          ? `${r.quantity} ${r.quantityUnit ? QUANTITY_UNIT_LABELS[r.quantityUnit] : ''}`.trim()
          : undefined} />
        <Line label="น้ำหนักรวม" value={r.totalWeight != null
          ? `${r.totalWeight} ${r.totalWeightUnit ? WEIGHT_UNIT_LABELS[r.totalWeightUnit] : ''}`.trim()
          : undefined} />
        <Line label="Gross Weight จากผู้ขาย (กก.)" value={r.sellerGrossWeightKg} />
        <Line label="Net Weight จากผู้ขาย (ลิตร)" value={r.sellerNetWeightLitre} />
        <Line label="Net Weight จากผู้ขาย (กก.)" value={r.sellerNetWeightKg} />
        <Line label="ผู้ขาย" value={r.seller} />
        <Line label="ประเทศผู้ขาย" value={r.sellerCountry} />
        <Line label="ผู้ผลิต" value={r.manufacturer} />
        <Line label="ประเทศผู้ผลิต" value={r.manufacturerCountry} />
        <Line label="เกณฑ์คลาดเคลื่อนสารออกฤทธิ์" value={r.activeIngredientTolerance} />
        <Line label="ผลเทียบเกณฑ์" value={r.toleranceResult ? TOLERANCE_RESULT_LABELS[r.toleranceResult] : undefined} />
        <Line label="เหตุที่ไม่อยู่ในเกณฑ์" value={r.toleranceOutsideReason} />
        <Line label="การส่งมอบล่าช้า" value={joinLabels(r.lateDelivery, LATE_DELIVERY_LABELS)} />
        <Line label="ผู้รับสินค้า" value={r.receivedByName} />
        <Line label="วันที่รับ" value={thDate(r.receivedAt)} />
      </section>

      {(r.caBatches?.length || r.productBatches?.length) ? (
        <section className="space-y-1">
          <h4 className="font-medium text-sm">แบชนัมเบอร์</h4>
          {(r.caBatches ?? []).map((b, idx) => (
            <Line key={`ca-${idx}`} label={`CA ${b.batchNo ?? ''}`}
              value={b.amount != null ? `${b.amount} ${b.unit ? WEIGHT_UNIT_LABELS[b.unit] : ''}`.trim() : '—'} />
          ))}
          {(r.productBatches ?? []).map((b, idx) => (
            <Line key={`p-${idx}`} label={`สินค้า ${b.batchNo ?? ''}${b.sendToLab ? ' (ส่งตรวจ)' : ''}`}
              value={b.amount != null ? `${b.amount} ${b.unit ? WEIGHT_UNIT_LABELS[b.unit] : ''}`.trim() : '—'} />
          ))}
        </section>
      ) : null}

      <section className="space-y-1">
        <h3 className="font-medium">ใบตรวจสอบวัตถุดิบ {doc.inspectionNo ?? ''}</h3>
        <Line label="ลักษณะภาชนะ" value={i.containerType
          ? (i.containerType === 'other' ? i.containerTypeOther : CONTAINER_TYPE_LABELS[i.containerType])
          : undefined} />
        <Line label="สภาพภาชนะ" value={i.containerCondition ? CONTAINER_CONDITION_LABELS[i.containerCondition] : undefined} />
        <Line label="แบชที่รั่วซึม/แตก" value={i.containerConditionBatches} />
        <Line label="ฉลากปิด" value={i.labelStatus ? PRESENCE_LABELS[i.labelStatus] : undefined} />
        <Line label="ซีลปิ๊งมาร์ค" value={i.sealMarkStatus ? PRESENCE_LABELS[i.sealMarkStatus] : undefined} />
        <Line label="ถพ." value={i.specificGravity} />
        <Line label="Gross weight" value={i.grossWeight != null
          ? `${i.grossWeight} ${i.grossWeightUnit ? WEIGHT_UNIT_LABELS[i.grossWeightUnit] : ''}`.trim()
          : undefined} />
        <Line label="Net weight (ลิตร)" value={i.netWeightLitre} />
        <Line label="Net weight (กก.)" value={i.netWeightKg} />
        <Line label="ช่วงยอมรับ (กก.)" value={i.toleranceKg} />
        {i.weighBatches?.length ? i.weighBatches.map((b, idx) => (
          <Line key={`w-${idx}`} label={`แบชชั่ง ${b.batchNo ?? ''}`}
            value={[
              b.quantity != null ? `${b.quantity} ${b.quantityUnit ? QUANTITY_UNIT_LABELS[b.quantityUnit] : ''}`.trim() : null,
              b.weightKg != null ? `${b.weightKg} กก.` : null,
            ].filter(Boolean).join(' / ') || undefined} />
        )) : null}
        <Line label="สรุปข้อ 1-4" value={i.summary14?.accepted === undefined ? undefined
          : i.summary14.accepted ? `ยอมรับได้ ${i.summary14.note ?? ''}`.trim()
          : `ยอมรับไม่ได้ เพราะ ${i.summary14.rejectReason ?? ''}`.trim()} />
        <Line label="ผู้ตรวจสอบ ข้อ 1-4" value={i.summary14?.inspectedBy} />
        <Line label="ลักษณะสินค้า" value={joinLabels(i.appearance, APPEARANCE_LABELS)} />
        <Line label="ลักษณะอื่นๆ" value={i.appearanceOther} />
        <Line label="แบชที่ลักษณะเหมือนเดิม" value={i.appearanceSameBatches} />
        <Line label="แบชที่ลักษณะไม่เหมือนเดิม" value={i.appearanceDiffBatches} />
        <Line label="สิ่งที่ไม่เหมือนเดิม" value={i.appearanceDiffDetail} />
        <Line label="แบชที่สีเหมือนเดิม" value={i.colorSameBatches} />
        <Line label="สี" value={i.colorSame} />
        <Line label="แบชที่สีไม่เหมือนเดิม" value={i.colorDiffBatches} />
        <Line label="สี (ไม่เหมือนเดิม)" value={i.colorDiff} />
        <Line label="สรุปข้อ 5-6" value={i.summary56?.accepted === undefined ? undefined
          : i.summary56.accepted ? `ยอมรับได้ ${i.summary56.note ?? ''}`.trim()
          : `ยอมรับไม่ได้ เพราะ ${i.summary56.rejectReason ?? ''}`.trim()} />
        <Line label="ผู้ตรวจสอบ ข้อ 5-6" value={i.summary56?.inspectedBy} />
      </section>
    </div>
  );
}
