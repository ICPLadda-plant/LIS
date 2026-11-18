// Centralized document-number generation driven by DocumentNumberConfig.
// next*No() functions in routes call nextDocumentNumber(); when no config row
// exists the DEFAULTS below reproduce the original hardcoded formats exactly.

const DEFAULTS = {
  petition:      { docType: 'petition',      prefix: 'P',   yearFormat: 'yy',   includeMonth: true,  seqPadding: 4, separator: '-' },
  sampleReceipt: { docType: 'sampleReceipt', prefix: 'RCV', yearFormat: 'yyyy', includeMonth: false, seqPadding: 4, separator: '-' },
  labRequest:    { docType: 'labRequest',    prefix: 'L',   yearFormat: 'yy',   includeMonth: true,  seqPadding: 4, separator: '-' },
  // ฟอร์ม F-WAR-03-01,02 — ใบรับสินค้า / ใบตรวจสอบวัตถุดิบ ของแผนก RM
  goodsReceipt:  { docType: 'goodsReceipt',  prefix: 'GR',  yearFormat: 'yy',   includeMonth: true,  seqPadding: 4, separator: '-' },
  rawMaterialInspection: { docType: 'rawMaterialInspection', prefix: 'RMI', yearFormat: 'yy', includeMonth: true, seqPadding: 4, separator: '-' },
};

const DOC_TYPES = Object.keys(DEFAULTS);
// เลขคำร้องเฉพาะ Admin — ลำดับแยกจากคำร้องปกติ ไม่เปิดให้ตั้งค่าในหน้า config
const HIDDEN_DEFAULTS = {
  adminPetition: { docType: 'adminPetition', prefix: 'PA', yearFormat: 'yy', includeMonth: true, seqPadding: 4, separator: '-' },
};
const YEAR_FORMATS = ['none', 'yy', 'yyyy'];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build the non-sequence portion of the number (the part used to scan for the
// last issued number). Sequence is appended by the caller.
function buildScanPrefix(cfg, now) {
  const sep = cfg.separator == null ? '' : String(cfg.separator);
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');

  let datePart = '';
  if (cfg.yearFormat === 'yyyy') datePart += yyyy;
  else if (cfg.yearFormat === 'yy') datePart += yy;
  if (cfg.includeMonth) datePart += mm;

  const segments = [];
  if (cfg.prefix) segments.push(cfg.prefix);
  if (datePart) segments.push(datePart);
  let prefix = segments.join(sep);
  if (segments.length > 0) prefix += sep; // trailing separator before sequence
  return prefix;
}

// Returns an error string (Thai) or null. Mirrors validateDocNumberConfig in
// src/lib/documentNumberConfig.ts — keep the two in sync.
function validateDocNumberConfig(input) {
  if (typeof input.prefix !== 'string') return 'prefix ต้องเป็นข้อความ';
  if (!YEAR_FORMATS.includes(input.yearFormat)) return 'yearFormat ไม่ถูกต้อง';
  if (typeof input.includeMonth !== 'boolean') return 'includeMonth ต้องเป็น boolean';
  if (typeof input.separator !== 'string' || input.separator.length > 3) return 'ตัวคั่นต้องเป็นข้อความไม่เกิน 3 ตัว';
  if (!Number.isInteger(input.seqPadding) || input.seqPadding < 1 || input.seqPadding > 10) return 'จำนวนหลัก running ต้องเป็นจำนวนเต็ม 1–10';
  const hasPrefix = input.prefix.trim().length > 0;
  const hasYear = input.yearFormat !== 'none';
  if (!hasPrefix && !hasYear) return 'ต้องมี prefix หรือปี อย่างน้อย 1 อย่าง (กันเลขเดินผิด)';
  if (input.yearFormat === 'none' && input.includeMonth) {
    return 'ถ้าใส่เดือน ต้องเลือกปีด้วย (กันเลขชนข้ามปี)';
  }
  return null;
}

// docType: 'petition'|'sampleReceipt'|'labRequest'; Model: the Mongoose model;
// numField: the document's number field name (e.g. 'petitionNo').
// ASSUMES the running sequence stays within seqPadding digits (seq < 10^seqPadding).
// The last-number lookup relies on lexicographic string sort, so an overflow past
// the padding width (e.g. 9999 -> 10000 at padding 4) would mis-order and could
// reissue a number. Padding is admin-configurable (1-10); pick a width with headroom.
async function nextDocumentNumber(docType, Model, numField) {
  const DocumentNumberConfig = require('../models/DocumentNumberConfig');
  const saved = await DocumentNumberConfig.findOne({ docType }).lean();
  const cfg = saved || DEFAULTS[docType] || HIDDEN_DEFAULTS[docType];
  const now = new Date();
  const scanPrefix = buildScanPrefix(cfg, now);
  const last = await Model.findOne({ [numField]: new RegExp(`^${escapeRegex(scanPrefix)}`) })
    .sort({ [numField]: -1 })
    .lean();
  const nextSeq = last ? Number(last[numField].slice(scanPrefix.length)) + 1 : 1;
  return `${scanPrefix}${String(nextSeq).padStart(cfg.seqPadding, '0')}`;
}

module.exports = {
  DEFAULTS,
  DOC_TYPES,
  YEAR_FORMATS,
  escapeRegex,
  buildScanPrefix,
  validateDocNumberConfig,
  nextDocumentNumber,
};
