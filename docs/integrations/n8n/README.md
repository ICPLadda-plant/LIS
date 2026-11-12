# ส่งข้อมูลคำขอจากระบบผลิตผ่าน n8n ไป LIS

Workflow นี้ใช้ API ที่มีอยู่แล้ว: `POST /LIS/api/production-integration/petitions`
เก็บข้อมูลชั่วคราวประมาณ 2 วัน แล้วคืนลิงก์เปิดฟอร์มตรวจสอบ **ยังไม่สร้างหรือส่งใบคำขอจริง**
ต้องให้ผู้ใช้เปิดฟอร์มและกดส่งตามขั้นตอน LIS

## ตั้งค่า

1. ใน n8n เลือก Import from File แล้วเลือก `production-petition.workflow.json`
2. สร้าง Header Auth credential สำหรับระบบผลิต → n8n: Name `X-Production-Webhook-Key`, Value เป็น secret ที่กำหนดเอง แล้วเลือกใน node `Receive production request`
3. ใน LIS หน้า Settings → API Key สร้าง key ที่มี scope `integration:write` และอนุญาต IP ขาออกของ n8n หากตั้ง IP allowlist
4. สร้าง Header Auth credential อีกชุดสำหรับ n8n → LIS: Name `X-API-Key`, Value เป็น key จาก LIS แล้วเลือกใน node `POST to LIS` อย่าใช้ secret ชุดเดียวกับ webhook
5. ตรวจ URL ของ `POST to LIS` และค่า `origin` ใน `Prepare short links` ให้ตรงกับ host จริง ค่าเริ่มต้นคือ `https://app-plant.icpladda.com` และ public base path `/LIS` หากใช้ local ให้แก้ทั้งสองตำแหน่ง เช่น `http://localhost` โดยต้องเข้าถึงได้จากเครื่อง n8n
6. กด Listen for test event แล้วใช้ Test URL ทดสอบ เมื่อผ่านจึง Publish/Activate ตามรุ่น n8n และใช้ Production URL ที่ node แสดง

Workflow ที่ส่งมาปิดใช้งานอยู่และไม่มี secret ฝังไว้ ต้องเลือก credentials ก่อนใช้งานจริง
ต้องเรียกจาก backend ระบบผลิตเพื่อเก็บ secret ฝั่ง server

## ข้อมูลที่ส่งเข้า webhook

ส่ง `Content-Type: application/json` และ `X-Production-Webhook-Key` ใน header
ใช้ body ตาม `production-petition.example.json` แล้วแทนค่าจริง สามารถเพิ่ม `samples` ได้หลายรายการ โดยปรับ `sampleCount` ให้ตรง
อย่า URL-encode ค่า JSON เช่นชื่อสารหรือภาษาไทย และอย่าครอบข้อมูลเพิ่มด้วย `{ "body": ... }`

หากระบบผลิตมี query string เดิมอยู่แล้ว ใช้ body `{ "query": "requestNo=...&samples%5B0%5D%5BsampleName%5D=..." }` ได้
โดยส่งเฉพาะ query ของหน้าแบบฟอร์ม LIS ไม่ส่ง URL ของ `lis_sso.php` หรือ `ret=` ทั้งก้อน และไม่ encode query ทั้งก้อนซ้ำ
วิธีนี้รักษาช่องว่างของแต่ละตัวอย่างตามข้อมูลเดิมได้ด้วย

ตัวอย่างเรียกด้วย curl (แทนค่าตัวแปรด้วยค่าจาก server หรือ secret manager):

```sh
curl --request POST "$N8N_WEBHOOK_URL" \
  --header 'Content-Type: application/json' \
  --header "X-Production-Webhook-Key: $PRODUCTION_WEBHOOK_SECRET" \
  --data-binary @production-petition.example.json
```

## ผลลัพธ์และการใช้งานฝั่งระบบผลิต

สำเร็จจะได้ HTTP 201, `ok: true`, `redirectUrl`, `ssoUrl`, `expiresInSeconds: 172800`, `submitted: false`
ให้ปุ่มเดิมเปิด `ssoUrl` ที่คืนมาเพื่อคงทางเข้า SSO เดิม หรือใช้ `redirectUrl` สำหรับเปิดฟอร์ม LIS โดยตรง
Workflow ประกอบ public path `/LIS` เอง เพราะ Apache อาจตัด prefix นี้ก่อน proxy ไป Express ทำให้ `redirectUrl` จาก API ไม่มี prefix
ควรถือว่าลิงก์ที่มี integration token เป็นข้อมูลส่วนตัว ไม่เผยแพร่ในช่องทางสาธารณะ

หาก LIS ตอบ 401/403/429/5xx จะคืนสถานะผิดพลาดตามนั้น หากเชื่อมต่อไม่ได้หรือผลลัพธ์ไม่ถูกต้องจะคืน 502
ตรวจ credentials, scope, IP allowlist และเครือข่ายก่อนเรียกใหม่ โดยไม่ส่งข้อมูลคำขอทั้งหมดผ่าน URL อีก
ไม่ได้เปิด automatic retry เพราะ API ปัจจุบันสร้าง token ใหม่ทุกครั้งและยังไม่มี idempotency
ระบบผลิตควรป้องกันการกดซ้ำและบันทึกลิงก์ที่ได้รับไว้ใช้งานต่อ

Workflow ปิดการเก็บ execution สำเร็จ/ผิดพลาดและ manual execution โดยค่าเริ่มต้น หากเปิดเพื่อวิเคราะห์ปัญหาให้คำนึงว่ามีข้อมูลคำขอและลิงก์ส่วนตัว

## ตรวจสอบก่อนเปิดใช้งาน

- ส่งข้อมูลทดสอบแล้วต้องได้ 201 และลิงก์สั้นที่มีเฉพาะ integrationToken
- เปิด ssoUrl แล้วตรวจข้อมูลตัวอย่างทั้ง 6 รายการ จำนวน ฝั่ง QC/Lab ภาษาไทย และช่องว่างให้ตรงกับต้นทาง ก่อนกดส่งจริง
- ทดสอบ key ผิด ต้องไม่ได้ผลลัพธ์สำเร็จ และไม่มีการส่งใบคำขอจริง
- ตรวจลิงก์บน local และ production `/LIS` หากเปลี่ยน host หรือ base path
- ไฟล์นี้ตรวจโครงสร้างและจำลองผลลัพธ์แล้ว แต่ยังไม่ได้ import/run ใน n8n จริงหรือส่งข้อมูลเข้า production

อ้างอิงเอกสาร n8n: [Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), [Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/)
