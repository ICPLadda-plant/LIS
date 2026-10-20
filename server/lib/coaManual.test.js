const test = require('node:test');
const assert = require('node:assert/strict');
const { manualCoaSnapshots, validateManualCoa } = require('./coaManual');
const CoaDocument = require('../models/CoaDocument');

const input = () => ({
  sample: { sampleName: ' Product ', commonName: 'Chemical 24%', batchNo: 'B1', productionDate: '2026-10-01' },
  results: [{ testItem: 'Appearance', criteria: 'Clear liquid', result: 'Conform', unit: '', method: 'Visual' }],
});

test('manual snapshots use the ERP line and preserve entered test results', () => {
  const snapshots = manualCoaSnapshots(input(), 10000);
  assert.equal(snapshots.sampleSnapshots[0].sampleName, 'Product');
  assert.equal(snapshots.resultSnapshots[0].itemSeq, 10000);
  assert.equal(snapshots.resultSnapshots[0].method, 'Visual');
  assert.deepEqual(validateManualCoa({ ...snapshots, selectedItemSeqs: [10000] }), snapshots);
});

test('manual snapshots replace a stale production date with the six-digit Lot No. date', () => {
  const data = input();
  data.sample.lotNo = '26S-PCB25-480-091069';
  data.sample.productionDate = '2026-06-18';

  const snapshots = manualCoaSnapshots(data, 10000);

  assert.equal(snapshots.sampleSnapshots[0].productionDate, '2026-10-09');
});

test('manual snapshots reject missing fields, invalid dates and empty results', () => {
  for (const mutate of [
    (data) => { data.sample.batchNo = ' '; },
    (data) => { data.sample.productionDate = '2026-02-30'; },
    (data) => { data.results = []; },
    (data) => { data.results[0].result = ''; },
    (data) => { data.results[0].criteria = ''; },
  ]) {
    const data = input(); mutate(data);
    assert.throws(() => manualCoaSnapshots(data, 1), /กรุณาระบุ/);
  }
});

test('ERP manual documents validate without a petition while lab documents require one', () => {
  const manual = new CoaDocument({ sourceType: 'erpManual', externalRequestId: 'erp-line-1', ...manualCoaSnapshots(input(), 1) });
  assert.equal(manual.validateSync(), undefined);
  assert.ok(new CoaDocument({ sourceType: 'lab' }).validateSync().errors.petitionId);
});
