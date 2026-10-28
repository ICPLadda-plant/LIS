const test = require('node:test');
const assert = require('node:assert');
const {
  isLabBatch,
  shouldSendItemToLab,
  hasLabTrack,
  hasFilledValue,
  qcParamAppliesToItem,
  computeQcHeuristic,
  enteredFieldLabels,
} = require('./petitionStatusLog');

// helper: a QC param with N countable text fields (labels f1..fN)
function qcParam(id, name, commonNames, fieldLabels) {
  return {
    _id: id, name, status: 'active', scope: 'qc', commonNames,
    valueFields: (fieldLabels || []).map((label) => ({ label, type: 'text' })),
  };
}

test('isLabBatch: last char 1 or 6 → true; else false; null-safe', () => {
  assert.strictEqual(isLabBatch('AB1'), true);
  assert.strictEqual(isLabBatch('AB6'), true);
  assert.strictEqual(isLabBatch('AB2'), false);
  assert.strictEqual(isLabBatch('  AB1  '), true);
  assert.strictEqual(isLabBatch(''), false);
  assert.strictEqual(isLabBatch(null), false);
  assert.strictEqual(isLabBatch(undefined), false);
});

test('shouldSendItemToLab: explicit sendToLab overrides batch suffix default', () => {
  assert.strictEqual(shouldSendItemToLab({ batchNo: 'AB1' }), true);
  assert.strictEqual(shouldSendItemToLab({ batchNo: 'AB1', sendToLab: false }), false);
  assert.strictEqual(shouldSendItemToLab({ batchNo: 'AB2', sendToLab: true }), true);
  assert.strictEqual(hasLabTrack({ items: [{ batchNo: 'AB1', sendToLab: false }] }), false);
  assert.strictEqual(hasLabTrack({ items: [{ batchNo: 'AB2', sendToLab: true }] }), true);
});

