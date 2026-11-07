const mongoose = require('mongoose');

// ค่า Control (baseline) ของเครื่องชั่งแต่ละเครื่อง — ใช้วาด Control Chart
// ของ Daily check ตุ้ม 100 g เทียบกับ Mean ±2SD (UWL/LWL) และ ±3SD (UCL/LCL)
const BalanceControlConfigSchema = new mongoose.Schema({
  scaleId: {
    type: String,
    enum: ['scale-1', 'scale-2', 'scale-3', 'scale-4', 'scale-5'],
    required: true,
    unique: true,
    index: true,
  },
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  weightCode: { type: String, default: '' },   // รหัสตุ้มน้ำหนัก เช่น GL55-11006
  nominal: { type: Number, default: 100 },     // น้ำหนักตุ้ม Daily check (g)
  mean: { type: Number, required: true },
  sd: { type: Number, required: true },
  mpe: { type: Number, default: null },        // Maximum permissible error (g)
  updatedDate: { type: String, default: '' },  // YYYY-MM-DD วันที่ปรับปรุงค่า Control
}, { timestamps: true });

module.exports = mongoose.model('BalanceControlConfig', BalanceControlConfigSchema);
