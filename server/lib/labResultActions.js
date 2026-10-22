const QCTestResult = require('../models/QCTestResult');
const Parameter = require('../models/Parameter');

// ผล Lab = QCTestResult ของ parameter scope "lab" เท่านั้น (ค่า QC ที่แชร์ให้ Lab ดูเป็นของฝั่ง QC)
async function labResultDocs(petitionId) {
  const docs = await QCTestResult.find({ petitionId: String(petitionId) }).lean();
  if (!docs.length) return [];
  const labParams = await Parameter.find(
    { _id: { $in: [...new Set(docs.map((doc) => doc.parameterId))] }, scope: 'lab' },
    { _id: 1 },
  ).lean();
  const labIds = new Set(labParams.map((param) => String(param._id)));
  return docs.filter((doc) => labIds.has(String(doc.parameterId)));
}

function snapshotOf(docs) {
  return docs.map(({ _id, __v, ...rest }) => ({ _id: String(_id), ...rest }));
}

async function clearLabResults(petitionId) {
  const docs = await labResultDocs(petitionId);
  if (docs.length) await QCTestResult.deleteMany({ _id: { $in: docs.map((doc) => doc._id) } });
  return snapshotOf(docs);
}

// คืนผล Lab ให้ตรงกับ snapshot ทุกประการ (ลบ doc ที่เกิดใหม่ระหว่างแก้ไขด้วย)
async function restoreLabResults(petitionId, snapshot) {
  await clearLabResults(petitionId);
  const rows = (snapshot || []).map(({ _id, ...rest }) => ({ _id, ...rest }));
  if (rows.length) await QCTestResult.insertMany(rows);
}

module.exports = { labResultDocs, snapshotOf, clearLabResults, restoreLabResults };
