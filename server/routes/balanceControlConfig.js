const express = require('express');
const router = express.Router();
const BalanceControlConfig = require('../models/BalanceControlConfig');

// Mirror of src/lib/balanceControlChart.ts BALANCE_CONTROL_DEFAULTS.
// mean/sd = null จนกว่าผู้ใช้จะตั้งค่า Control ของเครื่องนั้น
const SCALE_DEFAULTS = [
  { scaleId: 'scale-1', brand: 'Mettler Toledo', model: 'MS3002S' },
  { scaleId: 'scale-2', brand: 'Mettler Toledo', model: 'MS204' },
  { scaleId: 'scale-3', brand: 'Sartorius', model: 'CPA225D' },
  { scaleId: 'scale-4', brand: 'Mettler Toledo', model: 'MX205DU' },
  { scaleId: 'scale-5', brand: 'Sartorius', model: 'MCE225P-3S00-D' },
].map((d) => ({
  ...d,
  weightCode: '',
  nominal: 100,
  mean: null,
  sd: null,
  mpe: 0.5,
  updatedDate: '',
}));
const ALLOWED_IDS = SCALE_DEFAULTS.map((d) => d.scaleId);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pick(doc) {
  return {
    scaleId: doc.scaleId,
    brand: doc.brand || '',
    model: doc.model || '',
    weightCode: doc.weightCode || '',
    nominal: typeof doc.nominal === 'number' ? doc.nominal : 100,
    mean: typeof doc.mean === 'number' ? doc.mean : null,
    sd: typeof doc.sd === 'number' ? doc.sd : null,
    mpe: typeof doc.mpe === 'number' ? doc.mpe : null,
    updatedDate: doc.updatedDate || '',
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Validate control values; mirrors validateBalanceControlInput on the client.
function validate(body) {
  const { mean, sd, nominal, mpe, updatedDate } = body;
  if (!isNum(mean)) return 'ค่า Mean ต้องเป็นตัวเลข';
  if (!isNum(sd)) return 'ค่า STD ต้องเป็นตัวเลข';
  if (sd <= 0) return 'ค่า STD ต้องมากกว่า 0';
  if (nominal != null && (!isNum(nominal) || nominal <= 0)) return 'น้ำหนักตุ้มต้องมากกว่า 0';
  if (mpe != null && (!isNum(mpe) || mpe < 0)) return 'ค่า MPE ต้องไม่ติดลบ';
  if (updatedDate && (typeof updatedDate !== 'string' || !DATE_RE.test(updatedDate))) {
    return 'วันที่ปรับปรุงต้องอยู่ในรูปแบบ YYYY-MM-DD';
  }
  return null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// GET /api/balance-control-config — always returns all 5 scales (DB doc or default).
router.get('/', async (req, res) => {
  try {
    const docs = await BalanceControlConfig.find().lean();
    const byId = new Map(docs.map((d) => [d.scaleId, d]));
    const data = SCALE_DEFAULTS.map((def) => {
      const d = byId.get(def.scaleId);
      return d ? pick(d) : { ...def };
    });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/balance-control-config/:scaleId — upsert one scale's control values.
router.put('/:scaleId', async (req, res) => {
  try {
    const { scaleId } = req.params;
    if (!ALLOWED_IDS.includes(scaleId)) {
      return res.status(400).json({ error: 'รหัสเครื่องชั่งไม่ถูกต้อง' });
    }
    const body = req.body || {};
    const err = validate(body);
    if (err) return res.status(400).json({ error: err });

    const def = SCALE_DEFAULTS.find((d) => d.scaleId === scaleId);
    const update = {
      scaleId,
      brand: str(body.brand) || def.brand,
      model: str(body.model) || def.model,
      weightCode: str(body.weightCode),
      nominal: body.nominal != null ? body.nominal : 100,
      mean: body.mean,
      sd: body.sd,
      mpe: body.mpe != null ? body.mpe : null,
      updatedDate: str(body.updatedDate),
    };
    const doc = await BalanceControlConfig.findOneAndUpdate(
      { scaleId },
      update,
      { new: true, upsert: true },
    ).lean();

    res.json({ data: pick(doc) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
