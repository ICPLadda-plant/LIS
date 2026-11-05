import type { Petition } from '@/types/petition.types';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  /** คำร้องที่ยังรอรับ — เรียงตามลำดับที่ต้องการแสดง (งานด่วนก่อน) */
  petitions: Petition[];
  onPick: (petitionNo: string) => void;
  placeholder?: string;
}

/** Dropdown เลือกคำร้องที่รอรับ ใช้คู่กับช่องพิมพ์เลขและการสแกน QR ใน popup รับงาน */
export default function PendingPetitionSelect({ petitions, onPick, placeholder = 'เลือกคำร้องที่รอรับ' }: Props) {
  const empty = petitions.length === 0;
  return (
    <div className="space-y-1">
      <Select
        value=""
        disabled={empty}
        onValueChange={(petitionNo) => { if (petitionNo) onPick(petitionNo); }}
      >
        <SelectTrigger aria-label="เลือกคำร้องที่รอรับ">
          <SelectValue placeholder={empty ? 'ไม่มีคำร้องที่รอรับ' : `${placeholder} (${petitions.length})`} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {petitions.map((p) => (
            <SelectItem key={p._id} value={p.petitionNo}>
              <span className="font-semibold">{p.petitionNo}</span>
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

