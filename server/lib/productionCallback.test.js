const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveProductionStatus, buildCallbackBody, buildCancelCallbackBody } = require('./productionCallback');

const base = { petitionNo: 'P-1', productionWorkflow: { requestNo: 'SA1' }, items: [{ seq: 1, sampleName: 'A', batchNo: 'B1', sendToLab: true }] };
const s = (o) => deriveProductionStatus({ ...base, ...o });

test('ส่งแล้วยังไม่รับ = sent, รับฝั่งใดฝั่งหนึ่ง = received', () => {
  assert.equal(s({ status: 'sampleSent' }), 'sent');
  assert.equal(s({ status: 'pendingReview', labReceivedAt: new Date() }), 'received');
});

test('กรอกค่าแรก = analyzing', () => {
  assert.equal(s({ status: 'inProgress', qcReceivedAt: new Date() }), 'analyzing');
});

test('pre_result ต้องเสร็จครบทุกฝั่งที่ต้องตรวจ', () => {
  assert.equal(s({ status: 'inProgress', qcCompletedAt: new Date() }), 'analyzing');
  assert.equal(s({ status: 'inProgress', qcCompletedAt: new Date(), labCompletedAt: new Date() }), 'pre_result');
  assert.equal(s({ status: 'inProgress', qcCompletedAt: new Date(), labApprovedAt: new Date() }), 'pre_result');
  assert.equal(s({ status: 'success' }), 'pre_result');
});

test('Final Result = result_received, ตีกลับ = rejected', () => {
  assert.equal(s({ status: 'approved' }), 'result_received');
  assert.equal(s({ status: 'rejected' }), 'rejected');
});

test('Lab Re-check แล้วกลับเป็น analyzing เมื่อเริ่มกรอกใหม่', () => {
  const t0 = new Date('2026-10-01'); const t1 = new Date('2026-10-02');
  assert.equal(s({ status: 'pendingReview', labRecheckRequestedAt: t1, labApprovedAt: t0, firstResultAt: t0, qcCompletedAt: t0 }), 're_check');
  assert.equal(s({ status: 'inProgress', labRecheckRequestedAt: t1, labApprovedAt: t0, firstResultAt: t0, qcCompletedAt: t0 }), 'analyzing');
});

test('ตัวอย่างเพิ่ม: requested → more_sample, sent → more_sample_sent, received → analyzing', () => {
  const round = (status) => ({ additionalSampleRequests: [{ _id: 'r1', side: 'qc', reason: 'x', status, items: [{ itemSeq: 1, quantity: 2 }] }] });
  assert.equal(s({ status: 'inProgress', ...round('requested') }), 'more_sample');
  assert.equal(s({ status: 'inProgress', ...round('sent') }), 'more_sample_sent');
  assert.equal(s({ status: 'inProgress', ...round('received') }), 'analyzing');
});

test('callback ส่งรายการตัวอย่างที่ขอเพิ่ม และข้ามคำขอที่ไม่ได้มาจาก Production', () => {
  const body = buildCallbackBody({ ...base, status: 'inProgress', additionalSampleRequests: [{ _id: 'r1', side: 'qc', reason: 'ค่าไม่ผ่าน', status: 'requested', items: [{ itemSeq: 1, quantity: 2 }] }] });
  assert.equal(body.request_no, 'SA1');
  assert.equal(body.lis_status, 'more_sample');
  assert.deepEqual(body.more_sample.items[0], { item_seq: 1, quantity: 2, sample_name: 'A', batch_no: 'B1', lot_no: '', sent_amount: null, sent_unit: null });
  assert.equal(buildCallbackBody({ ...base, productionWorkflow: undefined, status: 'approved' }), null);
});

test('ยกเลิกคำขอ: ส่ง cancelled พร้อมเหตุผล ผู้ยกเลิก และเวลา', () => {
  const at = new Date('2026-11-03T03:00:00Z');
  const body = buildCancelCallbackBody({ ...base, status: 'pendingReview' }, { reason: 'ส่งคำขอซ้ำ', actor: 'หัวหน้า QC', at });
  assert.equal(body.request_no, 'SA1');
  assert.equal(body.lis_status, 'cancelled');
  assert.equal(body.cancel_reason, 'ส่งคำขอซ้ำ');
  assert.equal(body.cancelled_by, 'หัวหน้า QC');
  assert.equal(body.cancelled_at, at.toISOString());
  assert.equal(buildCancelCallbackBody({ ...base, productionWorkflow: undefined }, { reason: 'x' }), null);
});

