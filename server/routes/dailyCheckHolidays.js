const express = require('express');
const router = express.Router();
const DailyCheckHoliday = require('../models/DailyCheckHoliday');

// วันหยุดนอกเหนือจากวันอาทิตย์ (วันอาทิตย์คำนวณจากวันที่ ไม่ต้องเก็บ)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/daily-check-holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    const q = {};
    if (DATE_RE.test(String(from || '')) || DATE_RE.test(String(to || ''))) {
      q.date = {};
      if (DATE_RE.test(String(from || ''))) q.date.$gte = String(from);
      if (DATE_RE.test(String(to || ''))) q.date.$lte = String(to);
    }
    const data = await DailyCheckHoliday.find(q).sort({ date: 1 }).lean();
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/daily-check-holidays/:date — ติ๊ก/เอาออก (holiday=false ลบทิ้ง)
router.put('/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD' });
    const holiday = req.body?.holiday !== false;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!holiday) {
      await DailyCheckHoliday.deleteOne({ date });
      return res.json({ data: { date, holiday: false } });
    }
    await DailyCheckHoliday.findOneAndUpdate(
      { date },
      { $set: { date, note } },
      { new: true, upsert: true },
    ).lean();
    res.json({ data: { date, holiday: true, note } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
