const { aiToleranceCriteriaForCommonName, isAiContentTestItem } = require('./aiToleranceCriteria');
const { batchMatches } = require('./densityBatch');

const MF_URLS = [
  'https://n8n-plant.icpladda.com/webhook/api/item-MF',
  'https://n8n-plant.icpladda.com/webhook/item-MF-CLOSE',
];
const STOCK_URL = 'https://n8n-plant.icpladda.com/webhook/api/stock-all-item';
const GR_WP_SP_FORMULATIONS = new Set(['WG', 'WP', 'ST', 'GR', 'DS', 'SP', 'GB']);
const LEGACY_FORMULATIONS = new Set(['EC', 'SC', 'SL', 'WG', 'WP', 'GR', 'SP', 'ME', 'EW', 'ZC']);
const LEGACY_IGNORED_TOKENS = new Set([
  ...LEGACY_FORMULATIONS,
  'WV', 'WW', 'W', 'V', 'LIVE', 'STOCK', 'PUBLIC', 'HEALTH', 'BIO', 'GREEN', 'BROWN',
  'WAX', 'BLOCK', 'SAND', 'GRANULE', 'GRANULES', 'TECH', 'AI', 'ACTIVE', 'INGREDIENT', 'CONTENT',
]);
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
    'Lot Description', 'LotDescription', 'lot_description', 'lotDescription',
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
  const dmy = source.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const year = Number(dmy[3]) >= 2400 ? Number(dmy[3]) - 543 : Number(dmy[3]);
    const month = Number(dmy[2]);
    const day = Number(dmy[1]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return '';
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function lotDate(lotNo) {
  const value = text(lotNo);
  const labeledDate = value.match(/-([0-3]\d)([01]\d)(\d{2})$/);
  if (labeledDate) {
    const day = Number(labeledDate[1]);
    const month = Number(labeledDate[2]);
    const year = 2500 + Number(labeledDate[3]) - 543;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const match = value.match(/^(?:FG)?(\d{2})(\d{2})(\d{2})-/i);
  if (!match) return '';
  return `20${match[1]}-${match[2]}-${match[3]}`;
}

function isFgLotDescription(lotNo) {
  return /^FG\d{6}(?:-|$)/i.test(text(lotNo));
}

function lotSnapshot(lotNo, fallbackDate = '') {
  const value = text(lotNo);
  const labeledLot = value.match(/^(?:.+)-([^-]+)-[0-3]\d[01]\d\d{2}$/);
  return {
    lotNo: value,
    batchNo: labeledLot ? labeledLot[1] : value,
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

function labRequestBatch(labRequests, petition, item) {
  const petitionId = String(petition?._id || '');
  const itemSeq = Number(item?.seq);
  return text((labRequests || []).find((request) => (
    String(request?.petitionId || '') === petitionId && Number(request?.sampleSeq) === itemSeq
  ))?.batchNo);
}

function findBestRequestItem(petitions, source, labRequests = []) {
  const sourceItemNo = itemCode(source?.externalCoaRequest?.itemNo || source?.sampleSnapshots?.[0]?.sampleId);
  const sourceCommonName = normalizeText(source?.sampleSnapshots?.[0]?.commonName);
  const sourceSampleName = normalizeText(source?.sampleSnapshots?.[0]?.sampleName);
  if (!sourceItemNo && !sourceCommonName && !sourceSampleName) return null;
  const targetDate = normalizeIsoDate(
    source?.externalCoaRequest?.shipmentDate || source?.externalCoaRequest?.saleOrderDate,
  );
  const targetTime = targetDate ? Date.parse(`${targetDate}T00:00:00.000Z`) : Number.NaN;
  const candidates = [];

  for (const petition of petitions || []) {
    for (const item of petition.items || []) {
      const itemNoMatch = Boolean(sourceItemNo) && itemCode(item.itemNo) === sourceItemNo;
      const nameMatch = Boolean(sourceSampleName && sourceCommonName)
        && normalizeText(item.sampleName) === sourceSampleName
        && normalizeText(item.commonName) === sourceCommonName;
      if (!itemNoMatch && !nameMatch) continue;
      const batchNo = text(item.batchNo || item.lotNo || labRequestBatch(labRequests, petition, item));
      if (!batchNo) continue;
      const productionDate = normalizeIsoDate(item.productionDate)
        || lotSnapshot(item.lotNo || item.batchNo).productionDate;
      const productionTime = productionDate ? Date.parse(`${productionDate}T00:00:00.000Z`) : Number.NaN;
      const hasTargetAndProduction = Number.isFinite(targetTime) && Number.isFinite(productionTime);
      candidates.push({
        petition,
        item: item.batchNo || item.lotNo ? item : { ...item, batchNo },
        identityTier: itemNoMatch ? 2 : 1,
        identityScore: Number(Boolean(sourceCommonName) && normalizeText(item.commonName) === sourceCommonName) * 2
          + Number(Boolean(sourceSampleName) && normalizeText(item.sampleName) === sourceSampleName),
        dateBucket: hasTargetAndProduction ? (productionTime <= targetTime ? 0 : 1) : 2,
        dateDistance: hasTargetAndProduction
          ? Math.abs(targetTime - productionTime)
          : (Number.isFinite(productionTime) ? -productionTime : Number.POSITIVE_INFINITY),
      });
    }
  }

  candidates.sort((left, right) => right.identityTier - left.identityTier
    || right.identityScore - left.identityScore
    || left.dateBucket - right.dateBucket
    || left.dateDistance - right.dateDistance
    || String(right.petition.updatedAt || '').localeCompare(String(left.petition.updatedAt || '')));
  return candidates[0] || null;
}

function findBestCoaHistorySample(coas, source) {
  const sourceSample = source?.sampleSnapshots?.[0] || {};
  const sourceItemNo = itemCode(source?.externalCoaRequest?.itemNo || sourceSample.sampleId);
  const sourceSampleName = normalizeText(sourceSample.sampleName);
  const sourceCommonName = normalizeText(sourceSample.commonName);
  const targetDate = normalizeIsoDate(
    source?.externalCoaRequest?.shipmentDate || source?.externalCoaRequest?.saleOrderDate,
  );
  const targetTime = targetDate ? Date.parse(`${targetDate}T00:00:00.000Z`) : Number.NaN;
  const candidates = [];

  for (const coa of coas || []) {
    for (const sample of coa.sampleSnapshots || []) {
      const batchNo = text(sample.batchNo || sample.lotNo);
      if (!batchNo) continue;
      const itemNoMatch = Boolean(sourceItemNo) && itemCode(sample.sampleId) === sourceItemNo;
      const nameMatch = Boolean(sourceSampleName && sourceCommonName)
        && normalizeText(sample.sampleName) === sourceSampleName
        && normalizeText(sample.commonName) === sourceCommonName;
      if (!itemNoMatch && !nameMatch) continue;
      const productionDate = normalizeIsoDate(sample.productionDate)
        || lotSnapshot(sample.lotNo || sample.batchNo).productionDate;
      const productionTime = productionDate ? Date.parse(`${productionDate}T00:00:00.000Z`) : Number.NaN;
      const hasDates = Number.isFinite(targetTime) && Number.isFinite(productionTime);
      candidates.push({
        coa,
        sample,
        identityTier: itemNoMatch ? 2 : 1,
        dateBucket: hasDates ? (productionTime <= targetTime ? 0 : 1) : 2,
        dateDistance: hasDates ? Math.abs(targetTime - productionTime) : Number.POSITIVE_INFINITY,
      });
    }
  }

  candidates.sort((left, right) => right.identityTier - left.identityTier
    || left.dateBucket - right.dateBucket
    || left.dateDistance - right.dateDistance
    || String(right.coa.updatedAt || '').localeCompare(String(left.coa.updatedAt || '')));
  return candidates[0] || null;
}

function cleanLegacyBatch(value) {
  return text(value).replace(/(?:\s+|-)P\d+$/i, '').trim();
}

function legacyIdentityText(value) {
  return text(value).toUpperCase()
    .replace(/\bBENSOATE\b/g, 'BENZOATE')
    .replace(/\bANILOPHOS\b/g, 'ANILOFOS')
    .replace(/\bHYDROCHLORIDE\b/g, 'HCL')
    .replace(/\bFOSETHYL\b/g, 'FOSETYL')
    .replace(/\bPROFENOPHOS\b/g, 'PROFENOFOS')
    .replace(/\bPACLOBUTRAZOLE\b/g, 'PACLOBUTRAZOL')
    .replace(/\bBISPYRIBAC[\s-]+SODIUM\b/g, 'BISPYRIBAC')
    .replace(/2\s*,?\s*4\s*[- ]?D\s*[- ]?(?:BUTYL|B\.?E\.?)(?=\s|\d|%|$)/g, '24D BE')
    .replace(/W\s*\/\s*V/g, 'WV')
    .replace(/W\s*\/\s*W/g, 'WW');
}

function legacyIdentity(value) {
  const normalized = legacyIdentityText(value);
  const strengthValues = [
    ...[...normalized.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1])),
    ...[...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?=\+)/g)].map((match) => Number(match[1])),
  ].filter(Number.isFinite).sort((left, right) => left - right);
  const withoutStrengths = normalized
    .replace(/\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?=\+)/g, ' ');
  const tokens = [...new Set((withoutStrengths.match(/[A-Z0-9]+/g) || [])
    .filter((token) => /[A-Z]/.test(token) && !LEGACY_IGNORED_TOKENS.has(token)))];
  const formulation = (normalized.match(/\b(EC|SC|SL|WG|WP|GR|SP|ME|EW|ZC)\b/) || [])[1] || '';
  return { tokens, strengthValues, formulation };
}

