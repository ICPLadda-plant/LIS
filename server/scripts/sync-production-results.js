// ส่งสถานะปัจจุบันของคำขอจาก Production ไปให้ Production ทุกใบ (หรือเฉพาะเลขที่ระบุ)
// ใช้: node server/scripts/sync-production-results.js [P-2609-0022 ...]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Petition = require('../models/Petition');
const { syncPetition } = require('../lib/productionCallback');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB');
  const nos = process.argv.slice(2);
  const q = { 'productionWorkflow.requestNo': { $exists: true, $ne: '' } };
  if (nos.length) q.petitionNo = { $in: nos };
  const docs = await Petition.find(q, { _id: 1, petitionNo: 1, 'productionWorkflow.requestNo': 1 }).lean();
  let ok = 0; let failed = 0;
  for (const d of docs) {
    try {
      const r = await syncPetition(d._id, { force: true });
      ok++;
      console.log(d.petitionNo, d.productionWorkflow.requestNo, JSON.stringify(r));
    } catch (e) {
      failed++;
      console.error(d.petitionNo, 'FAILED', e.message);
    }
  }
  console.log(`done: ${ok} ok, ${failed} failed`);
  await mongoose.disconnect();
})();
