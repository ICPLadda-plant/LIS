// แจ้งเตือนสต็อกให้ Lab Inventory เมื่อสารเข้าสถานะใหม่: ใกล้หมด, หมด, ใกล้หมดอายุ, หมดอายุ
// กฎระดับเหมือนหน้าเว็บ (src/lib/stockStatus.ts): ขวดใช้ได้ 1 = ใกล้หมด, 0 = หมด, ใกล้หมดอายุ = ภายใน 30 วัน
// สแกนรอบแรกจำสถานะไว้เฉย ๆ เพื่อไม่ให้แจ้งของเก่าทั้งคลังพร้อมกัน
const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 30;
const EMPTY_EPSILON = 1e-6;
const RECIPIENT_ROLES = ['lab-inventory'];
const BASELINE_KEY = '__baseline';
const LEVEL_RANK = { ok: 0, low: 1, out: 2 };
const EXPIRY_RANK = { ok: 0, soon: 1, expired: 2 };

function hasRemaining(unit) {
  const remaining = unit?.volume?.remaining;
  return remaining == null || Number(remaining) > EMPTY_EPSILON;
}

function levelFromCount(count) {
  if (count <= 0) return 'out';
  if (count === 1) return 'low';
  return 'ok';
}

function unitExpiryState(unit, now) {
  if (!unit?.exp || unit.status !== 'active' || !hasRemaining(unit)) return 'ok';
  const left = new Date(unit.exp).getTime() - now.getTime();
  if (Number.isNaN(left)) return 'ok';
  if (left < 0) return 'expired';
  return left <= SOON_DAYS * DAY_MS ? 'soon' : 'ok';
}

// Pure: สถานะทั้งหมด ณ ตอนนี้ → Map<key, { state, label, type, itemName, itemCode }>
function computeStockStates({ standards = [], units = [], solvents = [], glassware = [], now = new Date() }) {
  const states = new Map();
  const unitsByCode = new Map();
  for (const unit of units) {
    if (unit.itemType && unit.itemType !== 'standard') continue;
    const code = String(unit.itemCode || '');
    if (!unitsByCode.has(code)) unitsByCode.set(code, []);
    unitsByCode.get(code).push(unit);
  }
  for (const standard of standards) {
    const list = unitsByCode.get(String(standard.code || '')) || [];
    const usable = list.filter((unit) => unit.status === 'active' && hasRemaining(unit) && unitExpiryState(unit, now) !== 'expired').length;
    states.set('item:standard:' + standard._id, { state: levelFromCount(usable), kind: 'level', itemName: standard.name, detail: 'เหลือ ' + usable + ' ขวด' });
  }
  for (const solvent of solvents) {
    const qty = Number(solvent.qty) || 0;
    states.set('item:solvent:' + solvent._id, { state: levelFromCount(qty), kind: 'level', itemName: solvent.name, detail: 'เหลือ ' + qty + ' ขวด' });
  }
  for (const item of glassware) {
    const qty = Number(item.qty) || 0;
    states.set('item:glassware:' + item._id, { state: qty <= 0 ? 'out' : 'ok', kind: 'level', itemName: item.name, detail: 'เหลือ ' + qty + ' ชิ้น' });
  }
  for (const unit of units) {
    if (unit.status !== 'active') continue;
    const label = unit.labelCode || unit.lotNo || unit.qrId;
    states.set('unit:' + unit._id, {
      state: unitExpiryState(unit, now),
      kind: 'expiry',
      itemName: unit.itemName || unit.itemCode,
      detail: label ? 'ขวด ' + label : '',
    });
  }
  return states;
}

// Pure: เทียบกับสถานะเดิม → เหตุการณ์ที่ต้องแจ้ง (แย่ลงเท่านั้น)
function diffStockStates(previous, next) {
  const events = [];
  for (const [key, entry] of next) {
    const before = previous.get(key) || 'ok';
    const rank = entry.kind === 'expiry' ? EXPIRY_RANK : LEVEL_RANK;
    if ((rank[entry.state] ?? 0) <= (rank[before] ?? 0)) continue;
    events.push({ key, ...entry });
  }
  return events;
}

