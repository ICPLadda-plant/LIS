// แจ้งเตือนระบบให้ admin: API ตอบ 401 / 403 / 5xx
// รวมเหตุการณ์ซ้ำ (สถานะ + method + path เดียวกัน) เป็นแจ้งเตือนเดียวต่อ 10 นาที เพื่อไม่ให้ท่วมกระดิ่ง
const WINDOW_MS = 10 * 60 * 1000;

const STATUS_TITLES = {
  401: 'มีการเรียกใช้งานโดยไม่ได้เข้าสู่ระบบ (401)',
  403: 'มีการถูกปฏิเสธสิทธิ์ (403)',
  500: 'เซิร์ฟเวอร์ทำงานผิดพลาด (500)',
  501: 'เซิร์ฟเวอร์ไม่รองรับคำขอ (501)',
  502: 'เชื่อมต่อบริการปลายทางไม่ได้ (502)',
  503: 'บริการไม่พร้อมใช้งาน (503)',
  504: 'บริการปลายทางตอบช้าเกินกำหนด (504)',
};

function isWatchedStatus(status) {
  return status === 401 || status === 403 || status >= 500;
}

// Pure: path ที่มี id ต่างกันรวมเป็นแถวเดียว
function normalizeApiPath(rawPath) {
  return String(rawPath || '')
    .split('?')[0]
    .replace(/^\/LIS(?=\/api)/, '')
    .split('/')
    .map((part) => (/^[0-9a-f]{24}$/i.test(part) ? ':id' : /^\d+$/.test(part) ? ':n' : part))
    .join('/');
}

function systemTitle(status) {
  return STATUS_TITLES[status] || 'เซิร์ฟเวอร์ตอบข้อผิดพลาด (' + status + ')';
}

// Pure: แจ้งเตือนสำหรับ 1 response
function systemNotificationFor({ status, method, path, user, at = Date.now() }) {
  const bucket = Math.floor(at / WINDOW_MS);
  return {
    key: 'system:' + status + ':' + method + ':' + path + ':' + bucket,
    kind: 'system',
    title: systemTitle(status),
    message: method + ' ' + path + (user ? ' · ' + user : ''),
    level: status >= 500 ? 'error' : 'warning',
    roles: ['admin'],
  };
}

function systemAlertMiddleware(req, res, next) {
  res.on('finish', () => {
    const status = res.statusCode;
    if (!isWatchedStatus(status)) return;
    const path = normalizeApiPath(req.originalUrl || req.url);
    if (!path.startsWith('/api/')) return;
    const user = String(req.get?.('X-LIS-User') || '').trim().toLowerCase();
    const { publishAppNotification } = require('./appNotifications');
    publishAppNotification(systemNotificationFor({ status, method: req.method, path, user }))
      .catch((err) => console.error('[systemAlerts] record failed:', err.message));
  });
  next();
}

module.exports = { systemAlertMiddleware, systemNotificationFor, normalizeApiPath, isWatchedStatus };
