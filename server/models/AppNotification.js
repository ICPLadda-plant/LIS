const mongoose = require('mongoose');

// แจ้งเตือนที่ไม่ได้มาจาก audit log ของคำขอ เช่น สต็อก, ระบบ (401/403/5xx), งานด่วนรายชั่วโมง, Daily Check
// key กันซ้ำ: เหตุการณ์เดียวกันสร้างได้ครั้งเดียว (เกิดซ้ำจะเพิ่ม count)
// pushOnly = ส่งเฉพาะ PWA เพราะกระดิ่งในเว็บสร้างรายการเองอยู่แล้ว (งานด่วน / Daily Check)
const PersonSchema = new mongoose.Schema({
  employeeId: { type: String, default: '' },
  email: { type: String, default: '' },
  name: { type: String, default: '' },
}, { _id: false });

const AppNotificationSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['stock', 'system', 'urgent', 'dailyCheck'], required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  level: { type: String, enum: ['info', 'warning', 'success', 'error'], default: 'info' },
  link: { type: String, default: '' },
  recipientRoles: { type: [String], default: [] },
  recipientPeople: { type: [PersonSchema], default: [] },
  pushOnly: { type: Boolean, default: false },
  count: { type: Number, default: 1 },
  lastAt: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });

AppNotificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AppNotification', AppNotificationSchema);
