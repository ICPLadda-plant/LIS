const COA_STATUSES = [
  'draft',
  'pendingApproval',
  'approved',
  'printed',
  'revisionDraft',
  'pendingRevisionApproval',
  'reissued',
  'cancelled',
  'superseded',
  'rejected',
];
const { aiPercentFromCommonName, aiToleranceCriteriaForCommonName, isAiContentTestItem } = require('./aiToleranceCriteria');

const COMPANY_NAME = 'บริษัท ไอ ซี พี ลัดดา จำกัด';
const PHYSICAL_PARAMETER_NAME = 'กายภาพ';
const PHYSICAL_DESCRIPTION_LABEL = 'ลักษณะ';
const PHYSICAL_COLOR_LABEL = 'สี';

const transitions = {
  submit: new Set(['draft', 'revisionDraft']),
  approve: new Set(['pendingApproval', 'pendingRevisionApproval']),
  reject: new Set(['pendingApproval', 'pendingRevisionApproval']),
  revise: new Set(['approved', 'printed', 'reissued']),
  cancel: new Set(['approved', 'printed', 'reissued']),
  print: new Set(['approved', 'printed', 'reissued']),
  update: new Set(['draft', 'revisionDraft']),
};

const protectedActions = new Set(['approve', 'reject', 'cancel']);
const editableSnapshotStatuses = new Set(['draft', 'revisionDraft']);
const supersedableStatuses = new Set(['approved', 'printed', 'reissued']);
// Prefer canPrintStatus() for read checks; this Set remains exported for Task 1 compatibility.
const activePrintableStatuses = new Set(transitions.print);

const COA_AUDIT_EVENTS = [
  'created',
  'updated',
  'submitted',
  'approved',
  'rejected',
  'revisionCreated',
  'revisionSubmitted',
  'revisionApproved',
  'superseded',
  'cancelled',
  'printed',
];

const lifecycleActionEvents = {
  submit: (status) => (status === 'revisionDraft' ? 'revisionSubmitted' : 'submitted'),
  approve: (status) => (status === 'pendingRevisionApproval' ? 'revisionApproved' : 'approved'),
  reject: () => 'rejected',
  revise: () => 'revisionCreated',
  cancel: () => 'cancelled',
  print: () => 'printed',
  update: () => 'updated',
};

const lifecycleActionStatuses = {
  submit: (status) => (status === 'revisionDraft' ? 'pendingRevisionApproval' : 'pendingApproval'),
  approve: (status) => (status === 'pendingRevisionApproval' ? 'reissued' : 'approved'),
  reject: (status) => (status === 'pendingRevisionApproval' ? 'revisionDraft' : 'draft'),
  revise: () => 'revisionDraft',
  cancel: () => 'cancelled',
  print: () => 'printed',
};

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isQcHead(user = {}) {
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return (
    normalizeRole(user.role) === 'qc_head' ||
    normalizeRole(user.activeRole) === 'qc_head' ||
    normalizeRole(user.position) === 'qc_head' ||
    permissions.includes('coa.approve')
  );
}

function isCoaCreator(user = {}, doc = {}) {
  const userEmail = String(user.email || '').trim().toLowerCase();
  const creatorEmail = String(doc.createdBy?.email || '').trim().toLowerCase();
  return Boolean(userEmail && creatorEmail && userEmail === creatorEmail);
}

function canReviewCoa(user = {}, doc = {}) {
  return isQcHead(user) || isCoaCreator(user, doc);
}

function valueText(value) {
  if (value == null || String(value).trim() === '') return '-';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object') {
    const file = value || {};
    if (typeof file.name === 'string') return file.name;
    if (typeof file.url === 'string') return file.url;
    return JSON.stringify(value);
  }
  return String(value);
}

function cleanString(value) {
  return String(value || '').trim();
}

