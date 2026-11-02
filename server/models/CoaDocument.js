const mongoose = require('mongoose');

const PersonSchema = new mongoose.Schema(
  { name: String, email: String, role: String, signatureUrl: String },
  { _id: false },
);

const CustomerSnapshotSchema = new mongoose.Schema(
  { name: String, company: String, department: String, email: String, phone: String },
  { _id: false },
);

const SampleSnapshotSchema = new mongoose.Schema(
  {
    itemSeq: { type: Number, required: true },
    sampleName: String,
    commonName: String,
    batchNo: String,
    lotNo: String,
    productionDate: String,
    sampleId: String,
    condition: String,
    manufacturer: String,
  },
  { _id: false },
);

const ResultSnapshotSchema = new mongoose.Schema(
  {
    itemSeq: { type: Number, required: true },
    testItem: String,
    result: String,
    criteria: String,
    method: String,
    unit: String,
  },
  { _id: false },
);

const TrendSnapshotSchema = new mongoose.Schema(
  {
    itemSeq: { type: Number, required: true },
    sampleName: String,
    commonName: String,
    aiLabelPercent: Number,
    aiResultPercent: Number,
    aiResultText: String,
  },
  { _id: false },
);

const PrintEventSchema = new mongoose.Schema(
  { event: String, printedAt: Date, printedBy: PersonSchema, copies: Number, outputMode: String },
  { _id: false },
);

const CancelSchema = new mongoose.Schema(
  {
    cancelledBy: PersonSchema,
    cancelledAt: Date,
    reason: {
      type: String,
      required: true,
      validate: {
        validator: (value) => typeof value === 'string' && value.trim().length > 0,
        message: 'COA cancellation reason is required',
      },
    },
  },
  { _id: false },
);

const STATUS = [
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

const ISSUED_SNAPSHOT_STATUSES = new Set(['approved', 'printed', 'reissued', 'cancelled', 'superseded']);
const SNAPSHOT_PATHS = ['customerSnapshot', 'sampleSnapshots', 'resultSnapshots', 'trendSnapshots', 'formSelections'];

function getUpdateValue(update = {}, path) {
  const operators = ['$set', '$setOnInsert'];
  if (Object.prototype.hasOwnProperty.call(update, path)) return update[path];
  for (const operator of operators) {
    if (update[operator] && Object.prototype.hasOwnProperty.call(update[operator], path)) {
      return update[operator][path];
    }
  }
  return undefined;
}

function getCurrentCancellationReason(doc) {
  return doc && doc.cancel ? doc.cancel.reason : undefined;
}

function updateTouchesPath(update = {}, path) {
  if (Array.isArray(update)) {
    return update.some((stage) => updateTouchesPath(stage, path));
  }

  if (update.$replaceRoot || update.$replaceWith) return true;
  const unsetPaths = update.$unset;
  if (
    (typeof unsetPaths === 'string' && (unsetPaths === path || unsetPaths.startsWith(`${path}.`))) ||
    (Array.isArray(unsetPaths) && unsetPaths.some((value) => (
      value === path || value.startsWith(`${path}.`)
    )))
  ) {
    return true;
  }

  const updateBuckets = [update];
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$') && value && typeof value === 'object') {
      updateBuckets.push(value);
    }
  }
  return updateBuckets.some((bucket) => Object.keys(bucket).some((key) => (
    key === path || key.startsWith(`${path}.`)
  )));
}

function updateTouchesCancellation(update = {}) {
  return updateTouchesPath(update, 'status') || updateTouchesPath(update, 'cancel');
}

function cancellationReasonAfterUpdate(update = {}, currentDoc) {
  if (updateTouchesPath(update, 'cancel.reason')) {
    if (update.$unset && Object.prototype.hasOwnProperty.call(update.$unset, 'cancel.reason')) {
      return undefined;
    }
    if (update.$rename && Object.prototype.hasOwnProperty.call(update.$rename, 'cancel.reason')) {
      return undefined;
    }
    return getUpdateValue(update, 'cancel.reason');
  }
  if (updateTouchesPath(update, 'cancel')) {
    if (update.$unset && Object.prototype.hasOwnProperty.call(update.$unset, 'cancel')) {
      return undefined;
    }
    if (update.$rename && Object.prototype.hasOwnProperty.call(update.$rename, 'cancel')) {
      return undefined;
    }
    const cancel = getUpdateValue(update, 'cancel');
    return cancel && typeof cancel === 'object' ? cancel.reason : undefined;
  }
  return getCurrentCancellationReason(currentDoc);
}

