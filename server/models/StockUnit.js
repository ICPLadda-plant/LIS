const mongoose = require('mongoose');
const { normalizeQuantity } = require('../lib/stockQuantity');

const VolumeSchema = new mongoose.Schema({
  initial: { type: Number, default: 0, set: normalizeQuantity },
  remaining: { type: Number, default: 0, set: normalizeQuantity },
  unit: { type: String, enum: ['ml', 'mg', 'g'], default: 'mg' },
}, { _id: false });

const PersonSchema = new mongoose.Schema({
  email: { type: String, default: '' },
  name: { type: String, default: '' },
}, { _id: false });

const StockUnitSchema = new mongoose.Schema({
  qrId: { type: String, required: true, unique: true, index: true },
  itemCode: { type: String, required: true, index: true },
  itemName: { type: String, default: '' },
  itemType: { type: String, enum: ['standard', 'solvent'], default: 'standard', index: true },
  itemId: { type: String, default: '', index: true },
  kind: { type: String, enum: ['sealed', 'working'], required: true },
  source: { type: String, enum: ['primary', 'supply', ''], default: '' }, // deprecated → type
  type: { type: String, enum: ['primary', 'supplier', 'working', ''], default: '', index: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StockUnit', default: null },
  lotNo: { type: String, default: '' },
  purity: { type: String, default: '' },
  lotBottleNo: { type: Number, default: null, min: 1 },
  labelCode: { type: String, default: '', trim: true, index: true },
  labelRunNo: { type: Number, default: null, min: 1 },
  labelRunYear: { type: Number, default: null, min: 2000 },
  exp: { type: Date, default: null },
  frequencyDue: { type: Date, default: null },
  volume: { type: VolumeSchema, default: () => ({}) },
  status: { type: String, enum: ['active', 'empty', 'discarded'], default: 'active', index: true },
  receivedDate: { type: Date, default: null },
  withdrawnDate: { type: Date, default: null },
  discardedAt: { type: Date, default: null },
  discardedBy: { type: PersonSchema, default: undefined },
  discardReason: { type: String, default: '' },
  createdBy: { type: PersonSchema, default: undefined },
  photoUrls: { type: [String], default: undefined },
}, { timestamps: true });

StockUnitSchema.index({ exp: 1 });
StockUnitSchema.index({ itemCode: 1, labelRunYear: 1, labelRunNo: 1 });
StockUnitSchema.index({ itemCode: 1, labelCode: 1 });

module.exports = mongoose.model('StockUnit', StockUnitSchema);
