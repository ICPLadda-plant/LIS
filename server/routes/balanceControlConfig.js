const express = require('express');
const router = express.Router();
const BalanceControlConfig = require('../models/BalanceControlConfig');
const BalanceWeightCode = require('../models/BalanceWeightCode');

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

function pick(doc, def, nominal, weightCodes) {
  const saved = doc?.controls?.[String(nominal)] || (doc?.nominal === nominal ? doc : null);
  return {
    scaleId: def.scaleId,
    brand: saved?.brand || doc?.brand || def.brand,
    model: saved?.model || doc?.model || def.model,
    weightCode: weightCodes.get(nominal) || '',
    nominal,
    mean: typeof saved?.mean === 'number' ? saved.mean : null,
    sd: typeof saved?.sd === 'number' ? saved.sd : null,
    baselineValues: Array.isArray(saved?.baselineValues) ? saved.baselineValues : [],
    mpe: typeof saved?.mpe === 'number' ? saved.mpe : 0.5,
    updatedDate: saved?.updatedDate || '',
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Validate control values; mirrors validateBalanceControlInput on the client.
function validate(body) {
  const { baselineValues, nominal, mpe, updatedDate } = body;
  if (!Array.isArray(baselineValues) || baselineValues.length !== 20 || !baselineValues.every(isNum)) {
    return 'กรอกค่าบันทึกให้ครบ 20 ค่า';
  }
  if (nominal != null && (!isNum(nominal) || nominal <= 0 || !Number.isInteger(nominal))) {
    return 'น้ำหนักตุ้มต้องเป็นจำนวนเต็มมากกว่า 0';
  }
  if (mpe != null && (!isNum(mpe) || mpe < 0)) return 'ค่า MPE ต้องไม่ติดลบ';
  if (updatedDate && (typeof updatedDate !== 'string' || !DATE_RE.test(updatedDate))) {
    return 'วันที่ปรับปรุงต้องอยู่ในรูปแบบ YYYY-MM-DD';
  }
  return null;
}

function baselineStats(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// GET /api/balance-control-config — always returns all 5 scales (DB doc or default).
router.get('/', async (req, res) => {
  try {
    const [docs, codes] = await Promise.all([
      BalanceControlConfig.find().lean(),
      BalanceWeightCode.find().lean(),
    ]);
    const weightCodes = new Map(codes.map((c) => [c.nominal, c.weightCode]));
    const byId = new Map(docs.map((d) => [d.scaleId, d]));
    const data = SCALE_DEFAULTS.flatMap((def) => {
      const d = byId.get(def.scaleId);
      const weights = [...new Set([
        ...def.weights,
        ...weightCodes.keys(),
        ...Object.keys(d?.controls || {}).map(Number).filter((weight) => Number.isInteger(weight) && weight > 0),
      ])];
      return weights.map((nominal) => pick(d, def, nominal, weightCodes));
    });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/balance-control-config/weight-code/:nominal — รหัสตุ้มผูกกับขนาดตุ้ม ใช้ร่วมทุกเครื่อง
router.put('/weight-code/:nominal', async (req, res) => {
  try {
    const nominal = Number(req.params.nominal);
    if (!Number.isInteger(nominal) || nominal <= 0) {
      return res.status(400).json({ error: 'น้ำหนักตุ้มต้องเป็นจำนวนเต็มมากกว่า 0' });
    }
    const weightCode = str(req.body?.weightCode);
    await BalanceWeightCode.findOneAndUpdate(
      { nominal },
      { $set: { nominal, weightCode } },
      { new: true, upsert: true },
    ).lean();
    res.json({ data: { nominal, weightCode } });
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
    const { mean, sd } = baselineStats(body.baselineValues);
    const control = {
      brand: str(body.brand) || def.brand,
      model: str(body.model) || def.model,
      nominal,
      mean,
      sd,
      baselineValues: body.baselineValues,
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
