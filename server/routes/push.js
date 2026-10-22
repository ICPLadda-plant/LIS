const express = require('express');
const PushSubscription = require('../models/PushSubscription');
const { requireAuthenticatedUser } = require('../lib/adminGate');
const { syntheticDevRolesFromEmail } = require('../lib/syntheticDevRoles');
const { normalizeRoles } = require('../lib/roles');
const { getVapidPublicKey, isPushConfigured, sendToSubscriptions } = require('../lib/webPush');

const router = express.Router();
router.use(requireAuthenticatedUser);

// ผู้ใช้จริงมาจาก gate; ผู้ใช้ dev mode (bypass) ไม่มีแถวใน User จึงสร้างจาก header
function currentIdentity(req) {
  const user = req.authenticatedUser;
  if (user) {
    return {
      email: String(user.email || '').toLowerCase(),
      roles: normalizeRoles(user),
      department: String(user.department || ''),
      employeeId: String(user.employeeId || ''),
    };
  }
  const email = String(req.get('x-lis-user') || '').trim().toLowerCase();
  let department = '';
  try {
    department = decodeURIComponent(String(req.get('x-lis-department') || ''));
  } catch {
    department = '';
  }
  return { email, roles: syntheticDevRolesFromEmail(email), department, employeeId: '' };
}

function deviceView(sub, currentEndpoint) {
  return {
    id: String(sub._id),
    label: sub.deviceLabel,
    current: Boolean(currentEndpoint) && sub.endpoint === currentEndpoint,
    createdAt: sub.createdAt,
  };
}

async function listState(email, currentEndpoint) {
  const subs = await PushSubscription.find({ email }).sort({ createdAt: 1 }).lean();
  return {
    configured: isPushConfigured(),
    publicKey: getVapidPublicKey() || null,
    paused: subs.length > 0 && subs.every((s) => s.paused),
    devices: subs.map((s) => deviceView(s, currentEndpoint)),
  };
}

// GET /api/push/devices?endpoint=<endpoint ของเครื่องนี้>
router.get('/devices', async (req, res) => {
  try {
    const { email } = currentIdentity(req);
    res.json(await listState(email, String(req.query.endpoint || '')));
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// POST /api/push/subscribe { subscription: { endpoint, keys }, deviceLabel }
router.post('/subscribe', async (req, res) => {
  try {
    if (!isPushConfigured()) return res.status(503).json({ error: { message: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน PWA' } });
    const identity = currentIdentity(req);
    const subscription = req.body?.subscription || {};
    const endpoint = String(subscription.endpoint || '');
    const keys = subscription.keys || {};
    if (!/^https:\/\//.test(endpoint) || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: { message: 'ข้อมูลการสมัครรับแจ้งเตือนไม่ถูกต้อง' } });
    }
    const existing = await PushSubscription.findOne({ email: identity.email }).lean();
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          ...identity,
          endpoint,
          keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
          deviceLabel: String(req.body?.deviceLabel || 'อุปกรณ์ไม่ทราบชื่อ').slice(0, 60),
          userAgent: String(req.get('user-agent') || '').slice(0, 300),
          paused: Boolean(existing?.paused),
        },
      },
      { upsert: true, new: true },
    );
    res.json(await listState(identity.email, endpoint));
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// POST /api/push/unsubscribe { endpoint }
router.post('/unsubscribe', async (req, res) => {
  try {
    const { email } = currentIdentity(req);
    await PushSubscription.deleteOne({ email, endpoint: String(req.body?.endpoint || '') });
    res.json(await listState(email, ''));
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// POST /api/push/pause { paused: boolean } — พัก/เปิดการแจ้งเตือนงานจริงทุกเครื่องของผู้ใช้
router.post('/pause', async (req, res) => {
  try {
    const { email } = currentIdentity(req);
    await PushSubscription.updateMany({ email }, { $set: { paused: Boolean(req.body?.paused) } });
    res.json(await listState(email, String(req.body?.endpoint || '')));
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// POST /api/push/test — ส่งแจ้งเตือนทดสอบไปทุกเครื่องของผู้ใช้ (ส่งแม้พักไว้ เพราะผู้ใช้กดเอง)
router.post('/test', async (req, res) => {
  try {
    if (!isPushConfigured()) return res.status(503).json({ error: { message: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน PWA' } });
    const { email } = currentIdentity(req);
    const subs = await PushSubscription.find({ email }).lean();
    if (!subs.length) return res.status(404).json({ error: { message: 'ยังไม่มีเครื่องที่เปิดรับแจ้งเตือน' } });
    const result = await sendToSubscriptions(subs, {
      title: 'ทดสอบการแจ้งเตือน LIS',
      body: 'ถ้าเห็นข้อความนี้ แปลว่าเครื่องนี้รับแจ้งเตือนได้แล้ว',
      tag: 'lis-push-test',
      url: '',
    });
    res.json({ ...result, total: subs.length });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
