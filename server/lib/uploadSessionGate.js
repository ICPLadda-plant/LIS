const path = require('path');

const PROTECTED_PREFIX = '/param-files';

// แปลง path ให้อยู่รูปเดียวกับที่ express.static/send ใช้หาไฟล์จริง
// (decode %XX, รวม slash ซ้ำ, ตัด ./ และ ../, ไม่สนตัวพิมพ์เล็กใหญ่เพราะ Windows ไม่สน)
// คืนค่า null เมื่อ decode ไม่ได้ ซึ่ง send ก็จะตอบ 400 อยู่แล้ว
function normalizeUploadPath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(rawPath || ''));
  } catch {
    return null;
  }
  const normalized = path.posix.normalize('/' + decoded.replace(/\\/g, '/'));
  return normalized.toLowerCase();
}

function isProtectedUploadPath(rawPath) {
  const normalized = normalizeUploadPath(rawPath);
  if (normalized === null) return true;
  return normalized === PROTECTED_PREFIX || normalized.startsWith(`${PROTECTED_PREFIX}/`);
}

function createUploadSessionGate({ getSessionUserId, findUserById }) {
  return async function requireUploadSession(req, res, next) {
    if (!isProtectedUploadPath(req.path)) return next();
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).end();
    try {
      const user = await findUserById(userId);
      if (!user || user.status === 'inactive') return res.status(401).end();
      return next();
    } catch {
      return res.status(503).end();
    }
  };
}

module.exports = { createUploadSessionGate, isProtectedUploadPath, normalizeUploadPath };
