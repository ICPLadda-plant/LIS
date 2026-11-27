import type { Petition } from '@/types/petition.types';
import { pendingSideLabels } from '@/lib/labelReceipt';
import type { SampleLabelSide } from '@/lib/petitionSampler';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  /** คำร้องที่ยังรอรับ — component เรียงงานที่มาล่าสุดขึ้นก่อนเอง */
  petitions: Petition[];
  onPick: (petitionNo: string) => void;
  placeholder?: string;
  /** ฝั่งที่รับ — ระบุแล้วแสดงตัวเลือกตามเลขนำส่ง (P/L) ของฝั่งนั้น โดยมีเลขคำร้องเป็นอ้างอิง */
  side?: SampleLabelSide;
}

/** เลข batch + ชื่อ common name ของป้าย (key = "BATCH|ส่วน"); ไม่มี key ใช้ทุกรายการในคำร้อง */
function batchInfo(p: Petition, key: string): string {
  const batch = key.split('|')[0]?.trim();
  const items = (p.items ?? []).filter((it) => !batch || it.batchNo?.trim() === batch);
  const batches = [...new Set(items.map((it) => it.batchNo).filter(Boolean))];
  const names = [...new Set(items.map((it) => it.commonName || it.sampleName).filter(Boolean))];
  return [batches.join(', ') || batch, names.join(', ')].filter(Boolean).join(' · ') || '-';
}

/** Dropdown เลือกงานที่รอรับ ใช้คู่กับช่องพิมพ์เลขและการสแกน QR ใน popup รับงาน */
export default function PendingPetitionSelect({ petitions, onPick, placeholder, side }: Props) {
  const newestFirst = [...petitions].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const options = newestFirst.flatMap((p) => {
    const labels = side ? pendingSideLabels(p, side) : [];
    if (!labels.length) return [{ key: p._id, value: p.petitionNo, title: p.petitionNo, info: batchInfo(p, '') }];
    return labels.map((label) => ({ key: p._id + ':' + label.label, value: label.label, title: label.label, info: batchInfo(p, label.key) }));
  });
  const empty = options.length === 0;
  const text = placeholder ?? (side ? 'เลือกเลขนำส่งที่รอรับ' : 'เลือกคำร้องที่รอรับ');
  return (
    <div className="space-y-1">
      <Select
        value=""
        disabled={empty}
        onValueChange={(petitionNo) => { if (petitionNo) onPick(petitionNo); }}
      >
        <SelectTrigger aria-label={text}>
          <SelectValue placeholder={empty ? 'ไม่มีงานที่รอรับ' : `${text} (${options.length})`} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map(({ key, value, title, info }) => (
            <SelectItem key={key} value={value}>
              <span className="font-semibold">{title}</span>
              <span className="text-muted-foreground">{' · '}{info}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

