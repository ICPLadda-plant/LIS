// helper สำหรับทิ้งขวดแบบ cascade (ทั้งขวด = ขวดแม่ + working ลูกทุกตัว)
function resolveCascadeRootId(unit) {
  return unit.kind === 'working' && unit.parentId ? unit.parentId : unit._id;
}

// คืน root + children ที่ยังไม่ถูกทิ้ง (idempotent: ข้ามตัว status 'discarded')
function selectDiscardTargets({ root, children }) {
  return [root, ...(children || [])].filter(Boolean).filter((u) => u.status !== 'discarded');
}

const AUTO_EXPIRED_REASON = 'หมดอายุ (ระบบทิ้งอัตโนมัติ)';
const SYSTEM_ACTOR = { name: 'ระบบ', email: '' };

// Pure: ขวดที่ยัง active และวันหมดอายุผ่านไปแล้ว
function selectExpiredUnits(units, now = new Date()) {
  return (units || []).filter((u) => {
    if (!u || u.status !== 'active' || !u.exp) return false;
    const t = new Date(u.exp).getTime();
    return !Number.isNaN(t) && t < now.getTime();
  });
}

// ทิ้งขวดหมดอายุอัตโนมัติ + บันทึกประวัติ; คืนจำนวนขวดที่ทิ้ง
async function autoDiscardExpiredUnits(now = new Date()) {
  const StockUnit = require('../models/StockUnit');
  const StockTransaction = require('../models/StockTransaction');
  const { StockStandard, StockSolvent } = require('../models/Stock');
  const candidates = await StockUnit.find({ status: 'active', exp: { $ne: null, $lt: now } });
  const expired = selectExpiredUnits(candidates, now);
  for (const unit of expired) {
    const res = await StockUnit.updateOne(
      { _id: unit._id, status: 'active' },
      { $set: { status: 'discarded', discardedAt: now, discardedBy: SYSTEM_ACTOR, discardReason: AUTO_EXPIRED_REASON } },
    );
    if (!res.modifiedCount) continue;
    const itemType = unit.itemType === 'solvent' ? 'solvent' : 'standard';
    const Model = itemType === 'solvent' ? StockSolvent : StockStandard;
    const item = await Model.findOne({ code: unit.itemCode }).select('_id').lean().catch(() => null);
    try {
      await StockTransaction.create({
        itemType, itemId: item ? item._id.toString() : unit.itemCode,
        itemCode: unit.itemCode, itemName: unit.itemName, action: 'discard',
        unitId: unit._id.toString(), qrId: unit.qrId, note: AUTO_EXPIRED_REASON,
        userName: SYSTEM_ACTOR.name,
      });
    } catch (err) {
      console.error('[autoDiscardExpired] log failed:', err.message);
    }
  }
  return expired.length;
}

module.exports = { resolveCascadeRootId, selectDiscardTargets, selectExpiredUnits, autoDiscardExpiredUnits, AUTO_EXPIRED_REASON };
