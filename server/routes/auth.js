const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const Role = require('../models/Role');
const { primaryRole, normalizeRoles, unionPermissions } = require('../lib/roles');
const { clearLisSessionCookie, getLisSessionUserId, setLisSessionCookie } = require('../lib/lisSessionCookie');
const { requireAdminUser } = require('../lib/adminGate');
const { fetchMonthlyEmployees } = require('../lib/employeeDirectory');
const { findEmployeeByEmail } = require('../lib/employeeLink');

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_LIMIT = 10;

function loginRateLimited(req) {
  const key = `${req.ip || 'unknown'}:${String(req.body?.email || '').trim().toLowerCase()}`;
  const now = Date.now();
  for (const [entryKey, entry] of loginAttempts) {
    if (now - entry.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(entryKey);
  }
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > LOGIN_LIMIT;
}

function b64urlDecode(value) {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function verifyHs256Jwt(token, secret, leewaySeconds = 30) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  const provided = b64urlDecode(signaturePart);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

  const header = JSON.parse(b64urlDecode(headerPart).toString('utf8'));
  if (header.alg !== 'HS256') return null;
  const payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > Number(payload.exp) + leewaySeconds) return null;
  if (payload.nbf && now < Number(payload.nbf) - leewaySeconds) return null;
  return payload;
}

async function getPermissions(rolesInput) {
  const roles = normalizeRoles(
    Array.isArray(rolesInput) ? { roles: rolesInput } : { role: rolesInput },
  );
  if (roles.length === 0) roles.push('viewer');
  const roleDocs = await Role.find(roles.includes('admin') ? {} : { id: { $in: roles } }).lean();
  const permsByRole = Object.fromEntries(roleDocs.map((r) => [r.id, r.permissions || []]));
  return unionPermissions(roles, permsByRole);
}

// role ที่ production ส่งมาใช้ได้เฉพาะ role ทั่วไปที่มีใน LIS — ห้ามยกระดับเป็น admin ผ่าน SSO
async function resolveClaimedRole(rawRole) {
  const claimed = String(rawRole || '').trim().toLowerCase();
  if (!claimed || claimed === 'admin') return null;
  return Role.findOne({ id: claimed });
}

// จับคู่พนักงาน HR ด้วยอีเมล (best-effort เหมือน Microsoft login) — HR ล่ม/ไม่พบ = ข้าม
async function findHrEmployee(email) {
  try {
    return findEmployeeByEmail(await fetchMonthlyEmployees(), email) || null;
  } catch (err) {
    console.error('[production-sso] employee lookup failed:', err.message);
    return null;
  }
}

function formatSsoUser(user, permissions = []) {
  const roles = normalizeRoles(user);
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: primaryRole(roles),
    roleId: primaryRole(roles),
    roleIds: roles,
    permissions,
    department: user.department,
    position: user.position,
    signatureUrl: user.signatureUrl || '',
    status: user.status,
  };
}

router.post('/login', async (req, res) => {
  try {
    if (loginRateLimited(req)) {
      return res.status(429).json({ error: 'ลองเข้าสู่ระบบใหม่ภายหลัง' });
    }
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    res.json({ email: user.email, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sso', (req, res) => {
  const token = String(req.query.token || '').trim();
  const ret = String(req.query.ret || '').trim();
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (ret) params.set('ret', ret);
  res.redirect(`/LIS/login${params.size ? `?${params.toString()}` : ''}`);
});

router.post('/sso', async (req, res) => {
  try {
    const secret = process.env.LIS_SSO_SECRET || process.env.PRODUCTION_SSO_SECRET || '';
    if (!secret) return res.status(500).json({ error: 'LIS SSO is not configured' });

    let payload;
    try {
      payload = verifyHs256Jwt(req.body?.token, secret);
    } catch {
      payload = null;
    }
    if (!payload) return res.status(401).json({ error: 'SSO token ไม่ถูกต้องหรือหมดอายุ' });
    if (payload.iss !== 'production' || payload.aud !== 'lis') {
      return res.status(401).json({ error: 'SSO token ไม่ใช่ของระบบที่อนุญาต' });
    }

    const normalizedEmail = String(payload.email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ error: 'SSO token ไม่มีอีเมลผู้ใช้' });

    const role = await resolveClaimedRole(payload.role);
    const now = new Date().toISOString();
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      user.name = String(payload.name || '').trim() || user.name || normalizedEmail;
      user.department = String(payload.dept || '').trim() || user.department || 'Unassigned';
      user.position = user.position || 'Unassigned';
      if (!user.authProvider || user.authProvider === 'local') user.authProvider = 'production';
      user.lastActive = now;
      const currentRoles = normalizeRoles(user);
      const onlyViewer = currentRoles.length === 0 || (currentRoles.length === 1 && currentRoles[0] === 'viewer');
      if (role && onlyViewer) user.roles = [role.id];
      if (currentRoles.length === 0 && !role) user.roles = ['viewer'];
      await user.save();
      setLisSessionCookie(res, user._id, req);
      return res.json(formatSsoUser(user, await getPermissions(normalizeRoles(user))));
    }

    const employee = await findHrEmployee(normalizedEmail);
    const newUserDoc = {
      email: normalizedEmail,
      name: (employee && employee.name) || String(payload.name || '').trim() || normalizedEmail,
      roles: [role?.id || 'viewer'],
      department: (employee && employee.department) || String(payload.dept || '').trim() || 'Unassigned',
      position: (employee && employee.position) || 'Unassigned',
      employeeId: (employee && employee.employeeId) || '',
      status: 'active',
      lastActive: now,
      authProvider: 'production',
      microsoftId: payload.sub ? `production:${payload.sub}` : undefined,
      tenantId: 'production',
    };
    try {
      user = await User.create(newUserDoc);
    } catch (e) {
      // employeeId ชนกับ user อื่น → สร้างโดยไม่ลิงก์ ไม่ให้การเข้าครั้งแรกล้ม
      if (e.code === 11000 && (e.keyPattern?.employeeId || /employeeId/.test(e.message || ''))) {
        user = await User.create({ ...newUserDoc, employeeId: '' });
      } else {
        throw e;
      }
    }

    setLisSessionCookie(res, user._id, req);
    res.status(201).json(formatSsoUser(user, await getPermissions(normalizeRoles(user))));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email นี้มีในระบบแล้ว' });
    res.status(400).json({ error: err.message });
  }
});

router.get('/session', async (req, res) => {
  try {
    const userId = getLisSessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'ไม่มี session ของ LIS' });

    const user = await User.findById(userId);
    if (!user || user.status === 'inactive') {
      clearLisSessionCookie(res, req);
      return res.status(401).json({ error: 'session ของ LIS ไม่ถูกต้อง' });
    }

    res.json(formatSsoUser(user, await getPermissions(normalizeRoles(user))));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/logout', (_req, res) => {
  clearLisSessionCookie(res, _req);
  res.json({ ok: true });
});

// Admin only: create user
router.post('/register', requireAdminUser, async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await User.create({ email, password, name, role });
    res.status(201).json({ email: user.email, name: user.name, role: user.role });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email นี้มีในระบบแล้ว' });
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
