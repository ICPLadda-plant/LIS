const mongoose = require("mongoose");

const qcTestResultSchema = new mongoose.Schema(
  {
    petitionId:    { type: String, required: true },
    petitionNo:    { type: String },
    itemSeq:       { type: Number, required: true },
    sampleId:      { type: String },
    sampleName:    { type: String },
    commonName:    { type: String },
    parameterId:   { type: String, required: true },
    parameterName: { type: String },
    sampleRoundId: { type: String, default: '' },
    values:        { type: mongoose.Schema.Types.Mixed, default: {} },
    // Phase 2 values — for 2-phase parameters only. Same field labels as `values`
    // but holding the "after" measurements. Regular (non-phased) parameters leave this empty.
    valuesPhase2:  { type: mongoose.Schema.Types.Mixed, default: {} },
    // For multiEntry parameters only — an array of value-objects, each holding
    // the full field set for one entry. Empty/absent for normal parameters.
    entries:       { type: [mongoose.Schema.Types.Mixed], default: undefined },
    // หมายเหตุอิสระของผู้บันทึกผล ต่อ parameter ต่อตัวอย่าง (ใช้ทั้ง QC และ Lab) — ไม่พิมพ์ใน COA
    remark:        { type: String, default: '' },
    remarkBy:      { name: String, email: String },
    remarkAt:      { type: Date },
    enteredBy:     { name: String, email: String },
    enteredAt:     { type: Date },
    updatedBy:     { name: String, email: String },
    updatedAt:     { type: Date },
  },
  { timestamps: false }
);

qcTestResultSchema.index(
  { petitionId: 1, itemSeq: 1, parameterId: 1 },
  { unique: true }
);

qcTestResultSchema.index({ commonName: 1, parameterId: 1, enteredAt: -1 });

module.exports = mongoose.model("QCTestResult", qcTestResultSchema);
