const mongoose = require('mongoose');

// หนึ่งแถว = หนึ่งเบราว์เซอร์/เครื่องที่เปิดรับแจ้งเตือน PWA (Web Push)
// เก็บ snapshot ของ roles/department/employeeId ไว้ด้วย เพราะผู้ใช้ dev mode ไม่มีแถวใน User
const PushSubscriptionSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  deviceLabel: { type: String, default: 'อุปกรณ์ไม่ทราบชื่อ' },
  userAgent: { type: String, default: '' },
  roles: { type: [String], default: [] },
  department: { type: String, default: '' },
  employeeId: { type: String, default: '' },
  name: { type: String, default: '' },
  paused: { type: Boolean, default: false },
  // admin เปิด "ดูแจ้งเตือนทั้งระบบ" ในกระดิ่ง → PWA ได้รับทุก role ด้วย (role อื่นไม่มีผล)
  seeAll: { type: Boolean, default: false },
  lastSuccessAt: Date,
  lastErrorAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);
