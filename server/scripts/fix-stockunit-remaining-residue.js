// ล้างขวดที่ "เบิกหมดแล้วแต่ไม่หายไป" เพราะคงเหลือมีเศษทศนิยม (เช่น 1e-12 mg)
// ปัด volume.remaining ให้เป็น 6 ตำแหน่ง และตั้ง status=empty ถ้าเหลือ 0
// idempotent — รันซ้ำได้
//
// Usage:
//   node scripts/fix-stockunit-remaining-residue.js           # dry-run
//   node scripts/fix-stockunit-remaining-residue.js --commit  # เขียนจริง
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { normalizeQuantity, EMPTY_REMAINING_EPSILON } = require('../lib/stockQuantity');

const COMMIT = process.argv.includes('--commit');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';

async function main() {
  await mongoose.connect(URI);
  console.log(`ต่อ database: ${mongoose.connection.host}/${mongoose.connection.name}`);
  const col = mongoose.connection.collection('stockunits');
  const cursor = col.find({ status: { $ne: 'discarded' }, 'volume.remaining': { $type: 'number' } });
  let fixed = 0;
  for await (const unit of cursor) {
    const raw = unit.volume.remaining;
    const clean = normalizeQuantity(raw);
    const shouldEmpty = clean <= EMPTY_REMAINING_EPSILON && unit.status === 'active';
    if (clean === raw && !shouldEmpty) continue;
    fixed += 1;
    console.log(`${unit.qrId || unit._id} (${unit.itemCode || '-'}): ${raw} -> ${clean}${shouldEmpty ? ' [หมด]' : ''}`);
    if (COMMIT) {
      const set = { 'volume.remaining': clean };
      if (shouldEmpty) set.status = 'empty';
      await col.updateOne({ _id: unit._id }, { $set: set });
    }
  }
  console.log(`${COMMIT ? 'แก้แล้ว' : 'จะแก้ (dry-run)'} ${fixed} ขวด`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
