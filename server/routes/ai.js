const express = require('express');
const router = express.Router();
const QCTestResult = require('../models/QCTestResult');
const { zScore, linearRegression, consecutiveStreak } = require('../lib/smartRules');
const Petition = require('../models/Petition');
const DailyCheck = require('../models/DailyCheck');
const { isOpenAIConfigured, generateStream, generateJSON, generateJSONFromImage } = require('../lib/openaiClient');
const Parameter = require('../models/Parameter');

const STOCK_LABEL_OCR_SYSTEM = `คุณอ่านข้อความจากรูปฉลากหรือบางส่วนของสติ๊กเกอร์ขวด stock ในห้องแล็บ
เป้าหมายคือเลข Code ใต้ QR บนสติ๊กเกอร์ เช่น 026601 หรือ 1016801
ผู้ใช้อาจถ่ายเห็นแค่บางส่วนของฉลาก ไม่ต้องเห็นทั้งขวด และไม่ต้องอ่าน/ถอดรหัส QR
ให้มองหาเลขตัวหนาใต้ QR ก่อน ข้ามชื่อสาร, %Purity, Batch/Lot, Exp date และรหัสเอกสาร
ต้องรักษาเลขศูนย์นำหน้า เช่น 026601 ห้ามคืนเป็น 26601
ห้ามเดา ถ้าอ่านไม่ชัดให้คืนค่าว่าง
ตอบเป็น JSON object เท่านั้น รูปแบบ {"labelCode":"","candidates":[],"rawText":""}`;

const BALANCE_DISPLAY_OCR_SYSTEM = `คุณอ่านข้อความจากหน้าจอดิจิทัลของเครื่องชั่งในห้องแล็บ
อ่านเฉพาะค่าตัวเลขน้ำหนักหลักที่แสดงบนหน้าจอ รวมเครื่องหมายลบและจุดทศนิยม
ข้ามหน่วย g, mg, สัญลักษณ์สถานะ และตัวเลขอื่นรอบหน้าจอ
ห้ามเดา ถ้าอ่านไม่ชัดให้คืนค่าว่าง
ตอบเป็น JSON object เท่านั้น รูปแบบ {"value":"","rawText":""}`;

function normalizeStockLabelCandidate(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 5 || digits.length > 12) return '';
  return digits;
}

function stockLabelCandidatesFromOcr(payload) {
  const values = [];
  if (payload?.labelCode) values.push(payload.labelCode);
  if (Array.isArray(payload?.candidates)) values.push(...payload.candidates);
  const rawText = typeof payload?.rawText === 'string' ? payload.rawText : '';
  values.push(...rawText.match(/\d[\d\s-]{3,}\d/g) || []);

  return [...new Set(values.map(normalizeStockLabelCandidate).filter(Boolean))];
}

function isSupportedImageDataUrl(value) {
  return /^data:image\/(?:png|jpe?g|webp);base64,/i.test(String(value || ''));
}

function normalizeBalanceDisplayValue(value) {
  const text = String(value ?? '').trim().replace(/,/g, '.').replace(/\s+/g, '');
  const match = text.match(/[+-]?\d{1,4}(?:\.\d{1,8})?/);
  if (!match) return '';
  const number = Number(match[0]);
  return Number.isFinite(number) && Math.abs(number) <= 1000 ? match[0].replace(/^\+/, '') : '';
}

