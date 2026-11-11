const mongoose = require('mongoose');
const { softDeletePlugin } = require('../lib/softDelete');
const bcrypt = require('bcryptjs');
const { primaryRole, normalizeRoles } = require('../lib/roles');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true },
  name: String,
  password: String,
  role: { type: String, default: 'viewer' },
  roles: { type: [String], default: [] },
  department: { type: String, default: 'Unassigned' },
  position: { type: String, default: 'Unassigned' },
  employeeId: { type: String, default: '' },
  signatureUrl: { type: String, default: '' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  // ผู้ใช้เดิม/ผู้ใช้ที่ admin เพิ่มเอง = approved; Microsoft login ครั้งแรก = pending
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  approvedAt: Date,
  approvedBy: String,
  lastActive: { type: String, default: 'Never' },
  authProvider: { type: String, enum: ['local', 'microsoft', 'production'], default: 'local' },
  microsoftId: String,
  tenantId: String,
}, { timestamps: true });

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Keep the legacy single `role` and the new `roles[]` consistent. If roles[] is
// set it wins and `role` becomes the primary; if only the legacy `role` is set,
// seed roles[] from it. Lets old single-role docs migrate lazily on next save.
UserSchema.pre('save', function (next) {
  const roles = normalizeRoles(this);
  this.roles = roles;
  this.role = primaryRole(roles);
  next();
});

UserSchema.methods.comparePassword = function (plain) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(plain, this.password);
};

UserSchema.index({ email: 1, deletedAt: 1 }, { unique: true });
// One employee record maps to at most one (non-deleted) user. Partial filter so
// only non-empty employeeIds are constrained — many users may sit unlinked ('').
UserSchema.index(
  { employeeId: 1, deletedAt: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $gt: '' } } },
);

UserSchema.plugin(softDeletePlugin);
module.exports = mongoose.model('User', UserSchema);
