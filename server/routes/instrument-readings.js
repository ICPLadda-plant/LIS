const express = require('express');
const router = express.Router();
const InstrumentSource = require('../models/InstrumentSource');
const { extractReading } = require('../lib/instrumentReading');

// เพดานฝั่ง server สำหรับการดึงค่าจากเครื่อง: ค่า timeoutMs ที่ตั้งไว้ใน Settings
// ถูกบีบให้อยู่ในช่วงนี้ และ response ต้องไม่ใหญ่เกินกำหนด กัน request ค้างนานหรือกินหน่วยความจำ
const DEFAULT_INSTRUMENT_TIMEOUT_MS = 5000;
const MIN_INSTRUMENT_TIMEOUT_MS = 500;
const MAX_INSTRUMENT_TIMEOUT_MS = 60000;
const MAX_INSTRUMENT_RESPONSE_BYTES = 1024 * 1024;

function boundedTimeoutMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_INSTRUMENT_TIMEOUT_MS;
  return Math.min(MAX_INSTRUMENT_TIMEOUT_MS, Math.max(MIN_INSTRUMENT_TIMEOUT_MS, ms));
}

async function readBodyWithLimit(resp, maxBytes, controller) {
  const tooLarge = () => {
    const err = new Error('response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    return err;
  };
  const declared = Number(resp.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    controller?.abort();
    throw tooLarge();
  }
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const text = await resp.text();
    if (Buffer.byteLength(text) > maxBytes) throw tooLarge();
    return text;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      controller?.abort();
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// CRUD for the instrument-source config (managed in Settings) ----------------

// GET /instrument-readings/sources — list all configured sources.
router.get('/sources', async (req, res) => {
  try {
    const items = await InstrumentSource.find().sort({ key: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /instrument-readings/sources — create a source.
router.post('/sources', async (req, res) => {
  try {
    const item = await InstrumentSource.create(req.body);
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /instrument-readings/sources/:id — update a source.
router.patch('/sources/:id', async (req, res) => {
  try {
    const item = await InstrumentSource.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /instrument-readings/sources/:id — soft-delete a source.
router.delete('/sources/:id', async (req, res) => {
  try {
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    const item = await InstrumentSource.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    await item.softDelete(actor);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live pull -------------------------------------------------------------------

// GET /instrument-readings/:key/latest — proxy: fetch the instrument's latest
// reading and return it normalized. Always resolves with a body; transport /
// parse failures come back as { ok:false, error } (HTTP 200) so the UI can show
// "ดึงไม่ได้" without the page breaking.
router.get('/:key/latest', async (req, res) => {
  const { key } = req.params;
  try {
    const source = await InstrumentSource.findOne({ key });
    if (!source) {
      return res.status(404).json({ ok: false, key, error: `ไม่พบการตั้งค่าเครื่องสำหรับ "${key}" — ตั้งค่าในหน้า Settings ก่อน` });
    }
    if (!source.enabled) {
      return res.json({ ok: false, key, error: `เครื่อง "${source.instrumentName || key}" ถูกปิดการดึงค่าอยู่` });
    }
    if (!source.fetchUrl) {
      return res.json({ ok: false, key, error: 'ยังไม่ได้ตั้งค่า URL ของเครื่อง' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeoutMs(source.timeoutMs));
    let raw;
    try {
      const headers = {};
      if (source.authHeader && source.authHeader.includes(':')) {
        const idx = source.authHeader.indexOf(':');
        headers[source.authHeader.slice(0, idx).trim()] = source.authHeader.slice(idx + 1).trim();
      }
      const resp = await fetch(source.fetchUrl, {
        method: source.method || 'GET',
        headers,
        signal: controller.signal,
      });
      if (!resp.ok) {
        return res.json({ ok: false, key, error: `เครื่องตอบสถานะ ${resp.status}` });
      }
      raw = JSON.parse(await readBodyWithLimit(resp, MAX_INSTRUMENT_RESPONSE_BYTES, controller));
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'เครื่องไม่ตอบ (timeout)'
        : err.code === 'RESPONSE_TOO_LARGE'
          ? 'ข้อมูลจากเครื่องใหญ่เกินกำหนด'
          : `ติดต่อเครื่องไม่ได้: ${err.message}`;
      return res.json({ ok: false, key, error: msg });
    } finally {
      clearTimeout(timer);
    }

    const parsed = extractReading(raw, source);
    if (!parsed.ok) {
      return res.json({ ok: false, key, error: parsed.error, raw });
    }

    res.json({
      ok: true,
      key,
      value: parsed.value,
      unit: source.unit || '',
      instrument: source.instrumentName || '',
      readingAt: parsed.readingAt || new Date().toISOString(),
      raw,
    });
  } catch (err) {
    res.status(500).json({ ok: false, key, error: err.message });
  }
});

module.exports = router;
module.exports.boundedTimeoutMs = boundedTimeoutMs;
module.exports.readBodyWithLimit = readBodyWithLimit;
