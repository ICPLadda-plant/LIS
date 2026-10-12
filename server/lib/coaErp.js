const { aiToleranceCriteriaForCommonName, isAiContentTestItem } = require('./aiToleranceCriteria');
const { batchMatches } = require('./densityBatch');

const MF_URLS = [
  'https://n8n-plant.icpladda.com/webhook/api/item-MF',
  'https://n8n-plant.icpladda.com/webhook/item-MF-CLOSE',
];
const STOCK_URL = 'https://n8n-plant.icpladda.com/webhook/api/stock-all-item';
const PHYSICAL_ENGLISH = {
  'ของเหลวใส': 'Clear liquid', 'ของเหลวขุ่น': 'Cloudy liquid', 'ของเหลวหนืด': 'Viscous liquid',
  'เม็ดทรงกระบอก': 'Cylindrical granules', 'เกล็ด': 'Flakes', 'ผงละเอียด': 'Fine powder',
  'ผงละเลียด': 'Fine powder', 'เม็ดทราย': 'Sand granules', 'เม็ดหยาบ': 'Coarse granules',
  'เม็ด': 'Granules', 'ก้อนเล็ก': 'Small blocks', 'ก้อนใหญ่': 'Large blocks',
  'ใส': 'Clear', 'ไม่มีสี': 'Colorless', 'ใสไม่มีสี': 'Colorless', 'ขาว': 'White',
  'ดำ': 'Black', 'แดง': 'Red', 'ส้ม': 'Orange', 'เหลือง': 'Yellow', 'เขียว': 'Green',
  'ฟ้า': 'Light blue', 'น้ำเงิน': 'Blue', 'ม่วง': 'Purple', 'ชมพู': 'Pink',
  'น้ำตาล': 'Brown', 'เทา': 'Gray', 'เหลืองอ่อน': 'Pale yellow',
};

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeText(value) {
  return text(value).toLowerCase().replace(/\s*%\s*/g, '%').replace(/\s+/g, ' ');
}

function normalizeBatch(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload.filter((row) => row && typeof row === 'object');
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['data', 'items', 'rows', 'result', 'value']) {
    if (Array.isArray(payload[key])) return rowsFromPayload(payload[key]);
  }
  return [];
}

function pick(row, keys) {
  for (const key of keys) {
    const value = text(row?.[key]);
    if (value) return value;
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
  const aliases = new Map(Object.keys(row).map((key) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), key]));
  for (const key of keys) {
    const actualKey = aliases.get(String(key).toLowerCase().replace(/[^a-z0-9]/g, ''));
    const value = text(actualKey ? row[actualKey] : '');
    if (value) return value;
  }
  return '';
}

function itemCode(value) {
  return text(value).toUpperCase();
}

function rowValues(row) {
  if (Array.isArray(row)) return row;
  if (Array.isArray(row?.values)) return row.values;
  if (!row || typeof row !== 'object') return [];
  const keys = Object.keys(row);
  if (keys.length && keys.every((key) => /^\d+$/.test(key))) {
    return keys.sort((left, right) => Number(left) - Number(right)).map((key) => row[key]);
  }
  return Object.values(row);
}

function isDateValue(value) {
  const source = text(value);
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]|$)/.test(source)
    || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}(?:[T\s]|$)/.test(source);
}

function positionalDateFromRow(row) {
  return rowValues(row).map((value) => text(value)).find(isDateValue) || '';
}

function positionalBatchFromRow(row) {
  const values = rowValues(row);
  if (!values.length) return '';
  const productName = pick(row, [
    'prod_descript', 'product_name', 'item_name', 'trade_name', 'name',
    'description', 'prod_descript2', 'TradeName', 'Trade Name',
  ]);
  let productIndex = productName ? values.findIndex((value) => text(value) === productName) : -1;
  if (productIndex < 0) {
    productIndex = values.findIndex((value) => /[^\x00-\x7F]/.test(text(value)));
  }
  const dateIndex = values.findIndex((value, index) => index > productIndex && isDateValue(value));
  if (productIndex < 0 || productIndex >= dateIndex - 1) return '';

  // The source contract places Batch immediately after the product name and
  // before the production date. Keep leading zeroes such as 080 and 081.
  const candidate = text(values[productIndex + 1]);
  if (!candidate || isDateValue(candidate) || /^MF[A-Z0-9-]+$/i.test(candidate)) return '';
  if (/^\d+(?:\.\d+)?$/.test(candidate) && !/^0\d{2,}$/.test(candidate)) return '';
  return candidate;
}

