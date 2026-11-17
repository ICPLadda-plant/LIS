const test = require('node:test');
const assert = require('node:assert');
const { canManageDocument, canViewDocument, sanitizeDocumentInput } = require('./lisDocumentAccess');

const qc = { email: 'qc@x.com', roles: ['qc-staff'] };
const head = { email: 'head@x.com', roles: ['qc-head'] };
const admin = { email: 'a@x.com', roles: ['admin'] };

test('viewers ว่าง = ทุกคนเห็น แต่แก้ไม่ได้', () => {
  const doc = { createdBy: 'head@x.com', viewers: [], managers: [] };
  assert.equal(canViewDocument(qc, doc), true);
  assert.equal(canManageDocument(qc, doc), false);
});

test('จำกัดผู้เห็นตาม role', () => {
  const doc = { createdBy: 'other@x.com', viewers: ['lab-head'], managers: ['qc-head'] };
  assert.equal(canViewDocument(qc, doc), false);
  assert.equal(canViewDocument(head, doc), true); // ผู้จัดการเห็นเสมอ
  assert.equal(canManageDocument(head, doc), true);
  assert.equal(canManageDocument(admin, doc), true);
});

test('ผู้สร้างแก้เอกสารตัวเองได้ (ไม่สนตัวพิมพ์)', () => {
  assert.equal(canManageDocument(qc, { createdBy: 'QC@x.com', viewers: ['x'], managers: [] }), true);
});

test('sanitize ตรวจค่า enum และชื่อ', () => {
  assert.ok(sanitizeDocumentInput({ title: '' }).error);
  assert.ok(sanitizeDocumentInput({ title: 'a', paper: 'B5' }).error);
  assert.ok(sanitizeDocumentInput({ title: 'a', status: 'x' }).error);
  const { value } = sanitizeDocumentInput({ title: ' a ', viewers: ['qc', 'qc', ''], paper: 'Sticker' });
  assert.deepEqual(value.viewers, ['qc']);
  assert.equal(value.title, 'a');
  assert.equal(value.source, 'สร้างเอง');
  assert.deepEqual(sanitizeDocumentInput({ status: 'ใช้งาน' }, { partial: true }).value, { status: 'ใช้งาน' });
});
