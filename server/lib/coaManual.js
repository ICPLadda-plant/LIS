const { lotSnapshot } = require('./coaErp');

// Manual ERP documents keep their entered results throughout the approval lifecycle.
function manualCoaSnapshots(input, itemSeq) {
  const fail = () => { throw new Error('กรุณาระบุชื่อการค้า ชื่อสามัญ Batch วันที่ผลิต และผลทดสอบให้ครบ'); };
  const clean = (value) => typeof value === 'string' ? value.trim().slice(0, 1000) : '';
  const sample = input?.sample;
  if (!sample || !Number.isInteger(itemSeq) || itemSeq < 1) fail();
  const sampleSnapshot = { itemSeq };
  for (const key of ['sampleName', 'commonName', 'batchNo', 'lotNo', 'productionDate', 'sampleId', 'condition', 'manufacturer']) {
    sampleSnapshot[key] = clean(sample[key]);
  }
  sampleSnapshot.productionDate = lotSnapshot(sampleSnapshot.lotNo).productionDate || sampleSnapshot.productionDate;
  if (!sampleSnapshot.sampleName || !sampleSnapshot.commonName || !sampleSnapshot.batchNo
    || !/^\d{4}-\d{2}-\d{2}$/.test(sampleSnapshot.productionDate)
    || Number.isNaN(Date.parse(sampleSnapshot.productionDate))
    || new Date(sampleSnapshot.productionDate).toISOString().slice(0, 10) !== sampleSnapshot.productionDate) fail();
  if (!Array.isArray(input.results) || !input.results.length || input.results.length > 50) fail();
  const resultSnapshots = input.results.map((row) => {
    if (!row || typeof row !== 'object') fail();
    const result = { itemSeq };
    for (const key of ['testItem', 'criteria', 'result', 'unit', 'method']) result[key] = clean(row[key]);
    if (!result.testItem || !result.criteria || !result.result) fail();
    return result;
  });
  return {
    sampleSnapshots: [sampleSnapshot], resultSnapshots,
    trendSnapshots: [{ itemSeq, sampleName: sampleSnapshot.sampleName, commonName: sampleSnapshot.commonName }],
  };
}

function validateManualCoa(doc) {
  return manualCoaSnapshots({ sample: doc.sampleSnapshots?.[0], results: doc.resultSnapshots }, doc.selectedItemSeqs?.[0]);
}

module.exports = { manualCoaSnapshots, validateManualCoa };
