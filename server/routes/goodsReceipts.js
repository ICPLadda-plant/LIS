const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const GoodsReceipt = require('../models/GoodsReceipt');
const Petition = require('../models/Petition');
const { nextDocumentNumber } = require('../lib/documentNumber');
const { validateGoodsReceiptInput, mapGoodsReceiptError } = require('../lib/goodsReceipt');
const { queryString } = require('../lib/queryValue');

function badRequest(res, message) {
  return res.status(400).json({ error: { message } });
}

// GET /api/goods-receipts?page=1&limit=20&petitionId=&petitionNo=
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const q = {};
    const petitionId = queryString(req.query.petitionId);
    const petitionNo = queryString(req.query.petitionNo);
    if (petitionId) q.petitionId = petitionId;
    if (petitionNo) q.petitionNo = petitionNo;
    const [items, total] = await Promise.all([
      GoodsReceipt.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      GoodsReceipt.countDocuments(q),
    ]);
    res.json({ items, total, page, limit });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/goods-receipts/:id
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = mongoose.Types.ObjectId.isValid(id)
      ? await GoodsReceipt.findById(id).lean()
      : await GoodsReceipt.findOne({ receiptNo: id }).lean();
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบใบรับสินค้า' } });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// POST /api/goods-receipts
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const invalid = validateGoodsReceiptInput(body);
    if (invalid) return badRequest(res, invalid);

    const petition = await Petition.findById(body.petitionId).lean();
    if (!petition) return badRequest(res, 'ไม่พบคำร้องอ้างอิง');
    if (petition.dept !== 'rm') return badRequest(res, 'ใบรับสินค้าใช้ได้เฉพาะคำขอของแผนก RM');

    // 1 petition มีได้ใบเดียว — กันกดส่งซ้ำแล้วได้ฟอร์มซ้อน
    const existing = await GoodsReceipt.findOne({ petitionId: body.petitionId }).lean();
    if (existing) return res.status(409).json({ error: { message: 'คำร้องนี้มีใบรับสินค้าอยู่แล้ว' } });

    const [receiptNo, inspectionNo] = await Promise.all([
      nextDocumentNumber('goodsReceipt', GoodsReceipt, 'receiptNo'),
      nextDocumentNumber('rawMaterialInspection', GoodsReceipt, 'inspectionNo'),
    ]);
    const doc = await GoodsReceipt.create({
      ...body,
      receiptNo,
      inspectionNo,
      petitionNo: petition.petitionNo,
    });
    res.status(201).json(doc);
  } catch (err) {
    const { status, message } = mapGoodsReceiptError(err);
    res.status(status).json({ error: { message } });
  }
});

// PATCH /api/goods-receipts/:id
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates._id;
    delete updates.receiptNo;
    delete updates.inspectionNo;
    delete updates.petitionId;
    delete updates.petitionNo;
    const doc = await GoodsReceipt.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบใบรับสินค้า' } });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// DELETE /api/goods-receipts/:id
router.delete('/:id', async (req, res) => {
  try {
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    const doc = await GoodsReceipt.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบใบรับสินค้า' } });
    await doc.softDelete(actor);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
