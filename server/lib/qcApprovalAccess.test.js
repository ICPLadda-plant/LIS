const test = require('node:test');
const assert = require('node:assert');
const { approvalTabsFor } = require('./qcApprovalAccess');
const { buildBatchCallbackBody } = require('./productionCallback');

const groups = [{ id: 'qc', paths: ['/physical-inspection', '/qc-approval'] }];

test('admin sees both approval tabs', () => {
  assert.deepStrictEqual(approvalTabsFor({ roles: ['admin'], permissions: [], groups }), ['qc', 'lab']);
});

test('QC Approver (lab tab denied) only gets the QC tab', () => {
  assert.deepStrictEqual(
    approvalTabsFor({ roles: ['qc-approver'], permissions: ['/qc-approval', 'deny:/qc-approval/lab'], groups }),
    ['qc'],
  );
});

test('page access through a group grants both tabs unless denied', () => {
  assert.deepStrictEqual(approvalTabsFor({ roles: ['qc-head'], permissions: ['qc'], groups }), ['qc', 'lab']);
});

test('no page access means no tabs', () => {
  assert.deepStrictEqual(approvalTabsFor({ roles: ['qc-staff'], permissions: ['/qc-testing'], groups }), []);
});

test('batch callback targets one production batch of the request', () => {
  const body = buildBatchCallbackBody(
    { petitionNo: 'P-2611-0002', productionWorkflow: { requestNo: 'SR-001' } },
    'B1',
    'กายภาพผ่าน',
  );
  assert.strictEqual(body.request_no, 'SR-001');
  assert.strictEqual(body.batch_no, 'B1');
  assert.match(body.result_summary, /Batch B1: อนุมัติแล้ว — กายภาพผ่าน/);
  assert.strictEqual(buildBatchCallbackBody({ petitionNo: 'P-1' }, 'B1'), null);
});