// POST /api/ai/outlier-check
// Body: { commonName, parameterId, fieldLabel, value }
// Returns: { warning, zScore?, mean?, stdev?, sampleSize, reason? }
router.post('/outlier-check', async (req, res) => {
  try {
    const { commonName, parameterId, fieldLabel, value } = req.body;
    if (!commonName || !parameterId || !fieldLabel || value == null) {
      return res.json({ warning: false, reason: 'missing_params' });
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num)) return res.json({ warning: false, reason: 'not_numeric' });

    const results = await QCTestResult.find(
      { commonName, parameterId },
      { values: 1, enteredAt: 1 },
    )
      .sort({ enteredAt: -1 })
      .limit(10)
      .lean();

    const historicalValues = results
      .map((r) => {
        const v = r.values?.[fieldLabel];
        return v != null && v !== '' ? Number(v) : NaN;
      })
      .filter((v) => !isNaN(v));

    if (historicalValues.length < 3) {
      return res.json({ warning: false, sampleSize: historicalValues.length, reason: 'insufficient_data' });
    }

    const stats = zScore(historicalValues, num);
    if (!stats) return res.json({ warning: false, sampleSize: historicalValues.length, reason: 'zero_variance' });

    return res.json({
      warning: stats.warning,
      zScore: Math.round(stats.zScore * 100) / 100,
      mean: Math.round(stats.mean * 10000) / 10000,
      stdev: Math.round(stats.stdev * 10000) / 10000,
      sampleSize: historicalValues.length,
    });
  } catch (err) {
    return res.json({ warning: false, reason: 'error' });
  }
});

// GET /api/ai/machine-suggestions?commonName=&dept=
router.get('/machine-suggestions', async (req, res) => {
  try {
    const { commonName, dept } = req.query;
    if (!commonName) return res.json([]);

    const query = { 'items.commonName': String(commonName) };
    if (dept) query.dept = String(dept);

    const petitions = await Petition.find(query, { assignedMachines: 1 })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const counts = {};
    petitions.forEach((p) => {
      (p.assignedMachines || []).forEach((m) => {
        if (!m.code) return;
        if (!counts[m.code]) {
          counts[m.code] = { machineCode: m.code, machineName: m.name || m.code, usageCount: 0 };
        }
        counts[m.code].usageCount++;
      });
    });

    const suggestions = Object.values(counts)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 3);

    res.json(suggestions);
  } catch {
    res.json([]);
  }
});

// GET /api/ai/daily-check-trends?type=consecutive|trend&scaleId=&field=avg100&days=30
router.get('/daily-check-trends', async (req, res) => {
  try {
    const { type, scaleId, field = 'avg100', days = '30' } = req.query;
    if (!scaleId || !type) return res.json({ alert: false, reason: 'missing_params' });

    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - Math.min(Number(days), 90));
    const fromStr = from.toISOString().slice(0, 10);

    const records = await DailyCheck.find(
      { scaleId: String(scaleId), date: { $gte: fromStr } },
      { status: 1, avg100: 1, avg10: 1, date: 1 },
    )
      .sort({ date: -1 })
      .lean();

    if (type === 'consecutive') {
      const streak = consecutiveStreak(records, (r) => r.status === 'fail');
      return res.json({
        alert: streak >= 3,
        streak,
        message: streak >= 3
          ? `Scale ${scaleId} fail ต่อเนื่อง ${streak} วัน — ควรแจ้งซ่อมบำรุง`
          : null,
      });
    }

    if (type === 'trend') {
      const fieldName = String(field);
      const pairs = records
        .filter((r) => r[fieldName] != null)
        .map((r, i) => ({ x: records.length - 1 - i, y: Number(r[fieldName]) }))
        .filter((p) => !isNaN(p.y));

      if (pairs.length < 5) return res.json({ alert: false, reason: 'insufficient_data' });

      const reg = linearRegression(pairs);
      if (!reg) return res.json({ alert: false, reason: 'degenerate' });

      const threshold = fieldName.startsWith('avg') ? 0.01 : 0.5;
      const alert = Math.abs(reg.slope) > threshold;
      const direction = reg.slope > 0 ? 'เพิ่มขึ้น' : 'ลดลง';

      return res.json({
        alert,
        slope: Math.round(reg.slope * 100000) / 100000,
        message: alert
          ? `${fieldName} มีแนวโน้ม${direction} ${Math.abs(reg.slope).toFixed(5)} ต่อวัน — ควรตรวจสอบ`
          : null,
      });
    }

    res.json({ alert: false, reason: 'unknown_type' });
  } catch {
    res.json({ alert: false });
  }
});

