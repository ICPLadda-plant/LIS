/**
 * งานด่วนคือคำร้องที่ API ส่ง priority = 1 มา ข้อมูลเก่าบางใบเก็บเป็นข้อความ "1"
 * จึงต้องแปลงเป็นตัวเลขก่อนเทียบทุกครั้ง
 */
export function isUrgentPetition(petition: { priority?: unknown } | null | undefined): boolean {
  if (!petition) return false;
  const value = petition.priority;
  if (value === null || value === undefined || value === "") return false;
  return Number(value) === 1;
}

/** ดันงานด่วนขึ้นบนสุด โดยคงลำดับเดิมภายในกลุ่มงานด่วนและกลุ่มงานปกติ */
export function prioritizeUrgentPetitions<T extends { priority?: unknown }>(petitions: T[]): T[] {
  const urgent: T[] = [];
  const normal: T[] = [];
  for (const petition of petitions) (isUrgentPetition(petition) ? urgent : normal).push(petition);
  return [...urgent, ...normal];
}