function filterTargetsIssuedStatus(filter = {}) {
  const status = filter.status;
  if (ISSUED_SNAPSHOT_STATUSES.has(status)) return true;
  if (status && Array.isArray(status.$in)) {
    return status.$in.some((value) => ISSUED_SNAPSHOT_STATUSES.has(value));
  }
  if (status && Array.isArray(status.$eq)) {
    return status.$eq.some((value) => ISSUED_SNAPSHOT_STATUSES.has(value));
  }
  if (status && ISSUED_SNAPSHOT_STATUSES.has(status.$eq)) return true;
  return false;
}

function filterProvesEditableStatus(filter = {}) {
  const status = filter.status;
  if (editableStatus(status)) return true;
  if (status && editableStatus(status.$eq)) return true;
  return Boolean(
    status &&
    Array.isArray(status.$in) &&
    status.$in.length > 0 &&
    status.$in.every((value) => editableStatus(value))
  );
}

function editableStatus(status) {
  return status === 'draft' || status === 'revisionDraft';
}

function updateTouchesSnapshot(update = {}) {
  return SNAPSHOT_PATHS.some((path) => updateTouchesPath(update, path));
}

function validateCoaQueryUpdate(filter = {}, update = {}, options = {}, currentDoc) {
  if (Array.isArray(update) && updateTouchesCancellation(update)) {
    throw new Error('COA aggregation pipeline updates cannot modify lifecycle fields');
  }

  const nextStatus = getUpdateValue(update, 'status');
  const effectiveStatus = nextStatus === undefined ? currentDoc && currentDoc.status : nextStatus;
  if (
    updateTouchesCancellation(update) &&
    effectiveStatus === 'cancelled' &&
    !hasNonEmptyCancellationReason(cancellationReasonAfterUpdate(update, currentDoc))
  ) {
    throw new Error('COA cancellation reason is required');
  }

  if (
    updateTouchesSnapshot(update) &&
    !options.allowCoaIssuedSnapshotMutation &&
    (filterTargetsIssuedStatus(filter) || (currentDoc && ISSUED_SNAPSHOT_STATUSES.has(currentDoc.status)))
  ) {
    throw new Error('Cannot edit issued COA snapshots');
  }
}