function sameNumberList(left, right) {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) < 0.000001);
}

function legacyProductMatchScore(commonName, legacySampleName) {
  const source = legacyIdentity(commonName);
  const candidate = legacyIdentity(legacySampleName);
  if (!source.tokens.length || !candidate.tokens.length) return 0;
  if (!source.tokens.every((token) => candidate.tokens.includes(token))) return 0;
  if (source.strengthValues.length && !sameNumberList(source.strengthValues, candidate.strengthValues)) return 0;
  if (source.formulation && candidate.formulation && source.formulation !== candidate.formulation) return 0;

  const tokenPrecision = source.tokens.length / candidate.tokens.length;
  const strengthScore = source.strengthValues.length ? 0.12 : 0.04;
  const formulationScore = source.formulation ? 0.08 : 0.03;
  return Math.min(1, 0.62 + tokenPrecision * 0.18 + strengthScore + formulationScore);
}

function legacyRowMatchesTests(row, commonName) {
  const sourceTokens = legacyIdentity(commonName).tokens;
  const testTokenGroups = (row?.tests || [])
    .filter((test) => !/(?:density|appearance)/i.test(text(test?.test_name)))
    .map((test) => legacyIdentity(test?.test_name).tokens)
    .filter((tokens) => tokens.length);
  return !testTokenGroups.length || testTokenGroups.every((tokens) => (
    tokens.some((token) => sourceTokens.includes(token))
  ));
}

