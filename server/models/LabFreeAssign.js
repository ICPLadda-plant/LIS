const mongoose = require('mongoose');

// โหมด "มอบหมายอิสระ" ของบอร์ด Assign Lab — หัวหน้า Lab เปิดไว้จนถึงเวลา freeUntil
// ระหว่างนั้นเจ้าหน้าที่ Lab กดรับงานที่ยังไม่มีผู้รับเองได้ (เก็บเป็น doc เดียว key = 'lab')
const LabFreeAssignSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'lab' },
  freeUntil: { type: Date, default: null },
  setBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('LabFreeAssign', LabFreeAssignSchema);
