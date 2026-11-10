// ส่วนของ batch ที่เก็บตัวอย่าง (บน/กลาง/ล่าง/...) ที่ Production ส่งมา — ค่าว่าง / "ทั่วไป/รวม" = ไม่ระบุส่วน
export function normalizeSamplePart(part?: string | null): string {
  const value = String(part ?? '').replace(/\s+/g, ' ').trim();
  return ['ทั่วไป/รวม', 'ทั่วไป', 'รวม'].includes(value) ? '' : value;
}

// แถวจาก Production ที่มีรหัสบรรทัดต่างกันเป็นคนละตัวอย่างเสมอ (ผู้ใช้เลือก "แยกรายการ" ไว้)
export function sameSampleLine(a: { lineRef?: string }, b: { lineRef?: string }): boolean {
  return !(a.lineRef && b.lineRef && a.lineRef !== b.lineRef);
}
