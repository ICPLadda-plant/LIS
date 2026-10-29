// Server port of src/lib/petitionEstimate.ts — per-track "เวลาที่คาดว่าจะได้รับผล".
// Working hours 08:00-17:00 Asia/Bangkok, Sunday off. Bangkok has no DST, so we
// shift to a fixed +7h "wall clock" and use UTC getters (independent of server TZ).
const OFFSET_MS = 7 * 60 * 60 * 1000;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;
// Lab นับ standard time ต่อได้ถึง 21:00 แล้วยกส่วนที่เหลือไป 08:00 วันทำการถัดไป
const LAB_WORK_END_HOUR = 21;
const LAB_DEFAULT_MINUTES = 240;
const QC_MINUTES_PER_TASK = 60;

const toWall = (d) => new Date(d.getTime() + OFFSET_MS);
const fromWall = (d) => new Date(d.getTime() - OFFSET_MS);
const isWorkingDay = (w) => w.getUTCDay() !== 0;

function atHour(w, hour) {
  const r = new Date(w);
  r.setUTCHours(hour, 0, 0, 0);
  return r;
}

function startOfNextWorkingDay(w) {
  const r = atHour(w, WORK_START_HOUR);
  do r.setUTCDate(r.getUTCDate() + 1); while (!isWorkingDay(r));
  return r;
}

function clamp(w, endHour = WORK_END_HOUR) {
  if (!isWorkingDay(w)) return startOfNextWorkingDay(w);
  if (w < atHour(w, WORK_START_HOUR)) return atHour(w, WORK_START_HOUR);
  if (w >= atHour(w, endHour)) return startOfNextWorkingDay(w);
  return new Date(w);
}

function addWorkingMinutes(from, minutes, endHour = WORK_END_HOUR) {
  let cursor = clamp(toWall(from), endHour);
  let remaining = Math.max(0, Math.round(minutes));
  while (remaining > 0) {
    const available = Math.round((atHour(cursor, endHour) - cursor) / 60000);
    if (remaining <= available) {
      cursor = new Date(cursor.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= available;
      cursor = startOfNextWorkingDay(cursor);
    }
  }
  return fromWall(cursor);
}

function endOfNextWorkingDay(from) {
  return fromWall(atHour(startOfNextWorkingDay(toWall(from)), WORK_END_HOUR));
}

function validDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isLabRecheckPending(petition) {
  const requestedAt = validDate(petition?.labRecheckRequestedAt);
  if (!requestedAt) return false;
  if (petition.status === 'approved' || petition.status === 'rejected') return false;
  const approvedAt = validDate(petition.labApprovedAt);
  return !approvedAt || approvedAt < requestedAt;
}

// จุดเริ่มนับเวลา Lab: Re-check ที่ยังไม่ออกผล → เวลาที่สั่ง Re-check; ปกติ → เวลากด "เริ่มงาน"
function labStartAnchor(petition) {
  if (isLabRecheckPending(petition)) return validDate(petition.labRecheckRequestedAt);
  return validDate(petition.assignedTo?.acceptedAt);
}

// เครื่องละหนึ่งแถว: นาทีจาก Standard Time หรือค่าเดา 240 นาทีถ้าจับคู่ไม่ได้
// ไม่มีเครื่องที่ assign อยู่ (เช่นหลัง Re-check ล้างเครื่อง) → ใช้รายการเครื่องจาก snapshot เดิม
function labBasis(petition) {
  const machines = petition.assignedMachines ?? [];
  if (machines.length) {
    return machines.map((m) => {
      const n = Number(m.estimatedMinutes);
      const standard = Number.isFinite(n) && n > 0;
      return {
        code: m.code || '',
        name: m.name || '',
        minutes: standard ? n : LAB_DEFAULT_MINUTES,
        source: standard ? 'standard' : 'default',
        standardTimeId: standard ? m.standardTimeId || '' : '',
        estimatedSource: standard ? m.estimatedSource || '' : '',
      };
    });
  }
  const previous = petition.labExpected?.basis;
  if (Array.isArray(previous) && previous.length) return previous.map((b) => ({ ...b }));
  return [{ code: '', name: '', minutes: LAB_DEFAULT_MINUTES, source: 'default', standardTimeId: '', estimatedSource: '' }];
}

// เวลาที่คาดว่าจะได้รับผล Lab · null = ยังไม่กดเริ่มงาน
// เครื่องรันคู่ขนานกันได้ → เอาเครื่องที่นานที่สุด
function computeLabExpected(petition) {
  const startedAt = labStartAnchor(petition);
  if (!startedAt) return null;
  const basis = labBasis(petition);
  const governing = basis.reduce((max, b) => (b.minutes > max.minutes ? b : max), basis[0]);
  const minutes = governing.minutes;
  return {
    startedAt,
    at: addWorkingMinutes(startedAt, minutes, LAB_WORK_END_HOUR),
    minutes,
    estimated: governing.source === 'default',
    basis,
  };
}

// ค่าที่บันทึกไว้ใช้ได้เมื่อเริ่มนับจากจุดเดียวกับปัจจุบัน; คำร้องเก่าที่ยังไม่มี → คำนวณตอนเปิดดู
function resolveLabExpected(petition) {
  const anchor = labStartAnchor(petition);
  if (!anchor) return null;
  const stored = petition.labExpected;
  const storedStart = validDate(stored?.startedAt);
  const storedAt = validDate(stored?.at);
  if (storedStart && storedAt && storedStart.getTime() === anchor.getTime()) {
    return { ...stored, startedAt: storedStart, at: storedAt, estimated: !!stored.estimated };
  }
  return computeLabExpected(petition);
}

// เรียกหลังเปลี่ยน acceptedAt / เครื่อง / Re-check เพื่อบันทึกค่าไว้ใน doc
function refreshLabExpected(doc) {
  const next = computeLabExpected(doc);
  if (!next) return;
  doc.labExpected = next;
  if (typeof doc.markModified === 'function') doc.markModified('labExpected');
}

// "28/10/2569 15:30" (Bangkok, พ.ศ.)
function formatThai(d) {
  const w = toWall(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(w.getUTCDate())}/${pad(w.getUTCMonth() + 1)}/${w.getUTCFullYear() + 543} ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
}

// Returns Date. side: 'qc' | 'lab'. Mirrors estimatePetitionEnd but per side.
function estimateTrackEnd(petition, side, { qcTaskCount = 0, now = new Date() } = {}) {
  const qcReceivedAt = validDate(petition.qcReceivedAt)
    ?? (petition.labReceivedAt ? null : validDate(petition.receivedAt));
  const labReceivedAt = validDate(petition.labReceivedAt);
  const receivedAt = side === 'lab' ? labReceivedAt : qcReceivedAt;
  if (!receivedAt) {
    const anchor = validDate(petition.sampleSentAt)
      ?? validDate(petition.submittedBy?.submittedAt)
      ?? validDate(petition.createdAt)
      ?? now;
    return endOfNextWorkingDay(anchor);
  }
  if (side === 'lab') return resolveLabExpected(petition)?.at ?? null;
  if (qcTaskCount > 0) return addWorkingMinutes(receivedAt, qcTaskCount * QC_MINUTES_PER_TASK);
  return endOfNextWorkingDay(receivedAt);
}

module.exports = {
  addWorkingMinutes,
  endOfNextWorkingDay,
  estimateTrackEnd,
  formatThai,
  computeLabExpected,
  resolveLabExpected,
  refreshLabExpected,
  LAB_WORK_END_HOUR,
};
