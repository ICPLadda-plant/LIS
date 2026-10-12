import { ICP_LADDA_LOGO_URL } from '@/lib/branding';
import { A4_PRINT_FONT_FAMILY, A4_PRINT_FONT_SIZE, A4_PRINT_HEADING_FONT_WEIGHT } from '@/lib/printConfig';
import type { LabRequest } from '@/types/labRequest.types';
import type { Petition, PetitionItem, QCTestResult } from '@/types/petition.types';
import { formatDate } from '@/lib/dateTime';

type ReportKind = 'pre' | 'final';

interface Props {
  kind: ReportKind;
  petition: Petition;
  labRequests?: LabRequest[];
  qcResults?: QCTestResult[];
}

function buddhistDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return formatDate(d, '');
}

function valueText(value: unknown): string {
  if (value == null || value === '') return '-';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object') {
    const file = value as { name?: unknown; url?: unknown };
    if (typeof file.name === 'string') return file.name;
    if (typeof file.url === 'string') return file.url;
    return JSON.stringify(value);
  }
  return String(value);
}

function refSourceText(value: unknown): string {
  if (!value || typeof value !== 'object') return '-';
  const src = value as { source?: unknown; instrument?: unknown; sampleName?: unknown; fetchedAt?: unknown };
  return [
    src.instrument ? String(src.instrument) : src.source ? String(src.source) : '',
    src.sampleName ? String(src.sampleName) : '',
  ].filter(Boolean).join(' / ') || '-';
}

function labRequestFor(item: PetitionItem, labRequests: LabRequest[]): LabRequest | undefined {
  return labRequests.find((lr) => lr.sampleSeq === item.seq)
    ?? labRequests.find((lr) => lr.batchNo === item.batchNo)
    ?? labRequests[0];
}

function rowsFor(item: PetitionItem, results: QCTestResult[]) {
  return results
    .filter((result) => result.itemSeq === item.seq)
    .flatMap((result) => {
      const values = result.entries?.length ? result.entries : [result.values ?? {}];
      const phase2 = result.valuesPhase2 && Object.keys(result.valuesPhase2).length
        ? [result.valuesPhase2]
        : [];
      return [...values, ...phase2].flatMap((row, index) =>
        Object.entries(row)
          .filter(([key]) =>
            !key.startsWith('__') &&
            !key.endsWith('__note') &&
            !key.endsWith('__source') &&
            !key.endsWith('__provenance')
          )
          .map(([field, value]) => ({
            key: `${result.parameterId}-${index}-${field}`,
            testItem: result.parameterName && result.parameterName !== field
              ? `${result.parameterName} - ${field}`
              : (result.parameterName || field),
            value: valueText(value),
            refSource: refSourceText(row[`${field}__source`]),
          })),
      );
    });
}

