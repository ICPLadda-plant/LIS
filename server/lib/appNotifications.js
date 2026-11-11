// สร้าง/อ่านแจ้งเตือนที่ไม่ผูกกับคำขอ (สต็อก, ระบบ, งานด่วน, Daily Check) แล้วส่ง PWA ให้ผู้รับ
const AppNotification = require('../models/AppNotification');
const { matchesRecipients } = require('./petitionNotifications');

function recipientsOf(doc) {
  return { roles: doc?.recipientRoles || [], people: doc?.recipientPeople || [] };
}

function isAppNotificationForViewer(doc, viewer) {
  if (!doc || !viewer) return false;
  if (matchesRecipients(recipientsOf(doc), viewer)) return true;
  return Boolean(viewer.seeAll && (viewer.roles || []).includes('admin'));
}

function toBellItem(doc) {
  return {
    id: 'app:' + doc.key,
    title: doc.title,
    message: doc.message || undefined,
    level: doc.level || 'info',
    link: doc.link || undefined,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    group: doc.kind,
  };
}

// สร้างครั้งเดียวต่อ key — ซ้ำแล้วเพิ่ม count เฉย ๆ (ไม่ส่ง push ซ้ำ). คืน doc ใหม่หรือ null
async function publishAppNotification(input) {
  const doc = {
    key: String(input.key),
    kind: input.kind,
    title: input.title,
    message: input.message || '',
    level: input.level || 'info',
    link: input.link || '',
    recipientRoles: input.roles || [],
    recipientPeople: input.people || [],
    pushOnly: Boolean(input.pushOnly),
  };
  try {
    const created = await AppNotification.create(doc);
    const plain = created.toObject();
    require('./webPush').dispatchAppNotificationPush(plain).catch((err) => console.error('[appNotifications] push failed:', err.message));
    return plain;
  } catch (err) {
    if (err?.code === 11000) {
      await AppNotification.updateOne({ key: doc.key }, { $inc: { count: 1 }, $set: { lastAt: new Date() } }).catch(() => undefined);
      return null;
    }
    throw err;
  }
}

async function bellAppNotifications(viewer, since, limit) {
  const docs = await AppNotification.find({ createdAt: { $gte: since }, pushOnly: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return docs.filter((doc) => isAppNotificationForViewer(doc, viewer)).slice(0, limit).map(toBellItem);
}

module.exports = { publishAppNotification, bellAppNotifications, isAppNotificationForViewer, toBellItem };
