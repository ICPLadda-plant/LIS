const express = require('express');
const mongoose = require('mongoose');
const CoaDocument = require('../models/CoaDocument');
const CoaAuditLog = require('../models/CoaAuditLog');
const Petition = require('../models/Petition');
const LabRequest = require('../models/LabRequest');
const QCTestResult = require('../models/QCTestResult');
const ResultDensity = require('../models/ResultDensity');
const Parameter = require('../models/Parameter');
const User = require('../models/User');
const Role = require('../models/Role');
const { nextCoaNumber } = require('../lib/coaNumber');
const { manualCoaSnapshots, validateManualCoa } = require('../lib/coaManual');
const { aiToleranceCriteriaForCommonName, isAiContentTestItem } = require('../lib/aiToleranceCriteria');
const { buildCoaFormOptions, buildCoaParameterOptions, applyCoaFormSelections } = require('../lib/coaForm');
const {
  densityForBatch,
  fetchErpReferences,
  findBestLabItem,
  formKindForCommonName,
  resultRowsFromQc,
  sampleFromSources,
} = require('../lib/coaErp');
const { normalizeRoles, primaryRole, unionPermissions } = require('../lib/roles');
const { mergeBaseRolesForFamilies } = require('../lib/roleFamilies');
const {
  actorFromBody,
  applyCoaLifecycleAction,
  applySupersession,
  assertCanTransition,
  buildCoaSnapshots,
  isQcHead,
  selectedItemsFromPetition,
  writeCoaAuditEvent,
} = require('../lib/coaLifecycle');

const router = express.Router();

const DEFAULT_COA_REQUESTS_WEBHOOK_URL = 'https://n8n-plant.icpladda.com/webhook/API/COA';
const COA_REQUESTS_WEBHOOK_URL = process.env.COA_REQUESTS_WEBHOOK_URL || DEFAULT_COA_REQUESTS_WEBHOOK_URL;
const COA_REQUESTS_WEBHOOK_TIMEOUT_MS = Number(process.env.COA_REQUESTS_WEBHOOK_TIMEOUT_MS || 8000);
const EXTERNAL_COA_STATUS = 'requested';

function objectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Invalid id');
  return new mongoose.Types.ObjectId(id);
}

