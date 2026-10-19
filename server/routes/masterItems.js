const express = require('express');
const fs = require('fs');
const XLSX = require('xlsx');
const MasterItemMeta = require('../models/MasterItemMeta');
const ItemGroup = require('../models/ItemGroup');

const router = express.Router();

const DEFAULT_WEBHOOK_URL = 'https://n8n-plant.icpladda.com/webhook/API/Item-production';
const WEBHOOK_URL = process.env.MASTER_ITEMS_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
const DEFAULT_LDI_WEBHOOK_URL = 'https://n8n-plant.icpladda.com/webhook/api/item-product-ldi';
const LDI_WEBHOOK_URL = process.env.MASTER_ITEMS_LDI_WEBHOOK_URL || DEFAULT_LDI_WEBHOOK_URL;
const MASTER_ITEM_KEYS = ['item_no', 'itemCode', 'item_code', 'code', 'Code', 'ITEM_CODE'];
const NAME_KEYS = ['item_name1', 'itemName', 'item_name', 'name', 'Name', 'ITEM_NAME', 'description'];
const COMMON_NAME_KEYS = ['common_name', 'commonname', 'commonName', 'item_name2', 'itemType'];
const PACK_SIZE_KEYS = ['packSize', 'pack_size', 'desc2', 'description2', 'item_name3'];
const CATEGORY_KEYS = ['inventory_posting_group', 'category', 'type', 'group', 'itemGroup', 'item_group'];
const UNIT_KEYS = ['base_unit_of_mea', 'unit', 'uom', 'UOM', 'unitName'];
const UNIT_COST_KEYS = ['unit_cost', 'unitCost', 'unit_cost_lcy', 'Unit Cost', 'UNIT_COST'];
const META_STRING_FIELDS = ['itemCode', 'itemName', 'itemType', 'category', 'unit', 'status', 'description', 'imageUrl'];
const META_ARRAY_FIELDS = ['imageUrls'];
const IMAGE_URL_KEYS = ['imageUrl', 'image_url', 'photoUrl', 'photo_url', 'pictureUrl', 'picture_url'];
const IMAGE_URLS_KEYS = ['imageUrls', 'image_urls', 'photoUrls', 'photo_urls', 'pictureUrls', 'picture_urls'];
const META_KEYS = [
  'kgPerCarton',
  'grossKgPerUnit',
  'declaredKgPerUnit',
  'weightDiff',
  'packLevel',
  'packSource',
  'cartonUnit',
  'unitsPerCarton',
  'packUnit',
  'measureSize',
  'measureUnit',
];

// Snake_case aliases mirroring the ERP weight-feed vocabulary (see masterItemMeta.js
// `weightUpdate`). Consumers of GET /master-items — e.g. the PDO load planner — read
// these snake_case keys, so every meta field with a snake_case source name is re-exposed
// under it, not just kg_per_carton. Without this the per-sub-unit weight never reaches
// the consumer and it falls back to unitsPerCarton, mis-computing น้ำหนักบรรทุก.
const META_SNAKE_ALIASES = {
  kgPerCarton: 'kg_per_carton',
  grossKgPerUnit: 'gross_kg_per_unit',
  declaredKgPerUnit: 'declared_kg_per_unit',
  weightDiff: 'weight_diff',
  packLevel: 'pack_level',
  packSource: 'pack_source',
  cartonUnit: 'carton_unit',
  unitsPerCarton: 'units_per_carton',
  packUnit: 'pack_unit',
  measureSize: 'measure_size',
  measureUnit: 'measure_unit',
  imageUrl: 'image_url',
  imageUrls: 'image_urls',
};

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

const CLASSIFICATION_TYPES = [
  { code: 'SG', group: 'sand' },
  { code: 'ULV', group: 'water' },
  { code: 'EC', group: 'water' },
  { code: 'EW', group: 'water' },
  { code: 'SC', group: 'water' },
  { code: 'SL', group: 'water' },
  { code: 'ME', group: 'water' },
  { code: 'ZC', group: 'water' },
  { code: 'W/V', group: 'water' },
  { code: 'W/W', group: 'sand' },
  { code: 'WP', group: 'powder' },
  { code: 'WDG', group: 'powder' },
  { code: 'WG', group: 'powder' },
  { code: 'GR', group: 'sand' },
  { code: 'ST', group: 'sand' },
  { code: 'GB', group: 'sand' },
  { code: 'SP', group: 'powder' },
  { code: 'DS', group: 'powder' },
  { code: 'DP', group: 'powder' },
];

