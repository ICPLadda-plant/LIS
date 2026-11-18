// server/scripts/backfill-standard-petition-usage.js
// ย้อนหลัง: ตั้ง withdrawnDate ของขวด Standard จากการ deduct ครั้งแรก
// แล้วคำนวณใบนำส่งที่ใช้แต่ละขวดเก็บลง StockUnit.petitionUsage
//
// Dry-run by default; pass --commit to write.
require('dotenv').config();
const mongoose = require('mongoose');
const StockUnit = require('../models/StockUnit');
const StockTransaction = require('../models/StockTransaction');
const { refreshPetitionUsageForGroup } = require('../lib/standardPetitionUsageSync');

const COMMIT = process.argv.includes('--commit');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB');
  const firsts = await StockTransaction.aggregate([
    { $match: { action: 'deduct', itemType: 'standard', unitId: { $nin: [null, ''] } } },
    { $group: { _id: '$unitId', first: { $min: '$createdAt' } } },
  ]);
  const firstByUnit = new Map(firsts.map((f) => [f._id, f.first]));
  const units = await StockUnit.find({ itemType: 'standard', withdrawnDate: null }).select('_id qrId').lean();
  const toSet = units.filter((u) => firstByUnit.has(String(u._id)));
  console.log(`withdrawnDate ที่จะตั้ง: ${toSet.length} ขวด`);
  const groups = await StockUnit.aggregate([
    { $match: { itemType: 'standard' } },
    { $group: { _id: { itemCode: '$itemCode', type: '$type' } } },
  ]);
  console.log(`กลุ่มสาร+type ที่จะคำนวณใบนำส่ง: ${groups.length}`);
  if (!COMMIT) {
    console.log('dry-run: ไม่ได้เขียนข้อมูล (ใส่ --commit เพื่อบันทึก)');
  } else {
    if (toSet.length) {
      await StockUnit.bulkWrite(toSet.map((u) => ({
        updateOne: { filter: { _id: u._id, withdrawnDate: null }, update: { $set: { withdrawnDate: firstByUnit.get(String(u._id)) } } },
      })));
    }
    for (const g of groups) await refreshPetitionUsageForGroup(g._id.itemCode, g._id.type);
    console.log('บันทึกเรียบร้อย');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
