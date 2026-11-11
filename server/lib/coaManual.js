const { lotSnapshot } = require('./coaErp');
const { isAiContentTestItem, resolveAiToleranceCriteria } = require('./aiToleranceCriteria');

// Manual ERP documents keep their entered results throughout the approval lifecycle.
function manualCoaSnapshots(input, itemSeq) {
  const fail = () => { throw new Error('กรุณาระบุชื่อการค้า ชื่อสามัญ Batch วันที่ผลิต และผลทดสอบให้ครบ'); };
  const clean = (value) => typeof value === 'string' ? value.trim().slice(0, 1000) : '';
  const samples = Array.isArray(input?.samples) ? input.samples : input?.sample ? [input.sample] : [];
  if (!samples.length || samples.length > 50 || !Number.isInteger(itemSeq) || itemSeq < 1) fail();
  const sampleSnapshots = samples.map((sample, index) => {
    const sampleSeq = Number(sample?.itemSeq || (index === 0 ? itemSeq : 0));
    if (!Number.isInteger(sampleSeq) || sampleSeq < 1) fail();
    const snapshot = { itemSeq: sampleSeq };
    for (const key of ['sampleName', 'commonName', 'batchNo', 'lotNo', 'productionDate', 'sampleId', 'condition', 'manufacturer']) {
      snapshot[key] = clean(sample[key]);
    }
    snapshot.productionDate = lotSnapshot(snapshot.batchNo).productionDate
      || lotSnapshot(snapshot.lotNo).productionDate
      || snapshot.productionDate;
    if (!snapshot.sampleName || !snapshot.commonName || !snapshot.batchNo
      || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.productionDate)
      || Number.isNaN(Date.parse(snapshot.productionDate))
      || new Date(snapshot.productionDate).toISOString().slice(0, 10) !== snapshot.productionDate) fail();
    return snapshot;
  });
  const sampleBySeq = new Map(sampleSnapshots.map((sample) => [sample.itemSeq, sample]));
  if (sampleBySeq.size !== sampleSnapshots.length) fail();
  if (!Array.isArray(input.results) || !input.results.length || input.results.length > 250) fail();
  const resultSnapshots = input.results.map((row) => {
    if (!row || typeof row !== 'object') fail();
    const resultSeq = Number(row.itemSeq || itemSeq);
    if (!sampleBySeq.has(resultSeq)) fail();
    const result = { itemSeq: resultSeq };
    for (const key of ['testItem', 'criteria', 'result', 'unit', 'method']) result[key] = clean(row[key]);
    if (!result.testItem || !result.criteria || !result.result) fail();
    if (isAiContentTestItem(result.testItem)) {
      result.criteria = resolveAiToleranceCriteria(sampleBySeq.get(resultSeq).commonName, result.criteria) || result.criteria;
    }
    return result;
  });
  if (sampleSnapshots.some((sample) => !resultSnapshots.some((row) => row.itemSeq === sample.itemSeq))) fail();
  return {
    sampleSnapshots, resultSnapshots,
    trendSnapshots: sampleSnapshots.map((sample) => ({ itemSeq: sample.itemSeq, sampleName: sample.sampleName, commonName: sample.commonName })),
  };
}

function validateManualCoa(doc) {
  return manualCoaSnapshots({ samples: doc.sampleSnapshots, results: doc.resultSnapshots }, doc.selectedItemSeqs?.[0]);
}

module.exports = { manualCoaSnapshots, validateManualCoa };