function legacyBatchMatches(left, right) {
  const source = normalizeBatch(cleanLegacyBatch(left));
  const candidate = normalizeBatch(cleanLegacyBatch(right));
  if (!source || !candidate) return false;
  return source === candidate
    || (source.length >= 3 && candidate.endsWith(source))
    || (candidate.length >= 3 && source.endsWith(candidate));
}

function legacyPackingScore(packingSize, formulation) {
  const packing = text(packingSize).toUpperCase();
  if (!packing || !formulation) return 0;
  const dry = /(?:^|\s)(?:KG|G)(?:\s|$)/.test(packing);
  const liquid = /(?:^|\s)(?:L|ML|CC)(?:\s|$)/.test(packing);
  if (dry && GR_WP_SP_FORMULATIONS.has(formulation)) return 1;
  if (liquid && ['EC', 'SC', 'SL', 'ME', 'EW', 'ZC'].includes(formulation)) return 1;
  return 0;
}

function legacyQualifierScore(source, batchNo) {
  const commonName = text(source?.sampleSnapshots?.[0]?.commonName).toUpperCase();
  const itemNo = itemCode(source?.externalCoaRequest?.itemNo || source?.sampleSnapshots?.[0]?.sampleId);
  const batch = text(batchNo).toUpperCase();
  if ((commonName.includes('LIVE STOCK') || itemNo.startsWith('FLS-')) && /(?:^|-)LS(?:-|$)/.test(batch)) return 1;
  if ((commonName.includes('PUBLIC HEALTH') || /^FC?PH-/.test(itemNo)) && batch.includes('GMP')) return 1;
  if (commonName.includes('BIO') && /(?:^|-)B(?:-|$)/.test(batch)) return 1;
  return 0;
}

function legacyTestConformanceBucket(row) {
  let parsedAny = false;
  for (const test of row?.tests || []) {
    const result = Number((text(test?.result).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/) || [])[0]);
    if (!Number.isFinite(result)) continue;
    const criteria = text(test?.criteria).replace(/,/g, '');
    const range = criteria.match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
    if (range) {
      parsedAny = true;
      if (result < Number(range[1]) || result > Number(range[2])) return 1;
      continue;
    }
    const minimum = criteria.match(/(?:>=|≥)\s*(-?\d+(?:\.\d+)?)/);
    if (minimum) {
      parsedAny = true;
      if (result < Number(minimum[1])) return 1;
    }
  }
  return parsedAny ? 0 : 2;
}

