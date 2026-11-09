const Sample = require('../models/Sample');
const PhysicalResult = require('../models/PhysicalResult');
const Approval = require('../models/Approval');
const RealtimeDensity = require('../models/RealtimeDensity');

function sampleIdsFromPetition(petition) {
  if (!petition || !Array.isArray(petition.items)) return [];
  return petition.items
    .map((item) => item.sampleId || `${petition.petitionNo}-${item.seq}`)
    .filter(Boolean);
}

// ซ่อนคำร้องพร้อมตัวอย่างและผลที่ผูกอยู่ (ใช้ทั้งตอน LIS ลบ/ยกเลิก และตอน Production ยกเลิก)
async function softDeletePetitionTree(doc, actor) {
  await doc.softDelete(actor);
  const sampleIds = sampleIdsFromPetition(doc);
  if (sampleIds.length > 0) {
    await Promise.all([
      Sample.softDeleteMany({ id: { $in: sampleIds } }, actor),
      PhysicalResult.softDeleteMany({ sampleId: { $in: sampleIds } }, actor),
      Approval.softDeleteMany({ sampleId: { $in: sampleIds } }, actor),
      RealtimeDensity.softDeleteMany({ sampleId: { $in: sampleIds } }, actor),
    ]);
  }
}

module.exports = { sampleIdsFromPetition, softDeletePetitionTree };
