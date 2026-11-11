const mongoose = require('mongoose');

// ตัวนับเลขที่ป้ายนำส่งตัวอย่าง แยกฝั่ง QC (P01, P02, ...) กับ LAB (L01, L02, ...) และเริ่มใหม่ทุกปี พ.ศ.
const SampleLabelCounterSchema = new mongoose.Schema(
  {
    side: { type: String, enum: ['qc', 'lab'], required: true },
    year: { type: Number, required: true }, // ปี พ.ศ. เต็ม เช่น 2569
    sequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);
SampleLabelCounterSchema.index({ side: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('SampleLabelCounter', SampleLabelCounterSchema);