function findBestLegacyLabResult(rows, source, sample = {}) {
  const commonName = text(sample.commonName || source?.sampleSnapshots?.[0]?.commonName);
  const requestedBatch = text(sample.batchNo || sample.lotNo);
  const targetDate = normalizeIsoDate(
    source?.externalCoaRequest?.shipmentDate || source?.externalCoaRequest?.saleOrderDate,
  );
  const targetTime = targetDate ? Date.parse(`${targetDate}T00:00:00.000Z`) : Number.NaN;
  let candidates = (rows || []).map((row) => {
    const score = legacyProductMatchScore(commonName, row?.sample_name);
    const productionDate = normalizeIsoDate(row?.production_date);
    const productionTime = productionDate ? Date.parse(`${productionDate}T00:00:00.000Z`) : Number.NaN;
    const hasDates = Number.isFinite(targetTime) && Number.isFinite(productionTime);
    const batchNo = cleanLegacyBatch(row?.batch_no);
    return {
      row,
      batchNo,
      productionDate,
      analysisDate: normalizeIsoDate(row?.test_date || row?.report_date),
      score,
      batchMatch: legacyBatchMatches(requestedBatch, batchNo),
      packingScore: legacyPackingScore(source?.externalCoaRequest?.packingSize, legacyIdentity(row?.sample_name).formulation),
      qualifierScore: legacyQualifierScore(source, batchNo),
      conformanceBucket: legacyTestConformanceBucket(row),
      dateBucket: hasDates ? (productionTime <= targetTime ? 0 : 1) : 2,
      dateDistance: hasDates ? Math.abs(targetTime - productionTime) : Number.POSITIVE_INFINITY,
    };
  }).filter((candidate) => (
    candidate.batchNo && candidate.productionDate && candidate.score >= 0.75
      && legacyRowMatchesTests(candidate.row, commonName)
  ));

  if (requestedBatch) {
    candidates = candidates.filter((candidate) => candidate.batchMatch);
  }
  candidates.sort((left, right) => right.score - left.score
    || right.packingScore - left.packingScore
    || right.qualifierScore - left.qualifierScore
    || left.conformanceBucket - right.conformanceBucket
    || left.dateBucket - right.dateBucket
    || left.dateDistance - right.dateDistance
    || right.analysisDate.localeCompare(left.analysisDate));
  const best = candidates[0];
  if (!best) return null;
  return {
    ...best,
    matchKind: requestedBatch ? 'exactBatch' : 'productHistory',
    candidates: candidates.slice(0, 10),
  };
}

function densityValueFromLegacyTest(result) {
  return text(result).replace(/\s*g\s*\/\s*cm(?:ยณ|³|3).*$/i, '').trim();
}

function resultRowsFromLegacyLab(row, commonName) {
  if (!row) return { rows: [], density: '', analysisDate: '' };
  const tests = Array.isArray(row.tests) ? row.tests : [];
  const densityTest = tests.find((test) => /density/i.test(text(test?.test_name)));
  const activeTests = tests.filter((test) => !/(?:density|appearance)/i.test(text(test?.test_name)));
  const joinActive = (key) => activeTests.map((test) => {
    const value = text(test?.[key]);
    if (!value) return '';
    return activeTests.length > 1 ? `${text(test?.test_name)}: ${value}` : value;
  }).filter(Boolean).join(' / ');
  const density = densityValueFromLegacyTest(densityTest?.result) || '-';
  const analysisDate = normalizeIsoDate(row.test_date || row.report_date);
  const rows = [
    {
      testItem: 'Appearance', criteria: text(row.sample_condition) || '-', result: 'Conform', method: 'Visual', unit: '',
    },
    {
      testItem: '%AI content',
      criteria: joinActive('criteria') || aiToleranceCriteriaForCommonName(commonName) || '-',
      result: joinActive('result') || '-',
      method: joinActive('method'),
      unit: '%',
    },
    {
      testItem: 'Density at 30°C (g/cm³)', criteria: '-', result: density, unit: 'g/cm³', method: densityTest?.method || 'DMA 501',
    },
    {
      testItem: 'Date of analysis', criteria: '-', result: analysisDate || '-', unit: '', method: '',
    },
  ];
  return { rows, density, analysisDate };
}

