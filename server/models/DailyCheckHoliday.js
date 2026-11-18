const mongoose = require('mongoose');

// วันที่ไม่ได้ทำงานนอกเหนือจากวันอาทิตย์ — ใช้ระบายสีในรายงาน Daily check
const DailyCheckHolidaySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('DailyCheckHoliday', DailyCheckHolidaySchema);
