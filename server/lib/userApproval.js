// สถานะการอนุมัติเข้าระบบของผู้ใช้
// - approved: เข้าระบบได้ตาม role (ผู้ใช้เดิมที่ไม่มี field นี้ถือว่า approved)
// - pending:  ล็อกอิน Microsoft ครั้งแรกด้วยอีเมลองค์กร รอผู้ดูแลยืนยัน
// - rejected: ผู้ดูแลปฏิเสธคำขอเข้าระบบ
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];
const ORG_EMAIL_DOMAIN = 'icpladda.com';
const DEFAULT_APPROVED_ROLE = 'viewer';

function approvalStatusOf(user) {
  const value = String(user?.approvalStatus || '').trim();
  return APPROVAL_STATUSES.includes(value) ? value : 'approved';
}

function isApproved(user) {
  return approvalStatusOf(user) === 'approved';
}

// รับทั้ง @icpladda.com และ subdomain เช่น @lab.icpladda.com
function isOrgEmail(email) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  return domain === ORG_EMAIL_DOMAIN || domain.endsWith(`.${ORG_EMAIL_DOMAIN}`);
}

module.exports = {
  APPROVAL_STATUSES,
  DEFAULT_APPROVED_ROLE,
  ORG_EMAIL_DOMAIN,
  approvalStatusOf,
  isApproved,
  isOrgEmail,
};
