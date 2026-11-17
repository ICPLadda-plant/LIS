const mongoose = require('mongoose');

// รหัสตุ้มน้ำหนัก — ผูกกับขนาดตุ้ม (g) อย่างเดียว ใช้ร่วมกันทุกเครื่องชั่ง (ไม่เกี่ยวกับค่า Control)
const BalanceWeightCodeSchema = new mongoose.Schema({
  nominal: { type: Number, required: true, unique: true, index: true },
  weightCode: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('BalanceWeightCode', BalanceWeightCodeSchema);
