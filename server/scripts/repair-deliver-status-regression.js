// ซ่อมใบที่สถานะถอยจาก inProgress/pendingReview กลับเป็น sampleSent เพราะสแกนส่งซ้ำหลังรับตัวอย่างแล้ว
// ใช้: node scripts/repair-deliver-status-regression.js            (dry-run แสดงรายการ)
//      node scripts/repair-deliver-status-regression.js --apply    (เขียนจริง + บันทึก audit)
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const logs = await db.collection('petitionauditlogs').find({
    note: 'สแกนส่งตัวอย่าง',
    toStatus: 'sampleSent',
    fromStatus: { $in: ['pendingReview', 'inProgress'] },
  }).sort({ createdAt: -1 }).toArray();

  const seen = new Set();
  for (const log of logs) {
    const key = String(log.petitionId);
    if (seen.has(key)) continue;
    seen.add(key);
    const petition = await db.collection('petitions').findOne({ _id: log.petitionId, deletedAt: null });
    if (!petition || petition.status !== 'sampleSent') continue;
    if (!petition.qcReceivedAt && !petition.labReceivedAt && !petition.receivedAt) continue;
    const restoreTo = log.fromStatus;
    console.log(`${petition.petitionNo}: sampleSent -> ${restoreTo}${APPLY ? '' : ' (dry-run)'}`);
    if (!APPLY) continue;
    await db.collection('petitions').updateOne(
      { _id: petition._id, status: 'sampleSent' },
      { $set: { status: restoreTo, updatedAt: new Date() }, $inc: { __v: 1 } },
    );
    await db.collection('petitionauditlogs').insertOne({
      petitionId: petition._id,
      petitionNo: petition.petitionNo,
      event: 'statusChanged',
      fromStatus: 'sampleSent',
      toStatus: restoreTo,
      actor: 'system',
      note: 'คืนสถานะหลังสแกนส่งซ้ำทำให้สถานะถอยหลัง',
      createdAt: new Date(),
      __v: 0,
    });
  }
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