test('shouldSendItemToLab: PUBLIC HEALTH and LIVE STOCK always route to Lab', () => {
  assert.strictEqual(shouldSendItemToLab({ commonName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)', batchNo: 'AB2', sendToLab: false }), true);
  assert.strictEqual(shouldSendItemToLab({ sampleName: 'BIFENTHRIN 10% W/V EC (LIVE STOCK)', batchNo: 'AB2' }), true);
  assert.strictEqual(hasLabTrack({ items: [{ commonName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)', batchNo: 'AB2', sendToLab: false }] }), true);
});

test('hasFilledValue: empty/blank → false, value → true', () => {
  assert.strictEqual(hasFilledValue({}), false);
  assert.strictEqual(hasFilledValue({ a: '' }), false);
  assert.strictEqual(hasFilledValue({ a: '  ' }), false);
  assert.strictEqual(hasFilledValue(null), false);
  assert.strictEqual(hasFilledValue({ a: '7' }), true);
  assert.strictEqual(hasFilledValue({ a: 0 }), true);
});

test('qcParamAppliesToItem: applyAll matches anything', () => {
  assert.strictEqual(qcParamAppliesToItem({ applyAll: true }, { sampleName: 'X' }), true);
});

test('qcParamAppliesToItem: commonName match (case-insensitive)', () => {
  const p = { commonNames: ['NaOH'] };
  assert.strictEqual(qcParamAppliesToItem(p, { commonName: 'naoh' }), true);
  assert.strictEqual(qcParamAppliesToItem(p, { commonName: 'KCl' }), false);
});

test('qcParamAppliesToItem: itemNames match sampleName', () => {
  assert.strictEqual(qcParamAppliesToItem({ itemNames: ['ตัวอย่าง A'] }, { sampleName: 'ตัวอย่าง A' }), true);
});

test('qcParamAppliesToItem: testItems name match', () => {
  assert.strictEqual(qcParamAppliesToItem({ name: 'pH' }, { testItems: 'pH, ความชื้น' }), true);
});

test('computeQcHeuristic: field-level — 1 of 2 fields in ONE param → 50% (not 100%)', () => {
  const petition = { items: [{ seq: 1, commonName: 'NaOH' }] };
  // single param "กายภาพ" with 2 fields (สี, กลิ่น)
  const parameters = [qcParam('p1', 'กายภาพ', ['NaOH'], ['สี', 'กลิ่น'])];
  const qcResults = [{ itemSeq: 1, parameterId: 'p1', values: { สี: 'แดง' } }];
  assert.deepStrictEqual(
    computeQcHeuristic(petition, qcResults, parameters),
    { filled: 1, total: 2, percent: 50 },
  );
});

test('computeQcHeuristic: total counts every countable field across params; photo excluded', () => {
  const petition = { items: [{ seq: 1, commonName: 'NaOH' }] };
  const parameters = [
    qcParam('p1', 'กายภาพ', ['NaOH'], ['สี', 'กลิ่น']),
    {
      _id: 'p2', name: 'รูป', status: 'active', scope: 'qc', commonNames: ['NaOH'],
      valueFields: [{ label: 'ภาพถ่าย', type: 'photo' }, { label: 'หมายเหตุ', type: 'text' }],
    },
  ];
  // total = 2 (กายภาพ) + 1 (รูป: photo excluded, หมายเหตุ counts) = 3
  assert.strictEqual(computeQcHeuristic(petition, [], parameters).total, 3);
});

test('computeQcHeuristic: no matched params → total 0, percent 0', () => {
  const petition = { items: [{ seq: 1, commonName: 'X', sampleName: 'S' }] };
  const parameters = [qcParam('p1', 'pH', ['NaOH'], ['v'])];
  assert.deepStrictEqual(computeQcHeuristic(petition, [], parameters), { filled: 0, total: 0, percent: 0 });
});

test('computeQcHeuristic: lab-scope and inactive params excluded', () => {
  const petition = { items: [{ seq: 1, commonName: 'NaOH' }] };
  const parameters = [
    { _id: 'p1', name: 'pH', status: 'active', scope: 'lab', applyAll: true, valueFields: [{ label: 'v', type: 'text' }] },
    { _id: 'p2', name: 'x', status: 'inactive', scope: 'qc', applyAll: true, valueFields: [{ label: 'v', type: 'text' }] },
  ];
  assert.strictEqual(computeQcHeuristic(petition, [], parameters).total, 0);
});

test('computeQcHeuristic: filled capped at total (percent never > 100)', () => {
  const petition = { items: [{ seq: 1, commonName: 'NaOH' }] };
  const parameters = [qcParam('p1', 'pH', ['NaOH'], ['v'])];
  const qcResults = [
    { itemSeq: 1, parameterId: 'p1', values: { v: '7' } },
    { itemSeq: 1, parameterId: 'pX', values: { extra: '7' } },
  ];
  const r = computeQcHeuristic(petition, qcResults, parameters);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.filled, 1);
  assert.strictEqual(r.percent, 100);
});

test('enteredFieldLabels: "param › field" distinct, ordered by enteredAt, blanks ignored', () => {
  const qcResults = [
    { parameterName: 'ความชื้น', values: { ค่า: '1' }, enteredAt: '2026-06-10T02:00:00Z' },
    { parameterName: 'กายภาพ', values: { สี: 'แดง', กลิ่น: '' }, enteredAt: '2026-06-10T01:00:00Z' },
    { parameterName: 'กายภาพ', values: { สี: 'ม่วง' }, enteredAt: '2026-06-10T03:00:00Z' },
    { parameterName: 'ไม่นับ', values: {}, enteredAt: '2026-06-10T00:00:00Z' },
  ];
  // กายภาพ(01:00 สี) → ความชื้น(02:00 ค่า) → กายภาพ(03:00 สี dup, skipped); กลิ่น blank skipped
  assert.deepStrictEqual(enteredFieldLabels(qcResults), ['กายภาพ › สี', 'ความชื้น › ค่า']);
});

test('enteredFieldLabels: substance key label::สาร → "param › label — สาร"', () => {
  const qcResults = [{ parameterName: 'ความเข้มข้น', values: { 'pct::NaOH': '40' }, enteredAt: '1' }];
  assert.deepStrictEqual(enteredFieldLabels(qcResults), ['ความเข้มข้น › pct — NaOH']);
});

// ─── Task 2: buildCurrent (dual-track) ───────────────────────────────────────
const { buildCurrent } = require('./petitionStatusLog');

const QC0 = { filled: 0, total: 0, percent: 0 };
const ASSIGNEE = { name: 'สมชาย', assignedBy: 'แอดมิน' };

// terminal / pre-receive — single label, no tracks
test('current: approved', () => {
  assert.deepStrictEqual(
    buildCurrent({ status: 'approved', items: [] }, QC0, [], true),
    { label: 'หัวหน้า QC ออก Final Result — ปิดงาน' },
  );
});

test('current: rejected', () => {
  assert.deepStrictEqual(
    buildCurrent({ status: 'rejected', items: [] }, QC0, [], true),
    { label: 'ส่งกลับให้แก้ไข' },
  );
});

test('current: success', () => {
  assert.deepStrictEqual(
    buildCurrent({ status: 'success', items: [] }, QC0, [], true),
    { label: 'เสร็จสิ้น — รอหัวหน้า QC ยืนยัน', side: 'qc' },
  );
});

test('current: sampleSent, neither received → single label', () => {
  assert.deepStrictEqual(
    buildCurrent({ status: 'sampleSent', items: [{ batchNo: 'B-1' }] }, QC0, [], false),
    { label: 'ส่งตัวอย่างแล้ว — รอรับ' },
  );
});

test('current: deliveringQC, neither received → single label', () => {
  assert.deepStrictEqual(
    buildCurrent({ status: 'deliveringQC', items: [] }, QC0, [], true),
    { label: 'กำลังนำส่ง QC' },
  );
});

// dual-track — one side received
test('current: only QC received, no lab item → QC track only', () => {
  const p = { status: 'pendingReview', items: [{ batchNo: 'B-2' }], qcReceivedAt: 'T' };
  assert.deepStrictEqual(buildCurrent(p, QC0, [], true), {
    label: 'QC รับแล้ว',
    tracks: { qc: { side: 'qc', label: 'QC รับแล้ว' } },
  });
});

test('current: only QC received, has lab item → QC รับแล้ว | Lab รอรับ', () => {
  const p = { status: 'pendingReview', items: [{ batchNo: 'B-1' }], qcReceivedAt: 'T' };
  assert.deepStrictEqual(buildCurrent(p, QC0, [], false), {
    label: 'QC รับแล้ว | Lab รอรับ',
    tracks: { qc: { side: 'qc', label: 'QC รับแล้ว' }, lab: { side: 'lab', label: 'Lab รอรับ' } },
  });
});

test('current: only Lab received, has lab item → QC รอรับ | Lab รับแล้ว', () => {
  const p = { status: 'pendingReview', items: [{ batchNo: 'B-1' }], labReceivedAt: 'T' };
  assert.deepStrictEqual(buildCurrent(p, QC0, [], false), {
    label: 'QC รอรับ | Lab รับแล้ว',
    tracks: { qc: { side: 'qc', label: 'QC รอรับ' }, lab: { side: 'lab', label: 'Lab รับแล้ว' } },
  });
});

// assignment shows ONLY on the assignee's side (derived from dept/position)
const LAB_ASSIGNEE = { name: 'อนล', department: 'Lab/วิเคราะห์', position: 'Lab Analyst' };

// QC-side assignee → assign line on QC, Lab is just "รับแล้ว"
test('current: both received + QC-assignee + not started → QC มอบหมาย | Lab รับแล้ว', () => {
  const p = {
    status: 'pendingReview', items: [{ batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', assignedTo: ASSIGNEE, reviewHistory: [],
  };
  assert.deepStrictEqual(buildCurrent(p, QC0, [], false), {
    label: 'QC มอบหมายงานแล้ว รอเจ้าหน้าที่รับงาน | Lab รับแล้ว',
    tracks: {
      qc: { side: 'qc', label: 'QC มอบหมายงานแล้ว รอเจ้าหน้าที่รับงาน' },
      lab: { side: 'lab', label: 'Lab รับแล้ว' },
    },
  });
});

// Lab-side assignee → assign line on Lab, QC is just "รับแล้ว" (the P-2606-0001 case)
test('current: both received + Lab-assignee + not started → QC รับแล้ว | Lab มอบหมาย', () => {
  const p = {
    status: 'pendingReview', items: [{ batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', assignedTo: LAB_ASSIGNEE, reviewHistory: [],
  };
  assert.deepStrictEqual(buildCurrent(p, QC0, [], false), {
    label: 'QC รับแล้ว | เจ้าหน้าที่กำลังวิเคราะห์',
    tracks: {
      qc: { side: 'qc', label: 'QC รับแล้ว' },
      lab: { side: 'lab', label: 'เจ้าหน้าที่กำลังวิเคราะห์' },
    },
  });
});

// started (accepted via startTesting) — only the assignee side flips to รับงานแล้ว
test('current: QC-assignee + startTesting → QC รับงานแล้ว | Lab รับแล้ว', () => {
  const p = {
    status: 'inProgress', items: [{ batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', assignedTo: ASSIGNEE,
    reviewHistory: [{ action: 'startTesting' }],
  };
  assert.deepStrictEqual(buildCurrent(p, QC0, [], false), {
    label: 'QC สมชาย รับงานแล้ว · กำลังตรวจ | Lab รับแล้ว',
    tracks: {
      qc: { side: 'qc', label: 'QC สมชาย รับงานแล้ว · กำลังตรวจ' },
      lab: { side: 'lab', label: 'Lab รับแล้ว' },
    },
  });
});

test('current: Lab-assignee + startTesting → QC รับแล้ว | Lab รับงานแล้ว', () => {
  const p = {
    status: 'inProgress', items: [{ batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', assignedTo: LAB_ASSIGNEE,
    reviewHistory: [{ action: 'startTesting' }],
  };
  assert.deepStrictEqual(buildCurrent(p, QC0, [], false), {
    label: 'QC รับแล้ว | Lab อนล รับงานแล้ว · กำลังตรวจ',
    tracks: {
      qc: { side: 'qc', label: 'QC รับแล้ว' },
      lab: { side: 'lab', label: 'Lab อนล รับงานแล้ว · กำลังตรวจ' },
    },
  });
});

// QC actively entering values → QC track shows progress regardless of assignee side
test('current: QC entering values (Lab-assignee) → QC % | Lab รับงานแล้ว', () => {
  const p = {
    status: 'inProgress', items: [{ batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', assignedTo: LAB_ASSIGNEE, reviewHistory: [],
  };
  assert.deepStrictEqual(buildCurrent(p, { filled: 1, total: 2, percent: 45 }, ['pH', 'ความชื้น'], false), {
    label: 'QC กำลังตรวจ — pH, ความชื้น (45%) | Lab อนล รับงานแล้ว · กำลังตรวจ',
    tracks: {
      qc: { side: 'qc', label: 'QC กำลังตรวจ — pH, ความชื้น (45%)', percent: 45 },
      lab: { side: 'lab', label: 'Lab อนล รับงานแล้ว · กำลังตรวจ' },
    },
  });
});

// QC done (qcCompletedAt set — the authoritative confirm), lab still running
test('current: QC completed + lab not done (Lab-assignee) → QC ตรวจครบ | Lab รับงานแล้ว', () => {
  const p = {
    status: 'inProgress', items: [{ batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', qcCompletedAt: 'T',
    assignedTo: LAB_ASSIGNEE, reviewHistory: [],
  };
  assert.deepStrictEqual(buildCurrent(p, { filled: 2, total: 2, percent: 100 }, ['pH'], false), {
    label: 'QC ตรวจครบ — รอยืนยัน | Lab อนล รับงานแล้ว · กำลังตรวจ',
    tracks: {
      qc: { side: 'qc', label: 'QC ตรวจครบ — รอยืนยัน' },
      lab: { side: 'lab', label: 'Lab อนล รับงานแล้ว · กำลังตรวจ' },
    },
  });
});

// dual-track — keep completed Lab visible while QC continues
test('current: QC completed + lab done → both completed tracks remain visible', () => {
  const p = {
    status: 'inProgress', items: [{ batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', qcCompletedAt: 'T',
    assignedTo: ASSIGNEE, reviewHistory: [],
  };
  assert.deepStrictEqual(buildCurrent(p, { filled: 2, total: 2, percent: 100 }, ['pH'], true), {
    label: 'QC ตรวจครบ — รอยืนยัน | Lab ตรวจครบ — รอออกผล',
    tracks: {
      qc: { side: 'qc', label: 'QC ตรวจครบ — รอยืนยัน' },
      lab: { side: 'lab', label: 'Lab ตรวจครบ — รอออกผล' },
    },
  });
});

// REGRESSION (P-2606-0013): heuristic filled>=total inflates to 100% (per-substance
// keys + stray result rows count toward `filled` but not `total`), yet QC has NOT
// confirmed completion (no qcCompletedAt). Must stay "กำลังตรวจ", never claim ตรวจครบ,
// and never display 100% before the authoritative flag flips.
test('current: heuristic 100% but qcCompletedAt absent → กำลังตรวจ (capped 99%), never ตรวจครบ', () => {
  const p = {
    status: 'inProgress', items: [{ batchNo: 'B-2' }],
    qcReceivedAt: 'T', assignedTo: ASSIGNEE, reviewHistory: [],
    // qcCompletedAt intentionally absent — QC has not pressed บันทึกผล/ยืนยัน
  };
  assert.deepStrictEqual(buildCurrent(p, { filled: 3, total: 3, percent: 100 }, ['pH'], true), {
    label: 'QC กำลังตรวจ — pH (99%)',
    tracks: { qc: { side: 'qc', label: 'QC กำลังตรวจ — pH (99%)', percent: 99 } },
  });
});

// no lab item → only QC track ever
test('current: no lab item, QC entering → QC track only', () => {
  const p = {
    status: 'inProgress', items: [{ batchNo: 'B-2' }],
    qcReceivedAt: 'T', assignedTo: ASSIGNEE, reviewHistory: [],
  };
  assert.deepStrictEqual(buildCurrent(p, { filled: 1, total: 2, percent: 50 }, ['pH'], true), {
    label: 'QC กำลังตรวจ — pH (50%)',
    tracks: { qc: { side: 'qc', label: 'QC กำลังตรวจ — pH (50%)', percent: 50 } },
  });
});

// ─── Task 3: buildTimeline / timelineLabel ───────────────────────────────────
const { buildTimeline, timelineLabel } = require('./petitionStatusLog');

test('timeline: maps milestone events in order; skips non-milestones', () => {
  const petition = { assignedTo: { name: 'สมชาย' } };
  const logs = [
    { event: 'created', createdAt: '1', actor: 'u1' },
    { event: 'statusChanged', toStatus: 'sampleSent', createdAt: '2', actor: 'u1' },
    { event: 'received', metadata: { side: 'qc' }, createdAt: '3', actor: 'qc1' },
    { event: 'received', metadata: { side: 'lab' }, createdAt: '4', actor: 'lab1' },
    { event: 'assigned', createdAt: '5', actor: 'm1' },
    { event: 'resultEntered', metadata: { parameterName: 'pH' }, createdAt: '6', actor: 'qc1' },
    { event: 'resultUpdated', metadata: { parameterName: 'pH' }, createdAt: '7', actor: 'qc1' },
    { event: 'reviewed', createdAt: '8', actor: 'x' },
    { event: 'updated', createdAt: '9', actor: 'x' },
    { event: 'statusChanged', toStatus: 'inProgress', createdAt: '10', actor: 'x' },
    { event: 'statusChanged', toStatus: 'success', createdAt: '11', actor: 'x' },
    { event: 'statusChanged', toStatus: 'approved', createdAt: '12', actor: 'boss' },
  ];
  assert.deepStrictEqual(buildTimeline(logs, petition).map((t) => t.label), [
    'ยื่นคำขอ',
    'ส่งตัวอย่าง',
    'QC รับตัวอย่าง',
    'Lab รับตัวอย่าง',
    'มอบหมายให้ สมชาย',
    'QC บันทึกผล — pH',
    'QC แก้ไขผล — pH',
    'เสร็จสิ้น — รอหัวหน้า QC ยืนยัน',
    'หัวหน้า QC ออก Final Result — ปิดงาน',
  ]);
});

test('timeline: received carries side; entries carry at + actor', () => {
  const logs = [{ event: 'received', metadata: { side: 'lab' }, createdAt: 'T', actor: 'lab1' }];
  assert.deepStrictEqual(buildTimeline(logs, {}), [
    { label: 'Lab รับตัวอย่าง', at: 'T', actor: 'lab1', side: 'lab' },
  ]);
});

test('timeline: assigned carries side derived from the assignee snapshot (lab)', () => {
  const logs = [{ event: 'assigned', metadata: { assignee: LAB_ASSIGNEE }, createdAt: 'T', actor: 'm1' }];
  assert.deepStrictEqual(buildTimeline(logs, { assignedTo: LAB_ASSIGNEE }), [
    { label: 'มอบหมายให้ อนล', at: 'T', actor: 'm1', side: 'lab' },
  ]);
});

test('timeline: assigned side falls back to petition.assignedTo when metadata lacks assignee', () => {
  const logs = [{ event: 'assigned', createdAt: 'T', actor: 'm1' }];
  assert.strictEqual(buildTimeline(logs, { assignedTo: LAB_ASSIGNEE })[0].side, 'lab');
});

test('timeline: assigned to a QC-side assignee carries side qc', () => {
  const logs = [{ event: 'assigned', metadata: { assignee: ASSIGNEE }, createdAt: 'T', actor: 'm1' }];
  assert.strictEqual(buildTimeline(logs, { assignedTo: ASSIGNEE })[0].side, 'qc');
});

test('timelineLabel: rejected status change', () => {
  assert.strictEqual(timelineLabel({ event: 'statusChanged', toStatus: 'rejected' }, {}), 'ส่งกลับให้แก้ไข');
});

test('timelineLabel: assigned falls back to note when no assignee name', () => {
  assert.strictEqual(timelineLabel({ event: 'assigned', note: 'มอบหมายให้ ก' }, {}), 'มอบหมายให้ ก');
});

test('timelineLabel: resultEntered with no param name', () => {
  assert.strictEqual(timelineLabel({ event: 'resultEntered', metadata: {} }, {}), 'QC บันทึกผล');
});

test('timelineLabel: unknown event → null (skipped)', () => {
  assert.strictEqual(timelineLabel({ event: 'deleted' }, {}), null);
});

// ─── Task 4: buildStatusLog ──────────────────────────────────────────────────
const { buildStatusLog } = require('./petitionStatusLog');

test('buildStatusLog: combines dual-track current + timeline', () => {
  const petition = {
    status: 'inProgress',
    items: [{ seq: 1, commonName: 'NaOH', batchNo: 'B-2' }], // non-lab batch → no lab track
    qcReceivedAt: 'T',
    assignedTo: { name: 'ก', assignedBy: 'แอดมิน' },
    reviewHistory: [],
  };
  const auditLogs = [{ event: 'created', createdAt: '1', actor: 'u' }];
  const parameters = [
    { _id: 'p1', name: 'pH', status: 'active', scope: 'qc', commonNames: ['NaOH'], valueFields: [{ label: 'ค่า', type: 'text' }] },
    { _id: 'p2', name: 'ความชื้น', status: 'active', scope: 'qc', commonNames: ['NaOH'], valueFields: [{ label: 'ค่า', type: 'text' }] },
  ];
  // 1 of 2 fields filled → 50%; field label shown as "param › field"
  const qcResults = [{ itemSeq: 1, parameterId: 'p1', parameterName: 'pH', values: { ค่า: '7' }, enteredAt: '1' }];
  const out = buildStatusLog(petition, auditLogs, qcResults, parameters, true);
  assert.strictEqual(out.current.label, 'QC กำลังตรวจ — pH › ค่า (50%)');
  assert.strictEqual(out.current.tracks.qc.side, 'qc');
  assert.strictEqual(out.current.tracks.qc.percent, 50);
  assert.strictEqual(out.current.tracks.lab, undefined);
  assert.deepStrictEqual(out.timeline.map((t) => t.label), ['ยื่นคำขอ']);
});

test('buildStatusLog: Lab %AI results never appear as QC progress', () => {
  const petition = {
    status: 'inProgress',
    items: [{ seq: 1, commonName: 'omethoate', batchNo: 'B-1' }],
    qcReceivedAt: 'T',
    labReceivedAt: 'T',
    reviewHistory: [],
  };
  const parameters = [
    { _id: 'density', name: 'Density', status: 'active', scope: 'qc', applyAll: true, valueFields: [{ label: 'density', type: 'number' }] },
    { _id: 'ai', name: '%AI', status: 'active', scope: 'lab', applyAll: true, valueFields: [{ label: 'Area Inj.1', type: 'number' }, { label: '%AI', type: 'number' }] },
  ];
  const results = [{
    itemSeq: 1, parameterId: 'ai', parameterName: '%AI',
    values: { 'Area Inj.1': '100', '%AI': '48.10' }, enteredAt: '1',
  }];

  const out = buildStatusLog(petition, [], results, parameters, false);

  assert.strictEqual(out.current.tracks.qc.label, 'QC รับแล้ว');
  assert.ok(!out.current.tracks.qc.label.includes('%AI'));
  assert.strictEqual(out.current.tracks.qc.percent, undefined);
  assert.strictEqual(out.current.tracks.lab['%AI'], '48.10');
});

test('buildStatusLog: completed Lab track remains visible with its %AI result', () => {
  const petition = {
    status: 'inProgress', items: [{ seq: 1, commonName: 'omethoate', batchNo: 'B-1' }],
    qcReceivedAt: 'T', labReceivedAt: 'T', labCompletedAt: 'T', reviewHistory: [],
  };
  const parameters = [
    { _id: 'density', name: 'Density', status: 'active', scope: 'qc', applyAll: true, valueFields: [{ label: 'density', type: 'number' }] },
    { _id: 'ai', name: '%AI', status: 'active', scope: 'lab', applyAll: true, valueFields: [{ label: '%AI', type: 'number' }] },
  ];
  const results = [
    { itemSeq: 1, parameterId: 'density', parameterName: 'Density', values: { density: '1.041' }, enteredAt: '1' },
    { itemSeq: 1, parameterId: 'ai', parameterName: '%AI', values: { '%AI': '48.10' }, enteredAt: '2' },
  ];

  const out = buildStatusLog(petition, [], results, parameters, true);

  assert.strictEqual(out.current.tracks.qc.density, '1.041');
  assert.strictEqual(out.current.tracks.lab.label, 'Lab ตรวจครบ — รอออกผล');
  assert.strictEqual(out.current.tracks.lab['%AI'], '48.10');
});

test('buildStatusLog: track result is empty before receive and waiting after receive', () => {
  const parameters = [
    { _id: 'density', name: 'ค่า ถพ.', scope: 'qc', status: 'active', applyAll: true, valueFields: [] },
    { _id: 'ai', name: '%AI', scope: 'lab', status: 'active', applyAll: true, valueFields: [] },
  ];
  const petition = { status: 'inProgress', items: [{ seq: 1, batchNo: 'B-1' }] };

  const labWaiting = buildStatusLog({ ...petition, qcReceivedAt: 'T' }, [], [], parameters, false);
  assert.strictEqual(labWaiting.current.tracks.qc.density, 'รอ QC ใส่ผล');
  assert.strictEqual(labWaiting.current.tracks.lab['%AI'], '');

  const qcWaiting = buildStatusLog({ ...petition, labReceivedAt: 'T' }, [], [], parameters, false);
  assert.strictEqual(qcWaiting.current.tracks.qc.density, '');
  assert.strictEqual(qcWaiting.current.tracks.lab['%AI'], 'รอ LAB ใส่ผล');

  const afterReceive = buildStatusLog(
    { ...petition, qcReceivedAt: 'T', labReceivedAt: 'T' },
    [],
    [],
    parameters,
    false,
  );
  assert.strictEqual(afterReceive.current.tracks.qc.density, 'รอ QC ใส่ผล');
  assert.strictEqual(afterReceive.current.tracks.lab['%AI'], 'รอ LAB ใส่ผล');

  const notRequested = buildStatusLog(
    { ...petition, items: [{ seq: 1, batchNo: 'B-1', testItems: 'pH' }], qcReceivedAt: 'T', labReceivedAt: 'T' },
    [],
    [],
    parameters,
    false,
  );
  assert.strictEqual(notRequested.current.tracks.qc.density, '');
  assert.strictEqual(notRequested.current.tracks.lab['%AI'], '');
});

test('buildStatusLog: %AI shows "ตรวจสอบใหม่" while a Lab re-check is pending and %AI was entered', () => {
  const parameters = [
    { _id: 'ai', name: '%AI', scope: 'lab', status: 'active', applyAll: true, valueFields: [] },
  ];
  const results = [{ itemSeq: 1, parameterId: 'ai', parameterName: '%AI', values: { '%AI': '48.10' } }];
  const base = {
    status: 'inProgress', qcReceivedAt: 'T', labReceivedAt: 'T',
    items: [{ seq: 1, batchNo: 'B-1' }],
    labRecheckRequestedAt: '2026-10-20T02:00:00.000Z',
  };

  const inProgress = buildStatusLog(base, [], results, parameters, false);
  assert.strictEqual(inProgress.current.tracks.lab['%AI'], 'ตรวจสอบใหม่');

  // Lab บันทึกผลแล้ว (labDone) — track Lab ต้องกลับมาให้เห็นว่ากำลังตรวจสอบใหม่
  const labDone = buildStatusLog({ ...base, labCompletedAt: 'T' }, [], results, parameters, true);
  assert.strictEqual(labDone.current.tracks.lab['%AI'], 'ตรวจสอบใหม่');

  const success = buildStatusLog({ ...base, status: 'success', labCompletedAt: 'T' }, [], results, parameters, true);
  assert.strictEqual(success.current.tracks.lab['%AI'], 'ตรวจสอบใหม่');

  // ยังไม่มี %AI → ยังรอ Lab ใส่ผลตามเดิม
  const noValue = buildStatusLog(base, [], [], parameters, false);
  assert.strictEqual(noValue.current.tracks.lab['%AI'], 'รอ LAB ใส่ผล');

  // หัวหน้า Lab ออกผลหลัง re-check แล้ว → กลับไปโชว์ค่าจริง
  const approved = buildStatusLog(
    { ...base, labApprovedAt: '2026-10-20T05:00:00.000Z' }, [], results, parameters, false,
  );
  assert.strictEqual(approved.current.tracks.lab['%AI'], '48.10');
});

test('buildStatusLog: recheck audit event appears on the Lab timeline', () => {
  const out = buildStatusLog(
    { status: 'inProgress', items: [{ seq: 1, batchNo: 'B-1' }] },
    [{ event: 'recheck', actor: 'Lab A', createdAt: 'T1' }],
    [], [], false,
  );
  assert.deepStrictEqual(out.timeline, [{ label: 'ขอตรวจสอบใหม่', at: 'T1', actor: 'Lab A', side: 'lab' }]);
});

test('buildStatusLog: sends density and %AI from original and additional Lab sample rounds', () => {
  const originalLab = {
    itemSeq: 1, parameterId: 'ai', parameterName: 'Active Ingredient',
    values: { '%AI': '9.80', 'Area Average': '123' },
  };
  const petition = {
    status: 'inProgress', qcReceivedAt: 'T', labReceivedAt: 'T',
    items: [{ seq: 1, sampleId: 'S-1', sampleName: 'ตัวอย่าง A', batchNo: 'B-1' }],
    additionalSampleRequests: [{
      _id: 'round-lab-1', side: 'lab', status: 'received',
      items: [{ itemSeq: 1 }], previousResults: [originalLab],
    }],
  };
  const parameters = [
    { _id: 'density', name: 'ค่า ถพ.', scope: 'qc', status: 'active', valueFields: [] },
    { _id: 'ai', name: 'Active Ingredient', scope: 'lab', status: 'active', valueFields: [] },
  ];
  const results = [
    {
      itemSeq: 1, parameterId: 'density', parameterName: 'ค่า ถพ.',
      values: { 'ค่าถพ.::สาร A': 1.052, 'ค่าถพ.::สาร A__source': { source: 'instrument' }, อุณหภูมิ: 30 },
    },
    {
      itemSeq: 1, parameterId: 'ai', parameterName: 'Active Ingredient', sampleRoundId: 'round-lab-1',
      values: { '%AI': '10.10' }, valuesPhase2: { '%AI': '10.20' },
      entries: [{ '%AI': '10.30' }],
    },
  ];

  const { current, testResults } = buildStatusLog(petition, [], results, parameters, false);
  assert.strictEqual(current.tracks.qc.density, '1.052');
  assert.strictEqual(current.tracks.lab['%AI'], '10.30');
  assert.deepStrictEqual(testResults, [
    { itemSeq: 1, sampleId: 'S-1', sampleName: 'ตัวอย่าง A', side: 'lab', sampleRoundId: '', parameterName: 'Active Ingredient', fieldLabel: '%AI', value: '9.80', phase: 1 },
    { itemSeq: 1, sampleId: 'S-1', sampleName: 'ตัวอย่าง A', side: 'qc', sampleRoundId: '', parameterName: 'ค่า ถพ.', fieldLabel: 'ค่าถพ.::สาร A', value: 1.052, phase: 1 },
    { itemSeq: 1, sampleId: 'S-1', sampleName: 'ตัวอย่าง A', side: 'lab', sampleRoundId: 'round-lab-1', parameterName: 'Active Ingredient', fieldLabel: '%AI', value: '10.10', phase: 1 },
    { itemSeq: 1, sampleId: 'S-1', sampleName: 'ตัวอย่าง A', side: 'lab', sampleRoundId: 'round-lab-1', parameterName: 'Active Ingredient', fieldLabel: '%AI', value: '10.20', phase: 2 },
    { itemSeq: 1, sampleId: 'S-1', sampleName: 'ตัวอย่าง A', side: 'lab', sampleRoundId: 'round-lab-1', parameterName: 'Active Ingredient', fieldLabel: '%AI', value: '10.30', phase: 1, entryIndex: 0 },
  ]);
});

test('buildStatusLog: keeps each Lab reading once while a new sample is pending', () => {
  const oldResult = { itemSeq: 1, parameterId: 'ai', values: { '%AI': 9.8 } };
  const petition = {
    status: 'inProgress', items: [{ seq: 1, batchNo: 'B-1' }],
    additionalSampleRequests: [{ side: 'lab', status: 'requested', previousResults: [oldResult] }],
  };
  const parameters = [{ _id: 'ai', name: 'AI', scope: 'lab', status: 'active', valueFields: [] }];
  const { testResults } = buildStatusLog(petition, [], [oldResult], parameters, false);
  assert.deepStrictEqual(testResults.map(({ value, sampleRoundId }) => ({ value, sampleRoundId })), [
    { value: 9.8, sampleRoundId: '' },
  ]);
});

// ─── isPetitionComplete (success gate) ───────────────────────────────────────
const { isPetitionComplete } = require('./petitionStatusLog');

test('isPetitionComplete: no lab item — QC done alone → complete', () => {
  assert.strictEqual(
    isPetitionComplete({ items: [{ batchNo: 'B-2' }], qcCompletedAt: 'T' }),
    true,
  );
});

test('isPetitionComplete: no lab item — QC not done → incomplete', () => {
  assert.strictEqual(isPetitionComplete({ items: [{ batchNo: 'B-2' }] }), false);
});

test('isPetitionComplete: lab item — QC done but lab not → incomplete (wait for lab)', () => {
  assert.strictEqual(
    isPetitionComplete({ items: [{ batchNo: 'B-1' }], qcCompletedAt: 'T' }),
    false,
  );
});

test('isPetitionComplete: lab item — lab done but QC not → incomplete (QC always required)', () => {
  assert.strictEqual(
    isPetitionComplete({ items: [{ batchNo: 'B-1' }], labCompletedAt: 'T' }),
    false,
  );
});

test('isPetitionComplete: lab item — qc done + lab APPROVED → complete', () => {
  assert.strictEqual(
    isPetitionComplete({ items: [{ batchNo: 'B-1' }], qcCompletedAt: 'T', labApprovedAt: 'T' }),
    true,
  );
});

test('isPetitionComplete: lab item — qc done + lab COMPLETED but NOT approved → incomplete', () => {
  assert.strictEqual(
    isPetitionComplete({ items: [{ batchNo: 'B-1' }], qcCompletedAt: 'T', labCompletedAt: 'T' }),
    false,
  );
});

test('isPetitionComplete: null-safe', () => {
  assert.strictEqual(isPetitionComplete(null), false);
  assert.strictEqual(isPetitionComplete({}), false);
});

test('isPetitionComplete: R&D requires Lab approval but not QC completion', () => {
  assert.strictEqual(
    isPetitionComplete({
      submittedBy: { department: 'R & D' },
      items: [{ batchNo: '' }],
      labApprovedAt: 'T',
    }),
    true,
  );
  assert.strictEqual(
    isPetitionComplete({
      submittedBy: { department: 'R & D' },
      items: [{ batchNo: '' }],
      qcCompletedAt: 'T',
    }),
    false,
  );
});

test('buildStatusLog: R&D has a Lab track and no QC track', () => {
  const out = buildStatusLog(
    {
      status: 'sampleSent',
      submittedBy: { department: 'R & D' },
      items: [{ seq: 1, sampleName: 'R&D sample', batchNo: '' }],
    },
    [],
    [],
    [],
    false,
  );
  assert.strictEqual(out.current.tracks.lab.side, 'lab');
  assert.strictEqual(out.current.tracks.qc, undefined);
});

test('qcParamAppliesToItem: excluded commonName wins over applyAll', () => {
  assert.strictEqual(qcParamAppliesToItem({ applyAll: true, excludeCommonNames: ['EC'] }, { commonName: 'ec' }), false);
  assert.strictEqual(qcParamAppliesToItem({ applyAll: true, excludeCommonNames: ['EC'] }, { commonName: 'SC' }), true);
});
