const mongoose = require('mongoose');

const ExternalCoaRequestDismissalSchema = new mongoose.Schema({
  externalRequestId: { type: String, required: true, unique: true, trim: true },
  dismissedBy: { name: String, email: String, role: String },
}, { timestamps: true });

module.exports = mongoose.model('ExternalCoaRequestDismissal', ExternalCoaRequestDismissalSchema);
