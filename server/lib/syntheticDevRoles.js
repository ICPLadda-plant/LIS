const { mergeBaseRolesForFamilies } = require('./roleFamilies');

const DEV_EMAIL_SUFFIX = '.dev@icpladda.com';
const KNOWN_ROLE_IDS = [
  'lab-data-config', 'lab-inventory', 'lab-analyze', 'lab-analyst',
  'qc-data-config', 'qc-reviewer', 'lab-config', 'lab-head',
  'qc-staff', 'qc-head', 'qc-approver', 'viewer', 'admin', 'lab', 'qc',
].sort((a, b) => b.length - a.length);

function syntheticDevRolesFromEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.endsWith(DEV_EMAIL_SUFFIX)) return [];
  const slug = normalized.slice(0, -DEV_EMAIL_SUFFIX.length);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) return [];
  const rolesPart = slug.split('-dept-')[0];
  if (!rolesPart) return [];
  const roleIds = [];
  let remaining = rolesPart;
  while (remaining) {
    const roleId = KNOWN_ROLE_IDS.find((candidate) => remaining === candidate || remaining.startsWith(`${candidate}-`));
    if (!roleId) return mergeBaseRolesForFamilies([slug]);
    roleIds.push(roleId);
    remaining = remaining.length === roleId.length ? '' : remaining.slice(roleId.length + 1);
  }
  return mergeBaseRolesForFamilies(roleIds);
}

module.exports = { syntheticDevRolesFromEmail };