function parsePercentValue(value) {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function visibleResultEntries(result = {}) {
  const valueRows = Array.isArray(result.entries) && result.entries.length
    ? result.entries
    : [result.values || {}];
  const phase2Rows = result.valuesPhase2 && Object.keys(result.valuesPhase2).length
    ? [result.valuesPhase2]
    : [];
  return [...valueRows, ...phase2Rows];
}

function isVisibleResultField(key) {
  return (
    !String(key).startsWith('__') &&
    !String(key).endsWith('__note') &&
    !String(key).endsWith('__source') &&
    !String(key).endsWith('__provenance')
  );
}

function meaningfulResultText(value) {
  const text = valueText(value).trim();
  return text === '-' ? '' : text;
}

function isPhysicalParameter(parameter = {}, result = {}) {
  return cleanString(parameter.name || result.parameterName) === PHYSICAL_PARAMETER_NAME;
}

function physicalDescriptionFromRow(row = {}) {
  return [
    meaningfulResultText(row[PHYSICAL_DESCRIPTION_LABEL]),
    meaningfulResultText(row[PHYSICAL_COLOR_LABEL]),
  ].filter(Boolean).join(' ');
}

function physicalDescriptionBySeq(qcResults, parameterById, selectedSeqs) {
  const descriptions = new Map();
  for (const result of qcResults || []) {
    const itemSeq = Number(result.itemSeq);
    if (!selectedSeqs.has(itemSeq) || descriptions.has(itemSeq)) continue;
    const parameter = parameterById.get(String(result.parameterId));
    if (!isPhysicalParameter(parameter, result)) continue;
    for (const row of visibleResultEntries(result)) {
      const description = physicalDescriptionFromRow(row);
      if (!description) continue;
      descriptions.set(itemSeq, description);
      break;
    }
  }
  return descriptions;
}

function assertCanTransition(fromStatus, action, actor, doc) {
  const allowed = transitions[action];
  if (!allowed) throw new Error(`Unknown COA action ${action}`);
  if (!allowed.has(fromStatus)) {
    throw new Error(`Cannot ${action} COA from ${fromStatus}`);
  }
  if (protectedActions.has(action)) {
    const canPerform = action === 'approve' || action === 'reject'
      ? canReviewCoa(actor, doc)
      : isQcHead(actor);
    if (!canPerform) {
      const requiredRole = action === 'approve' || action === 'reject' ? 'QC Head or COA creator' : 'QC Head';
      throw new Error(`${requiredRole} required to ${action} COA`);
    }
  }
}

function assertValidCancellation(reason) {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('COA cancellation reason is required');
  }
}

function buildCoaAuditEvent(input = {}) {
  if (!COA_AUDIT_EVENTS.includes(input.event)) {
    throw new Error(`Invalid COA audit event ${input.event || ''}`.trim());
  }
  const actor = input.actor || {};
  if (typeof actor.name !== 'string' || actor.name.trim().length === 0) {
    throw new Error('COA audit actor name is required');
  }
  if (typeof actor.email !== 'string' || actor.email.trim().length === 0) {
    throw new Error('COA audit actor email is required');
  }
  return {
    ...input,
    actor: {
      name: actor.name.trim(),
      email: actor.email.trim(),
      role: String(actor.role || '').trim(),
    },
    createdAt: input.createdAt instanceof Date ? input.createdAt : new Date(),
  };
}

async function writeCoaAuditEvent(doc, event, actor, note, metadata, CoaAuditLogModel, session) {
  const AuditModel = CoaAuditLogModel || require('../models/CoaAuditLog');
  if (!doc || !doc._id) {
    throw new Error('COA audit event requires a COA document');
  }
  const auditEvent = buildCoaAuditEvent({
    coaId: doc._id,
    coaNo: doc.coaNo,
    petitionId: doc.petitionId,
    petitionNo: doc.petitionNoSnapshot,
    event,
    actor,
    note,
    metadata,
  });
  return session ? AuditModel.create(auditEvent, { session }) : AuditModel.create(auditEvent);
}

async function recordCoaLifecycleAction({
  doc,
  action,
  actor,
  note,
  metadata,
  CoaAuditLogModel,
} = {}) {
  if (!doc || !doc._id) {
    throw new Error('COA lifecycle action requires a COA document');
  }
  const sourceStatus = doc.status;
  assertCanTransition(sourceStatus, action, actor, doc);
  const eventForAction = lifecycleActionEvents[action];
  if (!eventForAction) {
    throw new Error(`Unknown COA action ${action}`);
  }
  return writeCoaAuditEvent(
    doc,
    eventForAction(doc.status),
    actor,
    note,
    { action, ...(metadata || {}) },
    CoaAuditLogModel,
  );
}

