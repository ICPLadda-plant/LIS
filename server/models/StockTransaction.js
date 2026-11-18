const mongoose = require('mongoose');

const PersonSchema = new mongoose.Schema({
  email: { type: String, default: '' },
  name: { type: String, default: '' },
}, { _id: false });

const DeductionResolutionSchema = new mongoose.Schema({
  reason: { type: String, enum: ['empty', 'ineffective', 'other', 'expired'] },
  note: { type: String, default: '' },
  resolvedAt: Date,
  resolvedBy: { type: PersonSchema, default: undefined },
}, { _id: false });

const StockTransactionSchema = new mongoose.Schema({
  itemType: { type: String, enum: ['standard', 'solvent', 'glassware'], required: true, index: true },
  itemId: { type: String, required: true, index: true },
  itemCode: String,
  itemName: String,
  action: { type: String, enum: ['create', 'update', 'delete', 'deduct', 'receive', 'withdraw', 'discard'], required: true, index: true },
  tier: { type: String, enum: ['primary', 'supplier', 'working', null], default: null },
  beforeQty: { type: Number, default: null },
  afterQty: { type: Number, default: null },
  delta: { type: Number, default: null },
  unit: String,
  sampleId: String,
  petitionNo: { type: String, index: true },
  note: String,
  unitId: String,
  qrId: String,
  volumeDelta: { type: Number, default: null },
  volumeUnit: String,
  weights: { type: [Number], default: undefined },
  instrumentId: String,
  instrumentName: String,
  instrumentGroup: { type: String, enum: ['gc', 'hplc', null], default: null },
  deductionResolution: { type: DeductionResolutionSchema, default: undefined },
  photoUrls: { type: [String], default: undefined },
  userEmail: String,
  userName: String,
}, { timestamps: true });

StockTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('StockTransaction', StockTransactionSchema);
