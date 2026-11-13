function formatCoaNo(sequence, year) {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('COA sequence must be a positive integer');
  }
  if (!Number.isInteger(year) || year < 2000) {
    throw new Error('COA year must be a Gregorian year');
  }
  return `${String(sequence).padStart(4, '0')}${String(year)}`;
}

async function nextCoaNumber(now = new Date()) {
  const CoaCounter = require('../models/CoaCounter');
  const year = now.getFullYear();
  const sequenceFloor = year === 2026 ? 1347 : 0;
  const counter = await CoaCounter.findOneAndUpdate(
    { year },
    [{ $set: { sequence: { $add: [{ $max: [{ $ifNull: ['$sequence', 0] }, sequenceFloor] }, 1] } } }],
    { upsert: true, new: true },
  ).lean();
  const sequence = counter.sequence;
  return { coaNo: formatCoaNo(sequence, year), sequence, year };
}

module.exports = { formatCoaNo, nextCoaNumber };
