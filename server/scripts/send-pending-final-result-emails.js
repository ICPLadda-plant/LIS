// ส่งเมลขอออก Final Report ถึง QC Head ให้ใบที่ค้างรอออก Final Report อยู่ก่อนมีระบบเมล
// ใบที่ส่งไปแล้วในรอบเดียวกันจะถูกข้าม (กันส่งซ้ำ)
// dry-run เป็นค่าเริ่มต้น; ใส่ --send เพื่อส่งจริง
//
// Usage:
//   node scripts/send-pending-final-result-emails.js
//   node scripts/send-pending-final-result-emails.js --send
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const { findApprovers, roundKey, isAwaitingFinal, requestFinalResultApproval, webhookUrl } = require('../lib/finalResultEmail');

const SEND = process.argv.includes('--send');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';

async function main() {
  await mongoose.connect(URI);
  const approvers = await findApprovers();
  console.log('Webhook:', webhookUrl() || '(ปิดอยู่)');
  console.log('QC Head ' + approvers.length + ' คน: ' + approvers.map((a) => (a.name || '-') + ' <' + a.email + '>').join(', '));

  const petitions = await Petition.find({ status: 'success' }).sort({ completedAt: 1 });
  const awaiting = petitions.filter(isAwaitingFinal);
  const pending = awaiting.filter((p) => p.finalResultEmail?.key !== roundKey(p));
  console.log('รอออก Final Report ' + awaiting.length + ' ใบ, ยังไม่เคยส่งเมล ' + pending.length + ' ใบ');
  for (const p of pending) {
    const requester = p.submittedBy?.email || '(ไม่มีอีเมลผู้ขอ)';
    if (!SEND) {
      console.log('  [dry-run] ' + p.petitionNo + ' · ผู้ขอ ' + (p.submittedBy?.name || '-') + ' ' + requester);
      continue;
    }
    const result = await requestFinalResultApproval(p);
    console.log('  ' + p.petitionNo + ' → ' + JSON.stringify(result));
  }
  if (!SEND) console.log('dry-run: ยังไม่ได้ส่ง ใส่ --send เพื่อส่งจริง');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
