// เลขที่บนป้ายนำส่งตัวอย่าง: ตัวอย่างที่ส่ง QC ได้เลข P (P01, P02, ...) และที่ส่ง LAB ได้เลข L (L01, L02, ...)
// ตัวนับสองฝั่งแยกกัน และเริ่มใหม่ทุกปี พ.ศ.
// ออกเลขแยกตามกลุ่ม batch + ส่วนตัวอย่าง: คนละ batch หรือ batch เดียวกันคนละส่วน ได้คนละเลข
// ป้ายหลายชิ้นในกลุ่มเดียวกันและฝั่งเดียวกันใช้เลขเดียวกัน เช่น
//   รายการ 1 batch 001: QC 100 + QC 500 → P01 (2 ป้าย), LAB 500 → L01
//   รายการ 2 batch 002: QC 100 → P02
const { requiresQcTrack, shouldSendItemToQc } = require('./petitionSubmissionRules');
const { hasLabTrack, shouldSendItemToLab } = require('./petitionStatusLog');

const SIDE_PREFIX = { qc: 'P', lab: 'L' };

function buddhistYear(now) {
  return now.getFullYear() + 543;
}

function formatSampleLabelNo(side, sequence) {
  return `${SIDE_PREFIX[side]}${String(sequence).padStart(2, '0')}`;
}

function sampleLabelSides(petition) {
  return [requiresQcTrack(petition) && 'qc', hasLabTrack(petition) && 'lab'].filter(Boolean);
}