// MF rows expose the production order separately from the finished-product
// batch. Never use prod_order_no as the COA Batch No. fallback.
function batchFromRow(row) {
  return pick(row, [
    'batch_no', 'batchNo', 'BatchNo', 'Batch No.', 'Batch No',
    'batch', 'Batch', 'batch_number', 'batchNumber',
    'lot_no', 'lotNo', 'LotNo', 'Lot No.', 'Lot No', 'lot', 'Lot',
    'production_batch_no', 'productionBatchNo', 'prod_batch_no', 'prodBatchNo',
  ]) || positionalBatchFromRow(row);
}

function itemCodeFromRow(row) {
  return pick(row, ['item_no', 'itemNo', 'code', 'short_dm1_code'])
    || rowValues(row).map(text).find((value) => /^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/i.test(value))
    || '';
}

function productionDateFromRow(row, fallback = '') {
  const explicit = pick(row, [
    'create_date', 'createDate', 'production_date', 'productionDate',
    'mfg_date', 'manufacture_date', 'registering_date', 'registeringDate',
  ]);
  return normalizeIsoDate(explicit || positionalDateFromRow(row) || fallback);
}

function lotFromRow(row) {
  return pick(row, [
    'lot_no', 'lotNo', 'LotNo', 'Lot No.', 'Lot No', 'lot', 'Lot',
    'batch_no', 'batchNo', 'BatchNo', 'Batch No.', 'Batch No',
  ]) || batchFromRow(row);
}

function rowMatchesItem(row, normalizedItemNo) {
  if (!normalizedItemNo) return false;
  const explicit = itemCodeFromRow(row);
  return itemCode(explicit) === normalizedItemNo;
}

function normalizeIsoDate(value) {
  const source = text(value);
  const iso = source.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function lotDate(lotNo) {
  const value = text(lotNo);
  const match = value.match(/^(?:FG)?(\d{2})(\d{2})(\d{2})-/i);
  if (!match) return '';
  return `20${match[1]}-${match[2]}-${match[3]}`;
}

function lotSnapshot(lotNo, fallbackDate = '') {
  const value = text(lotNo);
  return {
    lotNo: value,
    batchNo: value,
    productionDate: lotDate(value) || normalizeIsoDate(fallbackDate),
  };
}

function commonPrefix(left, right) {
  const a = normalizeBatch(left);
  const b = normalizeBatch(right);
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

function batchSimilarity(requested, candidate) {
  const left = normalizeBatch(requested);
  const right = normalizeBatch(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const prefix = commonPrefix(left, right);
  const prefixRatio = prefix / Math.max(left.length, right.length);
  const leftNumber = Number((left.match(/\d+$/) || [])[0]);
  const rightNumber = Number((right.match(/\d+$/) || [])[0]);
  const numericBonus = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? Math.max(0, 0.2 - Math.min(Math.abs(leftNumber - rightNumber), 1000) / 5000)
    : 0;
  return Math.min(0.99, prefixRatio * 0.8 + numericBonus);
}

function translatePhysicalValue(value) {
  const source = text(value).replace(/^สี/, '');
  return PHYSICAL_ENGLISH[source] || (/^[\x20-\x7E]+$/.test(source) ? source : '');
}

function physicalFromQc(result) {
  const rows = Array.isArray(result?.entries) && result.entries.length ? result.entries : [result?.values || {}];
  const values = [];
  for (const row of rows) {
    for (const key of ['ลักษณะ', 'สี', 'appearance', 'color']) {
      const value = text(row?.[key]);
      if (value) values.push(value);
    }
  }
  const unique = [...new Set(values)];
  const english = unique.map(translatePhysicalValue).filter(Boolean);
  return {
    raw: unique.join(' '),
    english: english.join(', '),
    complete: unique.length > 0 && english.length === unique.length,
  };
}

function aiFromQc(result, commonName) {
  const rows = Array.isArray(result?.entries) && result.entries.length ? result.entries : [result?.values || {}];
  const substance = normalizeText(commonName).split(/\s|\+|,/)[0];
  const values = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row || {})) {
      if (isAiContentTestItem(key) && text(value)) {
        values.push({ key, value });
      }
    }
  }
  const selected = values.find((entry) => substance && normalizeText(entry.key).includes(`::${substance}`))
    || values.find((entry) => normalizeText(entry.key) !== '%ai')
    || values[0];
  if (!selected) return null;
  const resultText = text(selected.value).endsWith('%') ? text(selected.value) : `${text(selected.value)}%`;
  return { result: resultText, key: selected.key };
}

