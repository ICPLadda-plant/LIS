import QRCode from 'qrcode';
import type { AdditionalSampleRequest, Petition } from '@/types/petition.types';
import { A4_PRINT_FONT_FAMILY } from '@/lib/printConfig';
import { formatDateTime } from '@/lib/dateTime';

export default function AdditionalSamplePrintTemplate({ petition, request }: {
  petition: Petition;
  request: AdditionalSampleRequest;
}) {
  const round = (petition.additionalSampleRequests ?? []).findIndex((entry) => entry._id === request._id) + 1;
  const qr = QRCode.create(request.qrCode, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        .additional-sample-sheet { color: #000; background: #fff; width: 186mm; padding: 6mm; box-sizing: border-box; font-size: 16pt; line-height: 1.4; }
        .additional-sample-sheet table { width: 100%; border-collapse: collapse; margin: 6mm 0; }
        .additional-sample-sheet th, .additional-sample-sheet td { border: 1px solid #000; padding: 2mm; text-align: left; overflow-wrap: anywhere; }
        .additional-sample-sheet thead { display: table-header-group; }
        .additional-sample-sheet tr { break-inside: avoid; }
        .additional-sample-sheet h1 { font-size: 22pt; font-weight: 700; }
        @media print { .additional-sample-sheet { width: 100%; padding: 0; } }
      `}</style>
      <section className="additional-sample-sheet" style={{ fontFamily: A4_PRINT_FONT_FAMILY }}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1>ใบนำส่งตัวอย่างเพิ่ม</h1>
            <p>อ้างอิงคำร้อง {petition.petitionNo}</p>
            <p className="font-bold">ฝั่ง {request.side.toUpperCase()} · รอบ {round}</p>
            <p>ผู้ยื่น: {petition.submittedBy?.name || '-'}</p>
            <p>ผู้ขอเพิ่ม: {request.requestedBy.name}</p>
            <p>ขอเพิ่มเมื่อ: {formatDateTime(request.requestedAt)}</p>
          </div>
          <svg role="img" aria-label={`QR ${request.qrCode}`} viewBox={`-4 -4 ${size + 8} ${size + 8}`} className="shrink-0" style={{ width: '36mm', height: '36mm' }} shapeRendering="crispEdges">
            <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="#fff" />
            {Array.from(qr.modules.data).map((filled, index) => filled ? <rect key={index} x={index % size} y={Math.floor(index / size)} width="1" height="1" fill="#000" /> : null)}
          </svg>
        </div>
        <p className="mt-4 break-all text-sm">รหัสรอบ: {request.qrCode}</p>
        <div className="mt-4 whitespace-pre-wrap break-words"><strong>เหตุผลที่ขอเพิ่ม</strong><p>{request.reason}</p></div>
        <table>
          <thead><tr><th>รายการ</th><th>ชื่อตัวอย่าง / สารสำคัญ</th><th>Batch / Lot</th><th>จำนวน</th></tr></thead>
          <tbody>
            {request.items.map((selected, index) => {
              const item = petition.items.find((entry) => entry.seq === selected.itemSeq);
              return <tr key={selected.itemSeq}>
                <td>{index + 1}</td>
                <td><p>{item?.sampleName || `รายการ ${selected.itemSeq}`}</p>{item?.commonName && item.commonName !== item.sampleName && <p>{item.commonName}</p>}</td>
                <td>{item?.batchNo || item?.lotNo || '-'}</td>
                <td>{selected.quantity}</td>
              </tr>;
            })}
          </tbody>
        </table>
        <p>ใช้ QR นี้นำส่งและรับเฉพาะรอบเพิ่มนี้ เอกสารและ QR เดิมยังคงเดิม</p>
        <div className="mt-6 flex justify-between gap-4"><p>ผู้นำส่ง ................................</p><p>ผู้รับ ................................</p></div>
      </section>
    </>
  );
}
