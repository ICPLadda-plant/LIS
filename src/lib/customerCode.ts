/**
 * แปลงแผนก (department จาก HR/Microsoft sync) เป็นรหัสลูกค้า TI ที่ใช้ในใบคำขอ
 * (หน้า 1 — "รหัสลูกค้า"). department เป็น free-text เลยต้อง normalize ก่อน map.
 *
 *   ผลิต 1–5      → TI P01–TI P05
 *   อินเตอร์เทรด   → TI INT
 *   QC            → TI QC
 *   R & D         → TI RD
 *   คลังสินค้า     → TI WH
 *
 * ถ้า map ไม่ได้ (เช่น HR ส่งมาแค่ "ผลิต" ไม่มีเลขสาย) คืนค่า department เดิม
 * เพื่อไม่ให้ข้อมูลหายไปจากเอกสาร.
 */
export function customerCodeFromDepartment(dept?: string | null): string {
  const raw = (dept ?? "").trim();
  if (!raw) return "";
  const norm = raw.toLowerCase().replace(/\s+/g, " ");

  // สายผลิต 1–5: "ผลิต 1", "ผลิต1", "production 2", "prod 3"
  const prod = norm.match(/(?:ผลิต|prod(?:uction)?)\s*([1-5])/);
  if (prod) return `TI P0${prod[1]}`;

  if (/inter|อินเตอร์|อินเทอร์/.test(norm)) return "TI INT";
  if (/วิจัย|r\s*&?\s*d|\brd\b/.test(norm)) return "TI RD";
  if (/\bqc\b|คิวซี|ควบคุมคุณภาพ/.test(norm)) return "TI QC";
  if (/คลังสินค้า|คลัง|warehouse|\bwh\b/.test(norm)) return "TI WH";

  return raw; // map ไม่ได้ → คงค่าเดิม
}
