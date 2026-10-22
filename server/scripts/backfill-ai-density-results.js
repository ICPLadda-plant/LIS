// คำนวณ %AI ของคำร้องเดิมใหม่จาก % Sample Average × ค่า ถพ.
// แก้เฉพาะ %AI ที่เคยคำนวณด้วย ถพ. = 1 (เท่ากับ Sample Average) ทั้งที่ตัวอย่างมีค่า ถพ.
// ค่าเริ่มต้นเป็น dry-run; ใส่ --commit เพื่อเขียนจริง
// เมื่อเขียนจริงจะบันทึกประวัติลง PetitionAuditLog ทุกช่องที่แก้
// ใบ COA ที่ออกแล้วจะไม่ถูกแก้ แต่จะแสดงรายการให้ทีมตัดสินใจออกใบแก้ไข
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const QCTestResult = require('../models/QCTestResult');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const CoaDocument = require('../models/CoaDocument');
const { correctedAiValues } = require('../lib/aiResultBackfill');

const COMMIT = process.argv.includes('--commit');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';
const REASON = 'คำนวณ %AI ใหม่ด้วยค่า ถพ.';
const ISSUED_COA = ['approved', 'printed', 'reissued'];

async function main() {
  await mongoose.connect(URI);
  console.log('ฐานข้อมูล: ' + URI.replace(/\/\/[^@/]*@/, '//***@'));
  const results = await QCTestResult.find({}).lean();
  const densityBySample = new Map();
  for (const result of results) {
    if (!/(?:density|ถ\.?\s*พ)/i.test(result.parameterName || '')) continue;
    densityBySample.set([result.petitionId, result.itemSeq, result.sampleRoundId || ''].join('|'), result);
  }

  const operations = [];
  const auditLogs = [];
  const affected = new Map();
  let changedFields = 0;
  for (const result of results) {
    if (!/^%?\s*ai(?:$|\s|[-—:])/i.test(result.parameterName || '')) continue;
    const key = [result.petitionId, result.itemSeq, result.sampleRoundId || ''].join('|');
    const density = densityBySample.get(key);
    if (!density) continue;
    const phase1 = correctedAiValues(result.values, density);
    const phase2 = correctedAiValues(result.valuesPhase2, density);
    const changes = [
      ...phase1.changes.map((change) => ({ ...change, phase: 1 })),
      ...phase2.changes.map((change) => ({ ...change, phase: 2 })),
    ];
    if (!changes.length) continue;
    changedFields += changes.length;
    console.log(
      (result.petitionNo || result.petitionId) + ' · ตัวอย่าง ' + result.itemSeq + ': ' +
      changes.map(change => change.field + ' ' + (change.before ?? '-') + ' → ' + change.after).join(', '),
    );
    operations.push({ updateOne: { filter: { _id: result._id }, update: { $set: { values: phase1.values, valuesPhase2: phase2.values } } } });
    const petitionNo = result.petitionNo || String(result.petitionId);
    if (!affected.has(String(result.petitionId))) affected.set(String(result.petitionId), { petitionNo, itemSeqs: new Set() });
    affected.get(String(result.petitionId)).itemSeqs.add(result.itemSeq);
    if (mongoose.isValidObjectId(result.petitionId)) {
      for (const change of changes) {
        auditLogs.push({
          petitionId: result.petitionId,
          petitionNo,
          event: 'resultUpdated',
          actor: 'system',
          note: REASON + ' › ' + change.field + ' ' + (change.before ?? '-') + ' → ' + change.after + ' (' + (result.sampleName || 'ตัวอย่าง ' + result.itemSeq) + ')',
          metadata: {
            reason: REASON,
            itemSeq: result.itemSeq,
            sampleName: result.sampleName,
            parameterId: result.parameterId,
            parameterName: result.parameterName,
            fieldLabel: change.field,
            phase: change.phase,
            before: change.before ?? null,
            after: change.after,
            sampleAverage: change.average,
            density: change.density,
          },
        });
      }
    }
  }

  if (COMMIT && operations.length) {
    await QCTestResult.bulkWrite(operations);
    if (auditLogs.length) await PetitionAuditLog.insertMany(auditLogs);
  }
  console.log('คำร้องที่จะปรับ: ' + operations.length + ' รายการ | ช่อง %AI: ' + changedFields);

  // ใบ COA ที่ออกแล้วและใช้ผลของตัวอย่างที่ถูกแก้
  const petitionIds = [...affected.keys()].filter((id) => mongoose.isValidObjectId(id));
  const coas = petitionIds.length
    ? await CoaDocument.find({ petitionId: { $in: petitionIds }, status: { $in: ISSUED_COA } })
      .select('coaNo revision status petitionId petitionNoSnapshot selectedItemSeqs').lean()
    : [];
  const affectedCoas = coas.filter((coa) => {
    const seqs = affected.get(String(coa.petitionId)).itemSeqs;
    return !coa.selectedItemSeqs?.length || coa.selectedItemSeqs.some((seq) => seqs.has(seq));
  });
  console.log('ใบ COA ที่ออกแล้วและได้รับผลกระทบ (ไม่ได้แก้ ให้ทีมพิจารณาออกใบแก้ไข): ' + affectedCoas.length + ' ใบ');
  for (const coa of affectedCoas) {
    console.log('  ' + (coa.coaNo || '(ยังไม่มีเลข)') + ' rev ' + (coa.revision ?? 0) + ' · ' + coa.status + ' · คำร้อง ' + (coa.petitionNoSnapshot || affected.get(String(coa.petitionId)).petitionNo));
  }
  console.log(COMMIT ? 'เขียนข้อมูลเรียบร้อย' : 'DRY-RUN — ยังไม่เขียนข้อมูล');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
