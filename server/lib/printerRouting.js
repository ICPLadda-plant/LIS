// Pure routing + validation for the printer registry.
// Mirror of the client copy in src/lib/printConfig.ts — keep the map and the
// URL validation rules identical.

const PRINTER_KINDS = ['a4', 'sticker'];
const PAPER_SIZES = ['A4', 'label-100x50', 'label-65x25'];
const URL_PROTOCOLS = ['http:', 'https:', 'ipp:', 'ipps:'];
const HOST_WITH_OPTIONAL_PORT = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

// Which physical printer kind each document type prints to.
const DOC_TYPE_KIND = {
  'sample-label': 'sticker',
  'stock-label': 'sticker',
  'coa': 'a4',
  'service-request': 'a4',
  'daily-check-report': 'a4',
  'goods-receipt': 'a4',
};

const PRINT_DOC_TYPES = Object.keys(DOC_TYPE_KIND);

function kindForDocType(docType) {
  return DOC_TYPE_KIND[docType] || null;
}

// Media/paper size defaults by document type; printer assignments can override it.
function paperSizeForSlug(slug) {
  if (slug === 'sample-label') return 'label-100x50';
  if (slug === 'stock-label') return 'label-65x25';
  return 'A4';
}

function hasUrlProtocol(raw) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw);
}

function normalizePrinterAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (hasUrlProtocol(raw)) return raw;
  if (!HOST_WITH_OPTIONAL_PORT.test(raw)) throw new Error('Printer IP / URL ไม่ถูกต้อง');
  const parsed = new URL(`ipp://${raw}`);
  if (!parsed.port) parsed.port = '631';
  parsed.pathname = '/ipp/print';
  return parsed.toString();
}

function printerTargetFromAddress(value) {
  const raw = String(value || '').trim();
  const normalized = normalizePrinterAddress(raw);
  const url = new URL(normalized);
  const parts = url.pathname.split('/').filter(Boolean);
  const qi = parts.findIndex((p) => p === 'printers' || p === 'classes');
  const hasQueue = qi >= 0 && parts[qi + 1];
  const protocol = url.protocol === 'https:' ? 'ipps:' : url.protocol === 'http:' ? 'ipp:' : url.protocol;
  return { printerUri: `${protocol}//${url.host}${url.pathname}`, display: raw || normalized, isDirect: !hasQueue };
}

// Returns an error string, or null when valid.
function validatePrinterInput(input, opts) {
  const requireUrl = !opts || opts.requireUrl !== false;
  const { kind, cupsPrinterUrl } = input || {};
  if (!PRINTER_KINDS.includes(kind)) return 'kind ต้องเป็น a4 หรือ sticker';
  const raw = typeof cupsPrinterUrl === 'string' ? cupsPrinterUrl.trim() : '';
  if (!raw) return requireUrl ? 'ต้องระบุ Printer IP / URL' : null;
  let url;
  try {
    url = new URL(normalizePrinterAddress(raw));
  } catch (_) {
    return 'Printer IP / URL ไม่ถูกต้อง';
  }
  if (!URL_PROTOCOLS.includes(url.protocol)) {
    return 'Printer IP / URL ต้องเป็น IP เครื่องปริ้น, http, https, ipp หรือ ipps';
  }
  return null;
}

// Pure: the printer explicitly marked as default. New registry flow no longer
// creates one automatically; users choose the print source at print time.
function pickDefault(configs, kind) {
  const ofKind = (configs || []).filter((c) => c.kind === kind);
  return ofKind.find((c) => c.isDefault) || null;
}

function normalizeDepartment(value) {
  // "ผลิต 03" and "ผลิต 3" are the same department: HR data zero-pads, printer assignments do not.
  const raw = String(value || '').trim().replace(/\s+/g, ' ').replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ''));
  if (!raw || raw === 'all' || raw === 'ทุกแผนก') return '';
  return raw;
}

function normalizePrinterAssignmentsInput(input, kind) {
  const assignments = Array.isArray(input?.assignments) ? input.assignments : [];
  const normalized = [];

  for (const assignment of assignments) {
    const paperSize = String(assignment?.paperSize || '').trim() || 'A4';
    if (!PAPER_SIZES.includes(paperSize)) return { error: 'paperSize ไม่ถูกต้อง' };

    const docTypes = [];
    const rawDocTypes = Array.isArray(assignment?.docTypes) ? assignment.docTypes : [];
    for (const rawDocType of rawDocTypes) {
      const docType = String(rawDocType || '').trim();
      if (!PRINT_DOC_TYPES.includes(docType)) return { error: 'เอกสารไม่ถูกต้อง' };
      if (kindForDocType(docType) !== kind) return { error: 'เอกสารไม่ตรงกับประเภทเครื่องพิมพ์' };
      if (!docTypes.includes(docType)) docTypes.push(docType);
    }

    if (docTypes.length === 0) {
      if (assignment?.department || assignment?.paperSize) return { error: 'ต้องเลือกเอกสารอย่างน้อย 1 รายการ' };
      continue;
    }

    normalized.push({
      department: normalizeDepartment(assignment?.department),
      docTypes,
      paperSize,
    });
  }

  return { assignments: normalized };
}

function pickPrinterAssignmentRoute(configs, docType, department) {
  const kind = kindForDocType(docType);
  if (!kind) return null;

  const normalizedDepartment = normalizeDepartment(department);
  const candidates = [];
  for (const printerConfig of configs || []) {
    if (!printerConfig || printerConfig.kind !== kind) continue;
    for (const assignment of printerConfig.assignments || []) {
      const assignmentDepartment = normalizeDepartment(assignment?.department);
      const docTypes = Array.isArray(assignment?.docTypes) ? assignment.docTypes : [];
      if (!docTypes.includes(docType)) continue;
      if (assignmentDepartment !== normalizedDepartment && assignmentDepartment !== '') continue;
      candidates.push({
        printerConfig,
        assignment: {
          department: assignmentDepartment,
          docTypes,
          paperSize: PAPER_SIZES.includes(assignment?.paperSize) ? assignment.paperSize : paperSizeForSlug(docType),
        },
        exact: assignmentDepartment === normalizedDepartment,
      });
    }
  }

  const exactCandidates = candidates.filter((candidate) => candidate.exact);
  const usable = exactCandidates.length ? exactCandidates : candidates.filter((candidate) => !candidate.assignment.department);
  if (!usable.length) return null;
  const picked = usable[0];
  return {
    printerConfig: picked.printerConfig,
    assignment: picked.assignment,
    paperSize: picked.assignment.paperSize,
  };
}

module.exports = {
  PRINTER_KINDS,
  PAPER_SIZES,
  DOC_TYPE_KIND,
  PRINT_DOC_TYPES,
  kindForDocType,
  paperSizeForSlug,
  normalizeDepartment,
  normalizePrinterAssignmentsInput,
  pickPrinterAssignmentRoute,
  normalizePrinterAddress,
  printerTargetFromAddress,
  validatePrinterInput,
  pickDefault,
};
