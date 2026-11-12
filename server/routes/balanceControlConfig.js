const express = require('express');
const router = express.Router();
const BalanceControlConfig = require('../models/BalanceControlConfig');

// Mirror of src/lib/balanceControlChart.ts BALANCE_CONTROL_DEFAULTS.
// mean/sd = null จนกว่าผู้ใช้จะตั้งค่า Control ของเครื่องนั้น
const SCALE_DEFAULTS = [
  { scaleId: 'scale-1', brand: 'Mettler Toledo', model: 'MS3002S', weights: [500, 10] },
  { scaleId: 'scale-2', brand: 'Mettler Toledo', model: 'MS204', weights: [100, 10] },
  { scaleId: 'scale-3', brand: 'Sartorius', model: 'CPA225D', weights: [100, 10] },
  { scaleId: 'scale-4', brand: 'Mettler Toledo', model: 'MX205DU', weights: [100, 10] },
  { scaleId: 'scale-5', brand: 'Sartorius', model: 'MCE225P-3S00-D', weights: [100, 10] },
];
const ALLOWED_IDS = SCALE_DEFAULTS.map((d) => d.scaleId);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pick(doc, def, nominal) {
  const saved = doc?.controls?.[String(nominal)] || (doc?.nominal === nominal ? doc : null);
  return {
    scaleId: def.scaleId,
    brand: saved?.brand || doc?.brand || def.brand,
    model: saved?.model || doc?.model || def.model,
    weightCode: saved?.weightCode || '',
    nominal,
    mean: typeof saved?.mean === 'number' ? saved.mean : null,
    sd: typeof saved?.sd === 'number' ? saved.sd : null,
    mpe: typeof saved?.mpe === 'number' ? saved.mpe : 0.5,
    updatedDate: saved?.updatedDate || '',
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
    const data = SCALE_DEFAULTS.flatMap((def) => {
      const d = byId.get(def.scaleId);
      return def.weights.map((nominal) => pick(d, def, nominal));
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
    const nominal = body.nominal ?? def.weights[0];
    if (!def.weights.includes(nominal)) {
      return res.status(400).json({ error: 'น้ำหนักตุ้มไม่ตรงกับเครื่องชั่ง' });
    }
    const control = {
      brand: str(body.brand) || def.brand,
      model: str(body.model) || def.model,
      weightCode: str(body.weightCode),
      nominal,
      mean: body.mean,
      sd: body.sd,
      mpe: body.mpe != null ? body.mpe : null,
      updatedDate: str(body.updatedDate),
    };
    await BalanceControlConfig.findOneAndUpdate(
      { scaleId },
      { $set: { scaleId, brand: control.brand, model: control.model, [`controls.${nominal}`]: control } },
      { new: true, upsert: true },
    ).lean();

    res.json({ data: { scaleId, ...control } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