const CLASSIFICATION_ALIASES = [
  { phrase: 'SAND GRANULE', code: 'SG' },
];

function normalizeItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const found = [payload.data, payload.items, payload.result, payload.rows].find(Array.isArray);
    if (Array.isArray(found)) return found;
  }
  return [];
}

function firstValue(item, keys) {
  for (const key of keys) {
    const v = item && item[key];
    if (v !== undefined && v !== null && v !== '') return String(v).trim();
  }
  return '';
}

function getImageUrls(item) {
  const urls = [];
  for (const key of IMAGE_URLS_KEYS) urls.push(...normalizeStringArray(item && item[key]));
  for (const key of IMAGE_URL_KEYS) urls.push(...normalizeStringArray(item && item[key]));
  return uniqueStrings(urls);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function splitMasterCommonName(value) {
  const parts = [];
  let currentPart = '';
  let parenthesisDepth = 0;
  let hasTopLevelPlus = false;

  for (const character of String(value || '')) {
    if (character === '(') {
      parenthesisDepth += 1;
      currentPart += character;
      continue;
    }
    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      currentPart += character;
      continue;
    }
    if (character === '+' && parenthesisDepth === 0) {
      hasTopLevelPlus = true;
      parts.push(currentPart);
      currentPart = '';
      continue;
    }
    currentPart += character;
  }

  parts.push(currentPart);

  const rawCommonName = String(value || '').trim().replace(/\s+/g, ' ');
  const splitParts = parts
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part && !/^\d+(?:[.,]\d+)?\s*%/.test(part));

  return Array.from(new Set(hasTopLevelPlus && rawCommonName ? [...splitParts, rawCommonName] : splitParts));
}

