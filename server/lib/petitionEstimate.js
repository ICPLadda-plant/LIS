// Server port of src/lib/petitionEstimate.ts — per-track "เวลาที่คาดว่าจะได้รับผล".
// Working hours 08:00-17:00 Asia/Bangkok, Sunday off. Bangkok has no DST, so we
// shift to a fixed +7h "wall clock" and use UTC getters (independent of server TZ).
const OFFSET_MS = 7 * 60 * 60 * 1000;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;
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

function clamp(w) {
  if (!isWorkingDay(w)) return startOfNextWorkingDay(w);
  if (w < atHour(w, WORK_START_HOUR)) return atHour(w, WORK_START_HOUR);
  if (w >= atHour(w, WORK_END_HOUR)) return startOfNextWorkingDay(w);
  return new Date(w);
}

function addWorkingMinutes(from, minutes) {
  let cursor = clamp(toWall(from));
  let remaining = Math.max(0, Math.round(minutes));
  while (remaining > 0) {
    const available = Math.round((atHour(cursor, WORK_END_HOUR) - cursor) / 60000);
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

// เครื่องรันคู่ขนานกันได้ → เอาเครื่องที่นานที่สุด
function labMinutes(petition) {
  const machines = petition.assignedMachines ?? [];
  if (!machines.length) return LAB_DEFAULT_MINUTES;
  return Math.max(...machines.map((m) => {
    const n = Number(m.estimatedMinutes);
    return Number.isFinite(n) && n > 0 ? n : LAB_DEFAULT_MINUTES;
  }));
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
  if (side === 'lab') {
    // นับจากตอนเจ้าหน้าที่รับงาน; ยังไม่รับ → นับจากตอนนี้ (ยังไม่เริ่ม)
    const acceptedAt = validDate(petition.assignedTo?.acceptedAt);
    const start = acceptedAt ?? (now > receivedAt ? now : receivedAt);
    return addWorkingMinutes(start, labMinutes(petition));
  }
  if (qcTaskCount > 0) return addWorkingMinutes(receivedAt, qcTaskCount * QC_MINUTES_PER_TASK);
  return endOfNextWorkingDay(receivedAt);
}

module.exports = { addWorkingMinutes, endOfNextWorkingDay, estimateTrackEnd, formatThai };
