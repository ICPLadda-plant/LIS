// GET /api/notifications?since=<ISO>&all=0|1&limit=30
// ฟีดกระดิ่งรวม: audit log ของคำขอ (กฎใน lib/petitionNotifications) + แจ้งเตือนสต็อก/ระบบ (lib/appNotifications)
// ผู้ชมมาจาก session / X-LIS-User ก่อน ถ้าไม่พบ (dev bypass) ใช้ roles/employeeId/email/name จาก query
const express = require('express');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { isCollapsibleDuplicate, notificationForViewer } = require('../lib/petitionNotifications');
const { bellAppNotifications } = require('../lib/appNotifications');
const { viewerFromUser } = require('../lib/notificationViewer');

const router = express.Router();
const NOTIFY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PETITION_FIELDS = [
  'petitionNo', 'dept', 'status', 'priority', 'routeTargets', 'sentToLab', 'sendToLab',
  'items.seq', 'items.batchNo', 'items.sampleName', 'items.commonName', 'items.itemNo',
  'items.sendToQc', 'items.sendToLab', 'items.sentToLab', 'items.productType', 'items.category',
  'submittedBy', 'productionWorkflow.requesterEmail', 'assignedTo', 'qcHandlers', 'qcReceivedBy',
  'qcCompletedBy', 'labelReceipts', 'qcCompletedAt', 'labCompletedAt', 'labApprovedAt', 'deletedAt',
].join(' ');

const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

async function resolveViewer(req) {
  const seeAll = String(req.query.all || '') === '1';
  const { currentUser } = require('./additionalSamples');
  const user = await currentUser(req).catch(() => null);
  if (user) return viewerFromUser(user, { seeAll });
  return viewerFromUser({
    roles: list(req.query.roles),
    employeeId: req.query.employeeId,
    email: req.query.email,
    name: req.query.name,
  }, { seeAll });
}

async function petitionFeed(viewer, since, limit) {
  const logs = await PetitionAuditLog.find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();
  const petitionIds = [...new Set(logs.filter((l) => l.petitionId).map((l) => String(l.petitionId)))];
  const petitions = petitionIds.length
    ? await Petition.find({ _id: { $in: petitionIds } }).select(PETITION_FIELDS).lean()
    : [];
  const byId = new Map(petitions.map((p) => [String(p._id), p]));
  const items = [];
  const seen = new Set();
  for (const log of logs) {
    if (items.length >= limit) break;
    const petition = byId.get(String(log.petitionId));
    if (!petition || petition.deletedAt) continue;
    if (isCollapsibleDuplicate(log, seen)) continue;
    const notification = notificationForViewer(petition, log, viewer);
    if (notification) items.push({ ...notification, group: 'petition' });
  }
  return items;
}

async function feedHandler(req, res) {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const floor = new Date(Date.now() - NOTIFY_LOOKBACK_MS);
    const sinceRaw = new Date(String(req.query.since || ''));
    const since = !Number.isNaN(sinceRaw.getTime()) && sinceRaw > floor ? sinceRaw : floor;
    const viewer = await resolveViewer(req);
    const [petitionItems, appItems] = await Promise.all([
      petitionFeed(viewer, since, limit),
      bellAppNotifications(viewer, since, limit),
    ]);
    const items = [...petitionItems, ...appItems]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
    // client ใช้ serverTime เป็น cursor รอบถัดไป — กันนาฬิกาเครื่องไม่ตรง
    res.json({ items, serverTime: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
}

router.get('/', feedHandler);

module.exports = router;
module.exports.feedHandler = feedHandler;
module.exports.resolveViewer = resolveViewer;