function labelAmount(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

// ฝั่งของป้ายชิ้นที่ copyIndex (mirror src/lib/petitionSampler.ts sampleLabelCopySide)
function sampleLabelCopySide(item, copyIndex, { hasQc, hasLab }) {
  const declared = item?.labelQuantitySides?.[copyIndex];
  if (declared === 'qc' || declared === 'lab') return declared;
  if (!hasLab) return 'qc';
  if (!hasQc) return 'lab';
  if (!shouldSendItemToQc(item)) return 'lab';
  if (!shouldSendItemToLab(item)) return 'qc';
  const quantities = (item.labelQuantities ?? []).filter((quantity) => String(quantity ?? '').trim());
  if (quantities.length === 2) {
    const [first, second] = quantities.map(labelAmount);
    const qcIndex = first !== null && second !== null && second < first ? 1 : 0;
    return copyIndex === qcIndex ? 'qc' : 'lab';
  }
  return copyIndex === 0 ? 'qc' : 'lab';
}

function normalizeSamplePart(part) {
  const value = String(part ?? '').replace(/\s+/g, ' ').trim();
  return ['ทั่วไป/รวม', 'ทั่วไป', 'รวม'].includes(value) ? '' : value;
}

// กุญแจกลุ่มเลขป้าย (mirror src/lib/petitionSampler.ts sampleLabelGroupKey)
function sampleLabelGroupKey(item) {
  const batch = String(item?.batchNo ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return `${batch}|${normalizeSamplePart(item?.part)}`;
}

function printCopies(item) {
  const quantity = Math.floor(Number(item?.sampleQuantity));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

// กลุ่ม batch + ส่วน ตามลำดับรายการ พร้อมฝั่งที่แต่ละกลุ่มต้องใช้เลข
function sampleLabelGroups(petition) {
  const sides = sampleLabelSides(petition);
  if (!sides.length) return [];
  const tracks = { hasQc: sides.includes('qc'), hasLab: sides.includes('lab') };
  const groups = new Map();
  for (const item of petition?.items ?? []) {
    const key = sampleLabelGroupKey(item);
    if (!groups.has(key)) groups.set(key, new Set());
    for (let copyIndex = 0; copyIndex < printCopies(item); copyIndex += 1) {
      groups.get(key).add(sampleLabelCopySide(item, copyIndex, tracks));
    }
  }
  if (!groups.size) groups.set(sampleLabelGroupKey({}), new Set(sides));
  return [...groups].map(([key, groupSides]) => ({ key, sides: ['qc', 'lab'].filter((side) => groupSides.has(side)) }));
}

async function nextSampleLabelSequence(side, year) {
  const SampleLabelCounter = require('../models/SampleLabelCounter');
  const counter = await SampleLabelCounter.findOneAndUpdate(
    { side, year },
    { $inc: { sequence: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return counter.sequence;
}

// คืนค่า sampleLabelNumbers ชุดใหม่เมื่อมีกลุ่ม/ฝั่งที่ยังไม่มีเลข (เลขเดิมคงไว้เสมอ) หรือ null ถ้าไม่ต้องออกเลขเพิ่ม
// คำขอเก่าที่มีเลขระดับคำขอ (qc/lab) แต่ยังไม่มี groups: กลุ่มแรกที่ใช้ฝั่งนั้นรับเลขเดิมต่อ
async function assignMissingSampleLabelNumbers(petition, { now = new Date(), nextSequence = nextSampleLabelSequence } = {}) {
  const current = petition?.sampleLabelNumbers || {};
  const year = Number(current.year) || buddhistYear(now);
  const currentGroups = Array.isArray(current.groups) ? current.groups : [];
  const existing = new Map(currentGroups.map((group) => [group.key, group]));
  const legacy = currentGroups.length ? {} : { qc: current.qc, lab: current.lab };
  let changed = !currentGroups.length && Boolean(current.qc || current.lab);
  const groups = [];
  for (const { key, sides } of sampleLabelGroups(petition)) {
    const old = existing.get(key);
    const group = { key };
    if (old?.qc) group.qc = old.qc;
    if (old?.lab) group.lab = old.lab;
    for (const side of sides) {
      if (group[side]) continue;
      if (legacy[side]) {
        group[side] = legacy[side];
        legacy[side] = undefined;
        continue;
      }
      group[side] = formatSampleLabelNo(side, await nextSequence(side, year));
      changed = true;
    }
    groups.push(group);
  }
  // กลุ่มที่ถูกลบออกจากคำขอแล้วยังเก็บเลขไว้ ถ้าเพิ่มกลับมาจะได้เลขเดิม
  for (const group of currentGroups) {
    if (groups.some((entry) => entry.key === group.key)) continue;
    const kept = { key: group.key };
    if (group.qc) kept.qc = group.qc;
    if (group.lab) kept.lab = group.lab;
    groups.push(kept);
  }
  if (!changed) return null;
  const next = { year };
  const qc = current.qc || groups.find((group) => group.qc)?.qc;
  const lab = current.lab || groups.find((group) => group.lab)?.lab;
  if (qc) next.qc = qc;
  if (lab) next.lab = lab;
  return { ...next, groups };
}

function shortYear(petition) {
  const year = Number(petition?.sampleLabelNumbers?.year);
  return year ? String(year % 100).padStart(2, '0') : '';
}

// เลขป้ายของฝั่งนั้นที่ต้องรับแยกทีละป้าย: เฉพาะคำขอที่ออกเลขแยกกลุ่มแล้ว และกลุ่มยังอยู่ในรายการปัจจุบัน
function sideLabelGroups(petition, side) {
  const stored = petition?.sampleLabelNumbers?.groups ?? [];
  if (!stored.length) return [];
  const active = new Map(sampleLabelGroups(petition).map((group) => [group.key, group.sides]));
  const year = shortYear(petition);
  return stored
    .filter((group) => group[side] && active.get(group.key)?.includes(side))
    .map((group) => ({ key: group.key, label: year ? `${group[side]}/${year}` : group[side] }));
}

function isLabelReceived(petition, side, key) {
  return (petition?.labelReceipts ?? []).some((receipt) => receipt.side === side && receipt.key === key);
}

// วางแผนการรับตัวอย่างทีละป้าย
// - คืน null เมื่อคำขอนี้รับแบบเดิมทั้งคำขอ (มีเลขป้ายฝั่งนี้เลขเดียว / คำขอเก่า / รับฝั่งนี้ครบแล้ว)
// - body.labelKeys = กลุ่มที่เลือกรับ, body.itemSeq = รายการจาก QR บนป้าย, ไม่ระบุ = รับทุกป้ายที่ค้าง
// - complete = รับครบทุกป้ายของฝั่งนี้แล้ว (route จะตั้ง qcReceivedAt/labReceivedAt ตามเดิม)
function planLabelReceipt(petition, side, body = {}) {
  if (petition?.[`${side}ReceivedAt`]) return null;
  const groups = sideLabelGroups(petition, side);
  if (groups.length < 2) return null;
  const sideName = side.toUpperCase();
  let keys;
  if (Array.isArray(body.labelKeys) && body.labelKeys.length) {
    keys = [...new Set(body.labelKeys.map(String))];
  } else if (body.itemSeq != null && body.itemSeq !== '') {
    const item = (petition.items ?? []).find((entry) => Number(entry.seq) === Number(body.itemSeq));
    if (!item) return { error: 'ไม่พบรายการตาม QR บนป้าย' };
    keys = [sampleLabelGroupKey(item)];
  } else {
    keys = groups.filter((group) => !isLabelReceived(petition, side, group.key)).map((group) => group.key);
  }
  const picked = [];
  for (const key of keys) {
    const group = groups.find((entry) => entry.key === key);
    if (!group) return { error: `ป้ายนี้ไม่ได้ส่งฝั่ง ${sideName}` };
    if (isLabelReceived(petition, side, key)) return { error: `ป้าย ${group.label} รับฝั่ง ${sideName} แล้ว` };
    picked.push(group);
  }
  if (!picked.length) return { error: `รับตัวอย่างฝั่ง ${sideName} ครบแล้ว` };
  const receivedCount = groups.filter((group) => isLabelReceived(petition, side, group.key)).length + picked.length;
  return {
    keys: picked.map((group) => group.key),
    labels: picked.map((group) => group.label),
    receivedCount,
    total: groups.length,
    complete: receivedCount === groups.length,
  };
}

module.exports = { formatSampleLabelNo, sampleLabelSides, sampleLabelGroupKey, sampleLabelGroups, sideLabelGroups, planLabelReceipt, assignMissingSampleLabelNumbers };