function buildCommonNameRows(items) {
  const groups = new Map();

  for (const item of items) {
    const itemNo = firstValue(item, MASTER_ITEM_KEYS);
    const rawCommonName = firstValue(item, COMMON_NAME_KEYS);
    const imageUrls = getImageUrls(item);
    for (const commonName of splitMasterCommonName(rawCommonName)) {
      const key = normalizeKey(commonName);
      const existing = groups.get(key);
      if (existing) {
        existing.itemCount += 1;
        if (itemNo && !existing.itemNos.includes(itemNo)) existing.itemNos.push(itemNo);
        existing.imageUrls = uniqueStrings([...existing.imageUrls, ...imageUrls]);
        existing.imageUrl = existing.imageUrls[0] || '';
        continue;
      }

      groups.set(key, {
        key,
        commonName,
        itemCount: 1,
        itemNos: itemNo ? [itemNo] : [],
        imageUrl: imageUrls[0] || '',
        imageUrls,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.commonName.localeCompare(b.commonName, ['th', 'en']),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getClassification(value) {
  const text = String(value ?? '').trim().toUpperCase();
  const alias = CLASSIFICATION_ALIASES.find((item) => {
    const words = item.phrase.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    const pattern = new RegExp(`(^|[^A-Z0-9])${words}([^A-Z0-9]|$)`);
    return pattern.test(text);
  });
  if (alias) return CLASSIFICATION_TYPES.find((item) => item.code === alias.code);

  return CLASSIFICATION_TYPES
    .slice()
    .sort((a, b) => b.code.length - a.code.length)
    .find((item) => new RegExp(`(^|[^A-Z0-9])${escapeRegExp(item.code)}([^A-Z0-9]|$)`).test(text));
}

function addItemTypeAliases(item) {
  const source = [
    firstValue(item, COMMON_NAME_KEYS),
    firstValue(item, ['item_name2', 'item_name3', 'description']),
    firstValue(item, NAME_KEYS),
  ].filter(Boolean).join(' ');
  const classification = getClassification(source);

  const unitCost = firstValue(item, UNIT_COST_KEYS);
  return {
    ...item,
    itemCode: item.itemCode || firstValue(item, MASTER_ITEM_KEYS),
    itemName: item.itemName || firstValue(item, NAME_KEYS),
    packSize: item.packSize || firstValue(item, PACK_SIZE_KEYS),
    itemType: item.itemType || classification?.code || firstValue(item, COMMON_NAME_KEYS),
    category: item.category || firstValue(item, CATEGORY_KEYS),
    unit: item.unit || firstValue(item, UNIT_KEYS),
    ...(unitCost ? { unit_cost: item.unit_cost || unitCost, unitCost: item.unitCost || unitCost } : {}),
    productType: item.productType || classification?.group || '',
  };
}

async function fetchJsonItems(url, errorMessage) {
  const response = await fetch(new URL(url), { headers: { Accept: 'application/json' } });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    const err = new Error(errorMessage);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return normalizeItems(payload);
}

function mergeSources(...groups) {
  const seen = new Set();
  const merged = [];
  for (const items of groups) {
    for (const item of items) {
      const itemNo = firstValue(item, MASTER_ITEM_KEYS).toUpperCase();
      if (!itemNo || seen.has(itemNo)) continue;
      seen.add(itemNo);
      merged.push(item);
    }
  }
  return merged;
}

async function fetchMasterItems() {
  const [mainItems, ldiItems] = await Promise.all([
    fetchJsonItems(WEBHOOK_URL, 'Master item webhook request failed'),
    fetchJsonItems(LDI_WEBHOOK_URL, 'LDI master item webhook request failed'),
  ]);
  return mergeSources(mainItems, ldiItems);
}

function applyMeta(item, meta) {
  if (!meta) return item;
  const out = { ...item };
  for (const key of META_STRING_FIELDS) {
    if (meta[key] !== undefined && meta[key] !== null && meta[key] !== '') out[key] = meta[key];
  }
  for (const key of META_KEYS) {
    if (meta[key] !== undefined && meta[key] !== null && meta[key] !== '') out[key] = meta[key];
  }
  for (const key of META_ARRAY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(meta, key)) out[key] = normalizeStringArray(meta[key]);
  }
  for (const [camel, snake] of Object.entries(META_SNAKE_ALIASES)) {
    if (meta[camel] !== undefined && meta[camel] !== null && meta[camel] !== '') out[snake] = meta[camel];
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'imageUrls') || Object.prototype.hasOwnProperty.call(meta, 'imageUrl')) {
    const imageUrls = normalizeStringArray(meta.imageUrls);
    if (imageUrls.length === 0) imageUrls.push(...normalizeStringArray(meta.imageUrl));
    const imageUrl = imageUrls[0] || '';
    out.imageUrl = imageUrl;
    out.image_url = imageUrl;
    out.imageUrls = imageUrls;
    out.image_urls = imageUrls;
  }
  return out;
}

function mergeItemsWithMeta(items, metas) {
  const metaByItemNo = new Map(metas.map((m) => [String(m.itemNo || '').trim().toUpperCase(), m]));
  const seen = new Set();
  const merged = items.map((item) => {
    const itemNo = firstValue(item, MASTER_ITEM_KEYS).toUpperCase();
    if (itemNo) seen.add(itemNo);
    return addItemTypeAliases(applyMeta(item, metaByItemNo.get(itemNo)));
  });

  for (const meta of metas) {
    const itemNo = String(meta.itemNo || '').trim().toUpperCase();
    if (!itemNo || seen.has(itemNo)) continue;
    merged.push(addItemTypeAliases(applyMeta(buildMetaOnlyItem(meta), meta)));
  }

  return merged;
}

function buildMetaOnlyItem(meta) {
  const itemNo = String(meta.itemNo || meta.itemCode || '').trim();
  return {
    item_no: itemNo,
    item_name1: meta.itemName || '',
    common_name: meta.itemType || '',
    desc2: meta.description || '',
    itemCode: meta.itemCode || itemNo,
    itemName: meta.itemName || '',
    itemType: meta.itemType || '',
    category: meta.category || '',
    unit: meta.unit || '',
    status: meta.status || 'active',
    description: meta.description || '',
    imageUrl: meta.imageUrl || '',
    image_url: meta.imageUrl || '',
    imageUrls: normalizeStringArray(meta.imageUrls).length ? normalizeStringArray(meta.imageUrls) : normalizeStringArray(meta.imageUrl),
    image_urls: normalizeStringArray(meta.imageUrls).length ? normalizeStringArray(meta.imageUrls) : normalizeStringArray(meta.imageUrl),
    // ponytail: marker for UI/debug; remove if nobody reads it.
    source: 'meta',
  };
}

async function getMergedMasterItems(req, res) {
  try {
    const items = await fetchMasterItems();
    const metas = await MasterItemMeta.find().lean();
    const groups = await ItemGroup.find({ status: 'active' }).sort({ sortOrder: 1, name: 1 }).lean();
    const merged = mergeItemsWithMeta(items, metas);

    // Match src/lib/itemGroups.ts: exclude > include > common/trade name.
    const groupRules = groups.map((group) => ({
      summary: { _id: String(group._id), name: group.name },
      include: new Set((group.includeItemNos || []).map((value) => String(value).trim())),
      exclude: new Set((group.excludeItemNos || []).map((value) => String(value).trim())),
      common: new Set((group.commonNames || []).map((value) => String(value).trim().toUpperCase())),
      trade: new Set((group.tradeNames || []).map((value) => String(value).trim().toUpperCase())),
    }));
    return res.json(merged.map((item) => {
      const itemNo = firstValue(item, MASTER_ITEM_KEYS);
      const commonName = firstValue(item, COMMON_NAME_KEYS).toUpperCase();
      const tradeName = firstValue(item, ['trade_name', 'tradename', 'tradeName']).toUpperCase();
      const itemGroups = groupRules.filter((rule) => {
        if (itemNo && rule.exclude.has(itemNo)) return false;
        return (itemNo && rule.include.has(itemNo))
          || (commonName && rule.common.has(commonName))
          || (tradeName && rule.trade.has(tradeName));
      }).map((rule) => rule.summary);
      return { ...item, itemGroups };
    }));
  } catch (err) {
    return res.status(err.status || 502).json({
      message: err.message || 'Cannot connect to master item webhook',
      error: err.payload || err.message,
    });
  }
}

async function forwardToWebhook(req, res) {
  try {
    const headers = {
      Accept: 'application/json',
    };

    const init = {
      method: req.method,
      headers,
    };

    if (!['GET', 'HEAD'].includes(req.method)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body || {});
    }

    const target = new URL(WEBHOOK_URL);
    if (req.params.id && !target.searchParams.has('id')) {
      target.searchParams.set('id', req.params.id);
    }
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        value.forEach((entry) => target.searchParams.append(key, entry));
      } else if (value !== undefined) {
        target.searchParams.set(key, value);
      }
    }

    const response = await fetch(target, init);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        message: 'Master item webhook request failed',
        error: payload,
      });
    }

    return res.status(response.status).json(payload);
  } catch (err) {
    return res.status(502).json({
      message: 'Cannot connect to master item webhook',
      error: err.message,
    });
  }
}

