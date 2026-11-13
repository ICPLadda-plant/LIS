# แจ้งเตือนตาม Role

กระดิ่งในเว็บและ PWA ใช้กฎผู้รับชุดเดียวกัน ผู้รับเลือกจาก role (รวม role พื้นฐานของตระกูล QC/Lab) และงานของตัวเอง แผนกไม่มีผล ส่วน LINE กลุ่มยังส่งตามกลุ่มที่ผูกไว้เหมือนเดิม ผู้ทำรายการเองไม่ได้รับแจ้งเตือนของตัวเอง

"งานของตัวเอง" ฝั่ง QC คือคนที่รับตัวอย่าง บันทึกผล หรือยืนยันผล QC ของคำขอนั้น (`petition.qcHandlers`) ฝั่ง Lab คือผู้รับงานที่ถูกมอบหมาย (`assignedTo`) และผู้ยื่นคือ `submittedBy`

| Role | ได้รับ |
|---|---|
| QC Staff, QC Data Config | คำขอใหม่ที่ต้องผ่าน QC · ส่งตัวอย่างแล้ว (มีเสียง) · QC รับตัวอย่าง · เริ่มบันทึกผล QC · งานตัวเอง: กายภาพผ่าน, ออก Final Report, ถูกแก้ไข, ถูก Re-check, ไม่อนุมัติ/ส่งกลับทดสอบใหม่ · งานด่วนที่ QC รับแล้วแต่ยังไม่บันทึกผล (ทุกต้นชั่วโมง) |
| QC Head | ทุกอย่างของ QC Staff · งานครบทุกส่วนรอออก Final Report · Pre Result พร้อมออก Final Report · ออก Final Report แล้ว |
| QC Approver | ทุกอย่างของ QC Staff · มีผลกายภาพใหม่รอยืนยัน |
| Lab Analyze, Lab Data Config | คำขอใหม่ที่มีงาน Lab · ตัวอย่างมาถึงฝั่ง Lab (มีเสียง) · งานที่ถูกมอบหมาย (มีเสียง) · งานตัวเอง: QC ยืนยัน ถพ., หัวหน้า Lab ออกผล, ถูกสั่ง Re-check และถูกมอบหมายต่อให้ใคร, QC ขอตัวอย่างเพิ่ม, ถูกแก้ไข · งานด่วนที่ Lab ยังไม่บันทึกผล · Daily Check |
| Lab Head | ทุกอย่างของ Lab Analyze · ผล Lab รออนุมัติ · งานพร้อมให้ Lab แต่ยังไม่มีผู้รับงาน |
| Lab Inventory | ทุกอย่างของ Lab Analyze · สารใกล้หมด / สารหมด / ใกล้หมดอายุ (30 วัน) / หมดอายุ เฉพาะสถานะใหม่ |
| Viewer และ role อื่น | คำขอที่ตัวเองยื่น: รับตัวอย่างแล้ว, ถูกส่งกลับ, ขอตัวอย่างเพิ่ม, Re-check, ค่า ถพ., %AI, กายภาพผ่าน, ออก Final Report |
| Administrator | ทุกอย่างของ viewer · แจ้งเตือนระบบ 401 / 403 / 5xx (รวมซ้ำทุก 10 นาที) · เปิด "ดูแจ้งเตือนทั้งระบบ" ได้ทุก role ทั้งกระดิ่งและ PWA |

## โค้ดที่เกี่ยวข้อง

- `server/lib/petitionNotifications.js` — กฎของเหตุการณ์คำขอ (audit log → ผู้รับ)
- `server/lib/appNotifications.js`, `server/models/AppNotification.js` — แจ้งเตือนที่ไม่ผูกกับคำขอ
- `server/lib/stockAlerts.js` — สแกนสต็อก (หลังเบิก/รับ และทุก 5 นาที) รอบแรกจำสถานะไว้โดยไม่แจ้ง
- `server/lib/systemAlerts.js` — แจ้ง admin เมื่อ API ตอบ 401 / 403 / 5xx
- `server/lib/notificationScheduler.js` — PWA งานด่วนรายชั่วโมงและ Daily Check
- `server/routes/notifications.js` — ฟีดกระดิ่ง `GET /api/notifications`
- `src/components/lis/PetitionFlowWatcher.tsx`, `UrgentPetitionReminder.tsx`, `DailyCheckReminderWatcher.tsx`, `AdminSystemWatcher.tsx` — ฝั่งหน้าเว็บ
