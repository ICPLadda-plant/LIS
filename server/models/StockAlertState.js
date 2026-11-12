const mongoose = require('mongoose');

// สถานะล่าสุดที่ระบบแจ้งเตือนสต็อกเห็น — ใช้หา "สถานะใหม่" (ใกล้หมด / หมด / ใกล้หมดอายุ / หมดอายุ)
// key: item:<type>:<id> (ระดับคงเหลือ) หรือ unit:<id> (อายุของขวด); '__baseline' = เคยสแกนแล้ว
const StockAlertStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  state: { type: String, default: 'ok' },
}, { timestamps: true });

module.exports = mongoose.model('StockAlertState', StockAlertStateSchema);