// ---- Export (xlsx / pdf) -------------------------------------------------
// Client ส่งแถวที่กรองแล้วมา, server แปลงเป็นไฟล์ดาวน์โหลด (reuse xlsx + puppeteer)

function computeColumns(rows) {
  const seen = [];
  const set = new Set();
  for (const row of rows) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        if (!set.has(key)) { set.add(key); seen.push(key); }
      }
    }
  }
  return seen;
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

router.post('/export', async (req, res) => {
  try {
    const { format, rows, title } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลสำหรับ export' });
    }
    if (format !== 'xlsx' && format !== 'pdf') {
      return res.status(400).json({ error: 'format ไม่ถูกต้อง (รองรับ xlsx หรือ pdf)' });
    }

    const columns = computeColumns(rows);
    const baseName = `master-item-${dateStamp()}`;

    if (format === 'xlsx') {
      const data = rows.map((row) => {
        const obj = {};
        for (const col of columns) obj[col] = cellToString(row && row[col]);
        return obj;
      });
      const ws = XLSX.utils.json_to_sheet(data, { header: columns });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Master Item');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      return res.send(buf);
    }

    // format === 'pdf'
    const chromePath = process.env.PRINT_CHROME_PATH;
    if (!chromePath || !fs.existsSync(chromePath)) {
      return res.status(400).json({ error: 'ไม่พบ Chrome สำหรับสร้าง PDF (ตั้งค่า PRINT_CHROME_PATH)' });
    }

    const headHtml = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const bodyHtml = rows.map((row) => {
      const tds = columns.map((c) => `<td>${escapeHtml(cellToString(row && row[c]))}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    const docTitle = escapeHtml(title || 'Master Item');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { font-family: 'Kanit', sans-serif; }
  h1 { font-size: 12px; margin: 0 0 4px; }
  .meta { font-size: 8px; color: #555; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #999; padding: 2px 3px; font-size: 7px; text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #eee; font-weight: 600; }
</style></head><body>
  <h1>${docTitle}</h1>
  <div class="meta">จำนวน ${rows.length} รายการ</div>
  <table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
</body></html>`;

    const puppeteer = require('puppeteer-core');
    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
      await page.evaluateHandle('document.fonts.ready').catch(() => {});
      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
      });
      await browser.close();
      browser = null;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
      // page.pdf() returns a Uint8Array; wrap in Buffer so Express sends raw bytes
      // (a plain Uint8Array would be JSON-serialized by res.send)
      return res.send(Buffer.from(pdf));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---- Slim list (group-membership only) -----------------------------------
// The full master-item payload from the ERP webhook is ~940 KB and is fetched
// on every page that needs item↔group membership (QC testing/approval/assign,
// config pages) via useItemGroupMembership. That hook only reads 3 fields per
// item, so this endpoint returns just those and caches the ERP round-trip for
// a few minutes (the catalog changes rarely). Cuts ~940 KB → ~50 KB and skips
// the upstream fetch on repeat loads.
//
// Key lists MUST stay in sync with src/lib/masterItemFields.ts.
const SLIM_KEYS = {
  itemNo: ['item_no', 'itemCode', 'item_code', 'code', 'Code', 'ITEM_CODE'],
  commonName: ['common_name', 'commonname', 'commonName', 'item_name2', 'itemType'],
  tradeName: ['trade_name', 'tradename', 'tradeName'],
};

let slimCache = null;
let slimCacheAt = 0;
const SLIM_TTL_MS = 5 * 60 * 1000;

router.get('/slim', async (req, res) => {
  try {
    const now = Date.now();
    if (slimCache && now - slimCacheAt < SLIM_TTL_MS) {
      return res.json({ data: slimCache, cached: true });
    }
    const items = await fetchMasterItems();
    const slim = items
      .map((it) => ({
        itemNo: firstValue(it, SLIM_KEYS.itemNo),
        commonName: firstValue(it, SLIM_KEYS.commonName),
        tradeName: firstValue(it, SLIM_KEYS.tradeName),
      }))
      .filter((r) => r.itemNo);
    slimCache = slim;
    slimCacheAt = now;
    return res.json({ data: slim });
  } catch (err) {
    if (slimCache) return res.json({ data: slimCache, cached: true, stale: true });
    return res.status(502).json({ message: 'Cannot connect to master item webhook', error: err.message });
  }
});

router.get('/common-names', async (req, res) => {
  try {
    const items = await fetchMasterItems();
    const metas = await MasterItemMeta.find().lean();
    return res.json(buildCommonNameRows(mergeItemsWithMeta(items, metas)));
  } catch (err) {
    return res.status(err.status || 502).json({
      message: err.message || 'Cannot connect to master item webhook',
      error: err.payload || err.message,
    });
  }
});

router.get('/', getMergedMasterItems);
router.post('/', forwardToWebhook);
router.put('/', forwardToWebhook);
router.patch('/', forwardToWebhook);
router.delete('/', forwardToWebhook);
router.get('/:id', forwardToWebhook);
router.put('/:id', forwardToWebhook);
router.patch('/:id', forwardToWebhook);
router.delete('/:id', forwardToWebhook);

module.exports = router;
