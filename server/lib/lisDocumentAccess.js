// สิทธิ์เอกสารใน "จัดการเอกสาร" (pure — ทดสอบได้โดยไม่ต้องมี DB)
// - viewers ว่าง = ทุกคนที่ login เห็น
// - แก้ไข/ลบ: admin, ผู้สร้าง, หรือ role ที่อยู่ใน managers
// - ผู้จัดการเห็นเอกสารเสมอแม้ไม่อยู่ใน viewers
const { normalizeRoles } = require('./roles');

const PAPER_SIZES = ['A4 แนวตั้ง', 'A4 แนวนอน', 'A5 แนวตั้ง', 'Letter', 'Sticker'];
const DOC_STATUSES = ['ร่าง', 'รออนุมัติ', 'ใช้งาน', 'ยกเลิก'];
const SOURCES = ['สร้างเอง', 'นำเข้า Word'];
const MAX_HTML = 8 * 1024 * 1024;

const lower = (s) => String(s || '').trim().toLowerCase();
const intersects = (a = [], b = []) => a.some((x) => b.includes(x));

// user = null หมายถึง dev bypass (requireAuthenticatedUser ปล่อยผ่านโดยไม่มี user)
function canManageDocument(user, doc) {
  if (!user) return true;
  const roles = normalizeRoles(user);
  if (roles.includes('admin')) return true;
  if (doc.createdBy && lower(doc.createdBy) === lower(user.email)) return true;
  return intersects(doc.managers, roles);
}

function canViewDocument(user, doc) {
  if (canManageDocument(user, doc)) return true;
  if (!doc.viewers || doc.viewers.length === 0) return true;
  return intersects(doc.viewers, normalizeRoles(user));
}

const strList = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, 50) : []);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

// คืน { error } หรือ { value } ที่ทำความสะอาดแล้ว; partial=true สำหรับ PUT
function sanitizeDocumentInput(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('title')) {
    out.title = str(body.title, 200);
    if (!out.title) return { error: 'กรุณาระบุชื่อเอกสาร' };
  }
  if (has('html')) {
    if (typeof body.html !== 'string') return { error: 'เนื้อหาเอกสารไม่ถูกต้อง' };
    if (body.html.length > MAX_HTML) return { error: 'เอกสารใหญ่เกินไป (สูงสุด 8MB)' };
    out.html = body.html;
  }
  if (has('source') || !partial) {
    out.source = SOURCES.includes(body.source) ? body.source : 'สร้างเอง';
  }
  for (const k of ['code', 'rev', 'stage', 'printWhen', 'templateFor']) if (has(k)) out[k] = str(body[k]);
  if (has('status')) {
    if (!DOC_STATUSES.includes(body.status)) return { error: 'สถานะเอกสารไม่ถูกต้อง' };
    out.status = body.status;
  }
  if (has('paper')) {
    if (!PAPER_SIZES.includes(body.paper)) return { error: 'ขนาดกระดาษไม่ถูกต้อง' };
    out.paper = body.paper;
  }
  if (has('viewers')) out.viewers = strList(body.viewers);
  if (has('managers')) out.managers = strList(body.managers);
  return { value: out };
}

module.exports = { canManageDocument, canViewDocument, sanitizeDocumentInput, PAPER_SIZES, DOC_STATUSES };
