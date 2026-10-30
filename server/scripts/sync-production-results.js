// ส่งผลย้อนหลังให้คำขอจาก Production ที่ LIS ปิดแล้ว แต่ Production ยังค้างสถานะ
// ใช้: node server/scripts/sync-production-results.js [P-2609-0022 ...]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const { sendProductionResult, DONE_STATUSES } = require('../lib/productionCallback');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB');
  const nos = process.argv.slice(2);
  const q = { 'productionWorkflow.requestNo': { $exists: true, $ne: '' }, status: { $in: DONE_STATUSES } };
  if (nos.length) q.petitionNo = { $in: nos };
  const docs = await Petition.find(q).lean();
  for (const d of docs) {
    try {
      const r = await sendProductionResult(d);
      console.log(d.petitionNo, d.productionWorkflow.requestNo, JSON.stringify(r));
    } catch (e) {
      console.error(d.petitionNo, 'FAILED', e.message);
    }
  }
  await mongoose.disconnect();
})();
