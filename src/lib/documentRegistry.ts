// ทะเบียนเอกสารกลางของ LIS: เอกสารที่ระบบพิมพ์อยู่แล้ว (แก้ใน code) + ตัวเลือกข้อมูลกำกับสำหรับเอกสารที่สร้าง/นำเข้า
export type PaperSize = "A4 แนวตั้ง" | "A4 แนวนอน" | "A5 แนวตั้ง" | "Letter" | "Sticker";
export const PAPER_SIZES: PaperSize[] = ["A4 แนวตั้ง", "A4 แนวนอน", "A5 แนวตั้ง", "Letter", "Sticker"];
// ขนาดหน้ากระดาษจริง (mm) สำหรับ editor
export const PAPER_MM: Record<PaperSize, { w: number; h: number; pad: number }> = {
  "A4 แนวตั้ง": { w: 210, h: 297, pad: 25.4 },
  "A4 แนวนอน": { w: 297, h: 210, pad: 20 },
  "A5 แนวตั้ง": { w: 148, h: 210, pad: 15 },
  Letter: { w: 216, h: 279, pad: 25.4 },
  Sticker: { w: 100, h: 75, pad: 5 },
};

export type DocStatus = "ร่าง" | "รออนุมัติ" | "ใช้งาน" | "ยกเลิก";
export const DOC_STATUSES: DocStatus[] = ["ร่าง", "รออนุมัติ", "ใช้งาน", "ยกเลิก"];
export const DOC_STATUS_VARIANT: Record<DocStatus, "gray-soft" | "yellow-soft" | "green-soft" | "red-soft"> = {
  ร่าง: "gray-soft", รออนุมัติ: "yellow-soft", ใช้งาน: "green-soft", ยกเลิก: "red-soft",
};

export const DOC_ROLES = ["ผู้ดูแลระบบ", "ผู้ขอทดสอบ (ฝ่ายผลิต)", "คลังสินค้า", "QC", "QC Head", "Lab", "Lab Head", "ผู้บริหาร"];

// ขั้นตอนงานที่ใช้พิมพ์เอกสาร (เรียงตาม flow คำร้อง)
export const PRINT_STAGES = [
  "สร้างคำร้อง / ส่งตัวอย่าง",
  "รับสินค้า / ตรวจวัตถุดิบ",
  "รับตัวอย่าง",
  "ระหว่างทดสอบ",
  "ทดสอบเสร็จ / รายงานผล",
  "อนุมัติผลแล้ว / ออก COA",
  "ตรวจเช็กประจำวัน",
  "Validation",
  "จัดการ Stock",
  "พิมพ์ตามต้องการ",
];

export type SystemDoc = {
  code: string; rev: string; name: string; paper: PaperSize;
  stage: string; status: string; viewers: string[]; managers: string[];
  page: string; pageLabel: string;
};

