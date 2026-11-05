import QRCode from 'qrcode';
import FitToBox from '@/components/petition/FitToBox';
import { expandItemsBySampleQuantity } from '@/lib/petitionPrintItems';
import { additionalSampleWeights } from '@/lib/additionalSamples';
import {
  labelManufacturerName,
  labelSampledByName,
  sampleLabelCopySide,
  sampleLabelDocumentNumber,
  sampleLabelSideNumber,
} from '@/lib/petitionSampler';
import { requiresHazardSampleLabel } from '@/lib/masterItemRegulatoryType';
import type { AdditionalSampleRequest, Petition } from '@/types/petition.types';
import ghsEnvironment from '@/assets/ghs/environment.png?inline';
import ghsHealthHazard from '@/assets/ghs/health-hazard.png?inline';
import ghsCorrosive from '@/assets/ghs/corrosive.png?inline';
import ghsGasCylinder from '@/assets/ghs/gas-cylinder.png?inline';
import ghsExplosive from '@/assets/ghs/explosive.png?inline';
import ghsFlammable from '@/assets/ghs/flammable.png?inline';
import ghsOxidizer from '@/assets/ghs/oxidizer.png?inline';
import ghsToxic from '@/assets/ghs/toxic.png?inline';
import ghsExclamation from '@/assets/ghs/exclamation.png?inline';