export default function ResultReportPrintTemplate({
  kind,
  petition,
  labRequests = [],
  qcResults = [],
}: Props) {
  const isFinal = kind === 'final';
  const title = isFinal ? 'FINAL REPORT' : 'PRE REPORT';
  const firstRequest = labRequests[0];
  const reportNo = `${isFinal ? 'FR' : 'PR'}-${petition.petitionNo}`;
  const customerName = firstRequest?.reportCustomerName
    || firstRequest?.requester?.fullName
    || petition.submittedBy?.name
    || '-';
  const address = firstRequest?.reportAddressType === 'other'
    ? firstRequest.reportAddressOther
    : firstRequest?.requester?.address;

  return (
    <>
      <style>{CSS}</style>
      <div className="rr-root">
        <section className="rr-page">
          <header className="rr-header">
            <img src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" />
            <div>
              <h1>บริษัท ไอ ซี พี ลัดดา จำกัด</h1>
              <p>รายงานผลการทดสอบ / Certificate of Analysis</p>
            </div>
            <div className="rr-meta">
              <div>เลขที่รายงาน: {reportNo}</div>
              <div>วันที่รายงาน: {buddhistDate(isFinal ? petition.approvedAt : undefined)}</div>
              <div>เลขคำร้อง: {petition.petitionNo}</div>
            </div>
          </header>

          <h2>{title}</h2>
          {!isFinal && <div className="rr-watermark">ใช้สำหรับตรวจสอบผลเบื้องต้น</div>}

          <table className="rr-info">
            <tbody>
              <tr>
                <th>ชื่อลูกค้า/หน่วยงาน</th>
                <td>{customerName}</td>
                <th>ผู้ยื่นคำร้อง</th>
                <td>{petition.submittedBy?.name || '-'}</td>
              </tr>
              <tr>
                <th>ที่อยู่รายงานผล</th>
                <td colSpan={3}>{address || '-'}</td>
              </tr>
              <tr>
                <th>วันที่รับตัวอย่าง</th>
                <td>{buddhistDate(petition.receivedAt || petition.sampleSentAt || petition.createdAt)}</td>
                <th>สถานะรายงาน</th>
                <td>{isFinal ? 'Final' : 'Preliminary'}</td>
              </tr>
            </tbody>
          </table>

          {petition.items.map((item) => {
            const lr = labRequestFor(item, labRequests);
            const rows = rowsFor(item, qcResults);
            return (
              <div className="rr-sample" key={item.seq}>
                <table className="rr-info">
                  <tbody>
                    <tr>
                      <th>ลำดับ</th>
                      <td>{item.seq}</td>
                      <th>เลขที่ตัวอย่าง</th>
                      <td>{item.sampleId || lr?.labRequestNo || '-'}</td>
                    </tr>
                    <tr>
                      <th>ชื่อตัวอย่าง</th>
                      <td colSpan={3}>{item.commonName || item.sampleName}</td>
                    </tr>
                    <tr>
                      <th>Batch/Lot</th>
                      <td>{item.batchNo || item.lotNo || '-'}</td>
                      <th>วันที่ผลิต/นำเข้า</th>
                      <td>{buddhistDate(item.productionDate)}</td>
                    </tr>
                  </tbody>
                </table>

                <table className="rr-results">
                  <thead>
                    <tr>
                      <th>รายการทดสอบ</th>
                      <th>ผลการทดสอบ</th>
                      <th>Ref. source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.testItem}</td>
                        <td>{row.value}</td>
                        <td>{row.refSource}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={3} className="rr-empty">ยังไม่พบผลทดสอบของตัวอย่างนี้</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}

          <footer className="rr-footer">
            <div>
              <div className="rr-line" />
              <p>ผู้ทดสอบ / Analyst</p>
            </div>
            <div>
              <div className="rr-line" />
              <p>{isFinal ? 'ผู้อนุมัติ / Authorized by' : 'ผู้ตรวจสอบ / Reviewed by'}</p>
            </div>
          </footer>

          <p className="rr-note">
            หมายเหตุ: รายงานนี้แสดงผลเฉพาะตัวอย่างที่นำมาทดสอบเท่านั้น
            {!isFinal ? ' และยังไม่ใช่รายงานผลฉบับสมบูรณ์' : ''}
          </p>
        </section>
      </div>
    </>
  );
}

const CSS = `
@page { size: A4 portrait; margin: 0; }
.rr-root, .rr-root * { box-sizing: border-box; color: #000; font-family: ${A4_PRINT_FONT_FAMILY}; font-size: ${A4_PRINT_FONT_SIZE}; }
.rr-page { width: 210mm; min-height: 297mm; padding: 12mm; background: #fff; }
.rr-header { display: grid; grid-template-columns: 26mm 1fr 55mm; gap: 8mm; align-items: start; border-bottom: 1.2pt solid #000; padding-bottom: 6mm; }
.rr-header img { width: 24mm; height: auto; }
.rr-header h1 { margin: 0 0 2mm; font-size: 16pt; }
.rr-header p, .rr-note, .rr-footer p { margin: 0; }
.rr-meta { font-size: 9.5pt; line-height: 1.45; }
h2 { text-align: center; margin: 6mm 0 3mm; font-size: 18pt; letter-spacing: 0; }
.rr-watermark { text-align: center; border: 1pt solid #777; padding: 2mm; margin-bottom: 4mm; font-weight: 700; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 0.7pt solid #000; padding: 2.2mm; vertical-align: top; word-break: break-word; }
th { width: 25%; background: #f3f3f3; text-align: left; }
.rr-info { margin-bottom: 4mm; }
.rr-sample { margin-top: 5mm; break-inside: avoid; page-break-inside: avoid; }
.rr-results th { text-align: center; }
.rr-results td:nth-child(3) { font-weight: 600; }
.rr-empty { text-align: center; color: #555; font-weight: 400 !important; }
.rr-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 18mm; margin-top: 16mm; text-align: center; }
.rr-line { border-bottom: 0.8pt dotted #000; height: 12mm; }
.rr-note { margin-top: 8mm; font-size: 9.5pt; }
@media screen { .rr-page { margin: 0 auto; box-shadow: 0 0 0 1px #ddd; } }
.rr-root, .rr-root * { font-size: ${A4_PRINT_FONT_SIZE} !important; }
.rr-root h1,
.rr-root h2,
.rr-root h3,
.rr-root h4,
.rr-root h5,
.rr-root h6,
.rr-root th,
.rr-watermark,
.print-heading {
  font-weight: ${A4_PRINT_HEADING_FONT_WEIGHT} !important;
}
`;
