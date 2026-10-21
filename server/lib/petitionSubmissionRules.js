function isResearchAndDevelopmentDepartment(department) {
  return String(department || '').replace(/\s+/g, '').toLowerCase() === 'r&d';
}

function requiresDeliveryAndBatch(body) {
  return !isResearchAndDevelopmentDepartment(body?.submittedBy?.department);
}

function requiresQcTrack(petition) {
  if (Array.isArray(petition?.routeTargets) && petition.routeTargets.length) return petition.routeTargets.includes('qc');
  return !isResearchAndDevelopmentDepartment(petition?.submittedBy?.department);
}

function isLabBatchNo(batchNo) {
  return /[16]$/.test(String(batchNo ?? '').trim());
}

const RODENTICIDE_PATTERNS = [
  /BROMADIOLONE/i,
  /BRODIFACOUM/i,
  /DIFENACOUM/i,
  /DIFETHIALONE/i,
  /COUMATETRALYL/i,
  /CHLOROPHACINONE/i,
  /FLOCOUMAFEN/i,
  /ZINC\s+PHOSPHIDE/i,
  /RODENTICIDE/i,
  /RAT\s+BAIT/i,
  /ยาหนู/,
  /กำจัดหนู/,
];

function isMandatoryLabProduct(item) {
  const normalized = [item?.sampleName, item?.commonName]
    .map((value) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase())
    .join(' ');
  return normalized.includes('PUBLIC HEALTH') || normalized.includes('LIVE STOCK') || RODENTICIDE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function defaultSendItemToLab(item) {
  return isMandatoryLabProduct(item) || isLabBatchNo(item?.batchNo);
}

function hasSendToLabOverride(item) {
  if (!item || typeof item.sendToLab !== 'boolean') return false;
  if (isMandatoryLabProduct(item)) return false;
  return item.sendToLab !== defaultSendItemToLab(item);
}

function normalizeProductionCommonName(value) {
  const raw = String(value ?? '').trim();
  if (!raw.includes('+')) return raw;

  const segments = raw.split('+').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 3) return raw;

  const concentrationPattern = /\b\d+(?:[.,]\d+)?\s*%(?:\s*(?:w\/w|w\/v|v\/v))?/i;
  const firstConcentrationIndex = segments.findIndex((segment) => concentrationPattern.test(segment));
  if (firstConcentrationIndex <= 0) return raw;

  const names = segments.slice(0, firstConcentrationIndex);
  const concentrations = [];
  let formulation = '';

  for (let index = firstConcentrationIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    const match = segment.match(concentrationPattern);
    if (!match || match.index == null) return raw;

    const before = segment.slice(0, match.index).trim();
    const after = segment.slice(match.index + match[0].length).trim();

    if (index === firstConcentrationIndex) {
      if (!before) return raw;
      names.push(before);
    } else if (before) {
      return raw;
    }

    concentrations.push(match[0].replace(/\s+%/, '%').replace(/\s+/g, ' ').trim());
    if (after) {
      if (index !== segments.length - 1) return raw;
      formulation = after;
    }
  }

  if (names.length !== concentrations.length || names.some((name) => !name)) return raw;
  const normalized = names.map((name, index) => `${name} ${concentrations[index]}`).join(' + ');
  return formulation ? `${normalized} ${formulation}` : normalized;
}

function labSendOverrideNoteError(items) {
  const missing = (items || []).find((item) => hasSendToLabOverride(item) && !String(item.note ?? '').trim());
  if (!missing) return null;
  const label = missing.seq ? `ลำดับ ${missing.seq}` : missing.sampleName || String(missing.batchNo ?? '').trim() || 'นี้';
  return `ตัวอย่าง${label}: โปรดระบุเหตุผล`;
}

function normalizeSampleQuantity(value) {
  if (value == null || value === '') return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return value;
  return parsed;
}

function normalizePetitionItems(items, { department, petitionNo } = {}) {
  const isResearchRequest = isResearchAndDevelopmentDepartment(department);
  return (items || []).map((item) => {
    const commonNamePatch = item.commonName == null
      ? {}
      : { commonName: normalizeProductionCommonName(item.commonName) };
    const normalizedItem = {
      ...item,
      ...commonNamePatch,
      sampleQuantity: normalizeSampleQuantity(item.sampleQuantity),
      submissionNo: String(item.submissionNo ?? '').trim() || petitionNo,
    };
    return {
      ...normalizedItem,
      sendToLab: isResearchRequest || isMandatoryLabProduct(normalizedItem)
        ? true
        : (typeof item.sendToLab === 'boolean' ? item.sendToLab : defaultSendItemToLab(normalizedItem)),
    };
  });
}

function validatePetitionSubmission(body) {
  if (!body.dept || !['production', 'rm', 'fg'].includes(body.dept)) {
    return 'กรุณาระบุแผนก (production / rm / fg)';
  }
  if (!body.submittedBy?.name) {
    return 'กรุณาระบุผู้ยื่นคำขอ';
  }
  if (body.routeTargets != null) {
    const targets = Array.isArray(body.routeTargets) ? body.routeTargets : [];
    if (!targets.length || targets.some((target) => !['qc', 'lab'].includes(target))) {
      return 'กรุณาเลือกปลายทางส่งตรวจ QC, LAB หรือทั้ง 2';
    }
  }
  const needsDeliveryAndBatch = requiresDeliveryAndBatch(body);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return 'ต้องมีตัวอย่างอย่างน้อย 1 รายการ';
  }
  if (needsDeliveryAndBatch) {
    for (const item of body.items) {
      const batch = String(item.batchNo || '').trim();
      if (!batch) return `ตัวอย่าง "${item.sampleName || item.seq}": กรุณากรอกเลขแบช`;
    }
  }
  for (const item of body.items) {
    const quantity = item.sampleQuantity == null || item.sampleQuantity === '' ? 1 : Number(item.sampleQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return `ตัวอย่าง "${item.sampleName || item.seq}": กรุณากรอกจำนวนตัวอย่างเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป`;
    }
  }
  const overrideNoteError = labSendOverrideNoteError(body.items);
  if (overrideNoteError) return overrideNoteError;
  return null;
}

module.exports = {
  defaultSendItemToLab,
  hasSendToLabOverride,
  isMandatoryLabProduct,
  isResearchAndDevelopmentDepartment,
  isLabBatchNo,
  labSendOverrideNoteError,
  normalizeProductionCommonName,
  normalizePetitionItems,
  requiresDeliveryAndBatch,
  requiresQcTrack,
  validatePetitionSubmission,
};