function hasNonEmptyCancellationReason(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requiresLegacyFormSelection() {
  return this.resultKeys === undefined;
}

const CoaDocumentSchema = new mongoose.Schema(
  {
    coaNo: { type: String, default: null, index: true },
    coaYear: Number,
    sequence: Number,
    revision: { type: Number, default: 0 },
    status: { type: String, enum: STATUS, required: true, default: 'draft', index: true },
    sourceType: { type: String, enum: ['lab', 'erpManual'], default: 'lab', immutable: true },
    externalRequestId: { type: String, index: true, immutable: true },
    externalCoaRequest: { type: mongoose.Schema.Types.Mixed, immutable: true },
    entryMode: { type: String, enum: ['source', 'manual'], default: 'source', index: true },
    petitionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Petition',
      required() { return this.sourceType !== 'erpManual' && !this.externalCoaRequest?.saleOrderNo; },
      index: true,
    },
    petitionNoSnapshot: String,
    selectedItemSeqs: { type: [Number], default: [] },
    sourceCoaId: { type: mongoose.Schema.Types.ObjectId, ref: 'CoaDocument' },
    supersedesCoaId: { type: mongoose.Schema.Types.ObjectId, ref: 'CoaDocument' },
    supersededByCoaId: { type: mongoose.Schema.Types.ObjectId, ref: 'CoaDocument' },
    customerSnapshot: CustomerSnapshotSchema,
    sampleSnapshots: { type: [SampleSnapshotSchema], default: [] },
    resultSnapshots: { type: [ResultSnapshotSchema], default: [] },
    trendSnapshots: { type: [TrendSnapshotSchema], default: [] },
    formSelections: {
      type: [new mongoose.Schema({
        itemSeq: { type: Number, required: true },
        resultKeys: {
          type: [String], default: undefined,
          validate: {
            validator: (keys) => keys === undefined || (Array.isArray(keys) && keys.length > 0
              && keys.every((key) => typeof key === 'string' && key.trim()) && new Set(keys).size === keys.length),
            message: 'ต้องเลือกผลพารามิเตอร์อย่างน้อยหนึ่งค่าและไม่ซ้ำกัน',
          },
        },
        aiKey: { type: String, required: requiresLegacyFormSelection },
        appearanceKey: { type: String, required: requiresLegacyFormSelection },
        appearanceSource: { type: String, required: requiresLegacyFormSelection },
        appearanceSpecification: { type: String, required: requiresLegacyFormSelection, maxlength: 300 },
        appearanceResult: { type: String, enum: ['Conform', 'Not conform'], required: requiresLegacyFormSelection },
        densityKey: String,
      }, { _id: false })],
      default: undefined,
    },
    remark: { type: String, default: '' },
    approval: {
      submittedBy: PersonSchema,
      submittedAt: Date,
      approvedBy: PersonSchema,
      approvedAt: Date,
      rejectedBy: PersonSchema,
      rejectedAt: Date,
      rejectReason: String,
    },
    cancel: CancelSchema,
    print: {
      printCount: { type: Number, default: 0 },
      lastPrintedAt: Date,
      lastPrintedBy: PersonSchema,
      printEvents: { type: [PrintEventSchema], default: [] },
    },
    createdBy: PersonSchema,
    updatedBy: PersonSchema,
  },
  { timestamps: true },
);

CoaDocumentSchema.index(
  { coaNo: 1, revision: 1 },
  { unique: true, partialFilterExpression: { coaNo: { $type: 'string' } } },
);
CoaDocumentSchema.index({ petitionId: 1, status: 1 });
CoaDocumentSchema.index({ status: 1, updatedAt: -1 });
CoaDocumentSchema.index({ coaYear: 1, sequence: -1 });

CoaDocumentSchema.pre('validate', function validateCancellationAndSnapshots(next) {
  if (
    this.status === 'cancelled' &&
    (!this.cancel || typeof this.cancel.reason !== 'string' || this.cancel.reason.trim().length === 0)
  ) {
    this.invalidate('cancel.reason', 'COA cancellation reason is required');
  }

  if (
    !this.isNew &&
    ISSUED_SNAPSHOT_STATUSES.has(this.status) &&
    !this.$locals.allowIssuedSnapshotMutation &&
    SNAPSHOT_PATHS.some((path) => this.isModified(path))
  ) {
    this.invalidate('customerSnapshot', 'Cannot edit issued COA snapshots');
  }

  next();
});

async function validateCoaQueryUpdateMiddleware() {
  const filter = this.getFilter();
  const update = this.getUpdate();
  const options = this.getOptions();
  const needsCurrentDoc =
    updateTouchesCancellation(update) ||
    (updateTouchesSnapshot(update) && !options.allowCoaIssuedSnapshotMutation && !filterProvesEditableStatus(filter));
  let currentDoc;

  if (needsCurrentDoc) {
    let lookup = this.model.findOne(filter).select('status cancel.reason');
    if (options.session && typeof lookup.session === 'function') {
      lookup = lookup.session(options.session);
    }
    currentDoc = await lookup.lean();
  }
  validateCoaQueryUpdate(filter, update, options, currentDoc);
}

CoaDocumentSchema.pre('updateOne', validateCoaQueryUpdateMiddleware);
CoaDocumentSchema.pre('findOneAndUpdate', validateCoaQueryUpdateMiddleware);

module.exports = mongoose.model('CoaDocument', CoaDocumentSchema);
module.exports.COA_STATUSES = STATUS;
module.exports.validateCoaQueryUpdate = validateCoaQueryUpdate;
