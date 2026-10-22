// คำนวณ %AI ของคำร้องเดิมใหม่จาก % Sample Average × ค่า ถพ.
// ค่าเริ่มต้นเป็น dry-run; ใส่ --commit เพื่อเขียนจริง
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const QCTestResult = require('../models/QCTestResult');
const { correctedAiValues } = require('../lib/aiResultBackfill');

const COMMIT = process.argv.includes('--commit');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';

async function main() {
  await mongoose.connect(URI);
  const results = await QCTestResult.find({}).lean();
  const densityBySample = new Map();
  for (const result of results) {
    if (!/(?:density|ถพ)/i.test(result.parameterName || '')) continue;
    densityBySample.set([result.petitionId, result.itemSeq, result.sampleRoundId || ''].join('|'), result);
  }

  const operations = [];
  let changedFields = 0;
  for (const result of results) {
    if (!/^%?\s*ai(?:$|\s|[-—:])/i.test(result.parameterName || '')) continue;
    const key = [result.petitionId, result.itemSeq, result.sampleRoundId || ''].join('|');
    const density = densityBySample.get(key);
    if (!density) continue;
    const phase1 = correctedAiValues(result.values, density);
    const phase2 = correctedAiValues(result.valuesPhase2, density);
    const changes = [...phase1.changes, ...phase2.changes];
    if (!changes.length) continue;
    changedFields += changes.length;
    console.log(
      (result.petitionNo || result.petitionId) + ' · ตัวอย่าง ' + result.itemSeq + ': ' +
      changes.map(change => change.field + ' ' + (change.before ?? '-') + ' → ' + change.after).join(', '),
    );
    operations.push({ updateOne: { filter: { _id: result._id }, update: { $set: { values: phase1.values, valuesPhase2: phase2.values } } } });
  }

  if (COMMIT && operations.length) await QCTestResult.bulkWrite(operations);
  console.log('คำร้องที่จะปรับ: ' + operations.length + ' รายการ | ช่อง %AI: ' + changedFields);
  console.log(COMMIT ? 'เขียนข้อมูลเรียบร้อย' : 'DRY-RUN — ยังไม่เขียนข้อมูล');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
