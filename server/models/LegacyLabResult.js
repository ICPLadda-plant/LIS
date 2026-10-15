const mongoose = require('mongoose');

const LegacyLabResultSchema = new mongoose.Schema({}, {
  collection: 'lab_result',
  strict: false,
  timestamps: false,
});

module.exports = mongoose.model('LegacyLabResult', LegacyLabResultSchema);