function getLifecycleUpdateStatus(update = {}) {
  if (Object.prototype.hasOwnProperty.call(update, 'status')) return update.status;
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'status')) return update.$set.status;
  return undefined;
}

function getLifecycleCancellationReason(doc, update = {}) {
  if (Object.prototype.hasOwnProperty.call(update, 'cancel.reason')) return update['cancel.reason'];
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'cancel.reason')) {
    return update.$set['cancel.reason'];
  }
  if (Object.prototype.hasOwnProperty.call(update, 'cancel')) return update.cancel && update.cancel.reason;
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'cancel')) {
    return update.$set.cancel && update.$set.cancel.reason;
  }
  return doc.cancel && doc.cancel.reason;
}

function applyDocumentUpdate(doc, update = {}) {
  const setUpdate = { ...update };
  if (setUpdate.$set) {
    Object.assign(setUpdate, setUpdate.$set);
    delete setUpdate.$set;
  }
  if (Object.keys(setUpdate).some((key) => key.startsWith('$'))) {
    throw new Error('COA lifecycle updates must use document fields');
  }
  if (typeof doc.set === 'function') {
    doc.set(setUpdate);
  } else {
    Object.assign(doc, setUpdate);
  }
}

async function applyCoaLifecycleAction({
  doc,
  action,
  actor,
  note,
  metadata,
  update = {},
  CoaAuditLogModel,
  session,
} = {}) {
  if (!doc || !doc._id) {
    throw new Error('COA lifecycle action requires a COA document');
  }
  if (typeof doc.save !== 'function') {
    throw new Error('COA lifecycle action requires a saveable COA document');
  }

  const sourceStatus = doc.status;
  assertCanTransition(sourceStatus, action, actor, doc);
  const eventForAction = lifecycleActionEvents[action];
  if (!eventForAction) {
    throw new Error(`Unknown COA action ${action}`);
  }
  const nextStatusForAction = lifecycleActionStatuses[action];
  const nextStatus = nextStatusForAction ? nextStatusForAction(sourceStatus) : undefined;
  const event = eventForAction(sourceStatus);
  const requestedStatus = getLifecycleUpdateStatus(update);
  if (requestedStatus !== undefined && requestedStatus !== nextStatus) {
    throw new Error(`COA lifecycle action ${action} cannot set status to ${requestedStatus}`);
  }
  if (action === 'cancel') {
    assertValidCancellation(getLifecycleCancellationReason(doc, update));
  }

  // Validate the actor and audit payload before mutating or saving the document.
  buildCoaAuditEvent({
    coaId: doc._id,
    coaNo: doc.coaNo,
    petitionId: doc.petitionId,
    petitionNo: doc.petitionNoSnapshot,
    event,
    actor,
    note,
    metadata: { action, ...(metadata || {}) },
  });

  applyDocumentUpdate(doc, update);
  if (nextStatus !== undefined) {
    if (typeof doc.set === 'function') {
      doc.set({ status: nextStatus, updatedBy: actor });
    } else {
      doc.status = nextStatus;
      doc.updatedBy = actor;
    }
  }
  await doc.save(session ? { session } : undefined);
  const audit = await writeCoaAuditEvent(
    doc,
    event,
    actor,
    note,
    { action, ...(metadata || {}) },
    CoaAuditLogModel,
    session,
  );
  return { doc, audit };
}

function assertCanEditSnapshots(status) {
  if (!editableSnapshotStatuses.has(status)) {
    throw new Error(`Cannot edit COA snapshots from ${status}`);
  }
}

function assertCanSupersede(sourceStatus) {
  if (!supersedableStatuses.has(sourceStatus)) {
    throw new Error(`Cannot supersede COA from ${sourceStatus}`);
  }
}

function buildSupersessionUpdate({ sourceCoaId, replacementCoaId, sourceStatus } = {}) {
  assertCanSupersede(sourceStatus);
  if (!sourceCoaId || !replacementCoaId) {
    throw new Error('COA supersession requires source and replacement IDs');
  }
  return {
    source: { status: 'superseded', supersededByCoaId: replacementCoaId },
    replacement: { status: 'reissued', supersedesCoaId: sourceCoaId },
  };
}

