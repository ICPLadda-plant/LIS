// ผู้ชมแจ้งเตือน = role (รวม role พื้นฐานของตระกูล QC/Lab) + ตัวตนสำหรับจับคู่งานของตัวเอง
// แผนกไม่มีผลกับกระดิ่ง/PWA — ผู้ใช้ที่ไม่มี role QC/Lab เห็นเฉพาะงานของตัวเองแบบ viewer
const { normalizeRoles } = require('./roles');
const { mergeBaseRolesForFamilies } = require('./roleFamilies');

function viewerFromUser(user, options = {}) {
  if (!user) return null;
  const roles = mergeBaseRolesForFamilies(normalizeRoles(user));
  return {
    roles,
    employeeId: String(user.employeeId || '').trim(),
    email: String(user.email || '').trim().toLowerCase(),
    name: String(user.name || '').trim(),
    seeAll: Boolean(options.seeAll) && roles.includes('admin'),
  };
}

module.exports = { viewerFromUser };
