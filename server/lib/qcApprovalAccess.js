// สิทธิ์ระดับ tab ของหน้า /qc-approval (tab "qc" / "lab") — mirror ของ useAccessibleTabs ฝั่ง FE:
// ต้องเข้าหน้า /qc-approval ได้ และไม่มี token "deny:/qc-approval/<tab>" ใน permission รวมของทุก role
// (admin ผ่านเสมอ). Role "QC Approver" ถูก seed ด้วย deny:/qc-approval/lab จึงเห็นแค่ tab QC
const Role = require('../models/Role');
const AccessGroup = require('../models/AccessGroup');
const { normalizeRoles, unionPermissions } = require('./roles');

const PAGE = '/qc-approval';
const TABS = ['qc', 'lab'];

function pathMatches(pattern, pathname) {
  const a = String(pattern || '').replace(/\/+$/, '');
  const b = String(pathname || '').replace(/\/+$/, '');
  if (a === b) return true;
  if (a.endsWith('/*')) return b.startsWith(a.slice(0, -2));
  const ap = a.split('/');
  const bp = b.split('/');
  return ap.length === bp.length && ap.every((part, i) => part.startsWith(':') || part === bp[i]);
}

function denyToken(tab) {
  return 'deny:' + PAGE + '/' + tab;
}

// Pure: ตัดสินจาก roles + permission รวม + groups
function approvalTabsFor({ roles = [], permissions = [], groups = [] }) {
  if (roles.includes('admin')) return [...TABS];
  const hasPage = permissions.some((entry) => {
    if (entry.startsWith('/')) return pathMatches(entry, PAGE);
    const group = groups.find((g) => g.id === entry);
    return Boolean(group && (group.paths || []).some((p) => pathMatches(p, PAGE)));
  });
  if (!hasPage) return [];
  return TABS.filter((tab) => !permissions.includes(denyToken(tab)));
}

async function resolveApprovalTabs(user) {
  if (!user) return [];
  const roles = normalizeRoles(user);
  if (roles.includes('admin')) return [...TABS];
  const [roleDocs, groups] = await Promise.all([
    Role.find({ id: { $in: roles } }).lean(),
    AccessGroup.find().lean(),
  ]);
  const permissions = unionPermissions(roles, Object.fromEntries(roleDocs.map((r) => [r.id, r.permissions || []])));
  return approvalTabsFor({ roles, permissions, groups });
}

module.exports = { approvalTabsFor, resolveApprovalTabs, denyToken, QC_APPROVAL_TABS: TABS };