function resultRowKind(row) {
  if (/^appearance$/i.test(text(row?.testItem))) return 'appearance';
  if (isAiContentTestItem(row?.testItem)) return 'ai';
  if (/density/i.test(text(row?.testItem))) return 'density';
  if (/date\s*of\s*analysis/i.test(text(row?.testItem))) return 'analysisDate';
  return normalizeText(row?.testItem);
}

function mergeResultRows(primaryRows, fallbackRows) {
  const rows = [...(primaryRows || [])];
  for (const row of fallbackRows || []) {
    const kind = resultRowKind(row);
    const existing = rows.find((candidate) => resultRowKind(candidate) === kind);
    if (!existing) {
      rows.push(row);
      continue;
    }
    for (const field of ['criteria', 'result', 'method', 'unit']) {
      if ((!text(existing[field]) || text(existing[field]) === '-') && text(row[field])) {
        existing[field] = row[field];
      }
    }
  }
  return rows;
}

function sampleFromSources(source, stockRows, mfRows, petitionItem = null) {
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
  const mfCandidates = mfRows.filter((row) => {
    return normalizedItemNo
      ? rowMatchesItem(row, normalizedItemNo)
      : normalizeText(row.common_name || row.commonName) === normalizeText(commonName);
  }).filter((row) => batchFromRow(row));
  const mf = mfCandidates[0];
  const sourceSample = source?.sampleSnapshots?.[0] || {};
  const requestedBatch = text(sourceSample.batchNo || petitionItem?.batchNo);
  const requestedLot = text(sourceSample.lotNo || petitionItem?.lotNo);
  const sourceBatch = requestedBatch || requestedLot;
  const requestedProductionDate = normalizeIsoDate(sourceSample.productionDate || petitionItem?.productionDate);
  const mfBatch = batchFromRow(mf);
  const mfDate = productionDateFromRow(mf);
  const matchingStock = stockCandidates.find((row) => {
    const snapshot = lotSnapshot(lotFromRow(row), productionDateFromRow(row));
    return (requestedLot && normalizeBatch(snapshot.lotNo) === normalizeBatch(requestedLot))
      || (requestedBatch && normalizeBatch(snapshot.batchNo) === normalizeBatch(requestedBatch));
  });
  const newestFgStock = stockCandidates.find((row) => isFgLotDescription(lotFromRow(row)));
  const stock = newestFgStock || matchingStock || stockCandidates[0];
  const newestFgLot = newestFgStock
    ? lotSnapshot(lotFromRow(newestFgStock), productionDateFromRow(newestFgStock))
    : null;
  const matchingStockLot = matchingStock
    ? lotSnapshot(lotFromRow(matchingStock), productionDateFromRow(matchingStock))
    : null;
  const sourceLot = sourceBatch ? lotSnapshot(requestedLot || sourceBatch) : null;
  const sourceBatchDate = requestedBatch ? lotSnapshot(requestedBatch).productionDate : '';
  const lot = sourceLot
    ? {
      lotNo: requestedLot || matchingStockLot?.lotNo || sourceLot.lotNo,
      batchNo: requestedBatch || sourceLot.batchNo,
      productionDate: newestFgLot?.productionDate || matchingStockLot?.productionDate
        || requestedProductionDate || sourceLot.productionDate || sourceBatchDate,
    }
    : stock
      ? lotSnapshot(lotFromRow(stock), productionDateFromRow(stock))
      : mfBatch
        ? lotSnapshot(mfBatch, mfDate)
        : { lotNo: '', batchNo: '', productionDate: '' };
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
      batchNo: lotSnapshot(lotFromRow(row), productionDateFromRow(row)).batchNo,
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
  const formulation = value.match(/\b([A-Z]{2,3})$/)?.[1] || '';
  if (/^BROMADIOLONE\s+0\.005%(?:\s|$)/.test(value)) return 'bromadiolone0005';
  if (GR_WP_SP_FORMULATIONS.has(formulation)) return 'grWpSp';
  if (/\b(SL|EC|EW|SC|ME|ZC)$/.test(value)) return 'liquid';
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
  cleanLegacyBatch,
  densityForBatch,
  fetchErpReferences,
  findBestCoaHistorySample,
  findBestLabItem,
  findBestLegacyLabResult,
  findBestRequestItem,
  formKindForCommonName,
  legacyProductMatchScore,
  lotSnapshot,
  mergeResultRows,
  normalizeIsoDate,
  normalizeText,
  physicalFromQc,
  resultRowsFromLegacyLab,
  resultRowsFromQc,
  rowsFromPayload,
  sampleFromSources,
  batchFromRow,
};
