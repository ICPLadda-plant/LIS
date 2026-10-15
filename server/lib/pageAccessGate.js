const User = require('../models/User');
const Role = require('../models/Role');
const AccessGroup = require('../models/AccessGroup');
const { normalizeRoles, unionPermissions } = require('./roles');
const { getLisSessionUserId } = require('./lisSessionCookie');
const { syntheticDevRolesFromEmail } = require('./syntheticDevRoles');

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function pathMatches(pattern, pathname) {
  const a = String(pattern || '').replace(/\/+$/, '');
  const b = String(pathname || '').replace(/\/+$/, '');
  if (a === b) return true;
  if (a.endsWith('/*')) return b.startsWith(a.slice(0, -2));
  const ap = a.split('/'); const bp = b.split('/');
  return ap.length === bp.length && ap.every((part, i) => part.startsWith(':') || part === bp[i]);
}

async function resolveUser(req) {
  const email = String(req.get('x-lis-user') || '').trim().toLowerCase();
  const devRoles = process.env.ALLOW_DEV_STATUS === 'true' && LOOPBACK_IPS.has(req.ip)
    ? syntheticDevRolesFromEmail(email)
    : [];
  if (devRoles.length > 0) {
    return { email, name: 'Dev User', roles: devRoles, status: 'active' };
  }
  const sessionId = getLisSessionUserId(req);
  if (sessionId) {
    const user = await User.findById(sessionId).lean();
    if (user) return user;
  }
  return email ? User.findOne({ email }).lean() : null;
}

function requirePageAccess(paths) {
  return async (req, res, next) => {
    try {
      const user = await resolveUser(req);
      if (!user || user.status === 'inactive') return res.status(401).json({ error: { message: 'ต้องเข้าสู่ระบบ' } });
      const roles = normalizeRoles(user);
      if (roles.includes('admin')) { req.currentUser = user; return next(); }
      const roleDocs = await Role.find({ id: { $in: roles } }).lean();
      const groups = await AccessGroup.find().lean();
      const permissions = unionPermissions(roles, Object.fromEntries(roleDocs.map((r) => [r.id, r.permissions || []])));
      const allowed = paths.some((path) => permissions.some((entry) => entry.startsWith('/') && pathMatches(entry, path) || groups.some((g) => entry === g.id && (g.paths || []).some((p) => pathMatches(p, path)))));
      if (!allowed) return res.status(403).json({ error: { message: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' } });
      req.currentUser = user;
      return next();
    } catch (err) { return res.status(500).json({ error: { message: err.message } }); }
  };
}

module.exports = { requirePageAccess };
