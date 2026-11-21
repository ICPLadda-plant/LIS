// บันทึกผล %AI ที่ส่งตรวจภายนอก (Lab ภายนอก) ลงคำร้องโดยตรง ไม่ผ่านการคำนวณ
// ใส่ค่า %AI ตามที่ผู้ใช้แจ้ง แล้วปิดงาน Lab (บันทึกผล + ออกผล Lab) ให้ COA ดึงค่าไปแสดงได้
// ค่าเริ่มต้นเป็น dry-run; ใส่ --commit เพื่อเขียนจริง (สำรองข้อมูลเดิมเป็น JSON ก่อนเขียน)
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const QCTestResult = require('../models/QCTestResult');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { isPetitionComplete } = require('../lib/petitionStatusLog');

const COMMIT = process.argv.includes('--commit');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';
const ACTOR = 'ระบบ (ผลตรวจภายนอก)';
const NOTE = 'บันทึกผล %AI จากการส่งตรวจภายนอก';
const AI_PARAMETER_ID = '6a153cb2d1b37e2d6e343adc';

// lab label → คำร้อง, ลำดับตัวอย่าง และค่า %AI (ค่าเดี่ยว = สารแรกของ common name, object = ระบุสารเอง)
const ENTRIES = [
  { lab: 'L04', petitionNo: 'P-2611-0008', seq: 2, value: '26.23' },
  { lab: 'L10', petitionNo: 'P-2611-0016', seq: 3, value: '3.97' },
  { lab: 'L11', petitionNo: 'P-2611-0018', seq: 2, value: '51.35' },
  { lab: 'L14', petitionNo: 'P-2611-0024', seq: 1, value: '4.03' },
  { lab: 'L15', petitionNo: 'P-2611-0025', seq: 2, value: '0.00535' },
  { lab: 'L21', petitionNo: 'P-2611-0034', seq: 1, value: '26.29' },
  { lab: 'L23', petitionNo: 'P-2611-0036', seq: 1, value: '5.23' },
  { lab: 'L24', petitionNo: 'P-2611-0039', seq: 1, value: { '2,4-d-butyl': '4.12', anilofos: '1.52' } },
  { lab: 'L25', petitionNo: 'P-2611-0041', seq: 3, value: '3.92' },
  { lab: 'L26', petitionNo: 'P-2611-0042', seq: 1, value: '0.00495' },
  { lab: 'L26', petitionNo: 'P-2611-0042', seq: 2, value: '0.00576' },
  { lab: 'L27', petitionNo: 'P-2611-0043', seq: 1, value: { butachlor: '3.77', '2,4-d-butyl': '3.43' } },
  { lab: 'L28', petitionNo: 'P-2611-0046', seq: 1, value: '5.10' },
  { lab: 'L29', petitionNo: 'P-2611-0047', seq: 1, value: '0.00504' },
  { lab: 'L29', petitionNo: 'P-2611-0047', seq: 2, value: '0.00576' },
  { lab: 'L34', petitionNo: 'P-2611-0055', seq: 2, value: { anilofos: '1.5', '2,4-d-butyl': '3.96' } },
  { lab: 'L35', petitionNo: 'P-2611-0056', seq: 1, value: '0.00614' },
];

// mirror ของ matchSubstanceKey (src/lib/substances.ts): คำแรกของชื่อสาร ตัวพิมพ์เล็ก
function substanceKey(name) {
  return String(name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/)[0].toLowerCase();
}

function substancesOf(commonName) {
  return String(commonName || '').replace(/\(.*?\)/g, ' ').split('+').map(substanceKey).filter(Boolean);
}

function aiValues(entry, item) {
  const substances = substancesOf(item.commonName);
  if (typeof entry.value === 'string') {
    if (substances.length !== 1) throw new Error(entry.lab + ': ' + item.commonName + ' มีหลายสาร ต้องระบุสารเอง');
    return { ['%AI::' + substances[0]]: entry.value };
  }
  const keys = Object.keys(entry.value);
  if (keys.length !== substances.length || keys.some((key) => !substances.includes(key))) {
    throw new Error(entry.lab + ': สารไม่ตรงกับ ' + item.commonName + ' (' + substances.join(', ') + ')');
  }
  return Object.fromEntries(keys.map((key) => ['%AI::' + key, entry.value[key]]));
}

