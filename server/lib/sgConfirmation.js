// กฎ "รอยืนยันค่า ถพ." ของตัวอย่างกลุ่มน้ำ — mirror ของ src/lib/sgConfirmation.ts
// Pure functions: ไม่แตะ DB
const {
  defaultSendItemToLab,
  hasProductionSendTargets,
  isMandatoryLabProduct,
  isResearchAndDevelopmentDepartment,
  requiresQcTrack,
  shouldSendItemToQc,
} = require('./petitionSubmissionRules');

const SG_PENDING_LABEL = 'รอยืนยันค่า ถพ.';
const SG_VALUE_LABEL = 'ค่าถพ.';
const SG_TEMP_LABEL = 'อุณหภูมิ';
const FORM_ENTRY_INDEX_KEY = '__formEntryIndex';

// mirror ของ classificationTypes ใน src/lib/productClassification.ts
const CLASSIFICATION_GROUPS = {
  SG: 'sand', ULV: 'water', EC: 'water', EW: 'water', SC: 'water', SL: 'water', ME: 'water', ZC: 'water',
  'W/V': 'water', 'W/W': 'sand', WP: 'powder', WDG: 'powder', WG: 'powder', GR: 'sand', ST: 'sand', GB: 'sand',
  SP: 'powder', DS: 'powder', DP: 'powder',
};
// W/V และ W/W เป็นหน่วยความเข้มข้นเมื่ออยู่ในชื่อสามัญ (เหมือน getCommonName)
const COMMON_NAME_CODES = Object.keys(CLASSIFICATION_GROUPS)
  .filter((code) => code !== 'W/V' && code !== 'W/W')
  .sort((a, b) => b.length - a.length);

function formulationCodeFromCommonName(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/(^|[^A-Z0-9])SAND\s+GRANULE([^A-Z0-9]|$)/.test(raw.toUpperCase())) return 'SG';
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  if (COMMON_NAME_CODES.includes(compact)) return compact;
  const tokens = raw.replace(/\s*\([^)]*\)\s*$/g, '').trim().toUpperCase().split(/[\s,;|]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const cleaned = tokens[i].replace(/^[^A-Z0-9/]+|[^A-Z0-9/]+$/g, '');
    if (cleaned && COMMON_NAME_CODES.includes(cleaned)) return cleaned;
  }
  return '';
}

function isWaterFormulationItem(item) {
  if (!item) return false;
  const formulation = String(item.formulation ?? '').trim().toUpperCase().replace(/[\s_-]/g, '');
  if (formulation && CLASSIFICATION_GROUPS[formulation]) return CLASSIFICATION_GROUPS[formulation] === 'water';
  return CLASSIFICATION_GROUPS[formulationCodeFromCommonName(item.commonName)] === 'water';
}

function shouldSendItemToLab(item) {
  if (!item) return false;
  if (hasProductionSendTargets(item) && typeof item.sendToLab === 'boolean') return item.sendToLab;
  if (isMandatoryLabProduct(item)) return true;
  return typeof item.sendToLab === 'boolean' ? item.sendToLab : defaultSendItemToLab(item);
}

function itemNeedsSgConfirmation(item) {
  return Boolean(item) && isWaterFormulationItem(item) && shouldSendItemToLab(item) && shouldSendItemToQc(item);
}

function itemAwaitingSgConfirmation(item) {
  return itemNeedsSgConfirmation(item) && !item.sgConfirmedAt;
}

function labTrackStarted(petition) {
  const legacyReceived = !petition.labReceivedAt && !petition.qcReceivedAt && Boolean(petition.receivedAt);
  return Boolean(petition.labReceivedAt || legacyReceived || petition.labCompletedAt || petition.labApprovedAt || petition.assignedTo?.employeeId || petition.assignedTo?.name);
}

function isLabAwaitingSgConfirmation(petition) {
  if (!petition || !Array.isArray(petition.items)) return false;
  if (isResearchAndDevelopmentDepartment(petition.submittedBy?.department) || !requiresQcTrack(petition)) return false;
  if (labTrackStarted(petition)) return false;
  return petition.items.some((item) => itemAwaitingSgConfirmation(item));
}

function isFilled(value) {
  return value != null && String(value).trim() !== '';
}

function isSgValueKey(key) {
  return key === SG_VALUE_LABEL || key.startsWith(`${SG_VALUE_LABEL} —`) || (key.startsWith(`${SG_VALUE_LABEL}::`) && !key.endsWith('__source'));
}

function isSgParameter(parameter) {
  return (parameter?.valueFields ?? []).some((field) => isSgValueKey(String(field.label ?? '').trim()));
}

/** อ่านค่า ถพ. + อุณหภูมิจากผล QC ของพารามิเตอร์ "ค่า ถพ." (รองรับ multiEntry) */
function readSgReading(result) {
  if (!result) return { value: '', temperature: '' };
  const entries = Array.isArray(result.entries) ? result.entries : [];
  let row = result.values || {};
  if (entries.length) {
    let idx = Number(result.values?.[FORM_ENTRY_INDEX_KEY] ?? 0);
    if (!Number.isFinite(idx) || idx < 0 || idx >= entries.length) idx = 0;
    row = entries[idx] || {};
  }
  const valueKey = Object.keys(row).find((key) => isSgValueKey(key) && isFilled(row[key]));
  return {
    value: valueKey ? String(row[valueKey]).trim() : '',
    temperature: isFilled(row[SG_TEMP_LABEL]) ? String(row[SG_TEMP_LABEL]).trim() : '',
  };
}

module.exports = {
  SG_PENDING_LABEL,
  SG_VALUE_LABEL,
  SG_TEMP_LABEL,
  isWaterFormulationItem,
  itemNeedsSgConfirmation,
  itemAwaitingSgConfirmation,
  isLabAwaitingSgConfirmation,
  isSgParameter,
  readSgReading,
};
