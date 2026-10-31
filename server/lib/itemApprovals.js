// สถานะอนุมัติรายรายการ (ต่อ batch × common name = ต่อ petition item) แยกฝั่ง QC / Lab
// เก็บใน petition.itemApprovals = [{ seq, side, status, conclusion, note, by, at, source }]
// Pure functions — ไม่แตะ DB. Mirror ฝั่ง FE: src/lib/itemApprovals.ts
const { hasLabTrack, shouldSendItemToLab } = require('./petitionStatusLog');
const { requiresQcTrack, isResearchAndDevelopmentDepartment } = require('./petitionSubmissionRules');

const SIDES = ['qc', 'lab'];

function routeTargets(petition) {
  return Array.isArray(petition?.routeTargets) ? petition.routeTargets : [];
}

// รายการนี้ต้องผ่านการอนุมัติฝั่งไหนบ้าง
function itemRequiresSide(petition, item, side) {
  if (!item) return false;
  if (side === 'qc') return requiresQcTrack(petition) && item.sendToQc !== false;
  if (side !== 'lab' || !hasLabTrack(petition)) return false;
  if (isResearchAndDevelopmentDepartment(petition?.submittedBy?.department)) return true;
  const targets = routeTargets(petition);
  // คำร้องที่ส่ง Lab อย่างเดียว: ทุกรายการเป็นงาน Lab
  if (targets.length && targets.includes('lab') && !targets.includes('qc')) return true;
  return shouldSendItemToLab(item);
}

function findItemApproval(petition, seq, side) {
  return (petition?.itemApprovals || []).find((entry) => Number(entry.seq) === Number(seq) && entry.side === side) || null;
}

// 'approved' | 'rejected' | 'pending' | 'none' (ไม่ต้องอนุมัติฝั่งนี้)
// คำร้องที่ออก Final Result แล้วแบบเดิม (ไม่มีข้อมูลรายรายการ) ถือว่าอนุมัติครบ
function itemSideStatus(petition, item, side) {
  if (!itemRequiresSide(petition, item, side)) return 'none';
  const entry = findItemApproval(petition, item.seq, side);
  if (entry) return entry.status;
  return petition?.status === 'approved' ? 'approved' : 'pending';
}

function isItemFullyApproved(petition, item) {
  return SIDES.every((side) => ['approved', 'none'].includes(itemSideStatus(petition, item, side)));
}

function allItemsApproved(petition) {
  const items = petition?.items || [];
  return items.length > 0 && items.every((item) => isItemFullyApproved(petition, item));
}

function batchKey(item) {
  return String(item?.batchNo || '').trim();
}

// batch ที่ทุกรายการอนุมัติครบทุกฝั่งแล้ว
function approvedBatchNos(petition) {
  const byBatch = new Map();
  for (const item of petition?.items || []) {
    const key = batchKey(item);
    if (!key) continue;
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key).push(item);
  }
  return [...byBatch.entries()]
    .filter(([, items]) => items.every((item) => isItemFullyApproved(petition, item)))
    .map(([key]) => key);
}

function upsertItemApproval(petition, entry) {
  const list = Array.isArray(petition.itemApprovals) ? petition.itemApprovals : [];
  const next = list.filter((existing) => !(Number(existing.seq) === Number(entry.seq) && existing.side === entry.side));
  next.push(entry);
  petition.itemApprovals = next;
  if (typeof petition.markModified === 'function') petition.markModified('itemApprovals');
}

// ส่ง track ทั้งฝั่งกลับไปทำใหม่ → ล้างสถานะอนุมัติรายรายการของฝั่งนั้น
function clearSideApprovals(petition, side) {
  const list = Array.isArray(petition?.itemApprovals) ? petition.itemApprovals : [];
  if (!list.some((entry) => entry.side === side)) return;
  petition.itemApprovals = list.filter((entry) => entry.side !== side);
  if (typeof petition.markModified === 'function') petition.markModified('itemApprovals');
}

// ผลสรุปทั้งคำร้องเมื่ออนุมัติครบ: มีรายการใดยอมรับผลไม่ปกติ → accepted-oos
function overallConclusion(petition) {
  const oos = (petition?.itemApprovals || []).filter((entry) => entry.status === 'approved' && entry.conclusion === 'accepted-oos');
  if (!oos.length) return { conclusion: 'pass', note: '' };
  const note = oos
    .map((entry) => `รายการที่ ${entry.seq} (${entry.side === 'lab' ? 'Lab' : 'QC'}): ${entry.note || '-'}`)
    .join('\n');
  return { conclusion: 'accepted-oos', note };
}

function sideLabel(side) {
  return side === 'lab' ? '%AI' : 'กายภาพ';
}

// ข้อความสรุปต่อ batch สำหรับแจ้ง Production
function batchResultSummary(petition, batchNo) {
  const items = (petition?.items || []).filter((item) => batchKey(item) === batchNo);
  const parts = [];
  for (const side of SIDES) {
    const relevant = items.filter((item) => itemRequiresSide(petition, item, side));
    if (!relevant.length) continue;
    const oos = relevant.some((item) => findItemApproval(petition, item.seq, side)?.conclusion === 'accepted-oos');
    parts.push(sideLabel(side) + (oos ? 'ไม่ผ่าน' : 'ผ่าน'));
  }
  return parts.join(' · ');
}

module.exports = {
  SIDES,
  itemRequiresSide,
  findItemApproval,
  itemSideStatus,
  isItemFullyApproved,
  allItemsApproved,
  approvedBatchNos,
  upsertItemApproval,
  clearSideApprovals,
  overallConclusion,
  batchResultSummary,
};
