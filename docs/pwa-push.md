# แจ้งเตือน PWA (Web Push)

ผู้ใช้เปิดรับแจ้งเตือนได้ที่ **ตั้งค่าโปรไฟล์ → แจ้งเตือนบนเบราว์เซอร์** ระบบจะเตือนแม้ปิดเบราว์เซอร์อยู่ สำหรับเหตุการณ์เดียวกับที่กระดิ่งเล่นเสียง คือ ตัวอย่างมาถึง QC/Lab และงาน Lab ใหม่ที่ถูกมอบหมายให้ผู้ใช้

## ตั้งค่า server (ทำครั้งเดียวต่อ environment)

1. สร้าง VAPID key ในโฟลเดอร์ `server/`

   ```bash
   node -e "console.log(require('web-push').generateVAPIDKeys())"
   ```

2. ใส่ค่าใน `server/.env` (ห้าม commit)

   ```env
   VAPID_PUBLIC_KEY=<publicKey>
   VAPID_PRIVATE_KEY=<privateKey>
   VAPID_SUBJECT=mailto:lis@icpladda.com
   ```

3. รีสตาร์ต server ถ้าไม่ได้ตั้งค่า หน้าตั้งค่าจะแสดงว่า "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน PWA" และระบบจะไม่ส่ง push

ห้ามเปลี่ยน key หลังเปิดใช้งานแล้ว เพราะเครื่องที่สมัครไว้ทั้งหมดจะรับแจ้งเตือนไม่ได้จนกว่าผู้ใช้จะปิดแล้วเปิดสวิตช์ใหม่

## ข้อจำกัด

- เว็บต้องเปิดผ่าน HTTPS (หรือ `localhost`)
- iPhone / iPad (iOS 16.4 ขึ้นไป) ต้องเพิ่ม LIS ลงหน้าจอโฮมแล้วเปิดจากไอคอนนั้นก่อน
- ปุ่ม "ส่งทดสอบ" ส่งไปทุกเครื่องของผู้ใช้ที่กด แม้จะพักการแจ้งเตือนไว้
- "พักการแจ้งเตือนทุกเครื่อง" หยุดเฉพาะแจ้งเตือนงานจริง เครื่องยังอยู่ในรายการ

## โค้ดที่เกี่ยวข้อง

- `server/routes/push.js` — API `/api/push/*` (devices, subscribe, unsubscribe, pause, test)
- `server/lib/webPush.js` — ส่ง push และเลือกผู้รับจากเหตุการณ์ (เรียกจาก `lineNotify.notifyPetitionEvent`)
- `server/lib/pushAudience.js` — พอร์ตของ `src/lib/petitionAudience.ts` ต้องแก้คู่กัน
- `public/sw.js` — รับ push และเปิดหน้าคำขอเมื่อกดแจ้งเตือน
- `src/components/lis/PwaPushSettings.tsx`, `src/lib/pwaPush.ts` — หน้าตั้งค่าฝั่งผู้ใช้
