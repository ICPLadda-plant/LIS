// ส่ง Web Push ไปยังเครื่องที่ผู้ใช้เปิดรับแจ้งเตือน PWA ไว้
// ต้องตั้ง VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT ใน server/.env (ดู docs/pwa-push.md)
// ผู้รับใช้กฎเดียวกับกระดิ่ง (petitionNotifications / appNotifications) ทุกเหตุการณ์
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const { viewerFromUser } = require('./notificationViewer');

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

// ใช้ข้อมูลล่าสุดจาก User ถ้ามี (role เปลี่ยนได้) ไม่งั้นใช้ snapshot ตอนสมัคร (ผู้ใช้ dev mode)
async function viewersForSubscriptions(subscriptions) {
  const emails = [...new Set(subscriptions.map((s) => s.email))];
  const users = await User.find({ email: { $in: emails } }).lean();
  const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));
  const viewers = new Map();
  for (const email of emails) {
    const user = byEmail.get(email);
    if (user?.status === 'inactive') continue;
    const subs = subscriptions.filter((s) => s.email === email);
    const snapshot = subs[0];
    const source = user || { email, roles: snapshot?.roles, employeeId: snapshot?.employeeId, name: snapshot?.name };
    viewers.set(email, viewerFromUser(source, { seeAll: subs.some((s) => s.seeAll) }));
  }
  return viewers;
}

// url ใน payload เป็น path สัมพัทธ์กับ scope ของ service worker (ใช้ได้ทั้ง local และ /LIS/)
function relativeUrl(link) {
  return String(link || '').replace(/^\/+/, '');
}

// Pure: viewers คือ Map<email, viewer>
function pushTargetsForPetitionLog(petition, log, subscriptions, viewers) {
  const { notificationForViewer } = require('./petitionNotifications');
  const targets = [];
  for (const sub of subscriptions) {
    if (sub.paused) continue;
    const viewer = viewers.get(sub.email);
    if (!viewer) continue;
    const notification = notificationForViewer(petition, log, viewer);
    if (notification) targets.push({ sub, notification });
  }
  return targets;
}

function pushTargetsForAppNotification(doc, subscriptions, viewers) {
  const { isAppNotificationForViewer, toBellItem } = require('./appNotifications');
  const notification = toBellItem(doc);
  return subscriptions
    .filter((sub) => !sub.paused && isAppNotificationForViewer(doc, viewers.get(sub.email)))
    .map((sub) => ({ sub, notification }));
}

async function sendTargets(targets) {
  const groups = new Map();
  for (const target of targets) {
    const payload = {
      title: target.notification.title,
      body: target.notification.message || '',
      tag: target.notification.id,
      url: relativeUrl(target.notification.link),
    };
    const key = JSON.stringify(payload);
    if (!groups.has(key)) groups.set(key, { payload, subs: [] });
    groups.get(key).subs.push(target.sub);
  }
  for (const { payload, subs } of groups.values()) await sendToSubscriptions(subs, payload);
}

async function activeSubscriptions() {
  const subscriptions = await PushSubscription.find({ paused: { $ne: true } }).lean();
  if (!subscriptions.length) return { subscriptions, viewers: new Map() };
  return { subscriptions, viewers: await viewersForSubscriptions(subscriptions) };
}

// เรียกจาก PetitionAuditLog post-save — ทุกแถวที่ลง audit log จึงได้ push ตามกฎกระดิ่ง
async function dispatchPetitionLogPush(log) {
  try {
    if (!isPushConfigured() || !log?.petitionId) return;
    const PetitionAuditLog = require('../models/PetitionAuditLog');
    const Petition = require('../models/Petition');
    // resultEntered เกิดทุกช่องที่กรอก — ส่ง push เฉพาะช่องแรกของฝั่งนั้น
    if (log.event === 'resultEntered') {
      const earlier = await PetitionAuditLog.exists({
        petitionId: log.petitionId,
        event: 'resultEntered',
        'metadata.side': log.metadata?.side,
        _id: { $ne: log._id },
      });
      if (earlier) return;
    }
    const petition = await Petition.findById(log.petitionId).lean();
    if (!petition || petition.deletedAt) return;
    const { subscriptions, viewers } = await activeSubscriptions();
    if (!subscriptions.length) return;
    await sendTargets(pushTargetsForPetitionLog(petition, log, subscriptions, viewers));
  } catch (err) {
    console.error('[webPush] dispatchPetitionLogPush error:', err.message);
  }
}

async function dispatchAppNotificationPush(doc) {
  try {
    if (!isPushConfigured() || !doc) return;
    const { subscriptions, viewers } = await activeSubscriptions();
    if (!subscriptions.length) return;
    await sendTargets(pushTargetsForAppNotification(doc, subscriptions, viewers));
  } catch (err) {
    console.error('[webPush] dispatchAppNotificationPush error:', err.message);
  }
}

module.exports = {
  getVapidPublicKey,
  isPushConfigured,
  sendToSubscriptions,
  pushTargetsForPetitionLog,
  pushTargetsForAppNotification,
  dispatchPetitionLogPush,
  dispatchAppNotificationPush,
};
