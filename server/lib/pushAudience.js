// พอร์ตมาจาก src/lib/petitionAudience.ts (audiencesForUser) — ต้องแก้คู่กัน
// ใช้ตัดสินว่าใครควรได้ push แจ้งเตือนงานจริง โดยใช้กฎเดียวกับเสียงในกระดิ่ง
const { normalizeRoles } = require('./roles');

const ROLE_AUDIENCE = {
  'qc-head': 'qc',
  'qc-staff': 'qc',
  'lab-head': 'lab',
  'lab-analyze': 'lab',
};

const DEPT_PATTERNS = [
  [/\br\s*&?\s*d\b|research\s*and\s*development/i, 'rd'],
  [/\brm\b|วัตถุดิบ/i, 'rm'],
  [/\bfg\b|สำเร็จรูป/i, 'fg'],
  [/production|ผลิต/i, 'production'],
  [/\bqc\b|ควบคุมคุณภาพ/i, 'qc'],
  [/\blab\b|วิเคราะห์/i, 'lab'],
];

function audiencesForUser(user) {
  if (!user) return [];
  const out = new Set();
  for (const role of normalizeRoles(user)) {
    if (ROLE_AUDIENCE[role]) out.add(ROLE_AUDIENCE[role]);
  }
  const dept = String(user.department || '');
  for (const [pattern, audience] of DEPT_PATTERNS) {
    if (pattern.test(dept)) out.add(audience);
  }
  return [...out];
}

module.exports = { audiencesForUser };
