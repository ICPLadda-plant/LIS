import FitToBox from '@/components/petition/FitToBox';
import { ICP_LADDA_LOGO_URL } from '@/lib/branding';
import { customerCodeFromDepartment } from '@/lib/customerCode';
import { shouldSendItemToLab } from '@/lib/petitionRouting';
import type { Petition, PetitionItem, QCTestResult } from '@/types/petition.types';
import type { LabRequest } from '@/types/labRequest.types';
import { resolveSpecificGravity, type SgParameter } from '@/lib/formSpecificGravity';
import { expandItemsBySampleQuantity } from '@/lib/petitionPrintItems';
import { A4_PRINT_FONT_FAMILY, A4_PRINT_FONT_SIZE, A4_PRINT_HEADING_FONT_WEIGHT } from '@/lib/printConfig';

function buddhistShort(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String((d.getFullYear() + 543) % 100).padStart(2, '0');
  return `${dd}/${mm}/${yy}`;
}

function splitBuddhist(iso?: string | null): { d: string; m: string; y: string } {
  if (!iso) return { d: '', m: '', y: '' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { d: '', m: '', y: '' };
  return {
    d: String(date.getDate()).padStart(2, '0'),
    m: String(date.getMonth() + 1).padStart(2, '0'),
    y: String((date.getFullYear() + 543) % 100).padStart(2, '0'),
  };
}

function CB({ checked }: { checked?: boolean }) {
  return <span className={`pr-cb${checked ? ' pr-cb-x' : ''}`} aria-hidden />;
}

function RD({ checked }: { checked?: boolean }) {
  return <span className={`pr-rd${checked ? ' pr-rd-x' : ''}`} aria-hidden />;
}

function Line({ value, width }: { value?: string; width?: string }) {
  return (
    <span className="pr-line" style={width ? { minWidth: width } : undefined}>
      {value || ' '}
    </span>
  );
}

function reportAddress(lr: LabRequest): string {
  if (lr.reportAddressType === 'other') return lr.reportAddressOther || '';
  return lr.requester?.address || '';
}

function invoiceAddress(lr: LabRequest): string {
  if (lr.invoiceAddressType === 'other') return lr.invoiceAddressOther || '';
  return lr.requester?.address || '';
}

function toArray<T extends string>(v: T | T[] | null | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function PageOne({ lr, submissionNo }: { lr: LabRequest; submissionNo: string }) {
  const sa = lr.serviceAgreement;
  const lar = lr.labAgreementReview;
  const createdDate = splitBuddhist(lr.createdAt);
  const reviewedDate = splitBuddhist(lar?.reviewedAt);
  const requester = lr.requester;

  const sd = sa?.sampleDelivery;
  const tm = sa?.testMethod;
  const td = sa?.testDuration;
  const tdDays = sa?.testDurationDays ?? '';
  const isCustomMethod = tm === 'custom';
  const isStandardMethod = tm === 'standard';

  return (
    <section className="pr-page1">
      <FitToBox className="pr-p1-inner" contentClassName="pr-fit-col">
        <div className="pr-p1-logo">
          <img src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" />
        </div>
        <div className="pr-p1-title pr-center">
          <b>เรื่อง: การทบทวนข้อตกลงการบริการทดสอบ</b>
        </div>
        <div className="pr-p1-meta-row">
          <b>อ้างอิงใบขอรับบริการเลขที่ TA</b>{' '}
          <span className="pr-line pr-line-md">{submissionNo}</span>
        </div>
        <div className="pr-p1-meta-row">
          <b>รหัสลูกค้า</b>{' '}
          <span className="pr-line pr-line-sm">{customerCodeFromDepartment(requester?.department)}</span>
          <span> / </span>
          <span className="pr-line pr-line-xs">{createdDate.y}</span>
        </div>

        <div className="pr-p1-notify">
          <div className="pr-p1-notify-line">
            ห้องปฏิบัติการได้รับแจ้งการทบทวนข้อตกลงการบริการทดสอบทางโทรศัพท์, อีเมล์&nbsp;&nbsp;
            <CB /> ใช่&nbsp;&nbsp;<CB /> ไม่ใช่
          </div>
          <div className="pr-p1-notify-line">
            ลงชื่อ <Line width="4cm" /> ผู้แจ้ง&nbsp;&nbsp;
            <Line width="4cm" /> ผู้รับแจ้ง
          </div>
        </div>

        <table className="pr-p1-table">
          <thead>
            <tr>
              <th className="pr-p1-head-l">
                <div className="pr-center"><b>สำหรับลูกค้ากรอก</b></div>
                <div className="pr-p1-sub">
                  (หากลูกค้าไม่สะดวกให้เจ้าหน้าห้องปฏิบัติการกรอกแทนโดยสอบถามข้อมูลและให้ลงนามทั้งผู้สอบถามและลูกค้า)
                </div>
              </th>
              <th className="pr-p1-head-r">
                <div className="pr-center"><b>สำหรับหัวหน้าห้องปฏิบัติการ</b></div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pr-p1-body-l">
                <div className="pr-cell">
                  <div className="pr-cell-main">
                    <div className="pr-q"><b>1. ตัวอย่างนำส่งห้องปฏิบัติการโดย</b></div>
                    <div className="pr-ind">
                      <CB checked={sd === 'self'} /> 1.1 ลูกค้ามาเอง&nbsp;&nbsp;
                      <CB checked={sd === 'courier'} /> 1.2 จัดส่งทางไปรษณีย์
                    </div>

                    <div className="pr-q"><b>2. วิธีทดสอบโปรดระบุ</b></div>
                    <div className="pr-ind">
                      <CB checked={tm === 'standard'} /> 2.1 วิธีปกติ&nbsp;
                      <span className="pr-note">(กรณีลูกค้าไม่ระบุวิธี)</span>
                    </div>
                    <div className="pr-ind">
                      <CB checked={tm === 'custom'} /> 2.2 วิธีเฉพาะตามเอกสารของลูกค้า
                    </div>
                    <div className="pr-ind2">
                      <CB checked={tm === 'previous'} /> เคยทำ&nbsp;&nbsp;
                      <CB checked={isCustomMethod && tm !== 'previous'} /> ไม่เคยทำ
                    </div>
                    <div className="pr-ind2 pr-note">
                      (วิธีเทคนิค/เครื่องมือ/สารเคมี/ชนิดตัวอย่าง / Detection Limit)
                    </div>
                    {sa?.testMethodDetail && (
                      <div className="pr-ind pr-italic">{sa.testMethodDetail}</div>
                    )}

                    <div className="pr-q"><b>3. ระยะเวลาดำเนินการทดสอบ</b></div>
                    <div className="pr-ind">
                      <CB checked={td === 'normal'} /> 3.1 ปกติ
                    </div>
                    <div className="pr-ind">
                      <CB checked={td === 'extended'} /> 3.2 ช้ากว่าปกติได้ (ภายใน{' '}
                      <Line width="1.2cm" value={td === 'extended' ? String(tdDays) : ''} /> วัน)
                    </div>
                    <div className="pr-ind">
                      <CB checked={td === 'urgent'} /> 3.3 เร็วกว่าปกติได้ (ภายใน{' '}
                      <Line width="1.2cm" value={td === 'urgent' ? String(tdDays) : ''} /> วัน)
                    </div>

                    <div className="pr-q"><b>4. ค่า Uncertainty</b></div>
                    <div className="pr-ind">
                      <CB checked={!!sa?.requireUncertainty} /> ต้องการ&nbsp;&nbsp;
                      <CB checked={sa ? !sa.requireUncertainty : false} /> ไม่ต้องการ
                      &nbsp;&nbsp;ค่า <Line width="4cm" value={sa?.uncertaintyValue} />
                    </div>

                    <div className="pr-terms">
                      <div className="pr-terms-title"><b>เงื่อนไขการให้บริการ</b></div>
                      <div className="pr-terms-list">
                        <div className="pr-terms-item">
                          <span className="pr-terms-num">1.</span>
                          <span>
                            ห้องปฏิบัติการฯให้บริการทดสอบตัวอย่างด้วยวิธีการตามเอกสาร วิธีวิเคราะห์สารเคมีกำจัดศัตรูพืชของห้องปฏิบัติการฯ (FM-QP-07-01-002)
                          </span>
                        </div>
                        <div className="pr-terms-item">
                          <span className="pr-terms-num">2.</span>
                          <span>การรายงานผลทดสอบจะไม่มีบริการด้านการให้ความเห็น และการแปรผลไม่ตัดสินผล</span>
                        </div>
                        <div className="pr-terms-item">
                          <span className="pr-terms-num">3.</span>
                          <span>ปริมาณตัวอย่างขั้นต่ำที่นำส่ง 500 ml, 500 g</span>
                        </div>
                        <div className="pr-terms-item">
                          <span className="pr-terms-num">4.</span>
                          <span>
                            ระยะเวลาในการออกผลการทดสอบ ภายใน 3 วัน (กรณีหากมีข้อสงสัยในผลการวิเคราะห์ ขอขยายเวลาออกไปอีก 3 วัน)
                          </span>
                        </div>
                        <div className="pr-terms-item">
                          <span className="pr-terms-num">5.</span>
                          <span>ส่งตัวอย่างไม่เกิน 15.00 น. ของทุกวัน</span>
                        </div>
                        <div className="pr-terms-item">
                          <span className="pr-terms-num">6.</span>
                          <span>ห้องปฏิบัติการฯรับผิดชอบผลการทดลองเฉพาะกับตัวอย่างที่นำมาทดสอบเท่านั้น</span>
                        </div>
                        <div className="pr-terms-item">
                          <span className="pr-terms-num">7.</span>
                          <span>ยินยอมให้เปิดเผยข้อมูลตัวอย่าง และผลทดสอบแก่หน่วยงานอื่น (กรณีลูกค้าภายในองค์กร)</span>
                        </div>
                      </div>
                      <div className="pr-terms-ack">
                        ข้าพเจ้าได้รับทราบ และยอมรับเงื่อนไขการให้บริการของห้องปฏิบัติการ บริษัท ไอ ซี พี ลัดดา จำกัด ทุกประการ
                      </div>
                    </div>
                  </div>

                  <div className="pr-cell-sig">
                    <div className="pr-sig-row">
                      <span className="pr-sig-label">ลงชื่อ </span>
                      <Line width="4.5cm" />
                      <span className="pr-sig-date">
                        วันเดือนปี{' '}
                        <Line width="0.8cm" value={createdDate.d} />/
                        <Line width="0.8cm" value={createdDate.m} />/
                        <Line width="0.8cm" value={createdDate.y} />
                      </span>
                    </div>
                    <div className="pr-sig-name">
                      ( <Line width="6.5cm" value={requester?.fullName ?? ''} /> )
                    </div>
                  </div>
                </div>
              </td>

              <td className="pr-p1-body-r">
                <div className="pr-cell">
                  <div className="pr-cell-main">
                    <div><b><u>กรณีลูกค้าระบุวิธีทดสอบตามปกติ</u></b></div>

                    <div className="pr-q"><b>1. บุคลากร</b></div>
                    <div className="pr-ind">
                      <CB checked={isStandardMethod && lar?.personnel === 'able'} /> 1.1 ทำได้เนื่องจาก
                    </div>
                    <div className="pr-ind3">
                      <RD checked={lar?.personnelAbleReasons?.includes('trained')} /> ได้รับการฝึกอบรมแล้ว
                    </div>
                    <div className="pr-ind3">
                      <RD checked={lar?.personnelAbleReasons?.includes('assigned')} /> ได้รับการมอบหมายให้ทดลอง
                    </div>
                    <div className="pr-ind">
                      <CB checked={isStandardMethod && lar?.personnel === 'unable'} /> 1.2 ไม่สามารถทำได้เนื่องจาก
                    </div>
                    <div className="pr-ind3"><RD checked={lar?.personnelUnableReasons?.includes('neverDone')} /> ยังไม่เคยทำการทดลอง</div>
                    <div className="pr-ind3"><RD checked={lar?.personnelUnableReasons?.includes('notTrained')} /> ยังไม่ได้รับการฝึกอบรม</div>
                    <div className="pr-ind3"><RD checked={lar?.personnelUnableReasons?.includes('notAssigned')} /> ยังไม่ได้รับการมอบหมายให้ทำงานทดลอง</div>

                    <div className="pr-q"><b>2. ปริมาณงาน</b></div>
                    <div className="pr-ind">
                      <CB checked={isStandardMethod && lar?.workload === 'normal'} /> 2.1 ยังมีความสามารถรับงานได้ตามปกติ
                    </div>
                    <div className="pr-ind">
                      <CB checked={isStandardMethod && lar?.workload === 'slower'} /> 2.2 สามารถรับงานได้แต่อาจช้ากว่าปกติ ซึ่งลูกค้ายินยอม
                    </div>
                    <div className="pr-ind">
                      <CB checked={isStandardMethod && lar?.workload === 'cannot'} /> 2.3 ไม่สามารถรับงานได้ เพราะมีงานสะสมมาก
                    </div>

                    <div className="pr-q"><b>3. การใช้บริการผู้รับเหมาช่วงการทดสอบ (Sub contractor)</b></div>
                    <div className="pr-ind"><CB checked={isStandardMethod && lar?.subcontractor === 'none'} /> 3.1 ไม่ใช้ผู้รับเหมาช่วง</div>
                    <div className="pr-ind">
                      <CB checked={isStandardMethod && lar?.subcontractor === 'used'} /> 3.2 การทดสอบนี้ใช้บริการทดสอบโดยผู้รับเหมาช่วง บริษัท/หน่วยงาน{' '}
                      <Line width="5cm" value={lar?.subcontractor === 'used' ? (lar?.subcontractorName ?? '') : ''} />
                    </div>
                    <div className="pr-ind3 pr-note">
                      (เนื่องจากห้องปฏิบัติการทดสอบไม่สามารถทดสอบได้ ซึ่งลูกค้ารับทราบ และยินยอมแล้ว)
                    </div>

                    <div className="pr-mt-sm"><b>สรุปความพร้อมของงานบริการ</b></div>
                    <div className="pr-ind pr-fill-row">
                      <span>
                        <CB checked={isStandardMethod && lar?.acceptable === true} /> พร้อมรับงาน&nbsp;&nbsp;
                        <CB checked={isStandardMethod && lar?.acceptable === false} /> ไม่พร้อมรับงาน&nbsp;เนื่องจาก
                      </span>
                      <span className="pr-line-fill">
                        {isStandardMethod && lar?.acceptable === false ? lar?.notAcceptableReason : ' '}
                      </span>
                    </div>

                    <div className="pr-mt-sm">
                      <b><u>กรณีลูกค้าระบุวิธีการทดสอบตามเอกสารของลูกค้า</u></b>
                    </div>
                    <div className="pr-q"><b>พิจารณาแล้วว่า</b></div>
                    <div className="pr-ind pr-fill-row">
                      <span>
                        1.&nbsp;<CB checked={isCustomMethod && lar?.methodSuitable === true} /> เหมาะสม&nbsp;&nbsp;
                        <CB checked={isCustomMethod && lar?.methodSuitable === false} /> ไม่เหมาะสม&nbsp;เนื่องจาก
                      </span>
                      <span className="pr-line-fill">
                        {isCustomMethod && lar?.methodSuitable === false ? lar?.methodSuitableReason : ' '}
                      </span>
                    </div>
                    <div className="pr-ind">
                      2. เครื่องมือทดสอบ (เครื่องมือ <Line width="4cm" value={lar?.equipmentName ?? ''} /> )
                    </div>
                    <div className="pr-ind2">
                      <CB checked={lar?.equipment === 'ready'} /> 2.1 มีความพร้อม เนื่องจาก&nbsp;<RD checked={lar?.equipmentReadyReasons?.includes('hasInstrument')} /> มีเครื่องมือ&nbsp;<RD checked={lar?.equipmentReadyReasons?.includes('calibrated')} /> สอบเทียบแล้ว
                    </div>
                    <div className="pr-ind2">
                      <CB checked={lar?.equipment === 'notReady'} /> 2.2 ไม่มีความพร้อม เนื่องจาก
                    </div>
                    <div className="pr-ind3"><RD checked={lar?.equipmentNotReadyReasons?.includes('noInstrument')} /> ไม่มีเครื่องมือ</div>
                    <div className="pr-ind3"><RD checked={lar?.equipmentNotReadyReasons?.includes('notCalibrated')} /> ยังไม่มีการสอบเทียบ</div>
                    <div className="pr-ind3"><RD checked={lar?.equipmentNotReadyReasons?.includes('outOfRange')} /> เครื่องมือไม่ครอบคลุมช่วงทดสอบที่ต้องการ</div>
                    <div className="pr-ind3"><RD checked={lar?.equipmentNotReadyReasons?.includes('broken')} /> เครื่องมือเสีย</div>
                    <div className="pr-ind">
                      3. บุคลากร และปริมาณงาน ทบทวน ตามวิธีทดสอบของ ไอ ซี พี ลัดดา จำกัด (ข้อ 1 และ 2)
                    </div>

                    <div className="pr-mt-sm"><b>สรุปความพร้อมของงานบริการ</b></div>
                    <div className="pr-ind pr-fill-row">
                      <span>
                        <CB checked={isCustomMethod && lar?.acceptable === true} /> พร้อมรับงาน&nbsp;&nbsp;
                        <CB checked={isCustomMethod && lar?.acceptable === false} /> ไม่พร้อมรับงาน&nbsp;เนื่องจาก
                      </span>
                      <span className="pr-line-fill">
                        {isCustomMethod && lar?.acceptable === false ? lar?.notAcceptableReason : ' '}
                      </span>
                    </div>
                  </div>

                  <div className="pr-cell-sig">
                    <div className="pr-sig-row">
                      <span className="pr-sig-label">ลงชื่อ </span>
                      <Line width="4.5cm" />
                      <span className="pr-sig-date">
                        วันเดือนปี{' '}
                        <Line width="0.8cm" value={reviewedDate.d} />/
                        <Line width="0.8cm" value={reviewedDate.m} />/
                        <Line width="0.8cm" value={reviewedDate.y} />
                      </span>
                    </div>
                    <div className="pr-sig-name">
                      ( <Line width="6.5cm" value={lar?.reviewedBy ?? ''} /> )
                    </div>
                    <div className="pr-sig-title">หัวหน้าห้องปฏิบัติการเคมี</div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="pr-p1-footer">FM-QP-07-01-001 R02 (16/12/67) P1/1</div>
      </FitToBox>
    </section>
  );
}

function PageTwo({ lr, petition, items, qcResults, sgParam, requestValues = {} }: { lr: LabRequest; petition: Petition; items: PetitionItem[]; qcResults: QCTestResult[]; sgParam: SgParameter | null; requestValues?: Record<string, unknown> }) {
  const receivedDateTime = petition.receivedAt ? new Date(petition.receivedAt) : null;
  const receivedTime = receivedDateTime
    ? `${String(receivedDateTime.getHours()).padStart(2, '0')}.${String(receivedDateTime.getMinutes()).padStart(2, '0')} น.`
    : '';
  const td = new Set(lr.testDelivery ?? []);
  const yearShort = String((new Date(petition.createdAt).getFullYear() + 543) % 100).padStart(2, '0');
  const requester = lr.requester;
  const sampleReturnReturn = lr.sampleReturn === 'return';
  const sampleReturnNoReturn = lr.sampleReturn === 'discard';
  const printRows = expandItemsBySampleQuantity(items);
  return (
    <section className="pr-page2">
      <FitToBox className="pr-p2-inner" contentClassName="pr-fit-col">
        <div className="pr-p2-top">
          <img src={ICP_LADDA_LOGO_URL} alt="ICP Ladda" className="pr-p2-logo" />
          <div className="pr-p2-title"><b>ใบคำขอรับบริการ</b></div>
          <div className="pr-p2-top-r">
            <div className="pr-p2-sheet">
              <span>แผ่นที่</span>
              <span className="pr-line-fill pr-center">1</span>
              <span>/</span>
              <span className="pr-line-fill pr-center">{yearShort}</span>
            </div>
            <div className="pr-p2-infobox">
              <div className="pr-fill-row">
                <span>เลขที่ขอรับบริการ :</span>
                <span className="pr-line-fill">{lr.labRequestNo}</span>
              </div>
              <div className="pr-fill-row">
                <span>วันที่รับตัวอย่าง :</span>
                <span className="pr-line-fill">{buddhistShort(petition.receivedAt)}</span>
              </div>
              <div className="pr-fill-row">
                <span>เวลา :</span>
                <span className="pr-line-fill">{receivedTime}</span>
              </div>
            </div>
          </div>
        </div>

        <table className="pr-p2-info">
          <tbody>
            <tr>
              <td className="pr-p2-info-l">
                <div>
                  ชื่อบริษัทผู้ส่งตัวอย่างที่ระบุในใบรายงานผล :{' '}
                  <Line width="14cm" value={lr.reportCustomerName || requester?.fullName} />
                </div>
                <div>
                  ที่อยู่ที่ระบุในใบรายงานผล :{' '}
                  <Line width="16cm" value={reportAddress(lr)} />
                </div>
                <div>
                  ที่อยู่ในการออกใบกำกับภาษี :{' '}
                  <Line width="16cm" value={invoiceAddress(lr)} />
                </div>
                <div>
                  โทรศัพท์ : <Line width="3.5cm" value={requester?.phone} />
                  &nbsp;โทรสาร : <Line width="3.5cm" value={requester?.fax} />
                  &nbsp;E-mail : <Line width="6cm" value={requester?.email} />
                </div>
                <div>
                  ชื่อ-สกุลผู้ติดต่อ :{' '}
                  <Line width="6cm" value={requester?.contactName || requester?.fullName} />
                  &nbsp;ตำแหน่ง : <Line width="5cm" value={requester?.position} />
                </div>
                <div>
                  ตัวอย่างหลังการทดสอบ :{' '}
                  <CB checked={sampleReturnReturn} /> ขอรับคืน&nbsp;
                  <span className="pr-note">(ภายใน 3 วันหลังจากได้รับผลทดสอบ)</span>
                  &nbsp;&nbsp;
                  <CB checked={sampleReturnNoReturn} /> ไม่ขอรับคืน / No return
                </div>
                <div>
                  รายละเอียดการส่งผล :&nbsp;
                  <CB checked={td.has('self')} /> มารับเอง&nbsp;&nbsp;
                  <CB checked={td.has('mail')} /> ส่งทางไปรษณีย์&nbsp;&nbsp;
                  <CB checked={td.has('email')} /> E-Mail
                </div>
                <div className="pr-ind">
                  <CB checked={td.has('report')} /> ใบรายงานผล&nbsp;&nbsp;
                  <CB checked={td.has('taxInvoice')} /> ใบกำกับภาษี
                </div>
              </td>
              <td className="pr-p2-info-r">
                {(() => {
                  const storage = toArray(lr.storageCondition);
                  const pkg = toArray(lr.packageType);
                  return (
                    <>
                      <div><b>การเก็บรักษาตัวอย่าง</b></div>
                      <div>
                        <CB checked={storage.includes('room')} /> อุณหภูมิห้อง&nbsp;
                        <CB checked={storage.includes('chilled')} /> แช่เย็น
                      </div>
                      <div className="pr-mt-xs"><b>ภาชนะบรรจุ</b></div>
                      <div>
                        <CB checked={pkg.includes('plasticBag')} /> ถุงพลาสติก&nbsp;
                        <CB checked={pkg.includes('glassBottle')} /> ขวดแก้ว&nbsp;
                        <CB checked={pkg.includes('plasticBottle')} /> ขวดพลาสติก&nbsp;
                        <CB checked={pkg.includes('can')} /> กระป๋อง
                      </div>
                      <div>
                        <CB checked={pkg.includes('other')} /> อื่นๆ ระบุ{' '}
                        <Line width="5cm" value={pkg.includes('other') ? lr.packageTypeOther : ''} />
                      </div>
                    </>
                  );
                })()}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="pr-p2-items">
          <colgroup>
            <col style={{ width: '3%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '6.5%' }} />
            <col style={{ width: '7.5%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '6.5%' }} />
            <col style={{ width: '6.5%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '7.5%' }} />
            <col style={{ width: '4.5%' }} />
            <col style={{ width: '3.25%' }} />
            <col style={{ width: '3.25%' }} />
            <col style={{ width: '8.5%' }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={3}>ลำดับ</th>
              <th rowSpan={3}>ชื่อตัวอย่าง</th>
              <th rowSpan={3}>เลขแบช</th>
              <th rowSpan={3}>วันผลิต/ นำเข้า</th>
              <th rowSpan={3}>เลขที่ใบนำส่งตัวอย่าง</th>
              <th rowSpan={3}>ค่า ถ.พ.</th>
              <th rowSpan={3}>จำนวนหน่วยบรรจุ</th>
              <th rowSpan={3}>หน่วยทดสอบ</th>
              <th rowSpan={3}>รายการทดสอบ</th>
              <th rowSpan={3}>หมายเหตุ</th>
              <th colSpan={4} className="pr-officer-head">สำหรับเจ้าหน้าที่</th>
            </tr>
            <tr>
              <th rowSpan={2}>เลขที่<br />ตัวอย่าง</th>
              <th colSpan={2}>สภาพตัวอย่าง</th>
              <th rowSpan={2}>ราคา</th>
            </tr>
            <tr>
              <th>ปกติ</th>
              <th>ไม่ปกติ</th>
            </tr>
          </thead>
          <tbody>
            {printRows.length > 0 ? printRows.map(({ item, rowSeq, copyIndex }) => (
              <tr key={`${item.seq}-${copyIndex}`}>
                <td className="pr-center">{rowSeq}</td>
                <td>{item.commonName || item.sampleName}</td>
                <td>{item.batchNo}</td>
                <td className="pr-center">{buddhistShort(item.productionDate)}</td>
                <td>{item.submissionNo ?? ''}</td>
                <td className="pr-center">{resolveSpecificGravity(qcResults, item.seq, sgParam) || String(requestValues[`${item.batchNo}\u0000${item.sampleName}`] ?? '')}</td>
                <td>{item.packageUnit ?? ''}</td>
                <td>{item.testUnit ?? ''}</td>
                <td>
                  {item.testItems ?? ''}
                  {Object.entries(requestValues).filter(([key, value]) => !key.startsWith('ค่าถพ.\u0000') && key.endsWith(`\u0000${item.batchNo}\u0000${item.sampleName}`) && value !== '').map(([key, value]) => <div key={key} className="pr-note">{key.split('\u0000')[0]}: {String(value)}</div>)}
                </td>
                <td>{item.note ?? ''}</td>
                <td>{item.sampleId ?? ''}</td>
                <td className="pr-center">{item.condition === 'normal' ? '✓' : ''}</td>
                <td className="pr-center">{item.condition === 'defective' ? '✓' : ''}</td>
                <td />
              </tr>
            )) : (
              <tr><td colSpan={14} className="pr-center">ไม่พบรายการตัวอย่างที่อ้างอิง</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={11} className="pr-officer-filler" />
              <td colSpan={2} className="pr-center pr-officer-sum">ราคา</td>
              <td />
            </tr>
            <tr>
              <td colSpan={11} className="pr-officer-filler" />
              <td colSpan={2} className="pr-center pr-officer-sum">Vat 7 %</td>
              <td />
            </tr>
            <tr>
              <td colSpan={11} className="pr-officer-filler" />
              <td colSpan={2} className="pr-center pr-officer-sum">ราคารวม</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="pr-p2-middle">
          <div className="pr-p2-sign">
            <div className="pr-p2-sign-col">
              <div className="pr-sig-row">
                <span className="pr-sig-label">ผู้ส่งตัวอย่าง </span>
                <Line width="6cm" value={requester?.fullName ?? ''} />
              </div>
              <div className="pr-sig-row pr-mt-xs">
                <span className="pr-sig-label">วันที่ </span>
                <Line width="6cm" value={buddhistShort(petition.sampleSentAt)} />
              </div>
            </div>
            <div className="pr-p2-sign-col">
              <div className="pr-sig-row">
                <span className="pr-sig-label">ผู้รับตัวอย่าง </span>
                <Line width="6cm" value={petition.receivedBy ?? ''} />
              </div>
              <div className="pr-sig-row pr-mt-xs">
                <span className="pr-sig-label">วันที่ </span>
                <Line width="6cm" value={buddhistShort(petition.receivedAt)} />
              </div>
            </div>
          </div>

          <div className="pr-p2-warn">
            <b>&ldquo;หากสงสัยเกี่ยวกับผลการทดสอบ กรุณาติดต่อกลับภายใน 7 วัน หลังจากรับใบรายงานผลการทดสอบ&rdquo;</b>
          </div>
        </div>
        <div className="pr-p2-footer">FM-QP-07-04-001-R01 (30/05/68) P1/1</div>
      </FitToBox>
    </section>
  );
}

interface Props {
  labRequest: LabRequest;
  petition: Petition;
  qcResults?: QCTestResult[];
  sgParam?: SgParameter | null;
  requestValues?: Record<string, unknown>;
}

export default function PetitionPrintTemplate({ labRequest, petition, qcResults = [], sgParam = null, requestValues = {} }: Props) {
  const labItems = petition.items.filter((it) => shouldSendItemToLab(it));
  const itemsToShow = labItems.length > 0 ? labItems : petition.items.filter((it) => it.seq === labRequest.sampleSeq);
  // เลขที่ใบนำส่งใช้ค่าเดียวทั้งใบ (default = เลขคำขอ) — ดึงจากรายการที่ใบนี้อ้างถึง
  const submissionNo = itemsToShow[0]?.submissionNo ?? petition.items[0]?.submissionNo ?? '';
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="pr-root">
        <PageOne lr={labRequest} submissionNo={submissionNo} />
        <PageTwo lr={labRequest} petition={petition} items={itemsToShow} qcResults={qcResults} sgParam={sgParam} requestValues={requestValues} />
      </div>
    </>
  );
}

const PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
@page pageA4L { size: A4 landscape; margin: 0; }

.pr-root, .pr-root * {
  font-family: ${A4_PRINT_FONT_FAMILY};
  font-size: ${A4_PRINT_FONT_SIZE};
  color: #000;
  box-sizing: border-box;
}
.pr-root { line-height: 1.12; }

.pr-page1 {
  width: 210mm; height: 297mm;
  padding: 6mm 8mm 6mm 10mm;
  display: flex; flex-direction: column;
  overflow: hidden;
  page-break-after: always;
}
.pr-page2 {
  page: pageA4L;
  width: 297mm; height: 210mm;
  padding: 5mm 6mm;
  display: flex; flex-direction: column;
  overflow: hidden;
  page-break-after: always;
}

@media print {
  html, body { margin: 0; padding: 0; background: #fff; }
  .pr-p2-info, .pr-p2-top { break-inside: avoid; page-break-inside: avoid; }
  .pr-p2-items tr { break-inside: avoid; page-break-inside: avoid; }
  .pr-p2-warn { break-inside: avoid; page-break-inside: avoid; }
}
@media screen {
  .pr-page1 { margin: 0 auto 16px; background: #fff; box-shadow: 0 0 0 1px #ddd; }
  .pr-page2 { margin: 0 auto; background: #fff; box-shadow: 0 0 0 1px #ddd; }
}

.pr-cb {
  display: inline-block;
  width: 9pt; height: 9pt;
  border: 0.6pt solid #000;
  vertical-align: -1pt;
  margin-right: 1.5pt;
  position: relative;
}
.pr-cb-x::before {
  content: '✓'; position: absolute; inset: -1pt 0 0 0;
  text-align: center; font-size: 9pt; line-height: 9pt; font-weight: bold;
}
.pr-rd {
  display: inline-block;
  width: 7pt; height: 7pt;
  border: 0.6pt solid #000;
  border-radius: 50%;
  vertical-align: -0.5pt;
  margin: 0 2pt 0 0;
  position: relative;
}
.pr-rd-x::before {
  content: ''; position: absolute; inset: 1pt;
  background: #000; border-radius: 50%;
}
.pr-line {
  display: inline-block;
  min-width: 2.2cm;
  border-bottom: 0.4pt dotted #000;
  padding: 0 2pt;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: baseline;
}
.pr-line-xs { min-width: 0.9cm; }
.pr-line-sm { min-width: 1.8cm; }
.pr-line-md { min-width: 4.5cm; }
.pr-center { text-align: center; }
.pr-italic { font-style: italic; color: #333; }
.pr-note { font-size: 9pt; color: #333; }
.pr-mt-xs { margin-top: 1pt; }
.pr-mt-sm { margin-top: 3pt; }
.pr-sig-row {
  display: flex; align-items: baseline; flex-wrap: nowrap; gap: 0; white-space: nowrap;
}
.pr-sig-label { display: inline-block; }
.pr-sig-date {
  display: inline-flex; align-items: baseline; white-space: nowrap; margin-left: 8pt;
}
.pr-sig-name { margin-top: 1pt; text-align: center; font-size: 10pt; }
.pr-sig-title { margin-top: 1pt; text-align: center; font-size: 10pt; }

.pr-p1-logo { margin-bottom: 2pt; }
.pr-p1-logo img { height: 50pt; width: auto; display: block; }
.pr-p1-title { font-size: 14pt; margin: 2pt 0 3pt; }
.pr-p1-meta-row { text-align: right; font-size: 11pt; line-height: 1.25; }

.pr-p1-notify {
  border: 0.6pt solid #000;
  padding: 3pt 6pt;
  margin: 4pt 0 0;
  font-size: 10.5pt;
}
.pr-p1-notify-line { line-height: 1.5; }

.pr-p1-table {
  width: 100%; border-collapse: collapse; table-layout: fixed;
}
.pr-p1-table th, .pr-p1-table td {
  border: 0.6pt solid #000;
  padding: 2pt 4pt;
  vertical-align: top;
  font-weight: normal;
}
.pr-p1-head-l, .pr-p1-head-r { padding: 3pt 6pt; }
.pr-p1-sub {
  font-size: 8.5pt; font-style: italic; color: #333; line-height: 1.1;
  margin-top: 2pt; text-align: center;
}
.pr-fill-row { display: flex; align-items: baseline; gap: 4pt; width: 100%; }
.pr-line-fill {
  flex: 1 1 auto;
  border-bottom: 0.4pt dotted #000;
  padding: 0 3pt; line-height: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pr-p1-body-l, .pr-p1-body-r {
  font-size: 10.5pt; line-height: 1.15; vertical-align: top;
  height: 1px;
}
.pr-cell { display: flex; flex-direction: column; height: 100%; }
.pr-cell-main > div { margin: 0.5pt 0; }
.pr-cell-sig { margin-top: auto; padding-top: 4pt; }
.pr-q { margin-top: 1.5pt !important; }
.pr-ind { padding-left: 0; }
.pr-ind2 { padding-left: 0.5cm; }
.pr-ind3 { padding-left: 1.0cm; font-size: 10pt; }

.pr-terms {
  margin-top: 4pt;
  border-top: 0.4pt dashed #777;
  padding-top: 3pt;
}
.pr-terms-title { font-size: 10.5pt; }
.pr-terms-list {
  margin: 3pt 0 4pt 0;
  font-size: 9.5pt;
  line-height: 1.2;
}
.pr-terms-item {
  display: flex;
  align-items: flex-start;
  gap: 4pt;
  margin-bottom: 5pt;
}
.pr-terms-num {
  flex: 0 0 auto;
  min-width: 14pt;
}
.pr-terms-ack {
  font-size: 10pt;
  margin-top: 4pt;
}

.pr-p1-inner, .pr-p2-inner {
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 100%;
}
/* FitToBox วัดความสูงจริงของคอลัมน์นี้ แล้ว scale ลงถ้าล้นกรอบหน้ากระดาษ */
.pr-fit-col { display: flex; flex-direction: column; }
.pr-p1-footer, .pr-p2-footer {
  padding-top: 4pt;
  text-align: left; font-size: 10pt;
}
.pr-p1-footer { margin-top: auto; }

.pr-p2-top {
  display: grid;
  grid-template-areas: "logo  .      right" "title title  right";
  grid-template-columns: auto 1fr auto;
  column-gap: 8pt; row-gap: 4pt; margin-bottom: 4pt; align-items: start;
}
.pr-p2-logo { grid-area: logo; height: 40pt; width: auto; display: block; }
.pr-p2-title { grid-area: title; font-size: 16pt; text-align: center; }
.pr-p2-top-r {
  grid-area: right; display: flex; flex-direction: column; align-items: stretch;
  gap: 2pt; font-size: 11pt; line-height: 1.2;
}
.pr-p2-sheet {
  display: flex; align-items: baseline; gap: 4pt; margin-left: auto; min-width: 7cm;
}
.pr-p2-infobox {
  border: 0.6pt solid #000; padding: 4pt 6pt;
  display: flex; flex-direction: column; gap: 2pt;
  margin-left: auto; min-width: 7cm; width: fit-content;
}

.pr-p2-info {
  width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 10pt;
}
.pr-p2-info td {
  border: 0.6pt solid #000; padding: 3pt 5pt; vertical-align: top;
  font-size: 11pt; line-height: 1.25;
}
.pr-p2-info-l { width: 72%; }
.pr-p2-info-r { width: 28%; }

.pr-p2-items {
  width: 100%; border-collapse: collapse; table-layout: fixed;
  font-size: 9.5pt; margin-bottom: 12pt;
}
.pr-p2-items th, .pr-p2-items td {
  border: 0.5pt solid #000; padding: 2pt 3pt; vertical-align: top;
  word-break: break-word; overflow-wrap: anywhere; line-height: 1.2;
}
.pr-p2-items thead th { text-align: center; vertical-align: middle; font-weight: bold; font-size: 9.5pt; }
.pr-p2-items tbody td { text-align: center; vertical-align: middle; }
.pr-officer-head { background: #f1f1f1; }
.pr-p2-items tfoot .pr-officer-filler { border: none; background: transparent; }
.pr-p2-items tfoot .pr-officer-sum { font-weight: bold; }

.pr-p2-middle {
  margin-top: auto;
  margin-bottom: auto;
}
.pr-p2-sign {
  display: flex; justify-content: center; gap: 80pt;
}
.pr-p2-sign-col { flex: 0 1 auto; font-size: 11pt; min-width: 8cm; }

.pr-p2-warn { text-align: center; margin-top: 10pt; font-size: 11pt; }

.pr-root, .pr-root * {
  font-size: ${A4_PRINT_FONT_SIZE} !important;
}
.pr-root h1,
.pr-root h2,
.pr-root h3,
.pr-root h4,
.pr-root h5,
.pr-root h6,
.pr-root th,
.pr-p1-title,
.pr-p2-title,
.pr-terms-title,
.pr-q b,
.pr-officer-sum,
.print-heading {
  font-weight: ${A4_PRINT_HEADING_FONT_WEIGHT} !important;
}
`;
