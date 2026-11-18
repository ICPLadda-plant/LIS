// คำนวณว่าขวด Standard แต่ละขวดถูกใช้กับใบนำส่งใด
// กติกา: ขวดของสารเดียวกัน (itemCode + type) ใช้ตั้งแต่วันที่เบิก จนถึงวันที่เบิกขวดถัดไป
// (การเบิกขวดใหม่ = ขวดก่อนหน้าหมด) ขวดล่าสุดยังใช้อยู่ (end = null)

function substanceKey(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first.toLowerCase();
}

function petitionSubstanceKeys(petition) {
  const keys = new Set();
  for (const item of petition?.items || []) {
    for (const part of String(item?.commonName || '').split('+')) {
      const key = substanceKey(part);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function petitionUseDate(petition) {
  return petition?.labReceivedAt || petition?.receivedAt || petition?.createdAt || null;
}

// units: [{ _id, qrId, withdrawnDate }] ของสารเดียวกัน + type เดียวกัน
function buildUsagePeriods(units) {
  const started = (units || [])
    .filter((u) => toTime(u.withdrawnDate) != null)
    .sort((a, b) => toTime(a.withdrawnDate) - toTime(b.withdrawnDate) || String(a.qrId).localeCompare(String(b.qrId)));
  return started.map((u, i) => ({
    unitId: String(u._id),
    qrId: u.qrId,
    start: new Date(u.withdrawnDate),
    end: started[i + 1] ? new Date(started[i + 1].withdrawnDate) : null,
  }));
}

// เลขใบนำส่งของช่วงนี้: ใบที่ระบุตอนเบิก (withdraw) + ใบที่สารตรงและวันรับเข้า lab อยู่ในช่วง (inferred)
function matchPetitions(period, petitions, standardName, directPetitionNos = []) {
  const key = substanceKey(standardName);
  const result = new Map();
  for (const no of directPetitionNos) {
    if (no) result.set(no, { petitionNo: no, source: 'withdraw', date: null });
  }
  if (period) {
    const start = toTime(period.start);
    const end = toTime(period.end);
    for (const p of petitions || []) {
      const t = toTime(petitionUseDate(p));
      if (t == null || t < start || (end != null && t >= end)) continue;
      if (!key || !petitionSubstanceKeys(p).has(key)) continue;
      result.set(p.petitionNo, {
        petitionNo: p.petitionNo,
        petitionId: p._id ? String(p._id) : undefined,
        source: result.has(p.petitionNo) ? 'withdraw' : 'inferred',
        date: new Date(t),
      });
    }
  }
  return [...result.values()].sort((a, b) => (toTime(a.date) ?? 0) - (toTime(b.date) ?? 0));
}

module.exports = { substanceKey, petitionSubstanceKeys, petitionUseDate, buildUsagePeriods, matchPetitions };