const EVENT_TEXT = {
  low: { title: 'สารใกล้หมด', level: 'warning' },
  out: { title: 'สารหมด', level: 'error' },
  soon: { title: 'สารใกล้หมดอายุ', level: 'warning' },
  expired: { title: 'สารหมดอายุ', level: 'error' },
};

// Pure: รวมเหตุการณ์ต่อชนิด → แจ้งเตือนไม่เกินชนิดละ 1 อันต่อรอบสแกน
function notificationsForEvents(events, scanKey) {
  const byState = new Map();
  for (const event of events) {
    if (!byState.has(event.state)) byState.set(event.state, []);
    byState.get(event.state).push(event);
  }
  return [...byState.entries()].map(([state, list]) => {
    const names = list.slice(0, 3).map((event) => event.itemName + (event.detail ? ' (' + event.detail + ')' : ''));
    const more = list.length > 3 ? ' และอีก ' + (list.length - 3) + ' รายการ' : '';
    return {
      key: 'stock:' + state + ':' + scanKey,
      kind: 'stock',
      title: EVENT_TEXT[state].title + ' ' + list.length + ' รายการ',
      message: names.join(' · ') + more,
      level: EVENT_TEXT[state].level,
      link: '/stock',
      roles: RECIPIENT_ROLES,
    };
  });
}

async function loadStockSnapshot() {
  const { StockStandard, StockSolvent, StockGlassware } = require('../models/Stock');
  const StockUnit = require('../models/StockUnit');
  const [standards, units, solvents, glassware] = await Promise.all([
    StockStandard.find({}).select('code name').lean(),
    StockUnit.find({ status: 'active' }).select('itemCode itemName itemType status exp volume labelCode lotNo qrId').lean(),
    StockSolvent.find({}).select('name qty').lean(),
    StockGlassware.find({}).select('name qty').lean(),
  ]);
  return { standards, units, solvents, glassware };
}

let running = null;

async function runStockAlertScan(now = new Date()) {
  if (running) return running;
  running = (async () => {
    const StockAlertState = require('../models/StockAlertState');
    const { publishAppNotification } = require('./appNotifications');
    const next = computeStockStates({ ...(await loadStockSnapshot()), now });
    const stored = await StockAlertState.find({}).lean();
    const previous = new Map(stored.map((row) => [row.key, row.state]));
    const baseline = previous.has(BASELINE_KEY);
    const events = baseline ? diffStockStates(previous, next) : [];
    const writes = [];
    for (const [key, entry] of next) {
      if (previous.get(key) !== entry.state) writes.push({ updateOne: { filter: { key }, update: { $set: { state: entry.state } }, upsert: true } });
    }
    if (!baseline) writes.push({ updateOne: { filter: { key: BASELINE_KEY }, update: { $set: { state: 'done' } }, upsert: true } });
    if (writes.length) await StockAlertState.bulkWrite(writes, { ordered: false });
    for (const notification of notificationsForEvents(events, now.getTime())) {
      await publishAppNotification(notification);
    }
    return events.length;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

let pendingTimer = null;

// เรียกหลังมีการเบิก/รับ/ทิ้งสต็อก — รวมหลายคำขอติดกันเป็นสแกนเดียว
function requestStockAlertScan(delayMs = 3000) {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    runStockAlertScan().catch((err) => console.error('[stockAlerts] scan failed:', err.message));
  }, delayMs);
  if (typeof pendingTimer.unref === 'function') pendingTimer.unref();
}

module.exports = {
  computeStockStates,
  diffStockStates,
  notificationsForEvents,
  runStockAlertScan,
  requestStockAlertScan,
  unitExpiryState,
};
