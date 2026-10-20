const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const LabRequest = require('../models/LabRequest');
const Petition = require('../models/Petition');
const { requiresDeliveryAndBatch } = require('../lib/petitionSubmissionRules');

// Generate next lab-request number from DocumentNumberConfig (default: L-YYMM-####).
const { nextDocumentNumber } = require('../lib/documentNumber');
const { queryString } = require('../lib/queryValue');
function nextLabRequestNo() {
  return nextDocumentNumber('labRequest', LabRequest, 'labRequestNo');
}

function badRequest(res, message) {
  return res.status(400).json({ error: { message } });
}

// GET /api/lab-requests?page=1&limit=20&petitionId=&batchNo=
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const q = {};
    const petitionId = queryString(req.query.petitionId);
    const petitionNo = queryString(req.query.petitionNo);
    const batchNo = queryString(req.query.batchNo);
    if (petitionId) q.petitionId = petitionId;
    if (petitionNo) q.petitionNo = petitionNo;
    if (batchNo) q.batchNo = batchNo;
    const [items, total] = await Promise.all([
      LabRequest.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      LabRequest.countDocuments(q),
    ]);
    res.json({ items, total, page, limit });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// GET /api/lab-requests/:id
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = mongoose.Types.ObjectId.isValid(id)
      ? await LabRequest.findById(id).lean()
      : await LabRequest.findOne({ labRequestNo: id }).lean();
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบใบคำขอรับบริการ' } });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// POST /api/lab-requests
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.petitionId) return badRequest(res, 'ต้องระบุ petitionId');
    if (!body.serviceAgreement) return badRequest(res, 'ต้องระบุข้อตกลงการบริการ');

    const petition = await Petition.findById(body.petitionId).lean();
    if (!petition) return badRequest(res, 'ไม่พบคำร้องอ้างอิง');
    const deliveryAndBatchRequired = requiresDeliveryAndBatch(petition);
    if (deliveryAndBatchRequired && !body.batchNo) return badRequest(res, 'ต้องระบุ batchNo');
    const requestBatchNo = String(body.batchNo || '').trim();
    const matchItem = requestBatchNo
      ? petition.items.find((it) => String(it.batchNo || '').trim() === requestBatchNo)
      : petition.items.find((it) => Number(it.seq) === Number(body.sampleSeq));
    if (!matchItem) return badRequest(res, requestBatchNo ? `ไม่พบ batch ${body.batchNo} ในคำร้องอ้างอิง` : 'ไม่พบตัวอย่างอ้างอิง');
    if (deliveryAndBatchRequired && !/[16]$/.test(requestBatchNo)) {
      return badRequest(res, 'batch นี้ไม่ต้องสร้างใบคำขอรับบริการ (ต้องลงท้าย 1 หรือ 6)');
    }

    const labRequestNo = await nextLabRequestNo();
    const doc = await LabRequest.create({
      ...body,
      labRequestNo,
      petitionNo: petition.petitionNo,
      sampleSeq: matchItem.seq,
    });
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// PATCH /api/lab-requests/:id
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates._id;
    delete updates.labRequestNo;
    delete updates.petitionId;
    delete updates.petitionNo;
    const doc = await LabRequest.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบใบคำขอรับบริการ' } });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// DELETE /api/lab-requests/:id
router.delete('/:id', async (req, res) => {
  try {
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    const doc = await LabRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: { message: 'ไม่พบใบคำขอรับบริการ' } });
    await doc.softDelete(actor);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
