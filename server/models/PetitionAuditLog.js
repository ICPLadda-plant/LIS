const mongoose = require('mongoose');

const PetitionAuditLogSchema = new mongoose.Schema(
  {
    petitionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Petition',
      required: true,
      index: true,
    },
    petitionNo: { type: String, required: true, index: true },
    event: {
      type: String,
      enum: [
        'created', 'statusChanged', 'assigned', 'reviewed', 'updated', 'deleted',
        'received',        // Lab/QC สแกนรับตัวอย่าง
        'accepted',        // เจ้าหน้าที่ Lab กดรับงานที่หัวหน้า assign
        'unassigned',      // หัวหน้า Lab ดึงงานที่ยังไม่เริ่มกลับไปรอมอบหมาย
        'resultEntered',   // QC ใส่ค่าพารามิเตอร์ครั้งแรก
        'resultUpdated',   // QC แก้ค่าพารามิเตอร์
        'recheck',         // ผู้ใช้งานขอให้ QC Head และผู้ส่งคำขอตรวจสอบซ้ำ
        'labResultEdited', // แก้ไขผล Lab หลังบันทึก (เริ่ม/บันทึก/ยกเลิก) พร้อมเหตุผล
        'labResultCleared', // ล้างค่าผล Lab หลังบันทึก พร้อมเหตุผล
      ],
      required: true,
    },
    fromStatus: { type: String },
    toStatus: { type: String },
    actor: { type: String, default: 'system' },
    note: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

PetitionAuditLogSchema.index({ petitionId: 1, createdAt: -1 });
PetitionAuditLogSchema.index({ createdAt: -1 });
PetitionAuditLogSchema.index({ event: 1, createdAt: -1 });
PetitionAuditLogSchema.index({ toStatus: 1, createdAt: -1 });

module.exports = mongoose.model('PetitionAuditLog', PetitionAuditLogSchema);