async function main() {
  await mongoose.connect(URI);
  console.log('ฐานข้อมูล: ' + URI.replace(/\/\/[^@/]*@/, '//***@'));
  console.log(COMMIT ? 'โหมด: เขียนจริง' : 'โหมด: dry-run (ใส่ --commit เพื่อเขียนจริง)');
  const now = new Date();
  const actor = { name: ACTOR, email: '' };
  const petitionNos = [...new Set(ENTRIES.map((entry) => entry.petitionNo))];
  const petitions = await Petition.find({ petitionNo: { $in: petitionNos }, deletedAt: null }).lean();
  const byNo = new Map(petitions.map((petition) => [petition.petitionNo, petition]));
  const missing = petitionNos.filter((no) => !byNo.has(no));
  if (missing.length) throw new Error('ไม่พบคำร้อง: ' + missing.join(', '));

  const plans = ENTRIES.map((entry) => {
    const petition = byNo.get(entry.petitionNo);
    const item = (petition.items || []).find((it) => Number(it.seq) === entry.seq);
    if (!item) throw new Error(entry.lab + ': ไม่พบตัวอย่างลำดับ ' + entry.seq + ' ใน ' + entry.petitionNo);
    return { entry, petition, item, values: aiValues(entry, item) };
  });

  const existing = await QCTestResult.find({
    petitionId: { $in: petitions.map((petition) => String(petition._id)) },
    parameterId: AI_PARAMETER_ID,
  }).lean();

  for (const plan of plans) {
    const old = existing.find((r) => r.petitionId === String(plan.petition._id) && Number(r.itemSeq) === plan.entry.seq);
    console.log([
      plan.entry.lab, plan.entry.petitionNo, 'ลำดับ ' + plan.entry.seq, plan.item.commonName,
      Object.entries(plan.values).map(([k, v]) => k + '=' + v).join(', '),
      old ? 'มีผลเดิม: ' + JSON.stringify(old.values) : 'ยังไม่มีผล',
    ].join(' | '));
  }

  const petitionPlans = petitions.map((petition) => {
    const next = { ...petition, labApprovedAt: now, labCompletedAt: petition.labCompletedAt || now };
    const toStatus = ['success', 'approved', 'rejected'].includes(petition.status)
      ? petition.status
      : (isPetitionComplete(next) ? 'success' : petition.status);
    return { petition, toStatus };
  });
  for (const { petition, toStatus } of petitionPlans) {
    console.log(petition.petitionNo + ': สถานะ ' + petition.status + ' → ' + toStatus
      + (petition.qcCompletedAt ? '' : ' (QC ยังไม่ยืนยันผล)')
      + (petition.labApprovedAt ? ' [ออกผล Lab ไปแล้ว]' : ''));
  }

  if (!COMMIT) {
    await mongoose.disconnect();
    return;
  }

  const backupFile = path.join(__dirname, 'backup-external-lab-ai-' + now.toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(backupFile, JSON.stringify({ petitions, results: existing }, null, 2));
  console.log('สำรองข้อมูลเดิม: ' + backupFile);

  for (const plan of plans) {
    await QCTestResult.updateOne(
      { petitionId: String(plan.petition._id), itemSeq: plan.entry.seq, parameterId: AI_PARAMETER_ID },
      {
        $set: {
          petitionNo: plan.petition.petitionNo,
          sampleName: plan.item.tradeName || plan.item.sampleName || plan.item.commonName,
          commonName: plan.item.commonName,
          parameterName: '%AI',
          sampleRoundId: '',
          values: plan.values,
          remark: NOTE + ' (' + plan.entry.lab + ')',
          updatedBy: actor,
          updatedAt: now,
        },
        $setOnInsert: { enteredBy: actor, enteredAt: now },
      },
      { upsert: true },
    );
  }

  for (const { petition, toStatus } of petitionPlans) {
    const set = { labApprovedAt: petition.labApprovedAt || now, labApprovedBy: petition.labApprovedBy || ACTOR };
    if (!petition.labReceivedAt) Object.assign(set, { labReceivedAt: now, labReceivedBy: ACTOR });
    if (!petition.labCompletedAt) Object.assign(set, { labCompletedAt: now, labCompletedBy: ACTOR });
    if (toStatus !== petition.status) {
      set.status = toStatus;
      if (!petition.completedAt) set.completedAt = now;
    }
    const update = { $set: set };
    if (!petition.labApprovedAt) update.$push = { reviewHistory: { action: 'lab-approve', reviewedBy: ACTOR, reviewedAt: now, note: NOTE } };
    await Petition.updateOne({ _id: petition._id }, update);
    const aiResults = plans.filter((plan) => plan.petition === petition)
      .map((plan) => ({ seq: plan.entry.seq, lab: plan.entry.lab, values: plan.values }));
    await PetitionAuditLog.create({
      petitionId: petition._id,
      petitionNo: petition.petitionNo,
      event: toStatus !== petition.status ? 'statusChanged' : 'updated',
      fromStatus: petition.status,
      toStatus,
      actor: ACTOR,
      note: NOTE + ' — ออกผล Lab',
      metadata: { side: 'lab', kind: 'externalLabResult', aiResults },
    });
  }
  console.log('บันทึกเสร็จ ' + plans.length + ' รายการ ใน ' + petitions.length + ' คำร้อง');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
