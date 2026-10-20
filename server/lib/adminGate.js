const { normalizeRoles } = require('./roles');
const User = require('../models/User');
const { getLisSessionUserId } = require('./lisSessionCookie');

// ⚠️ ข้อจำกัดที่รู้ตัว: backend ยังไม่ verify token ของ Azure AD ฉะนั้น header
// X-LIS-User ปลอมได้ถ้าอยู่ในเน็ตเวิร์กและรู้อีเมล admin — ระดับความเชื่อถือ
// เท่ากับที่ทั้งระบบใช้อยู่ (หน้าเว็บ gate ด้วย FE อย่างเดียว) ตัวปิดรูนี้จริงๆ
// คือเฟส 2: verify Azure AD access token ฝั่ง server
// ดู docs/superpowers/specs/2026-08-06-api-keys-and-api-protection-design.md ข้อ 4.4
function createAdminGate({ findUserByEmail, findUserById, isDevBypass, warn = console.warn }) {
  return async function requireAdminUser(req, res, next) {
    if (isDevBypass(req)) {
      warn('[adminGate] ข้ามการตรวจสิทธิ์ (ALLOW_DEV_STATUS=true) — ห้ามตั้งค่านี้บน production');
      return next();
    }
    const sessionId = getLisSessionUserId(req);
    const email = String(req.get('x-lis-user') || '').trim().toLowerCase();
    if (sessionId && !findUserById) {
      return res.status(500).json({ error: { message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' } });
    }
    if (sessionId) {
      let sessionUser;
      try {
        sessionUser = await findUserById(sessionId);
      } catch (err) {
        warn('[adminGate] session lookup failed:', err.message);
        return res.status(500).json({ error: { message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' } });
      }
      if (!sessionUser || sessionUser.status === 'inactive' || !normalizeRoles(sessionUser).includes('admin')) {
        return res.status(403).json({ error: { message: 'เฉพาะผู้ดูแลระบบเท่านั้น' } });
      }
      req.adminUser = { email: sessionUser.email, name: sessionUser.name };
      return next();
    }
    if (!email) {
      return res.status(401).json({ error: { message: 'ต้องระบุผู้ใช้ (header X-LIS-User)' } });
    }
    let user;
    try {
      user = await findUserByEmail(email);
    } catch (err) {
      warn('[adminGate] user lookup failed:', err.message);
      return res.status(500).json({ error: { message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' } });
    }
    if (!user || user.status === 'inactive' || !normalizeRoles(user).includes('admin')) {
      return res.status(403).json({ error: { message: 'เฉพาะผู้ดูแลระบบเท่านั้น' } });
    }
    req.adminUser = { email, name: user.name };
    return next();
  };
}

function createAuthenticatedGate({ findUserByEmail, findUserById, isDevBypass, warn = console.warn }) {
  return async function requireAuthenticatedUser(req, res, next) {
    if (isDevBypass(req)) return next();
    const sessionId = getLisSessionUserId(req);
    const email = String(req.get('x-lis-user') || '').trim().toLowerCase();
    try {
      const user = sessionId && findUserById
        ? await findUserById(sessionId)
        : email
          ? await findUserByEmail(email)
          : null;
      if (!user) return res.status(401).json({ error: { message: 'ต้องระบุผู้ใช้' } });
      if (user.status === 'inactive') return res.status(403).json({ error: { message: 'ผู้ใช้ถูกระงับ' } });
      req.authenticatedUser = user;
      return next();
    } catch (err) {
      warn('[adminGate] user lookup failed:', err.message);
      return res.status(500).json({ error: { message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' } });
    }
  };
}

const requireAdminUser = createAdminGate({
  findUserByEmail: (email) => User.findOne({ email }).lean(),
  findUserById: (id) => User.findById(id).lean(),
  // Keep local test convenience without exposing an unauthenticated admin bypass.
  isDevBypass: (req) => (
    process.env.ALLOW_DEV_STATUS === 'true' &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req?.ip) &&
    String(req.get?.('x-lis-user') || '').toLowerCase().endsWith('.dev@icpladda.com')
  ),
});

const requireAuthenticatedUser = createAuthenticatedGate({
  findUserByEmail: (email) => User.findOne({ email }).lean(),
  findUserById: (id) => User.findById(id).lean(),
  isDevBypass: (req) => (
    process.env.ALLOW_DEV_STATUS === 'true' &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req?.ip) &&
    String(req.get?.('x-lis-user') || '').toLowerCase().endsWith('.dev@icpladda.com')
  ),
});

module.exports = { createAdminGate, createAuthenticatedGate, requireAdminUser, requireAuthenticatedUser };
