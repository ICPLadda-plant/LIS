const express = require('express');
const router = express.Router();
const LisDocument = require('../models/LisDocument');
const Role = require('../models/Role');
const { requireAuthenticatedUser } = require('../lib/adminGate');
const { canManageDocument, canViewDocument, sanitizeDocumentInput } = require('../lib/lisDocumentAccess');

router.use(requireAuthenticatedUser);

const actorOf = (req) => req.authenticatedUser?.email || 'dev';
const summary = (d, user) => {
  const { html, ...rest } = d;
  return { ...rest, id: String(d._id), canEdit: canManageDocument(user, d), hasContent: !!html };
};

// GET /api/documents — เฉพาะเอกสารที่ผู้ใช้มีสิทธิ์เห็น (ไม่ส่ง html เพื่อให้ list เบา)
// ?templateFor=CODE&active=1 → แม่แบบที่สถานะ "ใช้งาน" ของฟอร์มนั้น (ส่ง html มาด้วย ใช้ตอนพิมพ์)
router.get('/', async (req, res) => {
  try {
    const user = req.authenticatedUser || null;
    const query = req.query || {};
    if (query.templateFor) {
      const filter = { templateFor: String(query.templateFor) };
      if (query.active) filter.status = 'ใช้งาน';
      const list = await LisDocument.find(filter).sort({ updatedAt: -1 }).lean();
      const visible = list.filter((d) => canViewDocument(user, d));
      return res.json({ data: visible.map((d) => ({ ...summary(d, user), html: d.html })) });
    }
    const docs = await LisDocument.find().sort({ updatedAt: -1 }).lean();
    res.json({ data: docs.filter((d) => canViewDocument(user, d)).map((d) => summary(d, user)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/roles — role จริงจาก Access Control สำหรับเลือกผู้เห็น/ผู้จัดการ
router.get('/roles', async (_req, res) => {
  try {
    const roles = await Role.find().sort({ locked: -1, name: 1 }).lean();
    res.json({ data: roles.map((r) => ({ id: r.id, name: r.name })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = req.authenticatedUser || null;
    const doc = await LisDocument.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
    if (!canViewDocument(user, doc)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูเอกสารนี้' });
    res.json({ data: { ...summary(doc, user), html: doc.html } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = sanitizeDocumentInput(req.body || {});
    if (error) return res.status(400).json({ error });
    const actor = actorOf(req);
    const doc = await LisDocument.create({ ...value, createdBy: actor, updatedBy: actor });
    const lean = doc.toObject();
    res.status(201).json({ data: { ...summary(lean, req.authenticatedUser || null), html: lean.html } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const user = req.authenticatedUser || null;
    const doc = await LisDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
    if (!canManageDocument(user, doc)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขเอกสารนี้' });
    const { error, value } = sanitizeDocumentInput(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ error });
    Object.assign(doc, value, { updatedBy: actorOf(req) });
    await doc.save();
    const lean = doc.toObject();
    res.json({ data: { ...summary(lean, user), html: lean.html } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await LisDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
    if (!canManageDocument(req.authenticatedUser || null, doc)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบเอกสารนี้' });
    await doc.softDelete(actorOf(req));
    res.json({ data: { id: req.params.id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
