// ส่ง Web Push ไปยังเครื่องที่ผู้ใช้เปิดรับแจ้งเตือน PWA ไว้
// ต้องตั้ง VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT ใน server/.env (ดู docs/pwa-push.md)
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const { audiencesForUser } = require('./pushAudience');

let configuredWith = null;

function getVapidPublicKey() {
  return String(process.env.VAPID_PUBLIC_KEY || '').trim();
}

function isPushConfigured() {
  const publicKey = getVapidPublicKey();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return false;
  const signature = publicKey + privateKey;
  if (configuredWith !== signature) {
    webpush.setVapidDetails(String(process.env.VAPID_SUBJECT || 'mailto:lis@icpladda.com').trim(), publicKey, privateKey);
    configuredWith = signature;
  }
  return true;
}

// 404/410 = เบราว์เซอร์ยกเลิก subscription แล้ว ลบทิ้งเพื่อไม่ให้รายการเครื่องค้าง
async function sendToSubscriptions(subscriptions, payload) {
  if (!isPushConfigured() || !subscriptions.length) return { sent: 0, failed: 0, removed: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let removed = 0;
  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { TTL: 60 * 60 });
      sent += 1;
      await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastSuccessAt: new Date() } }).catch(() => undefined);
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        removed += 1;
        await PushSubscription.deleteOne({ _id: sub._id }).catch(() => undefined);
      } else {
        failed += 1;
        console.error('[webPush] send failed:', err?.statusCode || '', err?.message);
        await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastErrorAt: new Date() } }).catch(() => undefined);
      }
    }
  }));
  return { sent, failed, removed };
}

// ใช้ข้อมูลล่าสุดจาก User ถ้ามี (role/แผนกเปลี่ยนได้) ไม่งั้นใช้ snapshot ตอนสมัคร (ผู้ใช้ dev mode)
async function viewersForSubscriptions(subscriptions) {
  const emails = [...new Set(subscriptions.map((s) => s.email))];
  const users = await User.find({ email: { $in: emails } }).lean();
  const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));
  const viewers = new Map();
  for (const email of emails) {
    const user = byEmail.get(email);
    const snapshot = subscriptions.find((s) => s.email === email);
    if (user?.status === 'inactive') continue;
    const source = user || snapshot;
    viewers.set(email, {
      audiences: audiencesForUser(source),
      employeeId: String(source?.employeeId || snapshot?.employeeId || '').trim(),
    });
  }
  return viewers;
}

// เหตุการณ์จริงที่ส่ง push = เหตุการณ์เดียวกับที่กระดิ่งเล่นเสียง (ตัวอย่างมาถึง, งาน Lab ใหม่)
// Pure: ไม่แตะ DB — viewers คือ Map<email, { audiences, employeeId }>
function pushTargetsForEvent(petition, payload, subscriptions, viewers) {
  const { bellDescribe, toNotification } = require('./petitionNotifications');
  const desc = bellDescribe(petition, payload);
  if (!desc) return { desc: null, targets: [] };
  const log = { ...payload, _id: payload?._id || `${petition?._id}-${payload?.event}` };
  const targets = subscriptions.filter((sub) => {
    if (sub.paused) return false;
    const viewer = viewers.get(sub.email);
    return Boolean(viewer) && toNotification(petition, log, desc, viewer).playSound === true;
  });
  return { desc, targets };
}

async function notifyPushForPetitionEvent(petition, payload) {
  try {
    if (!isPushConfigured()) return;
    const subscriptions = await PushSubscription.find({ paused: { $ne: true } }).lean();
    if (!subscriptions.length) return;
    const viewers = await viewersForSubscriptions(subscriptions);
    const { desc, targets } = pushTargetsForEvent(petition, payload, subscriptions, viewers);
    if (!desc || !targets.length) return;
    const petitionId = String(petition?._id || '');
    await sendToSubscriptions(targets, {
      title: desc.title,
      body: desc.message || '',
      tag: `petition-${petitionId}-${payload?.event}`,
      url: `petition/${petitionId}`,
    });
  } catch (err) {
    console.error('[webPush] notifyPushForPetitionEvent error:', err.message);
  }
}

module.exports = { getVapidPublicKey, isPushConfigured, notifyPushForPetitionEvent, pushTargetsForEvent, sendToSubscriptions };