function resolveQuerySession(query, session) {
  return session && typeof query.session === 'function' ? query.session(session) : query;
}

async function applySupersession({
  sourceCoaId,
  revisionCoaId,
  CoaDocumentModel,
  CoaAuditLogModel,
  actor,
  note = 'Superseded by approved COA revision',
  session,
} = {}) {
  const DocumentModel = CoaDocumentModel || require('../models/CoaDocument');
  if (!sourceCoaId || !revisionCoaId) {
    throw new Error('COA supersession requires source and revision IDs');
  }
  const ownedSession = session ? null : await startSupersessionSession(DocumentModel);
  const activeSession = session || ownedSession;
  if (!activeSession) {
    throw new Error('COA supersession requires a transaction session');
  }

  const runUpdates = async () => {
    const sourceDoc = await resolveQuerySession(DocumentModel.findById(sourceCoaId), activeSession)
      .select('status coaNo petitionId petitionNoSnapshot')
      .lean();
    if (!sourceDoc) {
      throw new Error('Source COA not found for supersession');
    }
    const updates = buildSupersessionUpdate({
      sourceCoaId,
      replacementCoaId: revisionCoaId,
      sourceStatus: sourceDoc.status,
    });
    const sourceUpdate = actor ? { ...updates.source, updatedBy: actor } : updates.source;
    const options = { session: activeSession, allowCoaIssuedSnapshotMutation: true };
    const source = await DocumentModel.updateOne(
      { _id: sourceCoaId },
      { $set: sourceUpdate },
      options,
    );
    const revision = await DocumentModel.updateOne(
      { _id: revisionCoaId },
      { $set: updates.replacement },
      options,
    );
    assertSupersessionUpdateMatched(source, 'source');
    assertSupersessionUpdateMatched(revision, 'revision');
    let audit;
    if (actor) {
      audit = await writeCoaAuditEvent(
        sourceDoc,
        'superseded',
        actor,
        note,
        { replacementCoaId: revisionCoaId },
        CoaAuditLogModel,
        activeSession,
      );
    }
    return { source, revision, audit };
  };

  if (session) {
    return runUpdates();
  }

  try {
    if (typeof activeSession.withTransaction !== 'function') {
      throw new Error('COA supersession requires a transaction session');
    }
    return await activeSession.withTransaction(runUpdates);
  } finally {
    if (ownedSession && typeof ownedSession.endSession === 'function') {
      await ownedSession.endSession();
    }
  }
}

function assertSupersessionUpdateMatched(result, label) {
  const matchedCount = result && (
    result.matchedCount ?? result.n ?? (result.result && result.result.n)
  );
  if (matchedCount === 0) {
    throw new Error(`${label} COA was not found for supersession`);
  }
}

async function startSupersessionSession(DocumentModel) {
  if (typeof DocumentModel.startSession === 'function') {
    return DocumentModel.startSession();
  }
  if (DocumentModel.db && typeof DocumentModel.db.startSession === 'function') {
    return DocumentModel.db.startSession();
  }
  return null;
}

function canPrintStatus(status) {
  return activePrintableStatuses.has(status);
}

function actorFromBody(body = {}) {
  const u = body._user || body.actor || {};
  return {
    name: String(u.name || body.actorName || '').trim(),
    email: String(u.email || body.actorEmail || '').trim(),
    role: String(u.role || body.actorRole || '').trim(),
  };
}

function selectedItemsFromPetition(petition, selectedItemSeqs) {
  const wanted = new Set((selectedItemSeqs || []).map(Number));
  if (wanted.size === 0) throw new Error('COA must include at least one sample');
  const items = Array.isArray(petition?.items) ? petition.items : [];
  const selected = items.filter((item) => wanted.has(Number(item.seq)));
  const found = new Set(selected.map((item) => Number(item.seq)));
  const missing = [...wanted].filter((seq) => !found.has(seq));
  if (missing.length) throw new Error(`Invalid COA item seqs: ${missing.join(', ')}`);
  return selected;
}

function itemSnapshot(item, condition) {
  return {
    itemSeq: item.seq,
    sampleName: item.sampleName || item.commonName || '-',
    commonName: item.commonName || '',
    batchNo: item.batchNo || '',
    lotNo: item.lotNo || '',
    productionDate: item.productionDate || '',
    sampleId: item.sampleId || '',
    condition: condition || item.condition || '',
    manufacturer: item.labelManufacturer || item.labelSeller || '',
  };
}