// sampleName กับ commonName ของงานผลิตมักเป็นค่าเดียวกัน — ถ้าต่อกันดื้อๆ ชื่อจะซ้ำสองรอบ
// แล้วดันบรรทัดล้นกรอบฉลาก 50mm จนบรรทัดท้าย (F-LAB) ถูกตัดทิ้ง
function productLine(item: Petition['items'][number]): string {
  const names = [item.sampleName, item.commonName]
    .map((name) => name?.trim())
    .filter((name): name is string => !!name);
  const unique = names.filter(
    (name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index,
  );
  return unique.join(' ');
}

function toBuddhistShort(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String((d.getFullYear() + 543) % 100).padStart(2, '0');
  return `${dd}/${mm}/${yy}`;
}

function currentBuddhistYearShort(): string {
  return String((new Date().getFullYear() + 543) % 100).padStart(2, '0');
}

function getQrValue(petition: Petition, item: Petition['items'][number]): string {
  return JSON.stringify({
    id: petition._id,
    petitionNo: petition.petitionNo,
    sampleId: item.sampleId || '',
    itemSeq: item.seq,
  });
}

function splitLabelQuantity(value: string | undefined): string[] {
  return String(value ?? '')
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function labelQuantityForCopy(item: Petition['items'][number], copyIndex: number): string {
  const fromArray = Array.isArray(item.labelQuantities)
    ? item.labelQuantities.map((entry) => String(entry ?? ''))
    : [];
  if (fromArray.length) return fromArray[copyIndex] ?? '';
  const split = splitLabelQuantity(item.labelQuantity);
  if (split.length > 1) return split[copyIndex] ?? '';
  return item.labelQuantity ?? '';
}

// หมายเหตุที่ผู้ส่งกรอกในฟอร์มคำร้องเก็บไว้ที่ item.note ส่วน labelRemark เป็นหมายเหตุเฉพาะป้าย
// ป้ายต้องแสดงทั้งสองค่า (ไม่ซ้ำกัน); งานขอตัวอย่างเพิ่มใช้เหตุผลของรอบนั้นแทน
function labelRemarkText(item: Petition['items'][number], additionalSampleRequest?: AdditionalSampleRequest): string {
  if (additionalSampleRequest?.reason) return additionalSampleRequest.reason;
  const remarks = [item.labelRemark, item.note]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  return remarks.filter((value, index) => remarks.indexOf(value) === index).join(' , ');
}

const LABEL_HEADER_LINE_1 = 'ป้ายนำส่งตัวอย่าง บริษัท ไอ ซี พี';
const LABEL_HEADER_LINE_2 = 'ลัดดา จำกัด';
const LABEL_HEADER_TEXT = `${LABEL_HEADER_LINE_1} ${LABEL_HEADER_LINE_2}`;
const DOCUMENT_NUMBER_LABEL = 'เลขที่';
const LABEL_FOOTER_TEXT = 'F-LAB-01-12 Rev : 00 02/11/69';
// สินค้า อย. ต้องใช้ป้ายแบบมีสัญลักษณ์อันตราย (ให้ผู้ส่งวงกลมสัญลักษณ์ที่ตรงกับสาร); สินค้าปศุสัตว์ใช้ป้ายแบบปกติ
const HAZARD_LABEL_FOOTER_TEXT = 'F-LAB-01-10 Rev : 02 11/07/69';
const HAZARD_PICTOGRAMS = [
  { src: ghsEnvironment, label: 'อันตรายต่อสิ่งแวดล้อม' },
  { src: ghsHealthHazard, label: 'อันตรายต่อสุขภาพ' },
  { src: ghsCorrosive, label: 'สารกัดกร่อน' },
  { src: ghsGasCylinder, label: 'ก๊าซบรรจุภายใต้ความดัน' },
  { src: ghsExplosive, label: 'วัตถุระเบิด' },
  { src: ghsFlammable, label: 'สารไวไฟ' },
  { src: ghsOxidizer, label: 'สารออกซิไดซ์' },
  { src: ghsToxic, label: 'พิษเฉียบพลัน' },
  { src: ghsExclamation, label: 'ระวัง' },
];
const SAMPLE_QR_SIZE_CLASS = 'h-[18mm] w-[18mm]';
const SAMPLE_QR_TEXT_WIDTH_CLASS = 'w-[18mm]';

function QrCodeSvg({
  value,
  sizeClass = SAMPLE_QR_SIZE_CLASS,
}: {
  value: string;
  sizeClass?: string;
}) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const modules = Array.from(qr.modules.data as Uint8Array);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={`${sizeClass} shrink-0`}
      role="img"
      aria-label={`QR ${value}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      {modules.map((filled, index) => {
        if (!filled) return null;
        const x = index % size;
        const y = Math.floor(index / size);
        return <rect key={index} x={x} y={y} width="1" height="1" fill="#000" />;
      })}
    </svg>
  );
}

function Field({
  label,
  value,
  className = '',
  valueClassName = '',
  valueTestId,
  multiline = false,
}: {
  label: string;
  value?: string;
  className?: string;
  valueClassName?: string;
  valueTestId?: string;
  multiline?: boolean;
}) {
  const valueBaseClass = multiline
    ? 'min-h-[3.5mm] min-w-0 flex-1 overflow-visible whitespace-normal break-words border-b border-black px-0.5 font-bold'
    : 'min-h-[3.5mm] min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap border-b border-black px-0.5 font-bold';

  return (
    <div className={`flex min-w-0 items-end gap-1 ${className}`}>
      <span className="whitespace-nowrap">{label}</span>
      <span data-testid={valueTestId} className={`${valueBaseClass} ${valueClassName}`}>
        {value || ''}
      </span>
    </div>
  );
}

function StackedField({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="whitespace-nowrap">{label}</div>
      <div className="min-h-[3.5mm] min-w-0 overflow-visible whitespace-normal break-words border-b border-black px-0.5 font-bold leading-tight">
        {value || ''}
      </div>
    </div>
  );
}

function LabelQrColumn({ petition, item, qrValue }: { petition: Petition; item: Petition['items'][number]; qrValue: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center pt-0.5">
      <QrCodeSvg value={qrValue} />
      <div className={`mt-0.5 ${SAMPLE_QR_TEXT_WIDTH_CLASS} break-all text-center text-[7px] font-bold leading-tight`}>
        {petition.petitionNo}
      </div>
      {item.batchNo ? (
        <>
          <QrCodeSvg value={item.batchNo} sizeClass={`mt-0.5 ${SAMPLE_QR_SIZE_CLASS}`} />
          <div
            data-testid="sample-label-batch-qr-text"
            className={`mt-0.5 ${SAMPLE_QR_TEXT_WIDTH_CLASS} break-all text-center text-[5.5px] font-bold leading-none`}
          >
            {item.batchNo}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DocumentNumber({ petition, item, yearShort, copyIndex, additionalSampleRequest }: LabelCardProps) {
  // เลขที่ __/__ : ป้ายที่ส่ง QC ใช้เลข P (P04/69) ป้ายที่ส่ง LAB ใช้เลข L (L02/69)
  // คำขอเก่าที่ยังไม่มีเลข P/L ใช้เลขจากเลขคำร้องแบบเดิม (P-2611-0002 → 2/69)
  const side = additionalSampleRequest?.side ?? sampleLabelCopySide(petition, item, copyIndex);
  const documentNumber = sampleLabelSideNumber(petition, side) ?? sampleLabelDocumentNumber(petition.petitionNo);
  return (
    <div
      data-testid="sample-label-document-number"
      className="flex items-end gap-0.5 whitespace-nowrap text-[7px]"
    >
      <span>{DOCUMENT_NUMBER_LABEL}</span>
      <span className="inline-block min-w-[1.45rem] border-b border-black px-0.5 text-center">
        {documentNumber?.seq || item.sampleId || '\u00a0'}
      </span>
      <span>/</span>
      <span className="inline-block min-w-[1.1rem] border-b border-black px-0.5 text-center">
        {documentNumber?.year || yearShort}
      </span>
    </div>
  );
}

const LABEL_CARD_STYLE = {
  width: '100mm',
  height: '50mm',
  // เครื่องพิมพ์ฉลากเริ่มพิมพ์สูงกว่าขอบบนของดวงฉลากราว 2-3 มม. (ท้ายดวงเหลือที่ว่าง ~2 มม.)
  // ถ้าเว้นขอบบนแค่ 2 มม. หัวป้าย/เลขที่จะตกไปอยู่ในช่องว่างระหว่างดวงแล้วถูกตัดครึ่ง
  // จึงเว้นขอบบนมากกว่าขอบล่าง ให้เนื้อหาทั้งหมดขยับลงมาอยู่บนตัวฉลาก
  padding: '4.5mm 3mm 1mm',
  boxSizing: 'border-box',
  fontFamily: 'Tahoma, Arial, sans-serif',
  textRendering: 'geometricPrecision',
} as const;

function additionalSampleTitle(petition: Petition, request: AdditionalSampleRequest, item: Petition['items'][number], copyIndex: number) {
  const round = (petition.additionalSampleRequests ?? []).findIndex((entry) => entry._id === request._id) + 1;
  return `ตัวอย่างเพิ่ม · ${request.side.toUpperCase()} · รอบ ${round} · ตัวอย่างที่ ${copyIndex + 1}/${item.sampleQuantity}`;
}

type LabelCardProps = {
  petition: Petition;
  item: Petition['items'][number];
  yearShort: string;
  copyIndex: number;
  additionalSampleRequest?: AdditionalSampleRequest;
};

function HazardLabelCard({ petition, item, yearShort, copyIndex, additionalSampleRequest }: LabelCardProps) {
  const qrValue = additionalSampleRequest?.qrCode || getQrValue(petition, item);
  return (
    <div
      data-testid="sample-label-hazard-form"
      className="label-card overflow-hidden border border-black text-[9.5px] font-semibold leading-[1.15]"
      style={LABEL_CARD_STYLE}
    >
      <FitToBox className="h-full">
      <div className="flex items-start gap-1.5">
        <LabelQrColumn petition={petition} item={item} qrValue={qrValue} />
        <div className="min-w-0 flex-1 space-y-1">
          {additionalSampleRequest && <p className="font-bold">{additionalSampleTitle(petition, additionalSampleRequest, item, copyIndex)}</p>}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1">
            <div
              data-testid="sample-label-header-title"
              className="min-w-0 px-0.5 text-center text-[8.5px] font-bold leading-tight"
            >
              <span data-testid="sample-label-title-line" className="block whitespace-nowrap">
                {LABEL_HEADER_TEXT}
              </span>
            </div>
            <DocumentNumber petition={petition} item={item} yearShort={yearShort} copyIndex={copyIndex} additionalSampleRequest={additionalSampleRequest} />
          </div>
          <div className="border-y border-black py-0.5">
            <div className="grid grid-cols-9 gap-0.5">
              {HAZARD_PICTOGRAMS.map((pictogram) => (
                <div key={pictogram.label} className="flex min-w-0 flex-col items-center">
                  <img src={pictogram.src} alt={pictogram.label} className="h-[6.5mm] w-[6.5mm]" />
                  <span className="mt-px text-center text-[4px] leading-none">{pictogram.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-0.5 text-center text-[5.5px] font-bold leading-none">
              ให้วงกลมล้อมรอบสัญลักษณ์ที่แสดงความเป็นอันตรายของสาร
            </p>
          </div>
          <StackedField label="ชื่อผลิตภัณฑ์ และสารสำคัญ" value={productLine(item)} />
          <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-1.5">
            <Field label="วัน เดือน ปี ที่ผลิต/นำเข้า" value={toBuddhistShort(item.productionDate)} />
            <Field
              label="แบชนัมเบอร์"
              value={item.batchNo}
              valueClassName="text-[8px] leading-tight"
              valueTestId="sample-label-batch-number-value"
              multiline
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="ผู้ผลิต" value={labelManufacturerName(petition, item)} />
            <Field label="ผู้ขาย" value={item.labelSeller} />
          </div>
          <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-1.5">
            <Field label="ปริมาณ" value={labelQuantityForCopy(item, copyIndex)} />
            <Field label="สุ่มโดย" value={labelSampledByName(petition, item)} valueClassName="leading-tight" multiline />
            <Field label="ว/ด/ป" value={toBuddhistShort(item.labelSampledDate)} />
          </div>
          <Field label="วันที่หมดอายุ" value="" />
          <Field
            label="หมายเหตุ"
            value={labelRemarkText(item, additionalSampleRequest)}
            valueClassName="leading-tight"
            valueTestId="sample-label-remark-value"
            multiline
          />
          <div className="text-[7.5px] font-semibold">{HAZARD_LABEL_FOOTER_TEXT}</div>
        </div>
      </div>
      <div className="sr-only">{petition.petitionNo}</div>
      </FitToBox>
    </div>
  );
}

function LabelCard({ petition, item, yearShort, copyIndex, additionalSampleRequest }: LabelCardProps) {
  if (requiresHazardSampleLabel(item)) {
    return <HazardLabelCard petition={petition} item={item} yearShort={yearShort} copyIndex={copyIndex} additionalSampleRequest={additionalSampleRequest} />;
  }
  const sampledByName = labelSampledByName(petition, item);
  const qrValue = additionalSampleRequest?.qrCode || getQrValue(petition, item);
  const labelQuantity = labelQuantityForCopy(item, copyIndex);
  return (
    <div
      className="label-card overflow-hidden border border-black text-[9.5px] font-semibold leading-[1.15]"
      style={LABEL_CARD_STYLE}
    >
      <FitToBox className="h-full">
      <div className="mb-1 flex items-start gap-1.5">
        <LabelQrColumn petition={petition} item={item} qrValue={qrValue} />
        <div className="min-w-0 flex-1 space-y-1">
          {additionalSampleRequest && <p className="font-bold">{additionalSampleTitle(petition, additionalSampleRequest, item, copyIndex)}</p>}
          <div className="grid min-h-[7mm] grid-cols-[minmax(0,1fr)_auto] items-start gap-1">
            <div
              data-testid="sample-label-header-title"
              className="min-w-0 px-0.5 text-center text-[8.5px] font-bold leading-tight"
            >
              <span data-testid="sample-label-title-line" className="block whitespace-nowrap">
                {LABEL_HEADER_TEXT}
              </span>
            </div>
            <DocumentNumber petition={petition} item={item} yearShort={yearShort} copyIndex={copyIndex} additionalSampleRequest={additionalSampleRequest} />
          </div>
          <StackedField label="ชื่อผลิตภัณฑ์ และสารสำคัญ" value={productLine(item)} />
          <div>
            <Field label="วัน เดือน ปี ที่ผลิต/นำเข้า" value={toBuddhistShort(item.productionDate)} />
          </div>
          <div>
            <Field
              label="Batch No."
              value={item.batchNo}
              valueClassName="text-[8px] leading-tight"
              valueTestId="sample-label-batch-number-value"
              multiline
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="ผู้ผลิต" value={labelManufacturerName(petition, item)} />
            <Field label="ผู้ขาย" value={item.labelSeller} />
          </div>
          <div>
            <Field label="ปริมาณ" value={labelQuantity} />
          </div>
          <div className="grid grid-cols-[1.4fr_1fr] gap-1.5">
            <Field label="สุ่มโดย" value={sampledByName} valueClassName="leading-tight" multiline />
            <Field label="ว/ด/ป" value={toBuddhistShort(item.labelSampledDate)} />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Field
          label="หมายเหตุ"
          value={labelRemarkText(item, additionalSampleRequest)}
          valueClassName="leading-tight"
          valueTestId="sample-label-remark-value"
          multiline
        />
      </div>

      <div className="mt-1 text-[7.5px] font-semibold">{LABEL_FOOTER_TEXT}</div>

      <div className="sr-only">{petition.petitionNo}</div>
      </FitToBox>
    </div>
  );
}

export default function SampleLabelPrintTemplate({ petition, additionalSampleRequest }: { petition: Petition; additionalSampleRequest?: AdditionalSampleRequest }) {
  const yearShort = currentBuddhistYearShort();
  const items = additionalSampleRequest ? additionalSampleRequest.items.flatMap((selected) => {
    const item = petition.items.find((entry) => entry.seq === selected.itemSeq);
    const weights = additionalSampleWeights(selected);
    return item ? [{ ...item, sampleQuantity: weights.length, labelQuantities: weights.map((weight) => `${weight} g`) }] : [];
  }) : petition.items;
  const printRows = expandItemsBySampleQuantity(items);
  return (
    <>
      <style>{`
        @page {
          size: 100mm 50mm;
          margin: 0;
        }
        html, body {
          margin: 0;
          padding: 0;
        }
        .sample-label-root {
          width: 100mm;
          margin: 0;
          padding: 0;
        }
        .label-page {
          display: flex;
          align-items: stretch;
          justify-content: stretch;
          width: 100mm;
          height: 50mm;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          overflow: hidden;
        }
        .label-card {
          flex: 0 0 100mm;
        }
        /* เครื่องพิมพ์ฉลากเป็น thermal ขาวดำ (1-bit) — บังคับดำล้วน/ขาวล้วน ไม่งั้น
           ตัวอักษรจะ inherit สี --foreground (กรมท่าเข้ม 215 25% 20%) ของ theme แล้ว
           ถูก dither เป็นเฉดเทาเพี้ยน (เส้นกรอบ .border-black ดำอยู่แล้วเลยไม่เพี้ยน) */
        .label-card, .label-card * {
          color: #000 !important;
          border-color: #000 !important;
          background-color: transparent !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .label-card { background-color: #fff !important; }
        @media print {
          html, body { margin: 0; padding: 0; width: 100mm; height: 50mm; }
          .label-page {
            break-after: page;
            page-break-after: always;
          }
          .label-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      <div className="sample-label-root" style={{ fontFamily: 'inherit' }}>
        {printRows.map(({ item, copyIndex }) => (
          <div key={`${item.seq}-${copyIndex}`} className="label-page">
            <LabelCard petition={petition} item={item} yearShort={yearShort} copyIndex={copyIndex} additionalSampleRequest={additionalSampleRequest} />
          </div>
        ))}
      </div>
    </>
  );
}
