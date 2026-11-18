// บันทึกผลการคำนวณใบนำส่งลงขวด (StockUnit.petitionUsage) ของสารเดียวกันทั้งกลุ่ม
// นับรวมทุก type (primary/working) — ขวดที่เบิกล่าสุดของสารเท่านั้นที่ "กำลังใช้งาน"
const StockUnit = require('../models/StockUnit');
const StockTransaction = require('../models/StockTransaction');
const Petition = require('../models/Petition');
const { StockStandard } = require('../models/Stock');
const { buildUsagePeriods, matchPetitions } = require('./standardPetitionUsage');

// eslint-disable-next-line no-unused-vars
async function refreshPetitionUsageForGroup(itemCode, _type) {
  const units = await StockUnit.find({ itemType: 'standard', itemCode })
    .select('_id qrId withdrawnDate itemName')
    .lean();
  if (!units.length) return [];
  const std = await StockStandard.findOne({ code: itemCode }).select('name').lean();
  const standardName = std?.name || units[0].itemName || '';
  const periods = buildUsagePeriods(units);
  const direct = await StockTransaction.aggregate([
    { $match: { action: 'deduct', unitId: { $in: units.map((u) => String(u._id)) }, petitionNo: { $nin: [null, ''] } } },
    { $group: { _id: '$unitId', nos: { $addToSet: '$petitionNo' } } },
  ]);
  const directByUnit = new Map(direct.map((d) => [d._id, d.nos]));
  const first = periods[0];
  const petitions = first
    ? await Petition.find({
      $or: [
        { labReceivedAt: { $gte: first.start } },
        { labReceivedAt: null, receivedAt: { $gte: first.start } },
        { labReceivedAt: null, receivedAt: null, createdAt: { $gte: first.start } },
      ],
    }).select('_id petitionNo labReceivedAt receivedAt createdAt items.commonName').lean()
    : [];
  const computedAt = new Date();
  const byUnit = new Map(periods.map((p) => [p.unitId, p]));
  const ops = units.map((u) => {
    const period = byUnit.get(String(u._id)) || null;
    const list = matchPetitions(period, petitions, standardName, directByUnit.get(String(u._id)) || []);
    return {
      updateOne: {
        filter: { _id: u._id },
        update: { $set: { petitionUsage: { start: period?.start || null, end: period?.end || null, petitions: list, computedAt } } },
      },
    };
  });
  await StockUnit.bulkWrite(ops);
  return ops;
}

module.exports = { refreshPetitionUsageForGroup };
