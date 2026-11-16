const mongoose = require('mongoose');
const { softDeletePlugin } = require('../lib/softDelete');
const { PAPER_SIZES, DOC_STATUSES } = require('../lib/lisDocumentAccess');

// เอกสารที่ผู้ใช้สร้าง/นำเข้า Word ในหน้า "จัดการเอกสาร" (/documents)
const LisDocumentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  html: { type: String, default: '' },
  source: { type: String, enum: ['สร้างเอง', 'นำเข้า Word'], default: 'สร้างเอง' },
  code: { type: String, default: '' },
  rev: { type: String, default: '' },
  status: { type: String, enum: DOC_STATUSES, default: 'ร่าง' },
  paper: { type: String, enum: PAPER_SIZES, default: 'A4 แนวตั้ง' },
  stage: { type: String, default: 'พิมพ์ตามต้องการ' },
  printWhen: { type: String, default: '' },
  // รหัสฟอร์มระบบที่เอกสารนี้เป็นแม่แบบแทน (เช่น FM-QP-07-04-001); ว่าง = เอกสารทั่วไป
  templateFor: { type: String, default: '', index: true },
  viewers: { type: [String], default: [] }, // role ids; ว่าง = ทุกคน
  managers: { type: [String], default: [] }, // role ids
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

LisDocumentSchema.plugin(softDeletePlugin);
module.exports = mongoose.model('LisDocument', LisDocumentSchema);