function densityFromQc(result) {
  const rows = Array.isArray(result?.entries) && result.entries.length ? result.entries : [result?.values || {}];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row || {})) {
      if (/(?:density|ถพ)/i.test(key) && !/source|note/i.test(key) && text(value)) {
        return text(value);
      }
    }
  }
  return '';
}

function findBestLabItem(petitions, sample) {
  const commonName = normalizeText(sample?.commonName);
  const batchNo = text(sample?.batchNo || sample?.lotNo);
  const tradeName = normalizeText(sample?.sampleName);
  const candidates = [];
  for (const petition of petitions || []) {
    for (const item of petition.items || []) {
      const itemCommonName = normalizeText(item.commonName);
      if (!commonName || itemCommonName !== commonName) continue;
      const candidateBatch = item.batchNo || item.lotNo;
      const batchScore = batchSimilarity(batchNo, candidateBatch);
      const tradeScore = tradeName && normalizeText(item.sampleName) === tradeName ? 0.15 : 0;
      const approvedScore = petition.labApprovedAt ? 0.1 : 0;
      candidates.push({
        petition,
        item,
        batchScore,
        score: batchScore * 0.75 + tradeScore + approvedScore,
        matchKind: batchScore === 1 ? 'exact' : batchScore >= 0.45 ? 'close' : 'none',
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || String(right.petition.updatedAt || '').localeCompare(String(left.petition.updatedAt || '')));
  // A Lab result is safe to autofill only when both common name and batch match.
  // Keep near candidates for diagnostics, but never use them as the selected result.
  return { best: candidates.find((candidate) => candidate.matchKind === 'exact') || null, candidates };
}

function sampleFromSources(source, stockRows, mfRows) {
  const itemNo = text(source?.externalCoaRequest?.itemNo || source?.sampleSnapshots?.[0]?.sampleId);
  const commonName = text(source?.sampleSnapshots?.[0]?.commonName);
  const normalizedItemNo = itemCode(itemNo);
  const productRows = stockRows.filter((row) => rowMatchesItem(row, normalizedItemNo));
  const commonRows = stockRows.filter((row) => !normalizedItemNo && normalizeText(row.common_name || row.commonName) === normalizeText(commonName));
  const stockCandidates = [...productRows, ...commonRows]
    .filter((row) => lotFromRow(row))
    .sort((left, right) => {
      const rightLot = lotFromRow(right);
      const leftLot = lotFromRow(left);
      const rightDate = lotSnapshot(rightLot, productionDateFromRow(right)).productionDate;
      const leftDate = lotSnapshot(leftLot, productionDateFromRow(left)).productionDate;
      return rightDate.localeCompare(leftDate)
        || productionDateFromRow(right).localeCompare(productionDateFromRow(left))
        || Number(right.stock_qty_base || right.stock_qty || 0) - Number(left.stock_qty_base || left.stock_qty || 0);
    });
  const stock = stockCandidates[0];
  const mfCandidates = mfRows.filter((row) => {
    return normalizedItemNo
      ? rowMatchesItem(row, normalizedItemNo)
      : normalizeText(row.common_name || row.commonName) === normalizeText(commonName);
  });
  const mf = mfCandidates[0];
  const sourceBatch = text(source?.sampleSnapshots?.[0]?.batchNo || source?.sampleSnapshots?.[0]?.lotNo);
  const mfBatch = batchFromRow(mf);
  const mfDate = productionDateFromRow(mf);
  const lot = sourceBatch
    ? lotSnapshot(sourceBatch, source?.sampleSnapshots?.[0]?.productionDate)
    : stock
      ? lotSnapshot(lotFromRow(stock), productionDateFromRow(stock))
      : mfBatch
        ? lotSnapshot(mfBatch, mfDate)
        : { lotNo: '', batchNo: '', productionDate: mfDate };
  return {
    sample: {
      itemSeq: Number(source.selectedItemSeqs?.[0] || 1),
      sampleName: text(source.sampleSnapshots?.[0]?.sampleName),
      commonName,
      batchNo: lot.batchNo,
      lotNo: lot.lotNo,
      productionDate: lot.productionDate,
      sampleId: itemNo,
      condition: text(source.externalCoaRequest?.packingSize || source.sampleSnapshots?.[0]?.condition),
    },
    stockCandidates: stockCandidates.slice(0, 10).map((row) => ({
      lotNo: lotFromRow(row),
      productionDate: lotSnapshot(lotFromRow(row), productionDateFromRow(row)).productionDate,
      quantity: Number(row.stock_qty_base || row.stock_qty || 0),
      itemNo: itemCodeFromRow(row),
    })),
    mfCandidates: mfCandidates.slice(0, 10).map((row) => ({
      batchNo: batchFromRow(row),
      productionDate: productionDateFromRow(row),
      itemNo: itemCodeFromRow(row),
    })),
  };
}

function resultRowsFromQc(qcResults, commonName) {
  const physical = qcResults.map(physicalFromQc).find((entry) => entry.raw);
  const ai = qcResults.map((result) => aiFromQc(result, commonName)).find(Boolean);
  const density = qcResults.map(densityFromQc).find(Boolean) || '';
  const rows = [];
  if (physical?.raw) rows.push({
    testItem: 'Appearance', criteria: physical.english || physical.raw, result: 'Conform', method: 'Visual', unit: '',
  });
  if (ai) rows.push({
    testItem: '%AI content', criteria: aiToleranceCriteriaForCommonName(commonName) || '', result: ai.result, unit: '%', method: '',
  });
  if (density) rows.push({
    testItem: 'Density at 30°C (g/cm³)', criteria: '-', result: density, unit: 'g/cm³', method: 'DMA 501',
  });
  const analysisDate = qcResults.map((entry) => normalizeIsoDate(entry.updatedAt || entry.enteredAt)).find(Boolean);
  if (analysisDate) rows.push({ testItem: 'Date of analysis', criteria: '-', result: analysisDate, unit: '', method: '' });
  return { rows, physical, ai, density, analysisDate };
}

function formKindForCommonName(commonName) {
  const value = text(commonName).toUpperCase();
  if (/^BROMADIOLONE\s+0\.005%(?:\s|$)/.test(value)) return 'bromadiolone0005';
  if (/\b(GR|DS|WP|WG|GB|ST|SP)$/.test(value)) return 'grWpSp';
  if (/\b(SC|EW|EC|ZC|SL)$/.test(value)) return 'liquid';
  return 'standard';
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchErpReferences() {
  const [mfResults, stockPayload] = await Promise.all([
    Promise.all(MF_URLS.map((url) => fetchJson(url))),
    fetchJson(STOCK_URL),
  ]);
  return {
    mfRows: mfResults.flatMap(rowsFromPayload),
    stockRows: rowsFromPayload(stockPayload),
  };
}

function densityForBatch(rows, batchNo) {
  return [...(rows || [])]
    .filter((row) => batchMatches(batchNo, row))
    .sort((left, right) => String(right['Date & time'] || '').localeCompare(String(left['Date & time'] || '')))
    .map((row) => text(row['Density [g/cm³]'] || row.density))
    .find(Boolean) || '';
}

module.exports = {
  batchSimilarity,
  densityForBatch,
  fetchErpReferences,
  findBestLabItem,
  formKindForCommonName,
  lotSnapshot,
  normalizeIsoDate,
  normalizeText,
  physicalFromQc,
  resultRowsFromQc,
  rowsFromPayload,
  sampleFromSources,
  batchFromRow,
};
