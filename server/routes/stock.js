const express = require('express');
const fs = require('fs');
const router = express.Router();
// คงเหลือต่ำกว่านี้ (mg/ml) ถือว่าขวดหมด กันเศษทศนิยมจากการลบหลายครั้ง
const EMPTY_REMAINING_EPSILON = 1e-6;
const { StockStandard, StockSolvent, StockGlassware } = require('../models/Stock');
const StockTransaction = require('../models/StockTransaction');
const { buildSearchRankingStages } = require('../lib/searchRanking');
const ChemicalRequisition = require('../models/ChemicalRequisition');
const StockUnit = require('../models/StockUnit');
const User = require('../models/User');
const crypto = require('crypto');
const { normalizeRoles } = require('../lib/roles');
const { syntheticDevRolesFromEmail } = require('../lib/syntheticDevRoles');
const { queryString } = require('../lib/queryValue');
const { isValidReceiveType, isValidUnitType } = require('../lib/stockSource');
const { MG_COMPARISON_EPSILON, sumWeights } = require('../lib/requisitionWeights');
const { normalizeActorFields } = require('../lib/stockActor');
const { buildLotBottleNumbers } = require('../lib/stockLotBottle');
const { buildStandardLabelCodeDefaults, formatStandardLabelCode, parseStandardLabelCode, standardLabelCodePrefix } = require('../lib/stockStandardLabelCode');
const {
  validateStandardUnitReceiveInput,
  validateSolventReceiveInput,
  composeSolventReceiveNote,
  normalizePhotoUrls,
  normalizeBottlePhotoUrls,
} = require('../lib/stockReceiveValidation');
const {
  buildPendingDeductionFilter,
  normalizeDeductionResolutionInput,
} = require('../lib/deductionResolution');
const { buildInUseItems, canAcknowledgeDeduction } = require('../lib/standardsInUse');
const { normalizeSixMonthStockItems } = require('../lib/sixMonthStockItems');
const {
  buildStandardExportDateRange,
  buildStandardLotExportHtml,
  buildStandardLotExportWorkbook,
  buildSolventRequisitionDoc,
  dateStamp,
  sanitizeFilenameSegment,
} = require('../lib/stockHistoryExport');

const STOCK_ALL_ITEM_URL = process.env.STOCK_ALL_ITEM_URL || 'https://n8n-plant.icpladda.com/webhook/api/stock-all-item';
const STOCK_ALL_ITEM_TIMEOUT_MS = 15_000;
const SIX_MONTH_MEDICINE_DEPARTMENT = 'คลังสินค้า FG';

async function genUniqueQrId() {
  for (let i = 0; i < 5; i++) {
    const id = 'u_' + crypto.randomBytes(6).toString('hex'); // u_ + 12 hex
    const exists = await StockUnit.exists({ qrId: id });
    if (!exists) return id;
  }
  throw new Error('ไม่สามารถสร้าง qrId ที่ไม่ซ้ำได้');
}

function normalizeDefaultLabelCodeCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) return 1;
  return Math.min(count, 200);
}

async function standardLabelCodeDefaults(std, count, now = new Date()) {
  const units = await StockUnit.find({ itemCode: std.code, labelCode: { $exists: true, $nin: ['', null] } })
    .select('labelCode')
    .lean();
  return buildStandardLabelCodeDefaults(std.code, units, { count: normalizeDefaultLabelCodeCount(count), now });
}

async function resolveReceiveLabelCodes(std, bottles, now = new Date()) {
  const parsed = bottles.map((bottle) => {
    const raw = bottle && bottle.labelCode;
    if (raw == null || String(raw).trim() === '') return null;
    const parsedCode = parseStandardLabelCode(raw, std.code);
    if (!parsedCode) {
      const prefix = standardLabelCodePrefix(std.code);
      const sample = formatStandardLabelCode(std.code, (now.getFullYear() + 543) % 100, 1);
      throw new Error(`Code ต้องขึ้นต้นด้วย ${prefix} และตามด้วยปี/เลขขวด เช่น ${sample}`);
    }
    return parsedCode.labelCode;
  });

  const providedCodes = new Set(parsed.filter(Boolean));
  const defaults = await standardLabelCodeDefaults(std, bottles.length + providedCodes.size, now);
  let defaultIndex = 0;
  const labelCodes = parsed.map((code) => {
    if (code) return code;
    while (providedCodes.has(defaults.codes[defaultIndex])) defaultIndex += 1;
    const next = defaults.codes[defaultIndex];
    defaultIndex += 1;
    return next;
  });

  return labelCodes;
}

function normalizeUnitLabelCodeUpdate(labelCode, itemCode) {
  const rawLabelCode = String(labelCode ?? '').trim().toUpperCase();
  if (!rawLabelCode) return '';
  const parsedCode = parseStandardLabelCode(rawLabelCode, itemCode);
  if (!parsedCode) {
    const prefix = standardLabelCodePrefix(itemCode);
    throw new Error(`Code ต้องขึ้นต้นด้วย ${prefix} และตามด้วยปี/เลขขวด เช่น ${prefix}6901`);
  }
  return parsedCode.labelCode;
}

