/**
 * แปลงแผนก (department จาก HR/Microsoft sync) เป็นรหัสลูกค้า TI ที่ใช้ในใบคำขอ
 * (หน้า 1 — "รหัสลูกค้า"). department เป็น free-text เลยต้อง normalize ก่อน map.
 *
 *   ผลิต 1–5      → TI P01–TI P05
 *   อินเตอร์เทรด / LDI → TI INT
 *   QC            → TI QC
 *   R & D         → TI RD
 *   คลังสินค้า     → TI WH
 *
 * ถ้า map ไม่ได้ (เช่น "IT" หรือ "ผลิต" ที่ไม่มีเลขสาย) คืนค่าว่าง
 * เพื่อให้ช่องรหัสลูกค้าในเอกสารเว้นว่างไว้ แทนการพิมพ์ค่าที่ไม่ใช่รหัส.
 */
export function customerCodeFromDepartment(dept?: string | null): string {
  const raw = (dept ?? "").trim();
  if (!raw) return "";
  const norm = raw.toLowerCase().replace(/\s+/g, " ");

  // สายผลิต 1–5: "ผลิต 1", "ผลิต1", "ผลิต 01", "production 2", "prod 3"
  const prod = norm.match(/(?:ผลิต|prod(?:uction)?)\s*0?([1-5])(?!\d)/);
  if (prod) return `TI P0${prod[1]}`;

  if (/inter|อินเตอร์|อินเทอร์|\bldi\b/.test(norm)) return "TI INT";
  if (/วิจัย|r\s*&?\s*d|\brd\b/.test(norm)) return "TI RD";
  if (/\bqc\b|คิวซี|ควบคุมคุณภาพ/.test(norm)) return "TI QC";
  if (/คลังสินค้า|คลัง|warehouse|\bwh\b/.test(norm)) return "TI WH";

  return "";
}

/**
 * รหัสลูกค้าของใบคำขอ: ลองแผนกในใบขอรับบริการก่อน แล้วแผนกผู้ยื่นคำขอ
 * สุดท้ายใช้ประเภทใบคำขอ (rm/fg = คลังสินค้า → TI WH).
 */
export function customerCodeForPetition(
  ...departments: Array<string | null | undefined>
): string {
  for (const dept of departments) {
    if (dept === "rm" || dept === "fg") return "TI WH";
    const code = customerCodeFromDepartment(dept);
    if (code) return code;
  }
  return "";
}
