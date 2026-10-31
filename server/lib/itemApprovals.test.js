const test = require('node:test');
const assert = require('node:assert');
const {
  itemRequiresSide,
  itemSideStatus,
  allItemsApproved,
  approvedBatchNos,
  upsertItemApproval,
  clearSideApprovals,
  overallConclusion,
  batchResultSummary,
} = require('./itemApprovals');

function petition(overrides = {}) {
  return {
    status: 'inProgress',
    submittedBy: { name: 'ผลิต', department: 'ผลิต 01' },
    items: [
      { seq: 1, batchNo: 'B1', sendToQc: true, sendToLab: true },
      { seq: 2, batchNo: 'B2', sendToQc: true, sendToLab: false },
      { seq: 3, batchNo: 'B3', sendToQc: false, sendToLab: true },
    ],
    itemApprovals: [],
    ...overrides,
  };
}

test('respects production send targets per item', () => {
  const p = petition();
  assert.deepStrictEqual(p.items.map((it) => [itemRequiresSide(p, it, 'qc'), itemRequiresSide(p, it, 'lab')]), [
    [true, true],
    [true, false],
    [false, true],
  ]);
});

test('petition is fully approved only when every required side of every item is approved', () => {
  const p = petition();
  const approve = (seq, side) => upsertItemApproval(p, { seq, side, status: 'approved', conclusion: 'pass' });
  approve(1, 'qc');
  approve(2, 'qc');
  approve(3, 'lab');
  assert.strictEqual(allItemsApproved(p), false);
  assert.deepStrictEqual(approvedBatchNos(p), ['B2', 'B3']);
  approve(1, 'lab');
  assert.strictEqual(allItemsApproved(p), true);
  assert.deepStrictEqual(approvedBatchNos(p), ['B1', 'B2', 'B3']);
});

test('upsert replaces the previous decision for the same item and side', () => {
  const p = petition();
  upsertItemApproval(p, { seq: 1, side: 'qc', status: 'rejected', note: 'ผิด' });
  upsertItemApproval(p, { seq: 1, side: 'qc', status: 'approved', conclusion: 'pass' });
  assert.strictEqual(p.itemApprovals.length, 1);
  assert.strictEqual(itemSideStatus(p, p.items[0], 'qc'), 'approved');
});

test('clearing a side keeps the other side decisions', () => {
  const p = petition();
  upsertItemApproval(p, { seq: 1, side: 'qc', status: 'approved' });
  upsertItemApproval(p, { seq: 1, side: 'lab', status: 'approved' });
  clearSideApprovals(p, 'lab');
  assert.deepStrictEqual(p.itemApprovals.map((e) => e.side), ['qc']);
});

test('legacy approved petitions without item data count as approved', () => {
  const p = petition({ status: 'approved' });
  assert.strictEqual(itemSideStatus(p, p.items[0], 'lab'), 'approved');
});

test('accepted out-of-spec items make the overall conclusion accepted-oos and the batch summary fail', () => {
  const p = petition();
  upsertItemApproval(p, { seq: 1, side: 'qc', status: 'approved', conclusion: 'pass' });
  upsertItemApproval(p, { seq: 1, side: 'lab', status: 'approved', conclusion: 'accepted-oos', note: 'ลูกค้ายอมรับ' });
  assert.strictEqual(overallConclusion(p).conclusion, 'accepted-oos');
  assert.match(overallConclusion(p).note, /รายการที่ 1 \(Lab\): ลูกค้ายอมรับ/);
  assert.strictEqual(batchResultSummary(p, 'B1'), 'กายภาพผ่าน · %AIไม่ผ่าน');
});