function normalizeUnitLabelCodeSearch(labelCode) {
  return String(labelCode ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function applyStockUnitItemTypeFilter(filter, itemType) {
  const normalizedItemType = String(itemType ?? '').trim();
  if (!normalizedItemType) return;
  if (normalizedItemType === 'standard') {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { $or: [{ itemType: 'standard' }, { itemType: { $exists: false } }, { itemType: null }, { itemType: '' }] },
    ];
    return;
  }
  filter.itemType = normalizedItemType;
}

function displayCodeYearCandidatesFromBuddhistTwoDigits(buddhistYear) {
  const gregorianTwoDigits = (buddhistYear + 100 - 43) % 100;
  return [...new Set([
    buddhistYear,
    2500 + buddhistYear,
    2000 + gregorianTwoDigits,
    1900 + gregorianTwoDigits,
  ])];
}

function parseStandardUnitDisplayCodeQuery(labelCode) {
  const normalized = normalizeUnitLabelCodeSearch(labelCode);
  if (!/^.{2}\d{2}\d+$/.test(normalized)) return null;
  const buddhistYear = Number(normalized.slice(2, 4));
  const bottleNo = Number(normalized.slice(4));
  if (!Number.isInteger(buddhistYear) || !Number.isInteger(bottleNo) || bottleNo < 1) return null;
  return {
    normalized,
    bottleNo,
    labelRunYears: displayCodeYearCandidatesFromBuddhistTwoDigits(buddhistYear),
  };
}

function standardUnitDisplayCode(unit) {
  const labelCode = normalizeUnitLabelCodeSearch(unit?.labelCode);
  if (labelCode) return labelCode;
  const labelRunNo = Number(unit?.labelRunNo);
  const labelRunYear = Number(unit?.labelRunYear);
  if (!Number.isInteger(labelRunNo) || labelRunNo < 1 || !Number.isInteger(labelRunYear) || labelRunYear <= 0) return '';
  let buddhistYear = labelRunYear % 100;
  if (labelRunYear >= 1900 && labelRunYear < 2400) buddhistYear = (labelRunYear + 543) % 100;
  try {
    return normalizeUnitLabelCodeSearch(formatStandardLabelCode(unit?.itemCode ?? '', buddhistYear, labelRunNo));
  } catch {
    return '';
  }
}

function uniqueStockUnits(units) {
  const seen = new Set();
  const out = [];
  for (const unit of units) {
    const key = String(unit?._id || unit?.qrId || '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(unit);
  }
  return out;
}

async function personOf(req) {
  const m = await userMeta(req);
  return m.userName ? { email: m.userEmail, name: m.userName } : undefined;
}

const TIERS = ['primary', 'supplier', 'working'];
const RECEIVE_BARCODE_MODELS = {
  standard: StockStandard,
  solvent: StockSolvent,
  glassware: StockGlassware,
};

function normalizeReceiveBarcode(value) {
  return String(value || '').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

async function fetchStockAllItems() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STOCK_ALL_ITEM_TIMEOUT_MS);
  try {
    const response = await fetch(STOCK_ALL_ITEM_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`stock-all-item returned ${response.status}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function buildTransactionFilter(query = {}) {
  const { itemType, itemId, qrId, action, search, user, createdFrom, createdTo } = query;
  const filter = {};
  const and = [];
  if (queryString(itemType)) filter.itemType = itemType;
  if (queryString(itemId)) filter.itemId = itemId;
  if (qrId) filter.qrId = String(qrId).trim();
  if (queryString(action)) filter.action = action;
  if (String(search || '').trim()) {
    const regex = new RegExp(escapeRegExp(String(search).trim()), 'i');
    and.push({ $or: [{ itemName: regex }, { itemCode: regex }, { userName: regex }, { userEmail: regex }] });
  }
  if (String(user || '').trim()) {
    const regex = new RegExp(escapeRegExp(String(user).trim()), 'i');
    and.push({ $or: [{ userName: regex }, { userEmail: regex }] });
  }
  if (createdFrom || createdTo) {
    filter.createdAt = {};
    if (createdFrom) {
      const from = new Date(createdFrom);
      if (Number.isNaN(from.getTime())) throw badRequest('Invalid createdFrom');
      filter.createdAt.$gte = from;
    }
    if (createdTo) {
      const to = new Date(createdTo);
      if (Number.isNaN(to.getTime())) throw badRequest('Invalid createdTo');
      filter.createdAt.$lt = to;
    }
  }
  if (and.length) filter.$and = and;
  return filter;
}

function receiveBarcodePayload(category, item, barcode) {
  return {
    barcode,
    category,
    itemId: item._id.toString(),
    itemCode: item.code || '',
    itemName: item.name || '',
    barcodes: item.barcodes || [],
  };
}

async function findReceiveBarcodeOwner(barcode) {
  for (const [category, Model] of Object.entries(RECEIVE_BARCODE_MODELS)) {
    const item = await Model.findOne({ barcodes: barcode }).lean();
    if (item) return { category, item };
  }
  return null;
}

function requestHeader(req, name) {
  return req.get?.(name) || req.headers?.[String(name).toLowerCase()] || '';
}

function decodedHeader(req, name) {
  const value = requestHeader(req, name);
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value);
  }
}

async function userMeta(req) {
  if (req._stockUserMeta) return req._stockUserMeta;
  const raw = {
    email: req.body?._user?.email || requestHeader(req, 'x-user-email') || requestHeader(req, 'x-lis-user') || '',
    name: req.body?._user?.name || requestHeader(req, 'x-user-name') || '',
    department: req.body?._user?.department || decodedHeader(req, 'x-user-department') || decodedHeader(req, 'x-lis-department') || '',
  };
  const email = String(raw.email || '').trim().toLowerCase();
  const stored = email ? await User.findOne({ email }).lean() : null;
  const actor = normalizeActorFields(raw, stored || {});
  req._stockUserMeta = {
    userEmail: actor.email,
    userName: actor.name,
    userDepartment: String(stored?.department || raw.department || '').trim(),
  };
  return req._stockUserMeta;
}

const STOCK_DEDUCTION_ACTION_TIME_ZONE = 'Asia/Bangkok';
const STOCK_DEDUCTION_MANAGER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STOCK_DEDUCTION_MANAGER_ROLES = new Set(['admin', 'lab-inventory']);

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isLoopbackIp(value) {
  const ip = String(value || '').trim().toLowerCase().replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
}

function stockDevRolesFromEmail(email, req) {
  // role จำลองใช้ได้เฉพาะ dev บนเครื่องตัวเอง (loopback) และห้ามเปิดบน production
  if (process.env.NODE_ENV === 'production') return [];
  if (!isLoopbackIp(req?.ip)) return [];
  return syntheticDevRolesFromEmail(email);
}

function calendarDayKey(value, timeZone = STOCK_DEDUCTION_ACTION_TIME_ZONE) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((row) => row.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function canManageOwnTodayDeduction(tx, actorEmail, now = new Date()) {
  if (!tx || tx.action !== 'deduct') return false;
  const owner = normalizedEmail(tx.userEmail);
  const actor = normalizedEmail(actorEmail);
  if (!owner || !actor || owner !== actor) return false;
  return calendarDayKey(tx.createdAt) === calendarDayKey(now);
}

function canManageStockDeduction(tx, actor, now = new Date()) {
  if (!tx || tx.action !== 'deduct') return false;
  const createdAt = tx.createdAt ? new Date(tx.createdAt) : null;
  const createdAtMs = createdAt?.getTime?.() ?? NaN;
  const nowMs = now.getTime();
  const hasManagerRole = normalizeRoles(actor).some((role) => STOCK_DEDUCTION_MANAGER_ROLES.has(role));
  if (hasManagerRole) {
    return Number.isFinite(createdAtMs) && createdAtMs <= nowMs && nowMs - createdAtMs <= STOCK_DEDUCTION_MANAGER_WINDOW_MS;
  }
  return canManageOwnTodayDeduction(tx, actor?.email || actor?.userEmail || '', now);
}

async function stockManagementActor(req) {
  const meta = await userMeta(req);
  const email = normalizedEmail(meta.userEmail);
  const stored = email ? await User.findOne({ email }).lean() : null;
  const storedRoles = normalizeRoles(stored);
  return {
    email: meta.userEmail,
    userEmail: meta.userEmail,
    name: meta.userName,
    department: String(stored?.department || meta.userDepartment || '').trim(),
    roles: storedRoles.length > 0 ? storedRoles : stockDevRolesFromEmail(meta.userEmail, req),
  };
}

function isVolumeDeduction(tx) {
  return tx?.volumeDelta != null || String(tx?.unit || tx?.volumeUnit || '').toLowerCase() === 'mg';
}

function transactionDeductionAmount(tx) {
  const volumeDelta = Number(tx?.volumeDelta);
  if (tx?.volumeDelta != null && Number.isFinite(volumeDelta)) return Math.abs(volumeDelta);
  const delta = Number(tx?.delta);
  if (tx?.delta != null && Number.isFinite(delta)) return Math.abs(delta);
  return Array.isArray(tx?.weights) ? sumWeights(tx.weights) : 0;
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function normalizeDeductionEditInput(body = {}, tx = {}) {
  let amount = null;
  let weights;
  if (isVolumeDeduction(tx) && Array.isArray(body.weights)) {
    weights = body.weights.map((weight) => Number(weight));
    if (!weights.length || weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
      return { error: 'กรุณากรอกน้ำหนักทุกช่องให้มากกว่า 0' };
    }
    amount = sumWeights(weights);
  } else {
    amount = normalizePositiveAmount(body.amount ?? body.qty);
  }
  if (!amount) return { error: 'จำนวนที่ตัดไม่ถูกต้อง' };

  const previousAmount = transactionDeductionAmount(tx);
  if (tx.itemType === 'solvent' && tx.qrId && amount !== previousAmount) {
    return { error: 'รายการเบิกจาก QR รายขวดแก้จำนวนไม่ได้ ให้ลบแล้วเบิกใหม่' };
  }
  if (tx.itemType === 'solvent' && !Number.isInteger(amount)) {
    return { error: 'จำนวนขวดต้องเป็นจำนวนเต็มบวก' };
  }
  const beforeQty = Number(tx.beforeQty);
  if (Number.isFinite(beforeQty) && beforeQty >= 0 && amount > beforeQty) {
    return { error: 'จำนวนที่ตัดต้องไม่เกินคงเหลือก่อนตัด' };
  }
  return {
    value: {
      amount,
      weights,
      note: body.note === undefined ? String(tx.note || '') : String(body.note || ''),
    },
  };
}

async function logTransaction(data) {
  try {
    await StockTransaction.create(data);
  } catch (err) {
    console.error('logTransaction failed:', err.message);
  }
}

function normalizeExportDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function contentDispositionFilename(filename) {
  const fallback = String(filename || 'stock-export')
    .replace(/[^ -~]+/g, '_')
    .replace(/[\"]/g, '_') || 'stock-export';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function sendAttachment(res, { buffer, contentType, filename }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDispositionFilename(filename));
  return res.send(buffer);
}

const RESOLUTION_REASON_LABELS = {
  empty: 'หมด',
  ineffective: 'ไม่มีประสิทธิภาพ',
  other: 'อื่นๆ',
};

async function applyUnitResolutionFromTransaction(tx, resolution, req) {
  // "รับทราบหมดอายุ" = สารละลายที่เตรียมไว้ครบกำหนด ไม่ใช่ขวดต้นทางมีปัญหา → ห้ามแตะขวด
  if (resolution.reason === 'expired') return null;
  if (tx.itemType !== 'standard' || !tx.qrId) return null;

  const unit = await StockUnit.findOne({ qrId: tx.qrId });
  if (!unit) throw new Error('ไม่พบขวด (QR)');

  if (resolution.reason === 'empty') {
    if (unit.status !== 'discarded') unit.status = 'empty';
  } else if (unit.status !== 'discarded') {
    unit.status = 'discarded';
    unit.discardedAt = new Date();
    unit.discardedBy = await personOf(req);
    unit.discardReason = resolution.note || RESOLUTION_REASON_LABELS[resolution.reason];
  }

  await unit.save();
  return unit;
}

function stripMeta(body) {
  if (!body) return body;
  const { _user, ...rest } = body;
  return rest;
}

function solventItemPayload(body = {}) {
  const payload = {};
  if (body.name !== undefined) payload.name = String(body.name);
  if (body.sizeLiter !== undefined) {
    const sizeLiter = Number(body.sizeLiter);
    payload.sizeLiter = Number.isFinite(sizeLiter) && sizeLiter > 0 ? sizeLiter : 0;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    payload.price = Number.isFinite(price) && price >= 0 ? price : 0;
  }
  if (body.note !== undefined) payload.note = String(body.note);
  return payload;
}

function requireWholeBottleCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) return null;
  return count;
}

function solventVolumeMl(sizeLiter) {
  const liters = Number(sizeLiter);
  return Number.isFinite(liters) && liters > 0 ? liters * 1000 : 0;
}

async function createSolventUnitsForReceive({ item, qty, lotNo, exp, sizeLiter, photoUrls, receivedDate, createdBy }) {
  const itemId = item._id.toString();
  const normalizedLotNo = String(lotNo || '').trim();
  const existingLotBottleCount = normalizedLotNo
    ? await StockUnit.countDocuments({ itemType: 'solvent', itemId, kind: 'sealed', lotNo: normalizedLotNo })
    : 0;
  const lotBottleNumbers = buildLotBottleNumbers(existingLotBottleCount, qty);
  const volumeMl = solventVolumeMl(sizeLiter);
  const created = [];

  for (let index = 0; index < qty; index += 1) {
    const qrId = await genUniqueQrId();
    const unit = await StockUnit.create({
      qrId,
      itemType: 'solvent',
      itemId,
      itemCode: itemId,
      itemName: item.name,
      kind: 'sealed',
      type: '',
      lotNo: normalizedLotNo,
      lotBottleNo: lotBottleNumbers[index],
      exp: new Date(exp),
      volume: { initial: volumeMl, remaining: volumeMl, unit: 'ml' },
      status: 'active',
      receivedDate,
      createdBy,
      photoUrls: photoUrls.length ? photoUrls : undefined,
    });
    created.push(unit);
  }

  return created;
}

async function markSolventUnitsEmptyForDeduction(item, qty) {
  const count = Math.floor(Number(qty));
  if (!Number.isFinite(count) || count < 1) return;
  const itemId = item._id.toString();
  const units = await StockUnit.find({ itemType: 'solvent', itemId, status: 'active' })
    .sort({ receivedDate: 1, createdAt: 1, _id: 1 })
    .limit(count);
  for (const unit of units) {
    unit.status = 'empty';
    if (unit.volume) unit.volume.remaining = 0;
    await unit.save();
  }
}

async function markSolventUnitsEmptyForDeductionStrict(solventId, qty) {
  const count = requireWholeBottleCount(qty);
  if (!count) throw new Error('จำนวนขวดต้องเป็นจำนวนเต็มบวก');
  const units = await StockUnit.find({ itemType: 'solvent', itemId: String(solventId), status: 'active' })
    .sort({ receivedDate: 1, createdAt: 1, _id: 1 })
    .limit(count);
  if (units.length < count) throw new Error('ขวดสารเคมีพร้อมใช้งานไม่พอ');
  for (const unit of units) {
    unit.status = 'empty';
    if (unit.volume) unit.volume.remaining = 0;
    await unit.save();
  }
  return units;
}

async function restoreSolventUnit(unit) {
  unit.status = 'active';
  if (unit.volume && Number(unit.volume.remaining) <= 0) {
    unit.volume.remaining = Number(unit.volume.initial) || 0;
  }
  await unit.save();
}

async function restoreSolventUnitsForDeduction(solventId, qty, qrId) {
  const count = requireWholeBottleCount(qty);
  if (!count) return;
  if (qrId) {
    const unit = await StockUnit.findOne({ itemType: 'solvent', itemId: String(solventId), qrId: String(qrId).trim(), status: 'empty' });
    if (unit) await restoreSolventUnit(unit);
    return;
  }
  const units = await StockUnit.find({ itemType: 'solvent', itemId: String(solventId), status: 'empty' })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(count);
  for (const unit of units) await restoreSolventUnit(unit);
}

async function updateStockQuantity(Model, itemId, path, diff, errorMessage) {
  if (diff === 0) return Model.findById(itemId);
  const filter = { _id: itemId };
  if (diff < 0) filter[path] = { $gte: Math.abs(diff) };
  const updated = await Model.findOneAndUpdate(filter, { $inc: { [path]: diff } }, { new: true });
  if (!updated) throw new Error(errorMessage);
  return updated;
}

function stockUnitQueryForTransaction(tx) {
  if (tx.qrId) return { qrId: tx.qrId, itemType: 'standard' };
  if (tx.unitId) return { _id: tx.unitId, itemType: 'standard' };
  throw new Error('ไม่พบข้อมูลขวดของรายการเบิก');
}

async function adjustStockUnitDeduction(tx, diff) {
  if (diff === 0) return;
  const query = stockUnitQueryForTransaction(tx);
  if (diff < 0) {
    const amountToDeduct = Math.abs(diff);
    const updated = await StockUnit.findOneAndUpdate(
      { ...query, status: 'active', 'volume.remaining': { $gte: amountToDeduct } },
      { $inc: { 'volume.remaining': -amountToDeduct } },
      { new: true },
    );
    if (!updated) throw new Error('ปริมาณคงเหลือไม่พอ');
    if (Number(updated.volume?.remaining) <= EMPTY_REMAINING_EPSILON) {
      updated.volume.remaining = 0;
      updated.status = 'empty';
      await updated.save();
    }
    return;
  }

  const unit = await StockUnit.findOne(query);
  if (!unit) throw new Error('ไม่พบขวด (QR)');
  const currentRemaining = Number(unit.volume?.remaining) || 0;
  const initialAmount = Number(unit.volume?.initial);
  const nextRemaining = currentRemaining + diff;
  if (Number.isFinite(initialAmount) && initialAmount > 0 && nextRemaining > initialAmount) {
    throw new Error('จำนวนคืนกลับเกินปริมาณตั้งต้นของขวด');
  }
  if (!unit.volume) {
    unit.volume = { initial: nextRemaining, remaining: nextRemaining, unit: tx.volumeUnit || tx.unit || 'mg' };
  } else {
    unit.volume.remaining = nextRemaining;
  }
  if (nextRemaining > 0 && unit.status === 'empty') unit.status = 'active';
  await unit.save();
}

async function adjustSolventDeduction(tx, diff) {
  if (diff === 0) return;
  if (diff < 0) {
    const emptiedUnits = await markSolventUnitsEmptyForDeductionStrict(tx.itemId, Math.abs(diff));
    try {
      await updateStockQuantity(StockSolvent, tx.itemId, 'qty', diff, 'จำนวน stock ไม่พอ');
    } catch (err) {
      for (const unit of emptiedUnits) await restoreSolventUnit(unit);
      throw err;
    }
    return;
  }
  await updateStockQuantity(StockSolvent, tx.itemId, 'qty', diff, 'ไม่พบสารเคมี');
  await restoreSolventUnitsForDeduction(tx.itemId, diff, tx.qrId);
}

async function adjustDeductionStock(tx, nextAmount) {
  const previousAmount = transactionDeductionAmount(tx);
  const diff = previousAmount - nextAmount;
  if (diff === 0) return;
  if (isVolumeDeduction(tx)) {
    await adjustStockUnitDeduction(tx, diff);
  } else if (tx.itemType === 'standard') {
    const tier = TIERS.includes(tx.tier) ? tx.tier : 'primary';
    await updateStockQuantity(StockStandard, tx.itemId, `${tier}.qty`, diff, 'จำนวน stock ไม่พอ');
  } else if (tx.itemType === 'solvent') {
    await adjustSolventDeduction(tx, diff);
  } else if (tx.itemType === 'glassware') {
    await updateStockQuantity(StockGlassware, tx.itemId, 'qty', diff, 'จำนวน stock ไม่พอ');
  } else {
    throw new Error('ไม่รองรับประเภทรายการเบิกนี้');
  }
}

// Pure: can this unit give up `mg`? (no DB) — shared by the endpoint and the
// lab-completion settle validator so both agree on the rules.
function planDeductMg(unit, mg) {
  const amount = Number(mg);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'จำนวน mg ไม่ถูกต้อง' };
  if (!unit || unit.status !== 'active') return { ok: false, reason: 'ขวดนี้ใช้งานต่อไม่ได้' };
  if (unit.exp && new Date(unit.exp).getTime() < Date.now()) return { ok: false, reason: 'ขวดนี้หมดอายุแล้ว' };
  const remaining = Number(unit.volume && unit.volume.remaining) || 0;
  if (remaining <= 0 || amount - remaining > MG_COMPARISON_EPSILON) return { ok: false, reason: 'ปริมาณคงเหลือไม่พอ' };
  return { ok: true, after: Math.max(0, remaining - amount) };
}

// Atomic: หัก mg จาก volume.remaining ของขวด (กัน race ด้วย $gte). โยน Error ถ้าไม่ผ่าน.
async function deductMgFromUnit(qrId, mg, meta = {}) {
  const amount = Number(mg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('จำนวน mg ไม่ถูกต้อง');
  const unit = await StockUnit.findOne({ qrId });
  if (!unit) throw new Error('ไม่พบขวด (QR)');
  const plan = planDeductMg(unit, amount);
  if (!plan.ok) throw new Error(plan.reason);
  const deductionAmount = Math.min(amount, Number(unit.volume?.remaining) || 0);
  const updated = await StockUnit.findOneAndUpdate(
    { qrId, status: 'active', 'volume.remaining': { $gte: deductionAmount } },
    { $inc: { 'volume.remaining': -deductionAmount } },
    { new: true },
  );
  if (!updated) throw new Error('ปริมาณคงเหลือไม่พอ');
  const before = updated.volume.remaining + deductionAmount; // pre-decrement value, atomically consistent
  // เศษทศนิยมจากการลบหลายครั้ง (เช่น 1e-12) ให้ถือว่าหมด
  if (updated.volume.remaining <= EMPTY_REMAINING_EPSILON) {
    updated.volume.remaining = 0;
    updated.status = 'empty';
    await updated.save();
  }
  const std = await StockStandard.findOne({ code: updated.itemCode });
  await logTransaction({
    itemType: 'standard',
    itemId: std ? std._id.toString() : updated.itemCode,
    itemCode: updated.itemCode,
    itemName: updated.itemName,
    action: 'deduct',
    unitId: updated._id.toString(),
    qrId,
    volumeDelta: -deductionAmount,
    volumeUnit: 'mg',
    unit: 'mg',
    beforeQty: before,
    afterQty: updated.volume.remaining,
    weights: meta.weights,
    instrumentId: meta.instrumentId,
    instrumentName: meta.instrumentName,
    instrumentGroup: meta.instrumentGroup,
    sampleId: meta.sampleId,
    note: meta.note,
    userEmail: meta.userEmail,
    userName: meta.userName,
  });
  return { unit: updated, before, after: updated.volume.remaining };
}

function publicStockUnitPayload(unit) {
  if (unit.itemType === 'solvent') {
    const remaining = Number(unit.volume?.remaining ?? 0);
    const initialMl = Number(unit.volume?.initial ?? 0);
    return {
      kind: 'solvent',
      id: unit.itemId || unit.itemCode,
      qrId: unit.qrId,
      name: unit.itemName,
      sizeLiter: initialMl > 0 ? initialMl / 1000 : 0,
      qty: unit.status === 'active' && remaining > 0 ? 1 : 0,
      lotNo: unit.lotNo || '',
      lotBottleNo: unit.lotBottleNo || null,
      exp: unit.exp || null,
      volume: unit.volume,
      status: unit.status,
      photoUrls: unit.photoUrls || [],
      updatedAt: unit.updatedAt,
    };
  }
  return {
    kind: 'standard',
    qrId: unit.qrId,
    itemCode: unit.itemCode,
    itemName: unit.itemName,
    type: unit.type || 'primary',
    lotNo: unit.lotNo || '',
    lotBottleNo: unit.lotBottleNo || null,
    labelCode: unit.labelCode || '',
    exp: unit.exp || null,
    volume: unit.volume,
    status: unit.status,
    photoUrls: unit.photoUrls || [],
    updatedAt: unit.updatedAt,
  };
}

function publicSolventPayload(solvent, latestReceive) {
  return {
    kind: 'solvent',
    id: solvent._id.toString(),
    qrId: solvent._id.toString(),
    name: solvent.name,
    sizeLiter: solvent.sizeLiter,
    qty: solvent.qty,
    note: solvent.note || '',
    photoUrls: latestReceive?.photoUrls || [],
    latestReceiveNote: latestReceive?.note || '',
    updatedAt: solvent.updatedAt,
  };
}

router.get('/public/:qrId', async (req, res) => {
  try {
    const qrId = String(req.params.qrId || '').trim();
    if (!qrId) return res.status(400).json({ error: 'missing qrId' });

    const unit = await StockUnit.findOne({ qrId }).lean();
    if (unit) return res.json(publicStockUnitPayload(unit));

    let solvent = null;
    try {
      solvent = await StockSolvent.findById(qrId).lean();
    } catch {
      solvent = null;
    }
    if (solvent) {
      const latestReceive = await StockTransaction.findOne({
        itemType: 'solvent',
        itemId: solvent._id.toString(),
        action: 'receive',
        photoUrls: { $exists: true, $ne: [] },
      }).sort({ createdAt: -1 }).lean();
      return res.json(publicSolventPayload(solvent, latestReceive));
    }

    return res.status(404).json({ error: 'ไม่พบรายการ stock จาก QR นี้' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ==================== RECEIVE BARCODES ==================== */

router.post('/barcodes/register', async (req, res) => {
  try {
    const barcode = normalizeReceiveBarcode(req.body?.barcode);
    const category = String(req.body?.category || '').trim();
    const itemId = String(req.body?.itemId || '').trim();
    const Model = RECEIVE_BARCODE_MODELS[category];

    if (!barcode) return res.status(400).json({ error: 'ต้องระบุ Barcode' });
    if (!Model) return res.status(400).json({ error: 'ประเภท Barcode ไม่ถูกต้อง' });
    if (!itemId) return res.status(400).json({ error: 'ต้องเลือกรายการ stock' });

    const item = await Model.findById(itemId);
    if (!item) return res.status(404).json({ error: 'ไม่พบรายการ stock' });

    const owner = await findReceiveBarcodeOwner(barcode);
    if (owner) {
      const ownerId = owner.item._id.toString();
      if (owner.category !== category || ownerId !== item._id.toString()) {
        return res.status(409).json({ error: 'Barcode นี้ถูกลงทะเบียนกับรายการอื่นแล้ว' });
      }
    }

    if (!Array.isArray(item.barcodes)) item.barcodes = [];
    if (!item.barcodes.includes(barcode)) {
      item.barcodes.push(barcode);
      await item.save();
    }

    return res.json(receiveBarcodePayload(category, item, barcode));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/* ==================== STANDARDS ==================== */

router.get('/medicine-six-months', async (req, res) => {
  try {
    const actor = await stockManagementActor(req);
    const actorRoles = normalizeRoles(actor);
    if (!actorRoles.includes('admin') && !actorRoles.includes('qc-head') && actor.department !== SIX_MONTH_MEDICINE_DEPARTMENT) {
      return res.status(403).json({ error: 'เฉพาะ Admin / QC Head / คลังสินค้า FG เท่านั้น' });
    }
    const referenceDate = new Date();
    const rows = await fetchStockAllItems();
    res.json({
      serverTime: referenceDate.toISOString(),
      referenceMonth: referenceDate.toISOString().slice(0, 7),
      items: normalizeSixMonthStockItems(rows, referenceDate),
    });
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 502;
    const message = err.name === 'AbortError' ? 'stock-all-item timeout' : err.message;
    res.status(status).json({ error: message });
  }
});

router.get('/standards', async (req, res) => {
  try {
    res.json(await StockStandard.find().sort({ code: 1 }).collation({ locale: 'en', numericOrdering: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// standard ที่เบิกไปแล้วยังไม่ปิด + วันครบกำหนดตามความถี่ (แท็บ "กำลังใช้งานอยู่")
// ต้องอยู่เหนือ '/standards/:id' ไม่งั้นจะถูกจับเป็น id
router.get('/standards/in-use', async (req, res) => {
  try {
    const built = buildPendingDeductionFilter({ itemType: 'standard' });
    if (built.error) return res.status(400).json({ error: built.error });
    const txs = await StockTransaction.find(built.value)
      .select('itemCode itemName qrId weights volumeDelta instrumentGroup note createdAt userEmail userName')
      // เก่าสุดก่อน — ถ้าเกิน limit แถวที่หลุดต้องเป็นแถวใหม่สุด ไม่ใช่แถวที่เกินกำหนดนานสุด
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    const codes = [...new Set(txs.map((t) => t.itemCode).filter(Boolean))];
    const standards = codes.length
      ? await StockStandard.find({ code: { $in: codes } }).select('code frequency').lean()
      : [];
    res.json({ serverTime: new Date().toISOString(), items: buildInUseItems(txs, standards) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/standards/:id/label-codes/defaults', async (req, res) => {
  try {
    const std = await StockStandard.findById(req.params.id);
    if (!std) return res.status(404).json({ error: 'Not found' });
    const count = normalizeDefaultLabelCodeCount(req.query.count);
    const defaults = await standardLabelCodeDefaults(std, count);
    res.json(defaults);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/standards/:id', async (req, res) => {
  try {
    const item = await StockStandard.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/standards', async (req, res) => {
  try {
    const body = stripMeta(req.body);
    const item = await StockStandard.create(body);
    await logTransaction({
      itemType: 'standard',
      itemId: item._id.toString(),
      itemCode: item.code,
      itemName: item.name,
      action: 'create',
      afterQty: item.primary?.qty ?? 0,
      unit: 'bottle',
      ...(await userMeta(req)),
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/standards/:id', async (req, res) => {
  try {
    const body = stripMeta(req.body);
    const before = await StockStandard.findById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const item = await StockStandard.findByIdAndUpdate(req.params.id, body, { new: true });
    const codeChanged = String(before.code || '') !== String(item.code || '');
    const nameChanged = String(before.name || '') !== String(item.name || '');
    if (codeChanged || nameChanged) {
      await StockUnit.updateMany(
        { itemCode: before.code },
        { $set: { itemCode: item.code, itemName: item.name } },
      );
    }
    await logTransaction({
      itemType: 'standard',
      itemId: item._id.toString(),
      itemCode: item.code,
      itemName: item.name,
      action: 'update',
      beforeQty: before.primary?.qty ?? 0,
      afterQty: item.primary?.qty ?? 0,
      delta: (item.primary?.qty ?? 0) - (before.primary?.qty ?? 0),
      unit: 'bottle',
      ...(await userMeta(req)),
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/standards/:id', async (req, res) => {
  try {
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    const item = await StockStandard.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    await item.softDelete(actor);
    await logTransaction({
      itemType: 'standard',
      itemId: item._id.toString(),
      itemCode: item.code,
      itemName: item.name,
      action: 'delete',
      beforeQty: item.primary?.qty ?? 0,
      ...(await userMeta(req)),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deduct: { tier: 'primary'|'supplier'|'working', qty: number, sampleId?, note? }
router.post('/standards/:id/deduct', async (req, res) => {
  try {
    const { tier = 'primary', qty, sampleId, note } = req.body;
    if (!TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid qty' });

    const item = await StockStandard.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const before = item[tier]?.qty ?? 0;
    if (before < amount) return res.status(400).json({ error: 'จำนวน stock ไม่พอ' });

    item[tier].qty = before - amount;
    await item.save();

    await logTransaction({
      itemType: 'standard',
      itemId: item._id.toString(),
      itemCode: item.code,
      itemName: item.name,
      action: 'deduct',
      tier,
      beforeQty: before,
      afterQty: item[tier].qty,
      delta: -amount,
      unit: 'bottle',
      sampleId,
      note,
      ...(await userMeta(req)),
    });

    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// หัก mg จากขวดตรงๆ: { mg?, weights?[], instrumentGroup?, instrumentId?, instrumentName?, sampleId?, petitionNo?, note? }
router.post('/units/:qrId/deduct-mg', async (req, res) => {
  try {
    const { mg, weights, instrumentId, instrumentName, instrumentGroup, sampleId, petitionNo, note } = req.body || {};
    const amount = Array.isArray(weights) && weights.length ? sumWeights(weights) : mg;
    const meta = {
      weights: Array.isArray(weights) ? weights.map(Number) : undefined,
      instrumentId, instrumentName, sampleId,
      // กัน audit หาย: ค่านอก enum → undefined (default null)
      instrumentGroup: instrumentGroup === 'gc' || instrumentGroup === 'hplc' ? instrumentGroup : undefined,
      note: [petitionNo, note].filter(Boolean).join(' · '),
      ...(await userMeta(req)),
    };
    const result = await deductMgFromUnit(req.params.qrId, amount, meta);
    res.json(result.unit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Receive: { tier, qty, note? }
router.post('/standards/:id/receive', async (req, res) => {
  try {
    const { tier = 'primary', qty, note } = req.body;
    if (!TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid qty' });

    const item = await StockStandard.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const before = item[tier]?.qty ?? 0;
    item[tier].qty = before + amount;
    await item.save();

    await logTransaction({
      itemType: 'standard',
      itemId: item._id.toString(),
      itemCode: item.code,
      itemName: item.name,
      action: 'receive',
      tier,
      beforeQty: before,
      afterQty: item[tier].qty,
      delta: amount,
      unit: 'bottle',
      note,
      ...(await userMeta(req)),
    });

    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==================== STANDARD UNITS (per-bottle) ==================== */

// รับเข้าหลายขวด: { lotNo?, sizeMl, unit?, type: 'primary'|'supplier'|'working', bottles: [{ exp }], note? }
router.post('/standards/:id/units/receive', async (req, res) => {
  try {
    const std = await StockStandard.findById(req.params.id);
    if (!std) return res.status(404).json({ error: 'ไม่พบสาร' });

    const { lotNo = '', purity = '', sizeMl, unit = 'mg', bottles, type, note } = req.body || {};
    const size = Number(sizeMl);
    if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: 'ขนาด/ขวดไม่ถูกต้อง' });
    if (!Array.isArray(bottles) || bottles.length === 0) return res.status(400).json({ error: 'ต้องระบุอย่างน้อย 1 ขวด' });
    if (!isValidReceiveType(type)) return res.status(400).json({ error: 'ต้องเลือกประเภท (primary, supplier หรือ working)' });
    const validationError = validateStandardUnitReceiveInput(req.body || {});
    if (validationError) return res.status(400).json({ error: validationError });

    const now = new Date();
    const normalizedLotNo = String(lotNo).trim();
    const normalizedPurity = String(purity).trim();
    const existingLotBottleCount = normalizedLotNo
      ? await StockUnit.countDocuments({ itemCode: std.code, kind: 'sealed', lotNo: normalizedLotNo })
      : 0;
    const lotBottleNumbers = buildLotBottleNumbers(existingLotBottleCount, bottles.length);
    const labelCodes = await resolveReceiveLabelCodes(std, bottles, now);
    const created = [];
    for (const [index, b] of bottles.entries()) {
      const qrId = await genUniqueQrId();
      const photoUrls = normalizeBottlePhotoUrls(b);
      const u = await StockUnit.create({
        qrId,
        itemCode: std.code,
        itemName: std.name,
        itemType: 'standard',
        itemId: std._id.toString(),
        kind: 'sealed',
        type,
        lotNo: normalizedLotNo,
        purity: normalizedPurity,
        lotBottleNo: lotBottleNumbers[index],
        labelCode: labelCodes[index],
        exp: new Date(b.exp),
        volume: { initial: size, remaining: size, unit },
        status: 'active',
        receivedDate: now,
        createdBy: await personOf(req),
        photoUrls: photoUrls.length ? photoUrls : undefined,
      });
      created.push(u);
      await logTransaction({
        itemType: 'standard',
        itemId: std._id.toString(),
        itemCode: std.code,
        itemName: std.name,
        action: 'receive',
        unitId: u._id.toString(),
        qrId,
        afterQty: size,
        volumeDelta: size,
        volumeUnit: unit,
        unit,
        note,
        photoUrls: photoUrls.length ? photoUrls : undefined,
        ...(await userMeta(req)),
      });
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// แจ้งสถานะขวด: POST /units/:qrId/discard { reason?, outcome? }
// outcome='empty' → หมด (status=empty); ไม่งั้น → discarded + เหตุผล
router.post('/units/:qrId/discard', async (req, res) => {
  try {
    const unit = await StockUnit.findOne({ qrId: req.params.qrId });
    if (!unit) return res.status(404).json({ error: 'ไม่พบขวด' });
    if (unit.status === 'discarded') return res.status(400).json({ error: 'ขวดนี้ถูกทิ้งแล้ว' });

    const reason = (req.body && req.body.reason) || '';
    const outcome = (req.body && req.body.outcome) === 'empty' ? 'empty' : 'discard';
    const std = await StockStandard.findOne({ code: unit.itemCode });

    if (outcome === 'empty') {
      unit.status = 'empty';
      await unit.save();
      await logTransaction({
        itemType: 'standard', itemId: std ? std._id.toString() : unit.itemCode,
        itemCode: unit.itemCode, itemName: unit.itemName, action: 'update',
        unitId: unit._id.toString(), qrId: unit.qrId, note: reason || 'แจ้งหมด', ...(await userMeta(req)),
      });
      return res.json({ status: 'empty', qrId: unit.qrId });
    }

    unit.status = 'discarded';
    unit.discardedAt = new Date();
    unit.discardedBy = await personOf(req);
    unit.discardReason = reason;
    await unit.save();
    await logTransaction({
      itemType: 'standard', itemId: std ? std._id.toString() : unit.itemCode,
      itemCode: unit.itemCode, itemName: unit.itemName, action: 'discard',
      unitId: unit._id.toString(), qrId: unit.qrId, note: reason, ...(await userMeta(req)),
    });
    res.json({ status: 'discarded', qrId: unit.qrId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// แก้ข้อมูลรายขวด (เติม EXP/lot/ปริมาณ ให้ขวดที่ย้ายข้อมูลเดิมมา): PATCH /units/:qrId
router.patch('/units/:qrId', async (req, res) => {
  try {
    const unit = await StockUnit.findOne({ qrId: req.params.qrId });
    if (!unit) return res.status(404).json({ error: 'ไม่พบขวด' });
    if (unit.status === 'discarded') return res.status(400).json({ error: 'ขวดนี้ถูกทิ้งแล้ว แก้ไขไม่ได้' });

    const { lotNo, exp, volume, type, photoUrls, labelCode } = req.body || {};
    if (lotNo !== undefined) unit.lotNo = String(lotNo);
    if (exp !== undefined) unit.exp = exp ? new Date(exp) : null;
    if (type !== undefined && isValidUnitType(type)) unit.type = type;
    if (photoUrls !== undefined) unit.photoUrls = normalizePhotoUrls(photoUrls);
    if (labelCode !== undefined) {
      const nextLabelCode = normalizeUnitLabelCodeUpdate(labelCode, unit.itemCode);
      if (nextLabelCode) {
        unit.labelCode = nextLabelCode;
      } else {
        unit.labelCode = '';
      }
    }
    if (volume && typeof volume === 'object') {
      if (volume.unit !== undefined && ['ml', 'mg', 'g'].includes(volume.unit)) unit.volume.unit = volume.unit;
      if (volume.initial !== undefined) {
        const init = Number(volume.initial);
        if (Number.isFinite(init) && init >= 0) unit.volume.initial = init;
      }
      if (volume.remaining !== undefined) {
        const rem = Number(volume.remaining);
        if (Number.isFinite(rem) && rem >= 0) unit.volume.remaining = rem;
      }
    }
    // กันสถานะค้าง: ปรับ active/empty ตามคงเหลือ (ไม่ยุ่งกับขวดที่ถูกทิ้ง — กันไว้ด้านบนแล้ว)
    if (unit.volume.remaining <= 0) unit.status = 'empty';
    else if (unit.status === 'empty') unit.status = 'active';
    await unit.save();
    res.json(unit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// list units: GET /units?itemCode=&status=&kind=&labelCode=
router.get('/units', async (req, res) => {
  try {
    const { itemCode, itemType, itemId, status, kind, labelCode } = req.query;
    const f = {};
    if (queryString(itemCode)) f.itemCode = itemCode;
    applyStockUnitItemTypeFilter(f, itemType);
    if (itemId) f.itemId = String(itemId).trim();
    if (queryString(status)) f.status = status;
    if (queryString(kind)) f.kind = kind;

    const normalizedLabelCode = normalizeUnitLabelCodeSearch(labelCode);
    if (normalizedLabelCode) {
      const directUnits = await StockUnit.find({ ...f, labelCode: normalizedLabelCode }).sort({ createdAt: -1 }).limit(2000);
      const parsedDisplayCode = parseStandardUnitDisplayCodeQuery(normalizedLabelCode);
      const displayCodeUnits = parsedDisplayCode
        ? await StockUnit.find({
          ...f,
          labelRunNo: parsedDisplayCode.bottleNo,
          labelRunYear: { $in: parsedDisplayCode.labelRunYears },
          $or: [{ labelCode: '' }, { labelCode: null }, { labelCode: { $exists: false } }],
        }).sort({ createdAt: -1 }).limit(2000)
        : [];
      const units = uniqueStockUnits([...directUnits, ...displayCodeUnits])
        .filter((unit) => standardUnitDisplayCode(unit) === normalizedLabelCode);
      return res.json(units);
    }

    const units = await StockUnit.find(f).sort({ createdAt: -1 }).limit(2000);
    res.json(units);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// get by qrId: GET /units/:qrId  (ปลายทางสแกน)
router.get('/units/:qrId', async (req, res) => {
  try {
    const unit = await StockUnit.findOne({ qrId: req.params.qrId });
    if (!unit) return res.status(404).json({ error: 'ไม่พบขวด' });
    res.json(unit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==================== SOLVENTS ==================== */

router.get('/solvents', async (req, res) => {
  try {
    res.json(await StockSolvent.find().sort({ name: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/solvents', async (req, res) => {
  try {
    const body = solventItemPayload(stripMeta(req.body));
    const item = await StockSolvent.create({ ...body, qty: 0 });
    await logTransaction({
      itemType: 'solvent',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'create',
      afterQty: item.qty,
      unit: 'bottle',
      ...(await userMeta(req)),
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/solvents/:id', async (req, res) => {
  try {
    const body = solventItemPayload(stripMeta(req.body));
    const before = await StockSolvent.findById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const item = await StockSolvent.findByIdAndUpdate(req.params.id, body, { new: true });
    await logTransaction({
      itemType: 'solvent',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'update',
      beforeQty: before.qty,
      afterQty: item.qty,
      delta: item.qty - before.qty,
      unit: 'bottle',
      ...(await userMeta(req)),
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/solvents/:id', async (req, res) => {
  try {
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    const item = await StockSolvent.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    await item.softDelete(actor);
    await logTransaction({
      itemType: 'solvent',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'delete',
      beforeQty: item.qty,
      ...(await userMeta(req)),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/solvents/:id/deduct', async (req, res) => {
  try {
    const { qty, sampleId, note } = req.body;
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid qty' });
    const item = await StockSolvent.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const before = item.qty;
    if (before < amount) return res.status(400).json({ error: 'จำนวน stock ไม่พอ' });
    item.qty = before - amount;
    await item.save();
    await markSolventUnitsEmptyForDeduction(item, amount);
    await logTransaction({
      itemType: 'solvent',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'deduct',
      beforeQty: before,
      afterQty: item.qty,
      delta: -amount,
      unit: 'bottle',
      sampleId,
      note,
      ...(await userMeta(req)),
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/solvents/:id/receive', async (req, res) => {
  try {
    const { qty, note, lotNo, exp, sizeLiter, price, photoUrls: rawPhotoUrls } = req.body;
    const amount = requireWholeBottleCount(qty);
    if (!amount) return res.status(400).json({ error: 'จำนวนขวดต้องเป็นจำนวนเต็มบวก' });
    const validationError = validateSolventReceiveInput(req.body || {});
    if (validationError) return res.status(400).json({ error: validationError });
    const item = await StockSolvent.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const before = item.qty;
    item.qty = before + amount;
    item.sizeLiter = Number(sizeLiter);
    item.price = Number(price);
    await item.save();
    const photoUrls = normalizePhotoUrls(rawPhotoUrls);
    const receivedDate = new Date();
    const meta = await userMeta(req);
    const createdBy = meta.userName ? { email: meta.userEmail, name: meta.userName } : undefined;
    const receivedUnits = await createSolventUnitsForReceive({ item, qty: amount, lotNo, exp, sizeLiter, photoUrls, receivedDate, createdBy });
    await logTransaction({
      itemType: 'solvent',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'receive',
      beforeQty: before,
      afterQty: item.qty,
      delta: amount,
      unit: 'bottle',
      note: composeSolventReceiveNote({ lotNo, exp, sizeLiter, price, note }),
      photoUrls: photoUrls.length ? photoUrls : undefined,
      ...meta,
    });
    const payload = typeof item.toObject === 'function' ? item.toObject() : item;
    res.json({ ...payload, receivedUnits });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==================== GLASSWARE ==================== */

router.get('/glassware', async (req, res) => {
  try {
    res.json(await StockGlassware.find().sort({ name: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/glassware', async (req, res) => {
  try {
    const body = stripMeta(req.body);
    const item = await StockGlassware.create(body);
    await logTransaction({
      itemType: 'glassware',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'create',
      afterQty: item.qty,
      unit: 'piece',
      ...(await userMeta(req)),
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/glassware/:id', async (req, res) => {
  try {
    const body = stripMeta(req.body);
    const before = await StockGlassware.findById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const item = await StockGlassware.findByIdAndUpdate(req.params.id, body, { new: true });
    await logTransaction({
      itemType: 'glassware',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'update',
      beforeQty: before.qty,
      afterQty: item.qty,
      delta: item.qty - before.qty,
      unit: 'piece',
      ...(await userMeta(req)),
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/glassware/:id', async (req, res) => {
  try {
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    const item = await StockGlassware.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    await item.softDelete(actor);
    await logTransaction({
      itemType: 'glassware',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'delete',
      beforeQty: item.qty,
      ...(await userMeta(req)),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/glassware/:id/deduct', async (req, res) => {
  try {
    const { qty, sampleId, note } = req.body;
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid qty' });
    const item = await StockGlassware.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const before = item.qty;
    if (before < amount) return res.status(400).json({ error: 'จำนวน stock ไม่พอ' });
    item.qty = before - amount;
    await item.save();
    await logTransaction({
      itemType: 'glassware',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'deduct',
      beforeQty: before,
      afterQty: item.qty,
      delta: -amount,
      unit: 'piece',
      sampleId,
      note,
      ...(await userMeta(req)),
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/glassware/:id/receive', async (req, res) => {
  try {
    const { qty, note } = req.body;
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid qty' });
    const item = await StockGlassware.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const before = item.qty;
    item.qty = before + amount;
    await item.save();
    await logTransaction({
      itemType: 'glassware',
      itemId: item._id.toString(),
      itemName: item.name,
      action: 'receive',
      beforeQty: before,
      afterQty: item.qty,
      delta: amount,
      unit: 'piece',
      note,
      ...(await userMeta(req)),
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==================== STOCK HISTORY EXPORTS ==================== */

router.get('/exports/standard', async (req, res) => {
  try {
    const itemId = String(req.query.itemId || '').trim();
    const dateRange = buildStandardExportDateRange(req.query.startDate, req.query.endDate);
    const format = String(req.query.format || 'xlsx').trim().toLowerCase();
    if (!itemId) return res.status(400).json({ error: 'ต้องเลือก standard' });
    if (dateRange.error) return res.status(400).json({ error: dateRange.error });
    if (!['xlsx', 'pdf'].includes(format)) return res.status(400).json({ error: 'รองรับเฉพาะ xlsx หรือ pdf' });

    const standard = await StockStandard.findById(itemId).lean();
    if (!standard) return res.status(404).json({ error: 'ไม่พบ standard' });

    const transactions = await StockTransaction.find({
      itemType: 'standard',
      action: { $in: ['receive', 'deduct'] },
      createdAt: dateRange.value.createdAt,
      $or: [
        { itemId: standard._id.toString() },
        { itemCode: standard.code },
      ],
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(5000)
      .lean();

    const qrIds = [...new Set(transactions.map((tx) => tx.qrId).filter(Boolean))];
    const units = qrIds.length
      ? await StockUnit.find({ qrId: { $in: qrIds } })
        .select('qrId lotNo lotBottleNo exp volume type')
        .lean()
      : [];

    const safeCode = sanitizeFilenameSegment(standard.code || standard.name || 'standard');
    const baseFilename = `${safeCode}-standard-history-${dateRange.value.startDate}_to_${dateRange.value.endDate}-${dateStamp()}`;

    if (format === 'pdf') {
      const html = buildStandardLotExportHtml({ standard, units, transactions });
      if (!html) return res.status(400).json({ error: 'ไม่มีประวัติสำหรับ standard นี้' });

      const chromePath = process.env.PRINT_CHROME_PATH;
      if (!chromePath || !fs.existsSync(chromePath)) {
        return res.status(400).json({ error: 'ไม่พบ Chrome สำหรับสร้าง PDF (ตั้งค่า PRINT_CHROME_PATH)' });
      }

      const puppeteer = require('puppeteer-core');
      let browser;
      try {
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setContent(html.toString('utf8'), { waitUntil: 'load', timeout: 20000 });
        await page.evaluateHandle('document.fonts.ready').catch(() => {});
        const pdf = await page.pdf({
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
        });
        await browser.close();
        browser = null;
        return sendAttachment(res, {
          buffer: Buffer.from(pdf),
          contentType: 'application/pdf',
          filename: `${baseFilename}.pdf`,
        });
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    }

    const workbook = buildStandardLotExportWorkbook({ standard, units, transactions });
    if (!workbook) return res.status(400).json({ error: 'ไม่มีประวัติสำหรับ standard นี้' });

    return sendAttachment(res, {
      buffer: workbook.buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${baseFilename}.xlsx`,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/exports/solvent', async (req, res) => {
  try {
    const solventId = String(req.query.solventId || '').trim();
    const date = normalizeExportDate(req.query.date);
    if (!solventId) return res.status(400).json({ error: 'ต้องเลือกสารเคมี' });
    if (!date) return res.status(400).json({ error: 'ต้องเลือกวันที่' });

    const solvent = await StockSolvent.findById(solventId).lean();
    if (!solvent) return res.status(404).json({ error: 'ไม่พบสารเคมี' });

    const requisitions = await ChemicalRequisition.find({ solventId: solvent._id.toString(), date })
      .sort({ createdAt: 1, _id: 1 })
      .limit(1000)
      .lean();
    if (requisitions.length === 0) return res.status(400).json({ error: 'ไม่มีประวัติเบิกสารเคมีตามวันที่เลือก' });

    const doc = buildSolventRequisitionDoc({ solvent, date, requisitions });
    const safeName = sanitizeFilenameSegment(solvent.name || 'solvent');
    return sendAttachment(res, {
      buffer: doc,
      contentType: 'application/msword; charset=utf-8',
      filename: `${safeName}-requisition-${date}.doc`,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});
/* ==================== TRANSACTIONS (Audit Log) ==================== */

router.get('/transactions/pending-deduction', async (req, res) => {
  try {
    const built = buildPendingDeductionFilter(req.query || {});
    if (built.error) return res.status(400).json({ error: built.error });
    const txs = await StockTransaction.find(built.value)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/transactions/:id/resolve-deduction', async (req, res) => {
  try {
    const norm = normalizeDeductionResolutionInput(req.body || {});
    if (norm.error) return res.status(400).json({ error: norm.error });

    const tx = await StockTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: 'ไม่พบรายการเบิก' });
    if (tx.action !== 'deduct' || !['standard', 'solvent'].includes(tx.itemType)) {
      return res.status(400).json({ error: 'รองรับเฉพาะรายการเบิก Standard และสารเคมี' });
    }

    const actor = await userMeta(req);
    if (norm.value.reason === 'expired' && !canAcknowledgeDeduction(tx, actor.userEmail)) {
      return res.status(403).json({ error: 'รับทราบได้เฉพาะคนที่เบิก' });
    }

    await applyUnitResolutionFromTransaction(tx, norm.value, req);
    tx.deductionResolution = {
      ...norm.value,
      resolvedAt: new Date(),
      resolvedBy: { email: actor.userEmail, name: actor.userName },
    };
    await tx.save();
    res.json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/transactions/:id/deduction', async (req, res) => {
  try {
    const tx = await StockTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: 'ไม่พบรายการเบิก' });
    const actor = await stockManagementActor(req);
    if (!canManageStockDeduction(tx, actor)) {
      return res.status(403).json({ error: 'แก้ไขได้เฉพาะเจ้าของในวันเดียวกัน หรือ admin/Lab Inventory ภายใน 7 วัน' });
    }
    const normalized = normalizeDeductionEditInput(req.body || {}, tx);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    const { amount, weights, note } = normalized.value;
    await adjustDeductionStock(tx, amount);
    const beforeQty = Number(tx.beforeQty);
    if (isVolumeDeduction(tx)) {
      tx.volumeDelta = -amount;
      tx.volumeUnit = tx.volumeUnit || tx.unit || 'mg';
      tx.unit = tx.unit || tx.volumeUnit || 'mg';
      tx.weights = weights;
    } else {
      tx.delta = -amount;
    }
    if (Number.isFinite(beforeQty)) tx.afterQty = beforeQty - amount;
    tx.note = note;
    await tx.save();
    return res.json(tx);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete('/transactions/:id/deduction', async (req, res) => {
  try {
    const tx = await StockTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: 'ไม่พบรายการเบิก' });
    const actor = await stockManagementActor(req);
    if (!canManageStockDeduction(tx, actor)) {
      return res.status(403).json({ error: 'ลบได้เฉพาะเจ้าของในวันเดียวกัน หรือ admin/Lab Inventory ภายใน 7 วัน' });
    }

    await adjustDeductionStock(tx, 0);
    await StockTransaction.deleteOne({ _id: tx._id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const { limit = 200, skip = 0 } = req.query;
    const search = String(req.query.search || '').trim();
    const filter = buildTransactionFilter(req.query);
    const transactionQuery = StockTransaction.find(filter);
    const txs = search
      ? await StockTransaction.aggregate([
        { $match: transactionQuery.cast(StockTransaction) },
        ...buildSearchRankingStages(search, {
          primary: ['itemCode'], secondary: ['itemName', 'userName', 'userEmail'],
        }, { createdAt: -1, _id: -1 }),
        { $skip: Math.max(0, Number.parseInt(skip, 10) || 0) },
        { $limit: Math.min(Number(limit) || 200, 1000) },
      ])
      : await transactionQuery
        .sort({ createdAt: -1, _id: -1 })
        .skip(Math.max(0, Number.parseInt(skip, 10) || 0))
        .limit(Math.min(Number(limit) || 200, 1000))
        .lean();
    const missingNameEmails = [...new Set(txs
      .filter((tx) => !normalizeActorFields({ email: tx.userEmail, name: tx.userName }).name && tx.userEmail)
      .map((tx) => String(tx.userEmail).trim().toLowerCase()))];
    const users = missingNameEmails.length
      ? await User.find({ email: { $in: missingNameEmails } }).lean()
      : [];
    const userByEmail = new Map(users.map((user) => [String(user.email).trim().toLowerCase(), user]));
    res.json(txs.map((tx) => {
      const actor = normalizeActorFields(
        { email: tx.userEmail, name: tx.userName },
        userByEmail.get(String(tx.userEmail || '').trim().toLowerCase()) || {},
      );
      return { ...tx, userEmail: actor.email || tx.userEmail, userName: actor.name || tx.userName };
    }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
router.planDeductMg = planDeductMg;
router.userMeta = userMeta;
router.canManageOwnTodayDeduction = canManageOwnTodayDeduction;
router.canManageStockDeduction = canManageStockDeduction;
router.buildTransactionFilter = buildTransactionFilter;
router.normalizeDeductionEditInput = normalizeDeductionEditInput;
router.deductMgFromUnit = deductMgFromUnit;
router.normalizeUnitLabelCodeUpdate = normalizeUnitLabelCodeUpdate;
