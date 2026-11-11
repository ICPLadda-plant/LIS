import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import type { LabRequestFormValues } from '@/lib/validations';
import type { ItemRowValues } from './ItemsStep';

export type LabRequestRowValues = LabRequestFormValues & {
  sampleName: string;
};

interface Props {
  items: ItemRowValues[];
  request: LabRequestRowValues;
  onChange: (next: LabRequestRowValues) => void;
}

export default function LabRequestStep({ items, request, onChange }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-grey-500">
        ไม่มี batch ที่เลือกส่ง LAB — ข้ามขั้นตอนนี้
      </p>
    );
  }

  const req = request;

  function setReq(patch: Partial<LabRequestRowValues>) {
    onChange({ ...req, ...patch });
  }
  function setSA<K extends keyof LabRequestRowValues['serviceAgreement']>(
    key: K,
    value: LabRequestRowValues['serviceAgreement'][K],
  ) {
    onChange({ ...req, serviceAgreement: { ...req.serviceAgreement, [key]: value } });
  }
  function setDuration(value: LabRequestRowValues['serviceAgreement']['testDuration']) {
    if (req.serviceAgreement.testDuration === value) return;
    onChange({
      ...req,
      serviceAgreement: { ...req.serviceAgreement, testDuration: value, testDurationDays: null },
    });
  }
  function setRequester<K extends keyof LabRequestRowValues['requester']>(
    key: K,
    value: LabRequestRowValues['requester'][K],
  ) {
    onChange({ ...req, requester: { ...req.requester, [key]: value } });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">ใบคำขอรับบริการ (Lab)</h2>
        <p className="text-sm text-grey-500">
          ข้อมูลนี้ใช้ร่วมกันทุก batch ที่ส่ง lab —{' '}
          batch ในชุดนี้: {items.map((it) => it.batchNo).join(', ')}
        </p>
      </div>

      {/* Requester info */}
      <div>
        <h3 className="font-semibold mb-2">ข้อมูลลูกค้า / ผู้ขอบริการ</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>ชื่อ-นามสกุล</Label>
            <div className="mt-1 rounded-[10px] border border-black-50 bg-grey-50 px-3 py-2 text-sm text-black-500">
              {req.requester.fullName || '-'}
            </div>
          </div>
          <div>
            <Label>แผนก</Label>
            <div className="mt-1 rounded-[10px] border border-black-50 bg-grey-50 px-3 py-2 text-sm text-black-500">
              {req.requester.department || '-'}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label>ที่อยู่</Label>
            <Textarea rows={2} value={req.requester.address ?? ''} onChange={(e) => setRequester('address', e.target.value)} />
          </div>
          <div>
            <Label>เบอร์โทร</Label>
            <Input value={req.requester.phone ?? ''} onChange={(e) => setRequester('phone', e.target.value)} />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input
              value={req.requester.email ?? ''}
              onChange={(e) => setRequester('email', e.target.value)}
              placeholder="email@example.com"
            />
          </div>
        </div>
      </div>

      {/* Service agreement */}
      <div className="space-y-4">
        <h3 className="font-semibold">ข้อตกลงการบริการทดสอบ</h3>

        {/* 1. การนำส่งตัวอย่าง */}
        <div className="rounded-[10px] border border-grey-200 p-4 space-y-2">
          <p className="text-sm font-medium">1. ตัวอย่างนำส่งห้องปฏิบัติการโดย</p>
          <div className="flex flex-wrap gap-4">
            {([
              { value: 'self', label: '1.1  ลูกค้ามาเอง' },
              { value: 'courier', label: '1.2  จัดส่งทางไปรษณีย์' },
            ] as const).map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="sampleDelivery"
                  value={opt.value}
                  checked={req.serviceAgreement.sampleDelivery === opt.value}
                  onChange={() => setSA('sampleDelivery', opt.value)}
                  className="accent-primary-500"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* 2. วิธีทดสอบ */}
        <div className="rounded-[10px] border border-grey-200 p-4 space-y-3">
          <p className="text-sm font-medium">2. วิธีทดสอบ โปรดระบุ</p>

          {/* 2.1 ปกติ */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="testMethod"
              value="standard"
              checked={req.serviceAgreement.testMethod === 'standard'}
              onChange={() => setSA('testMethod', 'standard')}
              className="accent-primary-500"
            />
            2.1  วิธีปกติ (กรณีลูกค้าไม่ระบุวิธี)
          </label>

          {/* 2.2 วิธีเฉพาะ */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="testMethod"
                value="custom-group"
                checked={req.serviceAgreement.testMethod === 'custom' || req.serviceAgreement.testMethod === 'previous'}
                onChange={() => setSA('testMethod', 'custom')}
                className="accent-primary-500"
              />
              2.2  วิธีเฉพาะตามเอกสารของลูกค้า
            </label>

            {(req.serviceAgreement.testMethod === 'custom' || req.serviceAgreement.testMethod === 'previous') && (
              <div className="ml-6 space-y-3">
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="testMethodDone"
                      checked={req.serviceAgreement.testMethod === 'previous'}
                      onChange={() => setSA('testMethod', 'previous')}
                      className="accent-primary-500"
                    />
                    เคยทำ
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="testMethodDone"
                      checked={req.serviceAgreement.testMethod === 'custom'}
                      onChange={() => setSA('testMethod', 'custom')}
                      className="accent-primary-500"
                    />
                    ไม่เคยทำ
                  </label>
                </div>
                {req.serviceAgreement.testMethod === 'previous' && (
                  <div>
                    <Label className="text-xs text-grey-500">เลขที่งานที่เคยทำ</Label>
                    <Input
                      value={req.serviceAgreement.testMethodDoneBefore ?? ''}
                      onChange={(e) => setSA('testMethodDoneBefore', e.target.value)}
                      placeholder="ระบุเลขที่งาน"
                    />
                  </div>
                )}
                <div>
                  <Label className="text-xs text-grey-500">
                    วิธีเทคนิค / เครื่องมือ / สารเคมี / ชนิดตัวอย่าง / Detection Limit
                  </Label>
                  <Textarea
                    rows={2}
                    value={req.serviceAgreement.testMethodDetail ?? ''}
                    onChange={(e) => setSA('testMethodDetail', e.target.value)}
                    placeholder="ระบุรายละเอียด"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. ระยะเวลาดำเนินการ */}
        <div className="rounded-[10px] border border-grey-200 p-4 space-y-2">
          <p className="text-sm font-medium">3. ระยะเวลาดำเนินการทดสอบ</p>
          <div className="space-y-2">
            {([
              { value: 'normal', label: '3.1  ปกติ', hasDays: false },
              { value: 'extended', label: '3.2  ช้ากว่าปกติได้', hasDays: true },
              { value: 'urgent', label: '3.3  เร็วกว่าปกติได้', hasDays: true },
            ] as const).map((opt) => {
              const selected = req.serviceAgreement.testDuration === opt.value;
              return (
                <div key={opt.value} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="testDuration"
                      value={opt.value}
                      checked={selected}
                      onChange={() => setDuration(opt.value)}
                      className="accent-primary-500"
                    />
                    {opt.label}
                  </label>
                  {opt.hasDays && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">(ภายใน</span>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        aria-label={`จำนวนวันสำหรับข้อ ${opt.label.trim()}`}
                        className="h-8 w-20"
                        disabled={!selected}
                        value={selected ? req.serviceAgreement.testDurationDays ?? '' : ''}
                        onChange={(e) =>
                          setSA('testDurationDays', e.target.value ? Number(e.target.value) : null)
                        }
                        placeholder="0"
                      />
                      <span className="text-sm">วัน)</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Uncertainty */}
        <div className="rounded-[10px] border border-grey-200 p-4 space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={req.serviceAgreement.requireUncertainty}
              onCheckedChange={(c) => setSA('requireUncertainty', c === true)}
            />
            ต้องการค่า Uncertainty
          </label>
          <div className="max-w-sm">
            <Label className="text-xs text-grey-500">ค่า Uncertainty</Label>
            <Input
              value={req.serviceAgreement.uncertaintyValue ?? ''}
              onChange={(e) => setSA('uncertaintyValue', e.target.value)}
              placeholder="ระบุค่า Uncertainty (ถ้ามี)"
            />
          </div>
          <p className="text-xs text-grey-500">ค่านี้ใช้ในใบคำขอ/ข้อมูลระบบ และไม่แสดงบนฉลากตัวอย่าง</p>
        </div>
      </div>

      {/* Customer/report info */}
      <div>
        <h3 className="font-semibold mb-2">ข้อมูลในใบรายงานผล / ใบกำกับภาษี</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>ชื่อบริษัทผู้ส่งตัวอย่างในใบรายงานผล</Label>
            <Input
              value={req.reportCustomerName ?? ''}
              onChange={(e) => setReq({ reportCustomerName: e.target.value })}
            />
          </div>
          <div>
            <Label>การเก็บรักษาตัวอย่าง (เลือกได้มากกว่า 1)</Label>
            <div className="flex flex-wrap gap-4 pt-1">
              {[
                { value: 'room', label: 'อุณหภูมิห้อง' },
                { value: 'chilled', label: 'แช่เย็น' },
              ].map((opt) => {
                const checked = (req.storageCondition ?? []).includes(opt.value as 'room' | 'chilled');
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        const cur = req.storageCondition ?? [];
                        const next = c === true
                          ? Array.from(new Set([...cur, opt.value as 'room' | 'chilled']))
                          : cur.filter((v) => v !== opt.value);
                        setReq({ storageCondition: next });
                      }}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <Label>ภาชนะบรรจุ (เลือกได้มากกว่า 1)</Label>
            <div className="flex flex-wrap gap-4 pt-1">
              {[
                { value: 'plasticBag', label: 'ถุงพลาสติก' },
                { value: 'glassBottle', label: 'ขวดแก้ว' },
                { value: 'plasticBottle', label: 'ขวดพลาสติก' },
                { value: 'can', label: 'กระป๋อง' },
                { value: 'other', label: 'อื่นๆ' },
              ].map((opt) => {
                const v = opt.value as 'plasticBag' | 'glassBottle' | 'plasticBottle' | 'can' | 'other';
                const checked = (req.packageType ?? []).includes(v);
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        const cur = req.packageType ?? [];
                        const next = c === true
                          ? Array.from(new Set([...cur, v]))
                          : cur.filter((x) => x !== v);
                        setReq({ packageType: next });
                      }}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
          {(req.packageType ?? []).includes('other') && (
            <div className="sm:col-span-2">
              <Label>ระบุภาชนะอื่นๆ</Label>
              <Input
                value={req.packageTypeOther ?? ''}
                onChange={(e) => setReq({ packageTypeOther: e.target.value })}
              />
            </div>
          )}
          <div>
            <Label>ตัวอย่างหลังการทดสอบ</Label>
            <select
              className="w-full rounded-md border border-grey-300 p-2 text-sm"
              value={req.sampleReturn}
              onChange={(e) => setReq({ sampleReturn: e.target.value as 'return' | 'discard' | 'keep' })}
            >
              <option value="return">ขอรับคืน</option>
              <option value="discard">ไม่ขอรับคืน / ทำลาย</option>
              <option value="keep">เก็บตัวอย่างไว้</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
