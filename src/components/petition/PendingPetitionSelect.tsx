import type { Petition } from '@/types/petition.types';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { pendingSideLabels } from '@/lib/labelReceipt';
import type { SampleLabelSide } from '@/lib/petitionSampler';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  /** คำร้องที่ยังรอรับ — เรียงตามลำดับที่ต้องการแสดง (งานด่วนก่อน) */
  petitions: Petition[];
  onPick: (petitionNo: string) => void;
  placeholder?: string;
  /** ฝั่งที่รับ — ระบุแล้วแสดงตัวเลือกตามเลขนำส่ง (P/L) ของฝั่งนั้น โดยมีเลขคำร้องเป็นอ้างอิง */
  side?: SampleLabelSide;
}

/** Dropdown เลือกงานที่รอรับ ใช้คู่กับช่องพิมพ์เลขและการสแกน QR ใน popup รับงาน */
export default function PendingPetitionSelect({ petitions, onPick, placeholder, side }: Props) {
  const options = petitions.flatMap((p) => {
    const labels = side ? pendingSideLabels(p, side) : [];
    if (!labels.length) return [{ key: p._id, value: p.petitionNo, title: p.petitionNo, ref: '', p }];
    return labels.map((label) => ({ key: p._id + ':' + label.label, value: label.label, title: label.label, ref: p.petitionNo, p }));
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
          {options.map(({ key, value, title, ref, p }) => (
            <SelectItem key={key} value={value}>
              <span className="font-semibold">{title}</span>
              {ref && <span className="text-muted-foreground">{' · อ้างอิง '}{ref}</span>}
              <span className="text-muted-foreground">
                {' · '}{petitionDepartmentLabel(p)} · {p.submittedBy?.name ?? '-'}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