export const SYSTEM_DOCS: SystemDoc[] = [
  { code: "FM-QP-07-01-001", rev: "R02 (16/12/67)", name: "ใบคำร้องขอรับบริการ แผ่นที่ 1", paper: "A4 แนวตั้ง",
    stage: "สร้างคำร้อง / ส่งตัวอย่าง", status: "ตั้งแต่ กำลังส่งตัวอย่าง", viewers: ["ผู้ขอทดสอบ (ฝ่ายผลิต)", "QC", "Lab"], managers: ["QC Head", "Lab Head"],
    page: "/petition", pageLabel: "รายการคำร้อง > รายละเอียด > พิมพ์" },
  { code: "FM-QP-07-04-001", rev: "R01 (30/05/68)", name: "ใบคำขอรับบริการ", paper: "A4 แนวตั้ง",
    stage: "สร้างคำร้อง / ส่งตัวอย่าง", status: "ตั้งแต่ กำลังส่งตัวอย่าง", viewers: ["ผู้ขอทดสอบ (ฝ่ายผลิต)", "QC", "Lab"], managers: ["QC Head", "Lab Head"],
    page: "/petition", pageLabel: "รายการคำร้อง > รายละเอียด > พิมพ์" },
  { code: "F-LAB-01-12", rev: "Rev 00 (02/11/69)", name: "ป้ายนำส่งตัวอย่าง (ปกติ / ปศุสัตว์)", paper: "Sticker",
    stage: "สร้างคำร้อง / ส่งตัวอย่าง", status: "กำลังส่งตัวอย่าง", viewers: ["ผู้ขอทดสอบ (ฝ่ายผลิต)", "QC", "Lab"], managers: ["QC Head"],
    page: "/petition", pageLabel: "รายการคำร้อง > พิมพ์ป้าย" },
  { code: "F-LAB-01-10", rev: "Rev 02 (11/07/69)", name: "ป้ายนำส่งตัวอย่าง มีสัญลักษณ์อันตราย (สินค้า อย.)", paper: "Sticker",
    stage: "สร้างคำร้อง / ส่งตัวอย่าง", status: "กำลังส่งตัวอย่าง", viewers: ["ผู้ขอทดสอบ (ฝ่ายผลิต)", "QC", "Lab"], managers: ["QC Head"],
    page: "/petition", pageLabel: "รายการคำร้อง > พิมพ์ป้าย" },
  { code: "-", rev: "-", name: "ใบนำส่งตัวอย่างเพิ่ม", paper: "A4 แนวตั้ง",
    stage: "ระหว่างทดสอบ", status: "กำลังดำเนินการ", viewers: ["ผู้ขอทดสอบ (ฝ่ายผลิต)", "QC", "Lab"], managers: ["QC Head", "Lab Head"],
    page: "/petition", pageLabel: "รายละเอียดคำร้อง > ขอตัวอย่างเพิ่ม" },
  { code: "F-WAR-03-01", rev: "Rev 03 (01/09/60)", name: "ใบรับสินค้า", paper: "A4 แนวตั้ง",
    stage: "รับสินค้า / ตรวจวัตถุดิบ", status: "รับสินค้าแล้ว", viewers: ["คลังสินค้า", "QC"], managers: ["คลังสินค้า", "QC Head"],
    page: "/petition", pageLabel: "คำร้อง RM > ไทม์ไลน์ > พิมพ์" },
  { code: "F-WAR-03-02", rev: "Rev 03 (01/09/60)", name: "ใบตรวจสอบวัตถุดิบ", paper: "A4 แนวตั้ง",
    stage: "รับสินค้า / ตรวจวัตถุดิบ", status: "รับสินค้าแล้ว", viewers: ["คลังสินค้า", "QC"], managers: ["QC Head"],
    page: "/petition", pageLabel: "คำร้อง RM > ไทม์ไลน์ > พิมพ์" },
  { code: "FM-QP-07-08-002", rev: "R02", name: "ใบคำนวณผลวิเคราะห์", paper: "A4 แนวนอน",
    stage: "ระหว่างทดสอบ", status: "กำลังดำเนินการ", viewers: ["Lab", "Lab Head"], managers: ["Lab Head"],
    page: "/lab-testing", pageLabel: "การทดสอบ Lab > รายละเอียด" },
  { code: "F-CHM-01-01", rev: "Rev 04 (24/03/65)", name: "รายงานผลการวิเคราะห์ (ใบละ 7 ตัวอย่าง)", paper: "A4 แนวตั้ง",
    stage: "ทดสอบเสร็จ / รายงานผล", status: "ทดสอบเสร็จสิ้น", viewers: ["QC", "QC Head", "ผู้ขอทดสอบ (ฝ่ายผลิต)"], managers: ["QC Head"],
    page: "/qc-approval", pageLabel: "อนุมัติผล QC > รายละเอียด" },
  { code: "F-CHM-01-03", rev: "Rev 00 (16/01/69)", name: "รายงานผลการทดสอบ (Lab)", paper: "A4 แนวตั้ง",
    stage: "ทดสอบเสร็จ / รายงานผล", status: "ทดสอบเสร็จสิ้น", viewers: ["Lab", "Lab Head", "ผู้ขอทดสอบ (ฝ่ายผลิต)"], managers: ["Lab Head"],
    page: "/lab-results", pageLabel: "ผลวิเคราะห์ Lab > รายละเอียด" },
  { code: "COA", rev: "-", name: "ใบรับรองผลการวิเคราะห์ (Certificate of Analysis)", paper: "A4 แนวตั้ง",
    stage: "อนุมัติผลแล้ว / ออก COA", status: "เสร็จสิ้น (อนุมัติแล้ว)", viewers: ["QC", "QC Head", "ผู้บริหาร", "ผู้ขอทดสอบ (ฝ่ายผลิต)"], managers: ["QC Head"],
    page: "/coa", pageLabel: "ออกเอกสาร COA" },
  { code: "FM-WI-06-04-001", rev: "R00", name: "บันทึก Daily check เครื่องชั่ง", paper: "A4 แนวตั้ง",
    stage: "ตรวจเช็กประจำวัน", status: "บันทึกประจำวันแล้ว", viewers: ["QC", "Lab"], managers: ["QC Head", "Lab Head"],
    page: "/daily-check", pageLabel: "Daily Check > ห้องเครื่องชั่ง" },
  { code: "-", rev: "-", name: "บันทึกการเช็กเครื่องมือประจำวัน", paper: "A4 แนวตั้ง",
    stage: "ตรวจเช็กประจำวัน", status: "บันทึกประจำวันแล้ว", viewers: ["QC", "Lab"], managers: ["QC Head", "Lab Head"],
    page: "/daily-check", pageLabel: "Daily Check > บันทึก" },
  { code: "-", rev: "-", name: "ใบเตรียมสาร / รายงาน Validation", paper: "A4 แนวตั้ง",
    stage: "Validation", status: "ระหว่าง Validation", viewers: ["QC", "Lab"], managers: ["QC Head", "Lab Head"],
    page: "/validation", pageLabel: "Validation" },
  { code: "-", rev: "-", name: "ป้ายสาร Standard / สารเคมี", paper: "Sticker",
    stage: "จัดการ Stock", status: "รับเข้า Stock", viewers: ["QC", "Lab"], managers: ["QC Head", "Lab Head"],
    page: "/stock", pageLabel: "Stock Management" },
];