function criteriaForResult(testItem, itemSeq, selectedItemsBySeq) {
  if (!isAiContentTestItem(testItem)) return '-';
  const sample = selectedItemsBySeq.get(Number(itemSeq));
  return aiToleranceCriteriaForCommonName(sample?.commonName) || '-';
}

function buildTrendSnapshots(selectedItems, resultSnapshots) {
  const aiResultBySeq = new Map();
  for (const row of resultSnapshots || []) {
    if (!isAiContentTestItem(row.testItem)) continue;
    const key = Number(row.itemSeq);
    if (aiResultBySeq.has(key)) continue;
    aiResultBySeq.set(key, {
      text: row.result || '',
      percent: parsePercentValue(row.result),
    });
  }
  return selectedItems.map((item) => {
    const aiResult = aiResultBySeq.get(Number(item.seq));
    return {
      itemSeq: item.seq,
      sampleName: item.sampleName || item.commonName || '-',
      commonName: item.commonName || '',
      aiLabelPercent: parsePercentValue(aiPercentFromCommonName(item.commonName)),
      aiResultPercent: aiResult?.percent,
      aiResultText: aiResult?.text || '',
    };
  });
}

function buildCoaSnapshots({
  petition,
  labRequests = [],
  parameters = [],
  qcResults = [],
  selectedItemSeqs,
} = {}) {
  const selectedItems = selectedItemsFromPetition(petition, selectedItemSeqs);
  const selectedSeqs = new Set(selectedItems.map((item) => Number(item.seq)));
  const selectedItemsBySeq = new Map(selectedItems.map((item) => [Number(item.seq), item]));
  const parameterById = new Map(parameters.map((parameter) => [String(parameter._id), parameter]));
  const firstLabRequest = labRequests[0] || {};
  const requester = firstLabRequest.requester || {};
  const physicalDescriptions = physicalDescriptionBySeq(qcResults, parameterById, selectedSeqs);
  const resultSnapshots = [];

  for (const result of qcResults) {
    if (!selectedSeqs.has(Number(result.itemSeq))) continue;
    const parameter = parameterById.get(String(result.parameterId));
    if ((parameter?.scope || 'qc') !== 'lab') continue;
    for (const [rowIndex, row] of visibleResultEntries(result).entries()) {
      for (const [field, value] of Object.entries(row || {}).filter(([key]) => isVisibleResultField(key))) {
        const testItem = result.parameterName && result.parameterName !== field
          ? `${result.parameterName} - ${field}`
          : (result.parameterName || field);
        resultSnapshots.push({
          itemSeq: result.itemSeq,
          testItem,
          result: valueText(value),
          criteria: criteriaForResult(testItem, result.itemSeq, selectedItemsBySeq),
          method: '-',
          unit: '',
        });
      }
    }
  }

  return {
    petitionNoSnapshot: petition.petitionNo,
    customerSnapshot: {
      name: cleanString(requester.fullName) || cleanString(petition.submittedBy?.name) || '-',
      company: cleanString(firstLabRequest.reportCustomerName) || COMPANY_NAME,
      department: requester.department || '',
      email: requester.email || '',
      phone: requester.phone || '',
    },
    sampleSnapshots: selectedItems.map((item) => itemSnapshot(item, physicalDescriptions.get(Number(item.seq)))),
    resultSnapshots,
    trendSnapshots: buildTrendSnapshots(selectedItems, resultSnapshots),
  };
}

module.exports = {
  COA_STATUSES,
  COA_AUDIT_EVENTS,
  activePrintableStatuses,
  canPrintStatus,
  isQcHead,
  isCoaCreator,
  canReviewCoa,
  assertCanTransition,
  assertValidCancellation,
  buildCoaAuditEvent,
  writeCoaAuditEvent,
  recordCoaLifecycleAction,
  applyCoaLifecycleAction,
  assertCanEditSnapshots,
  assertCanSupersede,
  buildSupersessionUpdate,
  applySupersession,
  actorFromBody,
  selectedItemsFromPetition,
  buildCoaSnapshots,
  visibleResultEntries,
  isVisibleResultField,
};
