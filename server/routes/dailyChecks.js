const express = require('express');
const router = express.Router();
const DailyCheck = require('../models/DailyCheck');
const { getDailyCheckPeriod, isDailyCheckPeriod } = require('../lib/dailyCheckPeriod');

const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// GET /api/daily-checks
// Query: ?date=YYYY-MM-DD | ?from=YYYY-MM-DD&to=YYYY-MM-DD | ?scaleId=... | ?status=pass|fail
// Default: today
router.get('/', async (req, res) => {
  try {
    const { date, from, to, scaleId, status, period } = req.query;
    const q = {};

    if (from || to) {
      q.date = {};
      if (from) q.date.$gte = String(from);
      if (to) q.date.$lte = String(to);
    } else if (date === 'all') {
      // no date filter
    } else {
      q.date = date ? String(date) : todayStr();
    }

    if (scaleId) q.scaleId = String(scaleId);
    if (status) q.status = String(status);
    if (period) q.period = String(period);

    const records = await DailyCheck.find(q).sort({ checkedAt: -1 }).lean();
    res.json({ data: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/daily-checks
router.post('/', async (req, res) => {
  try {
    const {
      scaleId, scaleName, model,
      weights100, weights10,
      avg100, avg10,
      status100, status10,
      tolerance,
      recorder, recorderId, recorderEmail,
    } = req.body;

    if (!scaleId || !scaleName) {
      return res.status(400).json({ error: 'scaleId และ scaleName ต้องระบุ' });
    }
    if (!Array.isArray(weights100) || weights100.length !== 3 ||
        !Array.isArray(weights10) || weights10.length !== 3) {
      return res.status(400).json({ error: 'weights100 และ weights10 ต้องเป็น array 3 ค่า' });
    }
    if (typeof avg100 !== 'number' || typeof avg10 !== 'number') {
      return res.status(400).json({ error: 'avg100 และ avg10 ต้องเป็นตัวเลข' });
    }
    if (!recorder || !String(recorder).trim()) {
      return res.status(400).json({ error: 'recorder ต้องระบุ' });
    }

    const overall = (status100 === 'pass' && status10 === 'pass') ? 'pass' : 'fail';

    const now = new Date();
    const period = getDailyCheckPeriod(now) || undefined;

    const created = await DailyCheck.create({
      scaleId, scaleName, model: model || '',
      weights100, weights10,
      avg100, avg10,
      status100, status10,
      status: overall,
      tolerance: typeof tolerance === 'number' ? tolerance : 0.05,
      recorder: String(recorder).trim(),
      recorderId: recorderId || '',
      recorderEmail: recorderEmail || '',
      date: todayStr(),
      period,
      checkedAt: now,
    });

    res.status(201).json({ data: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/daily-checks/summary/today — สำหรับ check ว่าทำ daily check วันนี้แล้วหรือยัง
router.get('/summary/today', async (req, res) => {
  try {
    const date = todayStr();
    const records = await DailyCheck.find({ date }).lean();
    const scaleRecords = records.map(r => ({
      scaleId: r.scaleId,
      checkedAt: r.checkedAt,
      period: isDailyCheckPeriod(r.period) ? r.period : getDailyCheckPeriod(r.checkedAt),
    }));
    const scaleIds = [...new Set(scaleRecords.map(r => r.scaleId).filter(Boolean))];
    res.json({
      data: {
        date,
        count: records.length,
        scaleIds,
        scaleRecords,
        allPass: records.length > 0 && records.every(r => r.status === 'pass'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
