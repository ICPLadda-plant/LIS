const mongoose = require('mongoose');

// ค่า Control (baseline) ของเครื่องชั่งแต่ละเครื่อง — ใช้วาด Control Chart
// ของ Daily check ตามตุ้มน้ำหนักที่กำหนดต่อเครื่อง เทียบกับ Mean ±2SD และ ±3SD
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
  mean: { type: Number, default: null },
  sd: { type: Number, default: null },
  baselineValues: { type: [Number], default: [] },
  mpe: { type: Number, default: null },        // Maximum permissible error (g)
  updatedDate: { type: String, default: '' },  // YYYY-MM-DD วันที่ปรับปรุงค่า Control
  controls: { type: mongoose.Schema.Types.Mixed, default: {} }, // ค่า Control แยกตามน้ำหนักตุ้ม
}, { timestamps: true });

module.exports = mongoose.model('BalanceControlConfig', BalanceControlConfigSchema);
