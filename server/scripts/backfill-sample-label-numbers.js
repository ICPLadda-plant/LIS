// เติมเลขที่ป้ายนำส่งตัวอย่าง (P01 / L01) ให้คำขอของปี พ.ศ. ปัจจุบันที่สร้างก่อนมีระบบเลข P/L
//
// หลักการ:
// - ไล่ตามเวลาสร้างคำขอ (createdAt) เก่า → ใหม่ ใช้กติกาเดียวกับตอนสร้างคำขอ (server/lib/sampleLabelNumber.js)
// - ไม่ overwrite คำขอที่มีเลขแล้ว; ข้ามคำขอที่ถูกลบ
// - ต่อจากตัวนับปัจจุบัน ควรรันทันทีหลังขึ้นระบบ ก่อนมีคำขอใหม่ เพื่อให้คำขอเก่าได้เลขต้น ๆ
// - dry-run เป็นค่าเริ่มต้น; ใส่ --commit เพื่อเขียนจริง
//
// Usage:
//   node scripts/backfill-sample-label-numbers.js
//   node scripts/backfill-sample-label-numbers.js --commit
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const SampleLabelCounter = require('../models/SampleLabelCounter');
const { assignMissingSampleLabelNumbers } = require('../lib/sampleLabelNumber');

const COMMIT = process.argv.includes('--commit');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';

async function main() {
  await mongoose.connect(URI);
  const now = new Date();
  const year = now.getFullYear() + 543;
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const petitions = await Petition.find({
    createdAt: { $gte: yearStart },
    deletedAt: null,
    'sampleLabelNumbers.year': { $exists: false },
  }).sort({ createdAt: 1, petitionNo: 1 }).lean();

  const counters = {};
  for (const row of await SampleLabelCounter.find({ year }).lean()) counters[row.side] = row.sequence;
  const dryRunSequence = async (side) => {
    counters[side] = (counters[side] || 0) + 1;
    return counters[side];
  };

  console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'}: ${petitions.length} คำขอของปี ${year} ที่ยังไม่มีเลขป้าย`);
  for (const petition of petitions) {
    const numbers = await assignMissingSampleLabelNumbers(petition, {
      now,
      ...(COMMIT ? {} : { nextSequence: dryRunSequence }),
    });
    if (!numbers) continue;
    console.log(`  ${petition.petitionNo} → ${[numbers.qc, numbers.lab].filter(Boolean).join(' + ')} / ${year % 100}`);
    if (COMMIT) await Petition.updateOne({ _id: petition._id }, { $set: { sampleLabelNumbers: numbers } });
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