function errorWithStatus(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function errorStatus(error) {
  if (error.status) return error.status;
  return error.message.startsWith('QC Head required') ? 403 : 400;
}

function manualText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function manualPercent(value) {
  const match = manualText(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildManualSnapshots(petition, selectedItemSeqs, body = {}) {
  const selectedItems = selectedItemsFromPetition(petition, selectedItemSeqs);
  const selectedSeqs = selectedItems.map((item) => Number(item.seq));
  const selectedSet = new Set(selectedSeqs);
  const samples = Array.isArray(body.sampleSnapshots) ? body.sampleSnapshots : [];
  if (samples.length !== selectedSeqs.length) throw errorWithStatus('กรุณากรอกข้อมูลตัวอย่างให้ครบทุกตัวอย่าง', 400);

  const sampleBySeq = new Map();
  for (const sample of samples) {
    const itemSeq = Number(sample?.itemSeq);
    if (!selectedSet.has(itemSeq) || sampleBySeq.has(itemSeq)) {
      throw errorWithStatus('ข้อมูลตัวอย่างไม่ตรงกับรายการที่เลือก', 400);
    }
    const normalized = {
      itemSeq,
      sampleName: manualText(sample.sampleName),
      commonName: manualText(sample.commonName),
      batchNo: manualText(sample.batchNo),
      lotNo: manualText(sample.lotNo),
      productionDate: manualText(sample.productionDate),
      sampleId: manualText(sample.sampleId),
      condition: manualText(sample.condition),
      manufacturer: manualText(sample.manufacturer),
    };
    if (!normalized.sampleName || !normalized.commonName || !normalized.batchNo || !normalized.productionDate) {
      throw errorWithStatus('กรุณากรอกชื่อตัวอย่าง ชื่อสามัญ Batch No. และวันที่ผลิตให้ครบ', 400);
    }
    sampleBySeq.set(itemSeq, normalized);
  }
  if (sampleBySeq.size !== selectedSeqs.length) throw errorWithStatus('กรุณากรอกข้อมูลตัวอย่างให้ครบทุกตัวอย่าง', 400);

  const results = Array.isArray(body.resultSnapshots) ? body.resultSnapshots : [];
  if (!results.length) throw errorWithStatus('กรุณากรอกผลทดสอบอย่างน้อยหนึ่งรายการ', 400);
  const resultSnapshots = results.map((row) => {
    const itemSeq = Number(row?.itemSeq);
    const normalized = {
      itemSeq,
      testItem: manualText(row?.testItem),
      result: manualText(row?.result),
      criteria: manualText(row?.criteria),
      method: manualText(row?.method),
      unit: manualText(row?.unit),
    };
    if (!selectedSet.has(itemSeq) || !normalized.testItem || !normalized.result) {
      throw errorWithStatus('รายการผลทดสอบไม่ถูกต้องหรือกรอกไม่ครบ', 400);
    }
    return normalized;
  });
  for (const itemSeq of selectedSeqs) {
    if (!resultSnapshots.some((row) => row.itemSeq === itemSeq)) {
      throw errorWithStatus('กรุณากรอกผลทดสอบให้ครบทุกตัวอย่าง', 400);
    }
  }

  const sampleSnapshots = selectedSeqs.map((itemSeq) => sampleBySeq.get(itemSeq));
  const trendSnapshots = sampleSnapshots.map((sample) => {
    const ai = resultSnapshots.find((row) => row.itemSeq === sample.itemSeq && isAiContentTestItem(row.testItem));
    return {
      itemSeq: sample.itemSeq,
      sampleName: sample.sampleName,
      commonName: sample.commonName,
      aiResultText: ai?.result || '',
      aiResultPercent: manualPercent(ai?.result),
    };
  });
  return { sampleSnapshots, resultSnapshots, trendSnapshots };
}

function externalCoaLink(body = {}) {
  const saleOrderNo = manualText(body.externalCoaRequest?.saleOrderNo);
  if (!saleOrderNo) return undefined;
  return {
    saleOrderNo,
    line: Number(body.externalCoaRequest.line) || undefined,
    itemNo: manualText(body.externalCoaRequest.itemNo),
  };
}

function externalCoaKey(link) {
  return `${link?.saleOrderNo || ''}:${link?.line ?? ''}`;
}

async function assertExternalCoaRequest(link) {
  if (!link) return;
  const rows = await fetchExternalCoaDocuments();
  if (!rows.some((row) => externalCoaKey(row.externalCoaRequest) === externalCoaKey(link))) {
    throw errorWithStatus('ไม่พบคำขอ COA จาก ERP', 404);
  }
}

function manualCustomerSnapshot(body = {}) {
  return Object.fromEntries(
    ['name', 'company', 'department', 'email', 'phone']
      .map((key) => [key, manualText(body.customerSnapshot?.[key])]),
  );
}

function normalizeCoaMatchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function coaHistoryKey(commonName, batchNo) {
  const normalizedCommonName = normalizeCoaMatchValue(commonName);
  const normalizedBatchNo = normalizeCoaMatchValue(batchNo);
  return normalizedCommonName && normalizedBatchNo
    ? `${normalizedCommonName}\u0000${normalizedBatchNo}`
    : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactTrimmedRegex(value) {
  return new RegExp(`^\\s*${escapeRegex(value)}\\s*$`, 'i');
}

function commonNameRegex(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  return new RegExp(tokens.map(escapeRegex).join('.*'), 'i');
}

function activeCoaSummary(coa, sample) {
  return {
    coaId: coa._id,
    coaNo: coa.coaNo,
    revision: coa.revision,
    petitionNo: coa.petitionNoSnapshot,
    commonName: sample.commonName,
    batchNo: sample.batchNo,
    productionDate: sample.productionDate,
  };
}

function firstActiveCoaByHistoryKey(coas = []) {
  const activeByHistoryKey = new Map();
  for (const coa of coas) {
    for (const sample of coa.sampleSnapshots || []) {
      const key = coaHistoryKey(sample.commonName, sample.batchNo);
      if (key && !activeByHistoryKey.has(key)) {
        activeByHistoryKey.set(key, activeCoaSummary(coa, sample));
      }
    }
  }
  return activeByHistoryKey;
}

function normalizeExternalPayload(payload) {
  if (typeof payload === 'string') {
    try {
      return normalizeExternalPayload(JSON.parse(payload));
    } catch (_error) {
      return [];
    }
  }
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === 'object');
  if (payload && typeof payload === 'object') {
    for (const key of ['items', 'data', 'rows', 'result']) {
      const rows = normalizeExternalPayload(payload[key]);
      if (rows.length) return rows;
    }
  }
  return [];
}

function firstExternalValue(row, keys) {
  for (const key of keys) {
    const value = row && row[key];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function externalNumber(row, keys) {
  const value = Number(firstExternalValue(row, keys));
  return Number.isFinite(value) ? value : undefined;
}

function externalCoaRemark(row) {
  return firstExternalValue(row, ['remark', 'Remark']);
}

// ponytail: ERP has no appearance field, so read it from the free-text remark; switch to a real field when ERP adds one.
function externalAppearance(remark) {
  return remark.split('/').map((part) => part.trim())
    .filter((part) => /สี|เม็ด|ผง|ของเหลว|เกล็ด|ก้อน/.test(part))
    .join(' ');
}

function isExternalCoaRequest(row) {
  return /\bcoa\b/i.test(externalCoaRemark(row));
}

function externalCoaRequestId(row) {
  return [
    'external-coa-request',
    firstExternalValue(row, ['SaleOrderNo']) || 'no-order',
    firstExternalValue(row, ['Line']) || firstExternalValue(row, ['ItemNo']) || 'no-line',
  ].map((part) => String(part).replace(/[^A-Za-z0-9_-]+/g, '-')).join('-');
}

function externalCoaDate(row) {
  return firstExternalValue(row, ['UpdateDate', 'SaleOrderDate', 'ShipmentDate', 'ActionDate']);
}

function externalCoaRowToDocument(row) {
  const itemSeq = externalNumber(row, ['Line']) || 1;
  const saleOrderNo = firstExternalValue(row, ['SaleOrderNo']);
  const itemNo = firstExternalValue(row, ['ItemNo']);
  const tradeName = firstExternalValue(row, ['TradeName']);
  const commonName = firstExternalValue(row, ['CommonName']);
  const batchNo = firstExternalValue(row, ['BatchNo', 'Batch No.', 'Batch No', 'batch_no', 'Batch', 'LotNo', 'Lot No.', 'Lot']);
  const lotNo = firstExternalValue(row, ['LotNo', 'Lot No.', 'lot_no', 'Lot']);
  const date = externalCoaDate(row);
  const updatedAt = firstExternalValue(row, ['UpdateDate']) || date;
  const sampleSnapshot = {
    itemSeq,
    sampleName: tradeName || itemNo || saleOrderNo,
    commonName,
    sampleId: itemNo,
    condition: firstExternalValue(row, ['PackingSize']),
  };
  if (batchNo) sampleSnapshot.batchNo = batchNo;
  if (lotNo) sampleSnapshot.lotNo = lotNo;
  return {
    _id: externalCoaRequestId(row),
    coaNo: null,
    revision: 0,
    status: EXTERNAL_COA_STATUS,
    petitionId: externalCoaRequestId(row),
    petitionNoSnapshot: saleOrderNo,
    selectedItemSeqs: [itemSeq],
    customerSnapshot: {
      name: firstExternalValue(row, ['CustomerName']),
      company: firstExternalValue(row, ['CompanySource']),
      department: firstExternalValue(row, ['Zone']),
    },
    sampleSnapshots: [sampleSnapshot],
    resultSnapshots: [],
    trendSnapshots: commonName ? [{ itemSeq, sampleName: tradeName || itemNo, commonName }] : [],
    remark: externalCoaRemark(row),
    print: { printCount: 0 },
    createdAt: date,
    updatedAt,
    externalCoaRequest: {
      companySource: firstExternalValue(row, ['CompanySource']),
      saleName: firstExternalValue(row, ['SaleName']),
      saleOrderNo,
      line: itemSeq,
      saleOrderDate: firstExternalValue(row, ['SaleOrderDate']),
      itemNo,
      appearance: externalAppearance(externalCoaRemark(row)),
      packingSize: firstExternalValue(row, ['PackingSize']),
      quantity: externalNumber(row, ['Quantity']),
      outstandingQty: externalNumber(row, ['OutstandingQty']),
      unit: firstExternalValue(row, ['Unit', 'SaleUnit', 'BaseUnit']),
      pendingStatus: firstExternalValue(row, ['PendingStatus']),
      pendingStatusDetail: firstExternalValue(row, ['PendingStatusDetail']),
      shipmentDate: firstExternalValue(row, ['ShipmentDate']),
      remark: externalCoaRemark(row),
    },
  };
}

function externalCoaRowsToDocuments(payload) {
  const seen = new Set();
  const documents = [];
  for (const row of normalizeExternalPayload(payload)) {
    if (!isExternalCoaRequest(row)) continue;
    const doc = externalCoaRowToDocument(row);
    if (seen.has(doc._id)) continue;
    seen.add(doc._id);
    documents.push(doc);
  }
  return documents;
}

async function fetchExternalCoaDocuments() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COA_REQUESTS_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(COA_REQUESTS_WEBHOOK_URL), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = JSON.parse(text);
    if (!response.ok) {
      const error = new Error('COA requests webhook request failed');
      error.status = response.status;
      throw error;
    }
    return externalCoaRowsToDocuments(payload);
  } finally {
    clearTimeout(timeout);
  }
}

function shouldFetchExternalCoaRequests(query = {}) {
  return query.needsApproval !== '1'
    && !query.coaNo
    && (!query.status || query.status === EXTERNAL_COA_STATUS);
}

function filterExternalCoaDocuments(items, query = {}) {
  const petitionNo = String(query.petitionNo || '').trim().toLowerCase();
  if (!petitionNo) return items;
  return items.filter((item) => String(item.petitionNoSnapshot || '').toLowerCase().includes(petitionNo));
}

async function permissionsForRoles(roles) {
  const roleDocs = roles.length ? await Role.find({ id: { $in: roles } }).lean() : [];
  const permissions = unionPermissions(roles, Object.fromEntries(roleDocs.map((role) => [role.id, role.permissions || []])));
  return permissions;
}

const SYNTHETIC_DEV_EMAIL_SUFFIX = '.dev@icpladda.com';
const SYNTHETIC_DEV_ROLE_IDS = [
  'lab-data-config', 'lab-inventory', 'lab-analyze', 'lab-analyst',
  'qc-data-config', 'qc-reviewer', 'lab-config', 'lab-head',
  'qc-staff', 'qc-head', 'viewer', 'admin', 'lab', 'qc',
].sort((a, b) => b.length - a.length);

function syntheticDevRolesFromEmail(email) {
  if (process.env.ALLOW_DEV_STATUS !== 'true') return [];
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.endsWith(SYNTHETIC_DEV_EMAIL_SUFFIX)) return [];
  const roleSlug = normalized.slice(0, -SYNTHETIC_DEV_EMAIL_SUFFIX.length).split('-dept-')[0];
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(roleSlug)) return [];

  const roleIds = [];
  let remaining = roleSlug;
  while (remaining) {
    const roleId = SYNTHETIC_DEV_ROLE_IDS.find((candidate) => (
      remaining === candidate || remaining.startsWith(`${candidate}-`)
    ));
    if (!roleId) return [];
    roleIds.push(roleId);
    remaining = remaining.length === roleId.length ? '' : remaining.slice(roleId.length + 1);
  }
  return mergeBaseRolesForFamilies(roleIds);
}

async function actorFromRequest(body = {}) {
  const requested = body._user || body.actor || {};
  const requestedActor = actorFromBody(body);
  const email = String(requestedActor.email || requested.email || '').trim().toLowerCase();
  if (!email) throw errorWithStatus('COA actor email is required', 400);

  let user = await User.findOne({ email }).lean();
  if (!user) {
    const syntheticRoles = syntheticDevRolesFromEmail(email);
    if (syntheticRoles.length === 0) throw errorWithStatus('COA actor must match an active user', 401);
    user = {
      email,
      name: requestedActor.name || requested.name || email,
      roles: syntheticRoles,
      role: primaryRole(syntheticRoles),
      status: 'active',
    };
  }
  if (user.status && user.status !== 'active') throw errorWithStatus('Inactive users cannot issue COA documents', 403);

  const roles = normalizeRoles(user);
  const requestedRole = String(requested.activeRole || requested.role || '').trim();
  const activeRole = roles.includes(requestedRole) ? requestedRole : primaryRole(roles);
  const permissions = await permissionsForRoles(roles);

  return {
    name: String(user.name || requestedActor.name || email).trim(),
    email,
    role: activeRole,
    activeRole,
    roles,
    permissions,
    position: user.position,
  };
}

async function assertLabApprovedPetition(petitionId) {
  const petition = await Petition.findById(petitionId).lean();
  if (!petition) throw errorWithStatus('ไม่พบคำร้อง', 404);
  if (!petition.labApprovedAt) throw errorWithStatus('คำร้องนี้ยังไม่ได้อนุมัติผล Lab', 400);
  return petition;
}

async function labRequestsForPetitionIds(petitionIds) {
  if (!petitionIds.length) return [];
  return LabRequest.find({ petitionId: { $in: petitionIds } }).lean();
}

function labSeqSet(labRequests = []) {
  const seqs = new Set();
  for (const request of labRequests) {
    if (request.sampleSeq != null) seqs.add(Number(request.sampleSeq));
  }
  return seqs;
}

function groupLabRequestsByPetition(labRequests = []) {
  const byPetition = new Map();
  for (const request of labRequests) {
    const key = String(request.petitionId);
    if (!byPetition.has(key)) byPetition.set(key, []);
    byPetition.get(key).push(request);
  }
  return byPetition;
}

function customerSnapshotFromLabRequests(labRequests = [], petition = {}) {
  const first = labRequests.find((request) => request.reportCustomerName || request.requester) || {};
  const requester = first.requester || {};
  return {
    name: requester.fullName || petition.submittedBy?.name || '',
    company: first.reportCustomerName || '',
    department: requester.department || petition.submittedBy?.department || '',
    email: requester.email || petition.submittedBy?.email || '',
    phone: requester.phone || '',
  };
}

function sampleSnapshotFromPetitionItem(item = {}) {
  return {
    itemSeq: Number(item.seq),
    sampleName: item.sampleName,
    commonName: item.commonName,
    batchNo: item.batchNo,
    lotNo: item.lotNo,
    productionDate: item.productionDate,
    sampleId: item.sampleId || '',
    condition: item.condition || '',
    manufacturer: item.labelManufacturer || '',
  };
}

function coveredSeqsByPetition(coas = []) {
  const covered = new Map();
  for (const coa of coas) {
    const petitionKey = String(coa.petitionId);
    if (!covered.has(petitionKey)) covered.set(petitionKey, new Set());
    const seqs = covered.get(petitionKey);
    for (const seq of coa.selectedItemSeqs || []) seqs.add(Number(seq));
  }
  return covered;
}

function requestedCoaRowFromPetition(petition, labRequests = [], coveredSeqs = new Set()) {
  const labSeqs = labSeqSet(labRequests);
  const selectedItems = (petition.items || [])
    .filter((item) => labSeqs.size === 0 || labSeqs.has(Number(item.seq)))
    .filter((item) => !coveredSeqs.has(Number(item.seq)));
  if (!selectedItems.length) return null;

  const timestamp = petition.labApprovedAt || petition.updatedAt || petition.createdAt || new Date();
  return {
    _id: `requested:${petition._id}`,
    coaNo: null,
    revision: 0,
    status: 'requested',
    petitionId: String(petition._id),
    petitionNoSnapshot: petition.petitionNo,
    selectedItemSeqs: selectedItems.map((item) => Number(item.seq)),
    customerSnapshot: customerSnapshotFromLabRequests(labRequests, petition),
    sampleSnapshots: selectedItems.map(sampleSnapshotFromPetitionItem),
    resultSnapshots: [],
    trendSnapshots: [],
    print: { printCount: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function requestedCoaRows({ petitionNo } = {}) {
  const petitionFilter = { labApprovedAt: { $exists: true, $ne: null } };
  if (petitionNo) petitionFilter.petitionNo = new RegExp(String(petitionNo).trim(), 'i');
  const petitions = await Petition.find(petitionFilter)
    .sort({ labApprovedAt: -1 })
    .limit(100)
    .lean();
  const petitionIds = petitions.map((petition) => petition._id);
  if (!petitionIds.length) return [];
  const [labRequests, existingCoas] = await Promise.all([
    labRequestsForPetitionIds(petitionIds),
    CoaDocument.find({
      petitionId: { $in: petitionIds },
      status: { $nin: ['cancelled', 'superseded', 'rejected'] },
    }).sort({ updatedAt: -1 }).lean(),
  ]);
  const labRequestsByPetition = groupLabRequestsByPetition(labRequests);
  const coveredByPetition = coveredSeqsByPetition(existingCoas);
  return petitions
    .map((petition) => requestedCoaRowFromPetition(
      petition,
      labRequestsByPetition.get(String(petition._id)) || [],
      coveredByPetition.get(String(petition._id)) || new Set(),
    ))
    .filter(Boolean);
}

function shouldIncludeRequestedRows(query = {}) {
  if (query.needsApproval === '1') return false;
  if (query.coaNo) return false;
  return !query.status || query.status === 'requested';
}

function sortCoaRows(items = []) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

async function loadCoaSource(petitionId, selectedItemSeqs) {
  const petition = await assertLabApprovedPetition(petitionId);
  selectedItemsFromPetition(petition, selectedItemSeqs);
  const labRequests = await LabRequest.find({ petitionId: petition._id }).lean();
  const labSeqs = labSeqSet(labRequests);
  if (labSeqs.size) {
    const nonLabSeqs = selectedItemSeqs.map(Number).filter((seq) => !labSeqs.has(seq));
    if (nonLabSeqs.length) throw errorWithStatus(`COA can include only Lab-approved samples: ${nonLabSeqs.join(', ')}`, 400);
  }
  const qcResults = await QCTestResult.find({
    petitionId: String(petition._id),
    itemSeq: { $in: selectedItemSeqs.map(Number) },
  }).lean();
  const parameterIds = [...new Set(qcResults.map((result) => String(result.parameterId)))];
  const parameters = parameterIds.length
    ? await Parameter.find({ _id: { $in: parameterIds } }).lean()
    : [];
  return { petition, labRequests, parameters, qcResults, selectedItemSeqs };
}

async function freezeSnapshots(petitionId, selectedItemSeqs, formSelections) {
  const source = await loadCoaSource(petitionId, selectedItemSeqs);
  const snapshots = buildCoaSnapshots(source);
  return formSelections === undefined
    ? snapshots
    : applyCoaFormSelections(snapshots, [...buildCoaFormOptions(source), ...buildCoaParameterOptions(source)], formSelections);
}

async function createCoaDocument(payload, session) {
  if (session) {
    const docs = await CoaDocument.create([payload], { session });
    return docs[0];
  }
  return CoaDocument.create(payload);
}

function supportsCoaTransactions() {
  const topologyType = mongoose.connection.getClient?.()?.topology?.description?.type;
  return !topologyType || topologyType !== 'Single';
}

async function withCoaTransaction(callback) {
  if (mongoose.connection.readyState !== 1) return callback(undefined);
  if (!supportsCoaTransactions()) return callback(undefined);
  if (typeof CoaDocument.startSession !== 'function') return callback(undefined);
  const session = await CoaDocument.startSession();
  if (!session || typeof session.withTransaction !== 'function') {
    if (session && typeof session.endSession === 'function') await session.endSession();
    return callback(undefined);
  }
  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.coaNo) filter.coaNo = new RegExp(String(req.query.coaNo).trim(), 'i');
    if (req.query.petitionNo) filter.petitionNoSnapshot = new RegExp(String(req.query.petitionNo).trim(), 'i');
    if (req.query.needsApproval === '1') {
      filter.status = { $in: ['pendingApproval', 'pendingRevisionApproval'] };
    }
    const externalPromise = shouldFetchExternalCoaRequests(req.query)
      ? fetchExternalCoaDocuments().catch((error) => {
          console.warn('[coa-documents] external COA request sync failed:', error.message);
          return [];
        })
      : Promise.resolve([]);
    const [documents, requestedRows, externalRows] = await Promise.all([
      CoaDocument.find(filter).sort({ updatedAt: -1 }).limit(200).lean(),
      shouldIncludeRequestedRows(req.query)
        ? requestedCoaRows({ petitionNo: req.query.petitionNo })
        : Promise.resolve([]),
      externalPromise,
    ]);
    const linkedExternalKeys = new Set(externalRows.length
      ? (await CoaDocument.find({
          'externalCoaRequest.saleOrderNo': { $in: externalRows.map((row) => row.externalCoaRequest.saleOrderNo) },
          status: { $nin: ['cancelled', 'superseded', 'rejected'] },
        }).sort({ updatedAt: -1 }).lean()).map((doc) => externalCoaKey(doc.externalCoaRequest))
      : []);
    res.json({
      items: sortCoaRows([
        ...documents,
        ...requestedRows,
        ...filterExternalCoaDocuments(externalRows, req.query)
          .filter((row) => !linkedExternalKeys.has(externalCoaKey(row.externalCoaRequest))),
      ]).slice(0, 200),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/erp-manual', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    const requests = await fetchExternalCoaDocuments();
    const source = requests.find((row) => row._id === req.body.externalRequestId);
    if (!source) throw errorWithStatus('ไม่พบคำขอ COA จาก ERP กรุณาโหลดรายการใหม่', 404);
    const snapshots = manualCoaSnapshots(req.body, source.selectedItemSeqs[0]);
    const doc = await withCoaTransaction(async (session) => {
      const created = await createCoaDocument({
        sourceType: 'erpManual', externalRequestId: source._id,
        externalCoaRequest: source.externalCoaRequest,
        petitionNoSnapshot: source.petitionNoSnapshot, selectedItemSeqs: source.selectedItemSeqs,
        customerSnapshot: source.customerSnapshot, ...snapshots,
        remark: String(req.body.remark || '').slice(0, 3000), status: 'draft',
        createdBy: actor, updatedBy: actor,
      }, session);
      await writeCoaAuditEvent(created, 'created', actor, 'สร้างร่าง COA จาก ERP โดยกรอกผลเอง', {
        externalRequestId: source._id,
      }, CoaAuditLog, session);
      return created;
    });
    res.status(201).json(doc);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.get('/erp-autofill/:externalRequestId', async (req, res) => {
  try {
    const externalRequestId = decodeURIComponent(String(req.params.externalRequestId || ''));
    const requests = await fetchExternalCoaDocuments();
    const source = requests.find((row) => row._id === externalRequestId);
    if (!source) throw errorWithStatus('ไม่พบคำขอ COA จาก ERP กรุณาโหลดรายการใหม่', 404);

    const references = await fetchErpReferences();
    const sourceData = sampleFromSources(source, references.stockRows, references.mfRows);
    const sample = sourceData.sample;
    const petitions = sample.commonName
      ? await Petition.find({ 'items.commonName': commonNameRegex(sample.commonName) })
        .sort({ updatedAt: -1 }).limit(200).lean()
      : [];
    const lab = findBestLabItem(petitions, sample);
    const qcResults = lab.best
      ? await QCTestResult.find({ petitionId: String(lab.best.petition._id), itemSeq: Number(lab.best.item.seq) })
        .sort({ updatedAt: -1 }).lean()
      : [];
    const resultData = resultRowsFromQc(qcResults, sample.commonName);
    let density = resultData.density;
    if (!density && sample.batchNo) {
      const pattern = new RegExp(escapeRegex(sample.batchNo), 'i');
      const densityRows = await ResultDensity.find({ 'Sample name': pattern }).sort({ _id: -1 }).limit(100).lean();
      density = densityForBatch(densityRows, sample.batchNo);
    }
    if (density && !resultData.rows.some((row) => /density/i.test(row.testItem || ''))) {
      resultData.rows.push({
        testItem: 'Density at 30°C (g/cm³)', criteria: '-', result: density, unit: 'g/cm³', method: 'DMA 501',
      });
    }

    const candidates = lab.candidates.slice(0, 10).map((candidate) => ({
      petitionId: String(candidate.petition._id),
      petitionNo: candidate.petition.petitionNo,
      itemSeq: Number(candidate.item.seq),
      sampleName: candidate.item.sampleName || '',
      commonName: candidate.item.commonName || '',
      batchNo: candidate.item.batchNo || candidate.item.lotNo || '',
      batchScore: candidate.batchScore,
      matchKind: candidate.matchKind,
      labApprovedAt: candidate.petition.labApprovedAt || null,
    }));
    const warnings = [];
    if (!sourceData.stockCandidates.length && !sourceData.mfCandidates.length) warnings.push('ไม่พบ LOT NO. จาก ERP/Stock/MF');
    if (!lab.best) warnings.push('ไม่พบผล Lab ที่ชื่อสามัญและ Batch No. ตรงกัน');
    else if (lab.best.matchKind !== 'exact') warnings.push('พบผล Lab จากเลขแบชที่ใกล้เคียง กรุณาตรวจสอบก่อนบันทึก');
    if (resultData.physical?.raw && !resultData.physical.complete) warnings.push('ผลกายภาพบางคำยังไม่มีคำแปลภาษาอังกฤษ กรุณาตรวจสอบ');
    res.json({
      externalRequestId,
      source: {
        petitionNo: source.petitionNoSnapshot,
        customerSnapshot: source.customerSnapshot,
        externalCoaRequest: source.externalCoaRequest,
      },
      sample,
      results: resultData.rows,
      match: lab.best ? {
        petitionId: String(lab.best.petition._id),
        petitionNo: lab.best.petition.petitionNo,
        itemSeq: Number(lab.best.item.seq),
        batchNo: lab.best.item.batchNo || lab.best.item.lotNo || '',
        matchKind: lab.best.matchKind,
        batchScore: lab.best.batchScore,
      } : null,
      candidates,
      stockCandidates: sourceData.stockCandidates,
      mfCandidates: sourceData.mfCandidates,
      form: {
        template: formKindForCommonName(sample.commonName),
        aiCriteria: aiToleranceCriteriaForCommonName(sample.commonName) || '',
        needsDensity: /\b(SC|SL|EC|EW|ZC)\s*$/i.test(sample.commonName || ''),
      },
      warnings,
      dataSources: {
        erp: true,
        stock: sourceData.stockCandidates.length > 0,
        mf: sourceData.mfCandidates.length > 0,
        lab: Boolean(lab.best),
        density: Boolean(density),
      },
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.get('/lab-ai-lookup', async (req, res) => {
  try {
    const batchNo = manualText(req.query.batchNo);
    const commonName = manualText(req.query.commonName);
    const sampleName = manualText(req.query.sampleName);
    if (!batchNo || !commonName) {
      throw errorWithStatus('กรุณาระบุ Batch No. และชื่อสามัญเพื่อค้นหาผล %AI', 400);
    }

    const petitions = await Petition.find({
      items: {
        $elemMatch: {
          commonName: commonNameRegex(commonName),
          $or: [
            { batchNo: exactTrimmedRegex(batchNo) },
            { lotNo: exactTrimmedRegex(batchNo) },
          ],
        },
      },
    }).sort({ updatedAt: -1 }).limit(200).lean();
    const lab = findBestLabItem(petitions, { batchNo, commonName, sampleName });
    if (!lab.best) {
      return res.json({ batchNo, commonName, ai: null, analysisDate: '', match: null });
    }

    const qcResults = await QCTestResult.find({
      petitionId: String(lab.best.petition._id),
      itemSeq: Number(lab.best.item.seq),
    }).sort({ updatedAt: -1 }).lean();
    const resultData = resultRowsFromQc(qcResults, commonName);
    const ai = resultData.rows.find((row) => isAiContentTestItem(row.testItem)) || null;
    return res.json({
      batchNo,
      commonName,
      ai,
      analysisDate: resultData.analysisDate || '',
      match: {
        petitionId: String(lab.best.petition._id),
        petitionNo: lab.best.petition.petitionNo,
        itemSeq: Number(lab.best.item.seq),
        batchNo: lab.best.item.batchNo || lab.best.item.lotNo || batchNo,
      },
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.get('/eligible-petitions', async (_req, res) => {
  try {
    const petitions = await Petition.find({ labApprovedAt: { $exists: true, $ne: null } })
      .sort({ labApprovedAt: -1 })
      .limit(100)
      .lean();
    const petitionIds = petitions.map((petition) => petition._id);
    const historyPairs = petitions.flatMap((petition) => (petition.items || [])
      .map((item) => ({ commonName: item.commonName, batchNo: item.batchNo }))
      .filter((item) => coaHistoryKey(item.commonName, item.batchNo)));
    const [coas, labRequests] = await Promise.all([
      CoaDocument.find({
        $or: [
          { petitionId: { $in: petitionIds } },
          ...historyPairs.map((item) => ({
            sampleSnapshots: {
              $elemMatch: {
                commonName: exactTrimmedRegex(item.commonName),
                batchNo: exactTrimmedRegex(item.batchNo),
              },
            },
          })),
        ],
        status: { $in: ['approved', 'printed', 'reissued'] },
      }).sort({ updatedAt: -1 }).lean(),
      labRequestsForPetitionIds(petitionIds),
    ]);
    const activeByHistoryKey = firstActiveCoaByHistoryKey(coas);
    const activeByPetitionSeq = new Map();
    for (const coa of coas) {
      for (const seq of coa.selectedItemSeqs || []) {
        const key = `${coa.petitionId}:${seq}`;
        if (!activeByPetitionSeq.has(key)) {
          const sample = (coa.sampleSnapshots || []).find((item) => Number(item.itemSeq) === Number(seq)) || {};
          activeByPetitionSeq.set(key, activeCoaSummary(coa, sample));
        }
      }
    }
    const labSeqsByPetition = new Map();
    for (const labRequest of labRequests) {
      const key = String(labRequest.petitionId);
      if (!labSeqsByPetition.has(key)) labSeqsByPetition.set(key, new Set());
      if (labRequest.sampleSeq != null) labSeqsByPetition.get(key).add(Number(labRequest.sampleSeq));
    }
    res.json({
      items: petitions.map((petition) => {
        const labSeqs = labSeqsByPetition.get(String(petition._id)) || new Set();
        return {
          _id: petition._id,
          petitionNo: petition.petitionNo,
          labApprovedAt: petition.labApprovedAt,
          submittedBy: petition.submittedBy,
          items: (petition.items || [])
            .filter((item) => labSeqs.size === 0 || labSeqs.has(Number(item.seq)))
            .map((item) => ({
              seq: item.seq,
              sampleName: item.sampleName,
              commonName: item.commonName,
              batchNo: item.batchNo,
              lotNo: item.lotNo,
              productionDate: item.productionDate,
              activeCoa: activeByPetitionSeq.get(`${petition._id}:${item.seq}`)
                || activeByHistoryKey.get(coaHistoryKey(item.commonName, item.batchNo))
                || null,
            })),
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/source-data/:petitionId', async (req, res) => {
  try {
    const selectedItemSeqs = String(req.query.itemSeqs || '').split(',').filter(Boolean).map(Number);
    const source = await loadCoaSource(req.params.petitionId, selectedItemSeqs);
    const { customerSnapshot, sampleSnapshots } = buildCoaSnapshots(source);
    res.json({ results: [...buildCoaFormOptions(source), ...buildCoaParameterOptions(source)], customerSnapshot, sampleSnapshots });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/manual', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    const externalLink = externalCoaLink(req.body);
    await assertExternalCoaRequest(externalLink);
    const petition = req.body.petitionId || !externalLink
      ? await assertLabApprovedPetition(req.body.petitionId)
      : { petitionNo: externalLink.saleOrderNo, items: [{ seq: externalLink.line || 1 }] };
    const selectedItems = selectedItemsFromPetition(petition, req.body.selectedItemSeqs);
    const selectedItemSeqs = selectedItems.map((item) => item.seq);
    const snapshots = buildManualSnapshots(petition, selectedItemSeqs, req.body);
    const customerSnapshot = manualCustomerSnapshot(req.body);
    const doc = await withCoaTransaction(async (session) => {
      const created = await createCoaDocument({
        entryMode: 'manual',
        petitionId: petition._id,
        petitionNoSnapshot: petition.petitionNo,
        externalCoaRequest: externalLink,
        selectedItemSeqs,
        customerSnapshot,
        ...snapshots,
        remark: manualText(req.body.remark),
        status: 'draft',
        createdBy: actor,
        updatedBy: actor,
      }, session);
      await writeCoaAuditEvent(created, 'created', actor, 'สร้างร่าง COA จากแบบกรอกข้อมูล', {
        selectedItemSeqs: created.selectedItemSeqs,
        entryMode: 'manual',
      }, CoaAuditLog, session);
      return created;
    });
    res.status(201).json(doc);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    const petition = await assertLabApprovedPetition(req.body.petitionId);
    const selectedItems = selectedItemsFromPetition(petition, req.body.selectedItemSeqs);
    const selectedItemSeqs = selectedItems.map((item) => item.seq);
    const snapshots = await freezeSnapshots(petition._id, selectedItemSeqs, req.body.formSelections);
    const doc = await withCoaTransaction(async (session) => {
      const created = await createCoaDocument({
        entryMode: 'source',
        petitionId: petition._id,
        petitionNoSnapshot: petition.petitionNo,
        selectedItemSeqs,
        ...snapshots,
        remark: String(req.body.remark || ''),
        status: 'draft',
        createdBy: actor,
        updatedBy: actor,
      }, session);
      await writeCoaAuditEvent(created, 'created', actor, 'สร้างร่าง COA', {
        selectedItemSeqs: created.selectedItemSeqs,
      }, CoaAuditLog, session);
      return created;
    });
    res.status(201).json(doc);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await CoaDocument.findById(objectId(req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'ไม่พบ COA' });
    const audit = await CoaAuditLog.find({ coaId: doc._id }).sort({ createdAt: -1 }).lean();
    res.json({ ...doc, audit });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    const doc = await CoaDocument.findById(objectId(req.params.id));
    if (!doc) return res.status(404).json({ error: 'ไม่พบ COA' });
    assertCanTransition(doc.status, 'update', actor);
    if (doc.sourceType === 'erpManual' && req.body.sample) {
      doc.set(manualCoaSnapshots(req.body, doc.selectedItemSeqs[0]));
    }
    if (req.body.selectedItemSeqs && doc.sourceType !== 'erpManual') {
      const petition = await assertLabApprovedPetition(doc.petitionId);
      doc.selectedItemSeqs = selectedItemsFromPetition(petition, req.body.selectedItemSeqs)
        .map((item) => item.seq);
      const snapshots = await freezeSnapshots(doc.petitionId, doc.selectedItemSeqs, req.body.formSelections ?? doc.formSelections);
      doc.set(snapshots);
    }
    if (typeof req.body.remark === 'string') doc.remark = req.body.remark;
    doc.updatedBy = actor;
    const updated = await withCoaTransaction(async (session) => {
      await doc.save(session ? { session } : undefined);
      await writeCoaAuditEvent(doc, 'updated', actor, 'แก้ไขร่าง COA', {}, CoaAuditLog, session);
      return doc;
    });
    res.json(updated);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/:id/submit', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    const doc = await CoaDocument.findById(objectId(req.params.id));
    if (!doc) return res.status(404).json({ error: 'ไม่พบ COA' });
    const snapshots = doc.sourceType === 'erpManual' ? validateManualCoa(doc)
      : doc.entryMode === 'manual' ? {}
      : await freezeSnapshots(doc.petitionId, doc.selectedItemSeqs, doc.formSelections);
    doc.$locals.allowIssuedSnapshotMutation = true;
    const { doc: updated } = await withCoaTransaction((session) => applyCoaLifecycleAction({
      doc,
      action: 'submit',
      actor,
      note: 'ส่งอนุมัติ COA',
      CoaAuditLogModel: CoaAuditLog,
      session,
      update: { ...snapshots, approval: { ...doc.approval, submittedBy: actor, submittedAt: new Date() } },
    }));
    res.json(updated);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    if (!isQcHead(actor)) return res.status(403).json({ error: 'อนุมัติ COA ได้เฉพาะ QC Head' });
    const doc = await CoaDocument.findById(objectId(req.params.id));
    if (!doc) return res.status(404).json({ error: 'ไม่พบ COA' });
    assertCanTransition(doc.status, 'approve', actor);
    if (doc.sourceType !== 'erpManual' && doc.petitionId) await assertLabApprovedPetition(doc.petitionId);
    const missingSnapshots = !doc.sampleSnapshots?.length || !doc.resultSnapshots?.length || !doc.trendSnapshots?.length;
    const snapshots = doc.sourceType === 'erpManual' ? validateManualCoa(doc)
      : doc.entryMode === 'manual' || !missingSnapshots ? {}
      : await freezeSnapshots(doc.petitionId, doc.selectedItemSeqs, doc.formSelections);
    const update = {
      ...snapshots,
      approval: { ...doc.approval, approvedBy: actor, approvedAt: new Date() },
    };
    if (!doc.coaNo) Object.assign(update, await nextCoaNumber());
    doc.$locals.allowIssuedSnapshotMutation = true;
    const action = {
      doc,
      action: 'approve',
      actor,
      note: 'อนุมัติ COA',
      CoaAuditLogModel: CoaAuditLog,
      update,
    };
    let updated;
    if (doc.sourceCoaId) {
      const session = await CoaDocument.startSession();
      try {
        await session.withTransaction(async () => {
          if (typeof doc.$session === 'function') doc.$session(session);
          ({ doc: updated } = await applyCoaLifecycleAction({ ...action, session }));
          await applySupersession({
            sourceCoaId: updated.sourceCoaId,
            revisionCoaId: updated._id,
            CoaDocumentModel: CoaDocument,
            CoaAuditLogModel: CoaAuditLog,
            actor,
            note: 'แทนที่ด้วย COA ฉบับแก้ไข',
            session,
          });
        });
      } finally {
        await session.endSession();
      }
    } else {
      ({ doc: updated } = await withCoaTransaction((session) => applyCoaLifecycleAction({ ...action, session })));
    }
    res.json(updated);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    if (!isQcHead(actor)) return res.status(403).json({ error: 'ปฏิเสธ COA ได้เฉพาะ QC Head' });
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'ต้องระบุเหตุผลการปฏิเสธ' });
    const doc = await CoaDocument.findById(objectId(req.params.id));
    if (!doc) return res.status(404).json({ error: 'ไม่พบ COA' });
    const { doc: updated } = await withCoaTransaction((session) => applyCoaLifecycleAction({
      doc,
      action: 'reject',
      actor,
      note: reason,
      CoaAuditLogModel: CoaAuditLog,
      session,
      update: { approval: { ...doc.approval, rejectedBy: actor, rejectedAt: new Date(), rejectReason: reason } },
    }));
    res.json(updated);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/:id/revise', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    const source = await CoaDocument.findById(objectId(req.params.id)).lean();
    if (!source) return res.status(404).json({ error: 'ไม่พบ COA' });
    assertCanTransition(source.status, 'revise', actor);
    const doc = await withCoaTransaction(async (session) => {
      const created = await createCoaDocument({
        entryMode: source.entryMode || 'source',
        coaNo: source.coaNo,
        coaYear: source.coaYear,
        sequence: source.sequence,
        revision: Number(source.revision || 0) + 1,
        status: 'revisionDraft',
        petitionId: source.petitionId,
        sourceType: source.sourceType,
        externalRequestId: source.externalRequestId,
        petitionNoSnapshot: source.petitionNoSnapshot,
        externalCoaRequest: source.externalCoaRequest,
        selectedItemSeqs: source.selectedItemSeqs,
        customerSnapshot: source.customerSnapshot,
        sampleSnapshots: source.sampleSnapshots,
        resultSnapshots: source.resultSnapshots,
        trendSnapshots: source.trendSnapshots,
        formSelections: source.formSelections,
        sourceCoaId: source._id,
        remark: source.remark,
        createdBy: actor,
        updatedBy: actor,
      }, session);
      await writeCoaAuditEvent(created, 'revisionCreated', actor, 'สร้างร่างแก้ไข COA', {
        sourceCoaId: source._id,
      }, CoaAuditLog, session);
      return created;
    });
    res.status(201).json(doc);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    if (!isQcHead(actor)) return res.status(403).json({ error: 'ยกเลิก COA ได้เฉพาะ QC Head' });
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'ต้องระบุเหตุผลการยกเลิก' });
    const doc = await CoaDocument.findById(objectId(req.params.id));
    if (!doc) return res.status(404).json({ error: 'ไม่พบ COA' });
    const { doc: updated } = await withCoaTransaction((session) => applyCoaLifecycleAction({
      doc,
      action: 'cancel',
      actor,
      note: reason,
      CoaAuditLogModel: CoaAuditLog,
      session,
      update: { cancel: { cancelledBy: actor, cancelledAt: new Date(), reason } },
    }));
    res.json(updated);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

router.post('/:id/print-event', async (req, res) => {
  try {
    const actor = await actorFromRequest(req.body);
    const doc = await CoaDocument.findById(objectId(req.params.id));
    if (!doc) return res.status(404).json({ error: 'ไม่พบ COA' });
    const printedAt = new Date();
    const { doc: updated } = await withCoaTransaction((session) => applyCoaLifecycleAction({
      doc,
      action: 'print',
      actor,
      note: 'บันทึกการพิมพ์ COA',
      CoaAuditLogModel: CoaAuditLog,
      session,
      metadata: { copies: req.body.copies, outputMode: req.body.outputMode },
      update: {
        print: {
          ...doc.print,
          printCount: Number(doc.print?.printCount || 0) + 1,
          lastPrintedAt: printedAt,
          lastPrintedBy: actor,
          printEvents: [
            ...(doc.print?.printEvents || []),
            {
              event: req.body.event || 'printDialogOpened',
              printedAt,
              printedBy: actor,
              copies: Number(req.body.copies || 1),
              outputMode: req.body.outputMode || 'local',
            },
          ],
        },
      },
    }));
    res.json(updated);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message });
  }
});

module.exports = router;
module.exports.freezeSnapshots = freezeSnapshots;
module.exports.actorFromRequest = actorFromRequest;
module.exports.withCoaTransaction = withCoaTransaction;
module.exports.externalCoaRowsToDocuments = externalCoaRowsToDocuments;
