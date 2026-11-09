// ส่งเมลขอออก Final Report ถึง QC Head ให้ใบที่ค้างรอออก Final Report
// dry-run เป็นค่าเริ่มต้น
//
// Usage:
//   node scripts/send-pending-final-result-emails.js                         # dry-run
//   node scripts/send-pending-final-result-emails.js --send                  # ส่งใบที่ยังไม่เคยส่งในรอบนี้
//   node scripts/send-pending-final-result-emails.js --send --force          # ส่งใหม่ทุกใบ (เช่น เปลี่ยนรูปแบบเมล)
//   node scripts/send-pending-final-result-emails.js --preview-to a@icpladda.com [--petition P-2611-0002]
//        ส่งตัวอย่าง 1 ฉบับ (หัวเรื่องมี [ตัวอย่าง]) — ปุ่มตอบกลับผูกกับอีเมลนี้ จึงออก Final Report ไม่ได้ถ้าไม่ใช่ QC Head
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const {
  findApprovers, roundKey, isAwaitingFinal, requestFinalResultApproval, webhookUrl, replyInbox, buildApprovalMail, sendMail,
} = require('../lib/finalResultEmail');

const args = process.argv.slice(2);
const SEND = args.includes('--send');
const FORCE = args.includes('--force');
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PREVIEW_TO = arg('--preview-to');
const PETITION_NO = arg('--petition');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';

async function main() {
  await mongoose.connect(URI);
  console.log('Webhook:', webhookUrl() || '(ปิดอยู่)', '· กล่องรับเมลตอบกลับ:', replyInbox());

  if (PREVIEW_TO) {
    const p = PETITION_NO
      ? await Petition.findOne({ petitionNo: PETITION_NO })
      : await Petition.findOne({ status: 'success', completedAt: { $ne: null } }).sort({ completedAt: 1 });
    if (!p) throw new Error('ไม่พบคำขอสำหรับทำตัวอย่าง');
    const mail = buildApprovalMail(p, { email: PREVIEW_TO, name: 'ผู้ทดสอบ (ตัวอย่าง)' }, { previewTo: PREVIEW_TO });
    console.log('ส่งตัวอย่าง', p.petitionNo, '→', PREVIEW_TO, JSON.stringify(await sendMail(mail)));
    return;
  }

  const approvers = await findApprovers();
  console.log('QC Head ' + approvers.length + ' คน: ' + approvers.map((a) => (a.name || '-') + ' <' + a.email + '>').join(', '));
  const petitions = await Petition.find({ status: 'success' }).sort({ completedAt: 1 });
  const awaiting = petitions.filter(isAwaitingFinal);
  const pending = FORCE ? awaiting : awaiting.filter((p) => p.finalResultEmail?.key !== roundKey(p));
  console.log('รอออก Final Report ' + awaiting.length + ' ใบ, จะส่ง ' + pending.length + ' ใบ' + (FORCE ? ' (--force)' : ''));
  for (const p of pending) {
    const requester = p.submittedBy?.email || '(ไม่มีอีเมลผู้ขอ)';
    if (!SEND) {
      console.log('  [dry-run] ' + p.petitionNo + ' · ผู้ขอ ' + (p.submittedBy?.name || '-') + ' ' + requester);
      continue;
    }
    const result = await requestFinalResultApproval(p, { force: FORCE });
    console.log('  ' + p.petitionNo + ' → ' + JSON.stringify(result));
  }
  if (!SEND) console.log('dry-run: ยังไม่ได้ส่ง ใส่ --send เพื่อส่งจริง');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
