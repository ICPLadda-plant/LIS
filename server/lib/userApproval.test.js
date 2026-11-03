const test = require('node:test');
const assert = require('node:assert/strict');
const { approvalStatusOf, isOrgEmail } = require('./userApproval');

test('รับอีเมลองค์กร icpladda.com และ subdomain', () => {
  assert.equal(isOrgEmail('Somchai@ICPLadda.com'), true);
  assert.equal(isOrgEmail('lab.user@lab.icpladda.com'), true);
});

test('ไม่รับโดเมนอื่นหรือโดเมนที่แค่ลงท้ายคล้ายกัน', () => {
  assert.equal(isOrgEmail('someone@gmail.com'), false);
  assert.equal(isOrgEmail('someone@fakeicpladda.com'), false);
  assert.equal(isOrgEmail('icpladda.com'), false);
});

test('ผู้ใช้เดิมที่ไม่มีสถานะอนุมัติถือว่าอนุมัติแล้ว', () => {
  assert.equal(approvalStatusOf({}), 'approved');
  assert.equal(approvalStatusOf({ approvalStatus: 'pending' }), 'pending');
});
