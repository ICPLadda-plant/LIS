const express = require('express');
const router = express.Router();
const Approval = require('../models/Approval');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { notifyPetitionEvent } = require('../lib/lineNotify');

router.get('/', async (req, res) => {
  try {
    const approvals = await Approval.find();
    const map = {};
    approvals.forEach(a => {
      map[a.sampleId] = {
        labApproved: a.labApproved,
        labApprovedAt: a.labApprovedAt,
        qcStatus: a.qcStatus,
        qcNote: a.qcNote,
      };
    });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:sampleId/lab', async (req, res) => {
  try {
    const approval = await Approval.findOneAndUpdate(
      { sampleId: req.params.sampleId },
      { labApproved: true, labApprovedAt: new Date() },
      { new: true, upsert: true }
    );
    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:sampleId/qc', async (req, res) => {
  try {
    const { status, note, actor } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const approval = await Approval.findOneAndUpdate(
      { sampleId: req.params.sampleId },
      { qcStatus: status, qcNote: note },
      { new: true, upsert: true }
    );

    // Petition → success when all samples have qcStatus === 'approved'
    // ใบที่ปิดแล้ว (approved/rejected) ต้องไม่ถูกเปิดกลับเป็น success จากการอนุมัติรายตัวอย่าง
    const CLOSED_PETITION_STATUSES = ['success', 'approved', 'rejected'];
    if (status === 'approved') {
      const petition = await Petition.findOne({ 'items.sampleId': req.params.sampleId });
      if (petition && !CLOSED_PETITION_STATUSES.includes(petition.status)) {
        const sampleIds = (petition.items || [])
          .map((it) => it.sampleId || `${petition.petitionNo}-${it.seq}`)
          .filter(Boolean);
        const approvals = await Approval.find({ sampleId: { $in: sampleIds } }).lean();
        const allApproved =
          sampleIds.length > 0 &&
          sampleIds.every((sid) => approvals.find((a) => a.sampleId === sid)?.qcStatus === 'approved');
        if (allApproved) {
          const prevStatus = petition.status;
          petition.status = 'success';
          if (!petition.completedAt) petition.completedAt = new Date();
          await petition.save();
          const auditPayload = {
            event: 'statusChanged',
            fromStatus: prevStatus,
            toStatus: petition.status,
            actor: actor || 'system',
            note: 'QC อนุมัติครบทุกตัวอย่าง',
          };
          PetitionAuditLog.create({
            petitionId: petition._id,
            petitionNo: petition.petitionNo,
            ...auditPayload,
          }).catch((err) => console.error('[audit-log] failed:', err.message));
          notifyPetitionEvent(petition, auditPayload);
        }
      }
    }

    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