// GET /api/ai/ai-status
router.get('/ai-status', async (req, res) => {
  res.json({ available: isOpenAIConfigured() });
});

// POST /api/ai/draft-note
// Body: { petitionId }
// Streams plain-text Thai approval note
router.post('/draft-note', async (req, res) => {
  try {
    const { petitionId } = req.body;
    if (!petitionId) return res.status(400).json({ error: 'petitionId required' });

    if (!isOpenAIConfigured()) {
      return res.status(503).json({ error: 'OpenAI API key ไม่ได้ตั้งค่า' });
    }

    const petition = await Petition.findById(petitionId).lean();
    if (!petition) return res.status(404).json({ error: 'Petition not found' });

    const results = await QCTestResult.find({ petitionId: String(petitionId) }).lean();

    const itemSummaries = (petition.items || []).map((item, idx) => {
      const label = `ตัวอย่างที่ ${idx + 1}`;
      const itemResults = results.filter((r) => r.itemSeq === item.seq);
      const resultLines = itemResults.map((r) => {
        const vals = Object.entries(r.values || {})
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return vals ? `  ${r.parameterName || 'พารามิเตอร์'}: ${vals}` : null;
      }).filter(Boolean);
      return `- ${label}\n${resultLines.join('\n') || '  (ไม่มีผลทดสอบ)'}`;
    }).join('\n');

    const prompt = `คุณเป็นเจ้าหน้าที่ QC ของบริษัทเคมีภัณฑ์ไทย กรุณาเขียนหมายเหตุการอนุมัติ (approval note) เป็นภาษาไทย กระชับ 3-5 ประโยค

แผนก: ${petition.dept}
วันที่รับ: ${petition.receivedAt ? new Date(petition.receivedAt).toLocaleDateString('th-TH') : '-'}

รายการตัวอย่างและผลทดสอบ:
${itemSummaries || '(ไม่มีรายการ)'}

กรุณาสรุปผลการทดสอบ ระบุว่าผ่านหรือไม่ผ่าน และข้อสังเกตสำคัญ (ถ้ามี)`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');

    await generateStream(prompt, (chunk) => res.write(chunk));
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/weekly-summary
// Body: { fromDate: "YYYY-MM-DD", toDate: "YYYY-MM-DD" }
// Streams plain-text Thai weekly summary
router.post('/weekly-summary', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;
    if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate required' });

    if (!isOpenAIConfigured()) {
      return res.status(503).json({ error: 'OpenAI API key ไม่ได้ตั้งค่า' });
    }

    const dateFilter = { date: { $gte: String(fromDate), $lte: String(toDate) } };
    const dailyChecks = await DailyCheck.find(dateFilter).lean();

    // Try to load EnvCheck if model exists
    let envChecks = [];
    try {
      const EnvCheck = require('../models/EnvCheck');
      envChecks = await EnvCheck.find(dateFilter).lean();
    } catch {
      // EnvCheck model not available — skip
    }

    const scaleStats = {};
    dailyChecks.forEach((r) => {
      if (!scaleStats[r.scaleId]) scaleStats[r.scaleId] = { pass: 0, fail: 0 };
      scaleStats[r.scaleId][r.status]++;
    });
    const scaleLines = Object.entries(scaleStats)
      .map(([id, s]) => `- เครื่องชั่ง ${id}: ผ่าน ${s.pass} วัน, ไม่ผ่าน ${s.fail} วัน`)
      .join('\n') || '(ไม่มีข้อมูล)';

    const envStats = {};
    envChecks.forEach((r) => {
      const roomKey = r.room || 'unknown';
      if (!envStats[roomKey]) envStats[roomKey] = { pass: 0, fail: 0 };
      envStats[roomKey][(r.status === 'pass' ? 'pass' : 'fail')]++;
    });
    const envLines = Object.entries(envStats)
      .map(([room, s]) => `- ${room}: ผ่าน ${s.pass} วัน, ไม่ผ่าน ${s.fail} วัน`)
      .join('\n') || '(ไม่มีข้อมูล)';

    const prompt = `คุณเป็นเจ้าหน้าที่ QC กรุณาสรุปผล daily check ประจำสัปดาห์ ${fromDate} ถึง ${toDate} เป็นภาษาไทย 4-6 ประโยค

ผลการสอบเทียบเครื่องชั่ง:
${scaleLines}

ผลการตรวจสอบสภาพแวดล้อม:
${envLines}

กรุณาสรุปภาพรวม ชี้จุดที่ต้องให้ความสนใจ และข้อเสนอแนะ (ถ้ามี)`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');

    await generateStream(prompt, (chunk) => res.write(chunk));
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/analyze-qc
// Body: { petitionId }
// Streams Thai analysis of all entered QC values for a petition
router.post('/analyze-qc', async (req, res) => {
  try {
    const { petitionId } = req.body;
    if (!petitionId) return res.status(400).json({ error: 'petitionId required' });

    if (!isOpenAIConfigured()) {
      return res.status(503).json({ error: 'OpenAI API key ไม่ได้ตั้งค่า' });
    }

    const petition = await Petition.findById(petitionId).lean();
    if (!petition) return res.status(404).json({ error: 'Petition not found' });

    const results = await QCTestResult.find({ petitionId: String(petitionId) }).lean();

    const itemLines = (petition.items || []).map((item, idx) => {
      const label = `ตัวอย่างที่ ${idx + 1}`;
      const itemResults = results.filter((r) => r.itemSeq === item.seq);
      const valueLines = itemResults.flatMap((r) => {
        const entries = Object.entries(r.values || {})
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
          .map(([k, v]) => `    ${k}: ${v}`);
        if (entries.length === 0) return [];
        return [`  [${r.parameterName || 'พารามิเตอร์'}]`, ...entries];
      });
      const filled = valueLines.length > 0 ? valueLines.join('\n') : '  (ยังไม่มีผลทดสอบ)';
      return `${label}:\n${filled}`;
    }).join('\n\n');

    const prompt = `คุณเป็นเจ้าหน้าที่ QC ของบริษัทเคมีภัณฑ์ไทย กรุณาวิเคราะห์ผลการทดสอบ QC ต่อไปนี้เป็นภาษาไทย 4-6 ประโยค

แผนก: ${petition.dept}

ผลการทดสอบที่บันทึกไว้:
${itemLines || '(ยังไม่มีข้อมูล)'}

กรุณาสรุปผลการทดสอบที่บันทึกแล้ว ระบุรายการที่ยังไม่สมบูรณ์ และให้ข้อสังเกตเบื้องต้น (ถ้ามี)`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');

    await generateStream(prompt, (chunk) => res.write(chunk));
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/stock-label-ocr
// Body: { imageDataUrl }
// Returns: { labelCode, candidates, rawText }
router.post('/stock-label-ocr', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
    if (!imageDataUrl) return res.status(400).json({ error: 'imageDataUrl required' });
    if (!isSupportedImageDataUrl(imageDataUrl)) return res.status(400).json({ error: 'unsupported image data URL' });
    if (imageDataUrl.length > 9_500_000) return res.status(413).json({ error: 'image too large' });
    if (!isOpenAIConfigured()) return res.status(503).json({ error: 'OpenAI API key ไม่ได้ตั้งค่า' });

    const generated = await generateJSONFromImage(
      'อ่านข้อความเลขใต้ QR หรือ Code ใต้ QR บนสติ๊กเกอร์ขวด stock จากรูปนี้ เห็นแค่บางส่วนของฉลากก็ได้ แล้วคืนเฉพาะเลข Code ที่เป็นไปได้',
      imageDataUrl,
      { system: STOCK_LABEL_OCR_SYSTEM, temperature: 0, maxTokens: 300 },
    );
    const rawText = typeof generated?.rawText === 'string' ? generated.rawText.trim() : '';
    const candidates = stockLabelCandidatesFromOcr(generated);

    res.json({ labelCode: candidates[0] || '', candidates, rawText });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ocr failed' });
  }
});

// POST /api/ai/balance-display-ocr
// Body: { imageDataUrl }
// Returns: { value, rawText }
router.post('/balance-display-ocr', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
    if (!imageDataUrl) return res.status(400).json({ error: 'imageDataUrl required' });
    if (!isSupportedImageDataUrl(imageDataUrl)) return res.status(400).json({ error: 'unsupported image data URL' });
    if (imageDataUrl.length > 9_500_000) return res.status(413).json({ error: 'image too large' });
    if (!isOpenAIConfigured()) return res.status(503).json({ error: 'OpenAI API key ไม่ได้ตั้งค่า' });

    const generated = await generateJSONFromImage(
      'อ่านค่าตัวเลขน้ำหนักหลักจากหน้าจอเครื่องชั่งในรูปนี้',
      imageDataUrl,
      { system: BALANCE_DISPLAY_OCR_SYSTEM, temperature: 0, maxTokens: 120 },
    );
    const rawText = typeof generated?.rawText === 'string' ? generated.rawText.trim() : '';
    const value = normalizeBalanceDisplayValue(generated?.value || rawText);
    res.json({ value, rawText });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ocr failed' });
  }
});

// POST /api/ai/generate-parameter
// Body: { description, scope? }
// Returns: { parameter, valid, error? } — generated Parameter draft (NOT saved).
const PARAMETER_SCHEMA_GUIDE = `คุณคือผู้ช่วยกำหนด "Parameter" (นิยามช่องกรอกผลงานวิเคราะห์ lab/QC) ของระบบ LIS เคมีภัณฑ์ไทย
แปลงคำอธิบายงานวิเคราะห์ของผู้ใช้ให้เป็น Parameter JSON ที่ valid ตาม schema และกฎด้านล่าง

โครงสร้าง Parameter (คืนเป็น JSON object เดียว):
{
  "name": "string (จำเป็น)",
  "applyAll": false,
  "commonNames": [], "itemNames": [], "productTypes": [], "categories": [], "subCategories": [], "itemGroups": [],
  "valueFields": [ /* ช่องกรอก */ ],
  "note": "",
  "hasPhases": false,
  "multiEntry": false
}
- productTypes รับเฉพาะ "water" | "sand" | "powder"; categories รับเฉพาะ "RM" | "FG"; commonNames/subCategories เป็นตัวพิมพ์ใหญ่
- อย่าตั้ง applyAll=true เว้นแต่ผู้ใช้บอกชัดว่าใช้กับทุก item

แต่ละ valueField:
{
  "label": "string (จำเป็น, ห้ามซ้ำในชุดเดียว)",
  "type": "text|number|float|enum|photo|file|timer",
  "unit": "",            // จำเป็นเมื่อ type=number/float
  "min": null, "max": null,
  "options": [],         // จำเป็นเมื่อ type=enum (>=1)
  "required": false,
  "standardOperator": null,  // lt|lte|eq|gte|gt|between|tolerance (เฉพาะ number/float)
  "standardValue": null,     // จำเป็นเมื่อมี standardOperator
  "standardValue2": null,    // จำเป็นเมื่อ between (ค่าสิ้นสุด) / tolerance (%>0)
  "expectedValues": [],      // ค่าที่ปกติ (subset ของ options) สำหรับ enum
  "requireNoteOn": [],       // subset ของ options
  "timerDurationSec": null, "timerUnit": null,  // timer ต้องมีทั้งคู่, วินาที>0, unit=minute|hour|day|month
  "maxPhotos": 5, "maxFiles": 5, "allowedFileTypes": ["pdf"]
}

กฎที่ห้ามละเมิด:
1. number/float ต้องมี unit ที่ไม่ว่าง
2. enum ต้องมี options อย่างน้อย 1
3. ตั้ง standardOperator ต้องมี standardValue; between ต้องมี standardValue2 และ standardValue<=standardValue2; tolerance ต้องมี standardValue2>0
4. expectedValues/requireNoteOn ทุกค่าต้องอยู่ใน options
5. timer ต้องมี timerUnit และ timerDurationSec>0
6. min/max ถ้ามีทั้งคู่ ต้อง min<=max
7. ห้ามใช้ type "reference" หรือ "timer" trigger phase ในโหมดอัตโนมัตินี้ เว้นแต่ผู้ใช้ขอชัดเจน

ข้อพึงปฏิบัติ:
- สร้าง valueField ให้ครบทุกสิ่งที่ผู้ใช้กล่าวถึง: ปริมาณที่วัด, ตัวเลือก (ใช้ type "enum" + options), การถ่ายรูป (type "photo"), การแนบไฟล์ (type "file")
- ปริมาณที่ไม่มีหน่วยจริง (เช่น pH, ความถ่วงจำเพาะ, อัตราส่วน) ให้ใส่ unit เป็น "-" (ห้ามเว้นว่าง เพราะ number/float ต้องมี unit)
- ถ้าโจทย์บอก "ค่าปกติ" ของตัวเลือก ให้ใส่ค่านั้นใน expectedValues (ต้องเป็น subset ของ options)
- label ตั้งเป็นภาษาไทยให้ตรงกับสิ่งที่ผู้ใช้พูด (เช่น "ลักษณะภายนอก" ไม่ใช่ "appearance")
ตอบเป็น JSON object เท่านั้น ห้ามมีข้อความอื่น`;

router.post('/generate-parameter', async (req, res) => {
  try {
    const { description, scope } = req.body || {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'description required' });
    }
    if (!isOpenAIConfigured()) {
      return res.status(503).json({ error: 'OpenAI API key ไม่ได้ตั้งค่า' });
    }

    const prompt = `งานวิเคราะห์ที่ต้องการ (scope=${scope === 'lab' ? 'lab' : 'qc'}):\n${String(description).trim()}\n\nสร้าง Parameter JSON ตามกฎ`;
    const generated = await generateJSON(prompt, { system: PARAMETER_SCHEMA_GUIDE });

    // shape into a Parameter doc; scope from request, not the model
    const parameter = {
      name: typeof generated.name === 'string' ? generated.name.trim() : '',
      scope: scope === 'lab' ? 'lab' : 'qc',
      applyAll: !!generated.applyAll,
      commonNames: Array.isArray(generated.commonNames) ? generated.commonNames : [],
      itemNames: Array.isArray(generated.itemNames) ? generated.itemNames : [],
      productTypes: Array.isArray(generated.productTypes) ? generated.productTypes : [],
      categories: Array.isArray(generated.categories) ? generated.categories : [],
      subCategories: Array.isArray(generated.subCategories) ? generated.subCategories : [],
      itemGroups: Array.isArray(generated.itemGroups) ? generated.itemGroups : [],
      valueFields: Array.isArray(generated.valueFields) ? generated.valueFields : [],
      note: typeof generated.note === 'string' ? generated.note : '',
      hasPhases: !!generated.hasPhases,
      multiEntry: !!generated.multiEntry,
    };

    // Soft-validate against the real model (does NOT save). Surface Thai errors.
    let valid = true;
    let error;
    try {
      await new Parameter(parameter).validate();
    } catch (e) {
      valid = false;
      error = e?.errors
        ? Object.values(e.errors).map((x) => x.message).join('; ')
        : e.message;
    }

    res.json({ parameter, valid, error });
  } catch (err) {
    res.status(500).json({ error: err.message || 'generate failed' });
  }
});

module.exports = router;
