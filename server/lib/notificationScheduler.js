// งานแจ้งเตือนตามเวลา (ทำงานฝั่ง server จึงส่ง PWA ได้แม้ไม่มีใครเปิดเว็บ)
// - งานด่วนรอบันทึกผล: ทุกต้นชั่วโมง (QC = รับตัวอย่างแล้วแต่ยังไม่บันทึกผล, Lab = ยังไม่บันทึกผล)
// - Daily Check เครื่องชั่ง: รอบเช้า/บ่ายที่ยังบันทึกไม่ครบ ส่งให้ role ตระกูล Lab รอบละครั้ง
// - สต็อก: สแกนหาสถานะใหม่ทุก 5 นาที
// กระดิ่งในเว็บสร้างรายการงานด่วน/Daily Check เองอยู่แล้ว จึงส่งเป็น pushOnly
const { hasLabTrack } = require('./petitionStatusLog');
const { requiresQcTrack } = require('./petitionSubmissionRules');
const { getDailyCheckPeriod, getDailyCheckPeriodLabel, isDailyCheckPeriod } = require('./dailyCheckPeriod');

const TICK_MS = 60 * 1000;
const STOCK_SCAN_EVERY_TICKS = 5;
// ต้องตรงกับ DAILY_CHECK_SCALE_TOTAL ใน src/lib/dailyCheckProgress.ts
const DAILY_CHECK_SCALE_TOTAL = 5;
const SIDE_LABELS = { qc: 'QC', lab: 'Lab' };

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hourKey = (d) => localDate(d) + 'T' + pad(d.getHours());

function isUrgent(petition) {
  const value = petition?.priority;
  if (value === null || value === undefined || value === '') return false;
  return Number(value) === 1;
}

// Pure: งานด่วนที่ยังรอบันทึกผลแยกตามฝั่ง
function urgentPendingBySide(petitions) {
  const out = { qc: [], lab: [] };
  for (const petition of petitions || []) {
    if (!isUrgent(petition) || petition.deletedAt) continue;
    if (['approved', 'rejected'].includes(petition.status)) continue;
    if (requiresQcTrack(petition) && petition.qcReceivedAt && !petition.qcCompletedAt) out.qc.push(petition);
    if (hasLabTrack(petition) && !petition.labCompletedAt) out.lab.push(petition);
  }
  return out;
}

function urgentNotifications(pending, now) {
  return Object.entries(pending)
    .filter(([, list]) => list.length)
    .map(([side, list]) => ({
      key: 'urgent:' + side + ':' + hourKey(now),
      kind: 'urgent',
      pushOnly: true,
      title: '⏰ งานด่วนรอบันทึกผล ' + SIDE_LABELS[side] + ' ' + list.length + ' งาน',
      message: list.slice(0, 5).map((p) => p.petitionNo).join(', ') + (list.length > 5 ? ' และอีก ' + (list.length - 5) + ' งาน' : ''),
      level: 'error',
      link: side === 'qc' ? '/qc-testing' : '/lab-testing',
      roles: [side],
    }));
}

// Pure: แจ้ง Daily Check ถ้าอยู่ในรอบและยังบันทึกไม่ครบ
function dailyCheckNotification(records, now) {
  const period = getDailyCheckPeriod(now);
  if (!period) return null;
  const done = new Set(
    (records || [])
      .filter((r) => (isDailyCheckPeriod(r.period) ? r.period : getDailyCheckPeriod(r.checkedAt)) === period)
      .map((r) => r.scaleId)
      .filter(Boolean),
  ).size;
  if (done >= DAILY_CHECK_SCALE_TOTAL) return null;
  const label = getDailyCheckPeriodLabel(period);
  return {
    key: 'dailyCheck:' + localDate(now) + ':' + period,
    kind: 'dailyCheck',
    pushOnly: true,
    title: 'ถึงเวลา Daily Check รอบ' + label,
    message: 'กรุณาบันทึกผล Calibrate เครื่องชั่งประจำวัน รอบ' + label + ' (' + done + '/' + DAILY_CHECK_SCALE_TOTAL + ' แล้ว)',
    level: 'warning',
    link: '/daily-check',
    roles: ['lab'],
  };
}

async function runUrgentTick(now) {
  const Petition = require('../models/Petition');
  const { publishAppNotification } = require('./appNotifications');
  const petitions = await Petition.find({ priority: { $in: [1, '1'] }, status: { $nin: ['approved', 'rejected'] } })
    .select('petitionNo priority status routeTargets submittedBy items qcReceivedAt qcCompletedAt labCompletedAt deletedAt')
    .lean();
  for (const notification of urgentNotifications(urgentPendingBySide(petitions), now)) {
    await publishAppNotification(notification);
  }
}

async function runDailyCheckTick(now) {
  if (!getDailyCheckPeriod(now)) return;
  const DailyCheck = require('../models/DailyCheck');
  const { publishAppNotification } = require('./appNotifications');
  const records = await DailyCheck.find({ date: localDate(now) }).select('scaleId period checkedAt').lean();
  const notification = dailyCheckNotification(records, now);
  if (notification) await publishAppNotification(notification);
}

let timer = null;

function startNotificationScheduler() {
  if (timer) return;
  let lastHour = hourKey(new Date());
  let ticks = 0;
  const tick = async () => {
    const now = new Date();
    ticks += 1;
    try {
      const currentHour = hourKey(now);
      if (currentHour !== lastHour) {
        lastHour = currentHour;
        await runUrgentTick(now);
      }
      await runDailyCheckTick(now);
      if (ticks % STOCK_SCAN_EVERY_TICKS === 1) await require('./stockAlerts').runStockAlertScan(now);
    } catch (err) {
      console.error('[notificationScheduler] tick failed:', err.message);
    }
  };
  timer = setInterval(() => { tick(); }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(() => { tick(); }, 15 * 1000).unref?.();
}

module.exports = {
  startNotificationScheduler,
  urgentPendingBySide,
  urgentNotifications,
  dailyCheckNotification,
  DAILY_CHECK_SCALE_TOTAL,
};
