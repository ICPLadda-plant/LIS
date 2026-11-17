const express = require('express');
const { getLisSessionUserId } = require('../lib/lisSessionCookie');
const { validateInput, runValidationAi } = require('../lib/validationAi');
const router = express.Router();
// Bound concurrent provider calls and per-session bursts without storing documents.
const windows = new Map();
let inFlight = 0;
router.post('/', async (req, res) => {
  const devLocal = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_STATUS === 'true' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  const userId = getLisSessionUserId(req) || (devLocal ? 'local-development' : null);
  if (!userId) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ LIS ก่อนใช้ AI' });
  let input;
  try { input = validateInput(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  const configured = input.image ? Boolean(process.env.OCR_API_KEY && process.env.OCR_MODEL) : Boolean(process.env.OPENAI_API_KEY);
  if (!configured) return res.status(503).json({ error: 'AI ยังไม่ได้ตั้งค่าใน server' });
  const now = Date.now();
  for (const [key, value] of windows) if (now - value.start >= 60000) windows.delete(key);
  const window = windows.get(userId) || { start: now, count: 0 };
  if (window.count >= 6 || inFlight >= 3) return res.status(429).json({ error: 'มีคำขอ AI มาก กรุณารอสักครู่' });
  window.count++; windows.set(userId, window); inFlight++;
  try { return res.json(await runValidationAi(input)); }
  catch { return res.status(502).json({ error: 'AI อ่านข้อมูลไม่สำเร็จหรือหมดเวลา กรุณาลองใหม่ ตรวจโควตา หรือกรอกข้อมูลเอง' }); }
  finally { inFlight--; }
});
module.exports = router;
