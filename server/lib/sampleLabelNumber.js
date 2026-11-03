// เลขที่บนป้ายนำส่งตัวอย่าง: คำขอที่ส่ง QC ได้เลข P (P01, P02, ...) และคำขอที่ส่ง LAB ได้เลข L (L01, L02, ...)
// ตัวนับสองฝั่งแยกกัน และเริ่มใหม่ทุกปี พ.ศ. — คำขอที่ส่งทั้งสองฝั่งได้ทั้งเลข P และเลข L
const { requiresQcTrack } = require('./petitionSubmissionRules');
const { hasLabTrack } = require('./petitionStatusLog');

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

async function nextSampleLabelSequence(side, year) {
  const SampleLabelCounter = require('../models/SampleLabelCounter');
  const counter = await SampleLabelCounter.findOneAndUpdate(
    { side, year },
    { $inc: { sequence: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return counter.sequence;
}

// คืนค่า sampleLabelNumbers ชุดใหม่เมื่อมีฝั่งที่ยังไม่มีเลข (เลขเดิมคงไว้เสมอ) หรือ null ถ้าไม่ต้องออกเลขเพิ่ม
async function assignMissingSampleLabelNumbers(petition, { now = new Date(), nextSequence = nextSampleLabelSequence } = {}) {
  const current = petition?.sampleLabelNumbers || {};
  const year = Number(current.year) || buddhistYear(now);
  const patch = {};
  for (const side of sampleLabelSides(petition)) {
    if (current[side]) continue;
    patch[side] = formatSampleLabelNo(side, await nextSequence(side, year));
  }
  if (!Object.keys(patch).length) return null;
  const next = { year };
  if (current.qc) next.qc = current.qc;
  if (current.lab) next.lab = current.lab;
  return { ...next, ...patch };
}

module.exports = { formatSampleLabelNo, sampleLabelSides, assignMissingSampleLabelNumbers };
