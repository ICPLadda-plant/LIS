const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { requireAdminUser, requireAuthenticatedUser } = require('../lib/adminGate');
router.use((req, res, next) => {
  if ((req.method === 'GET' && req.path === '/') || (req.method === 'POST' && req.path === '/users/microsoft')) {
    return requireAuthenticatedUser(req, res, next);
  }
  return requireAdminUser(req, res, next);
});
const User = require('../models/User');
const Role = require('../models/Role');
const AccessGroup = require('../models/AccessGroup');
const {
  DEFAULT_ACCESS_GROUPS: defaultGroups,
  PETITION_BACKFILL_PATHS,
  findOrphanBackfillPaths,
  findGroupForBackfill,
} = require('../lib/accessGroups');
const { resolveHrField } = require('../lib/userProfile');
const { primaryRole, normalizeRoles, unionPermissions } = require('../lib/roles');
const { fetchMonthlyEmployees } = require('../lib/employeeDirectory');
const { findEmployeeByEmail, findEmployeeById, planEmployeeSync } = require('../lib/employeeLink');
const { isStorablePermission } = require('../lib/permissionFilter');
const { isValidProfileId } = require('../lib/dashboardProfiles');
const { roleInUse } = require('../lib/roleUsage');
const {
  LAB_BASE_ROLE,
  QC_BASE_ROLE,
  normalizeRoleFamily,
  roleFamilyForId,
  mergeBaseRolesForFamilies,
  applyBaseRolesToUser,
} = require('../lib/roleFamilies');

const defaultRoles = [
  { id: 'admin', name: 'Administrator', description: 'Full system access', locked: true, permissions: defaultGroups.map(g => g.id), family: '' },
  { id: LAB_BASE_ROLE, name: 'Lab Analyze', description: 'Base Lab analysis workspace', permissions: ['dashboard', 'samples', 'results', '/petition/assign', '/lab-testing', '/lab-testing/:id'], family: 'lab', dashboardProfile: 'lab-analyze' },
  { id: QC_BASE_ROLE, name: 'QC Staff', description: 'Base QC receiving and tracking workspace', permissions: ['dashboard', 'samples', 'qc', '/qc-testing', '/qc-testing/:id'], family: 'qc', dashboardProfile: 'qc-staff' },
  { id: 'qc-head', name: 'QC Head', description: 'Full Access Data and Approve', permissions: ['/petitions', '/qc-approval', '/stock'], family: 'qc' },
  { id: 'qc-approver', name: 'QC Approver', description: 'อนุมัติหรือไม่อนุมัติผล QC (ไม่รวมผล Lab)', permissions: ['/qc-approval', 'deny:/qc-approval/lab'], family: 'qc' },
  { id: 'lab', name: 'Lab Analyst', description: 'Sample handling and result entry', permissions: ['dashboard', 'samples', 'results', 'stock'], family: 'lab' },
  { id: 'qc', name: 'QC Reviewer', description: 'Review and approve results', permissions: ['dashboard', 'results', 'qc', 'reports'], family: 'qc' },
  { id: 'viewer', name: 'Viewer', description: 'Read-only access to dashboards and reports', permissions: ['dashboard', 'reports'], family: '' },
];

const knownRoleFamilies = new Map([
  ['lab', 'lab'],
  [LAB_BASE_ROLE, 'lab'],
  ['lab-data-config', 'lab'],
  ['lab-config', 'lab'],
  ['lab-head', 'lab'],
  ['lab-inventory', 'lab'],
  ['qc', 'qc'],
  [QC_BASE_ROLE, 'qc'],
  ['qc-reviewer', 'qc'],
  ['qc-data-config', 'qc'],
  ['qc-head', 'qc'],
  ['qc-approver', 'qc'],
]);

const defaultRolePermissionGrants = [
  { id: 'qc-head', permissions: ['/stock'] },
];

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizePaths(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

// One-time migration from legacy `accessmodules` collection to the new
// `accessgroups` collection. Runs only when the new collection is empty.
async function migrateLegacyModules() {
  const count = await AccessGroup.countDocuments();
  if (count > 0) return;
  try {
    const legacy = await mongoose.connection.db
      .collection('accessmodules')
      .find({})
      .toArray();
    if (!legacy.length) return;
    await AccessGroup.insertMany(
      legacy.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description || '',
        paths: m.paths?.length ? m.paths : [m.path].filter(Boolean),
        locked: !!m.locked,
        sortOrder: typeof m.sortOrder === 'number' ? m.sortOrder : 0,
      })),
      { ordered: false },
    );
    await mongoose.connection.db.collection('accessmodules').drop().catch(() => {});
  } catch {
    // Legacy collection may not exist; nothing to do.
  }
}

async function ensureGroups() {
  await migrateLegacyModules();

  // 'others' is the locked catch-all that the sidebar relies on as a fallback —
  // it must always exist, even if every other group has been deleted. Because
  // it's never deletable, a freshly-inserted 'others' is a reliable marker that
  // this is the very first run on this database.
  const othersDefault = defaultGroups.find(group => group.id === 'others');
  let firstRun = false;
  if (othersDefault) {
    const result = await AccessGroup.updateOne(
      { id: 'others' },
      { $setOnInsert: othersDefault },
      { upsert: true },
    );
    firstRun = result.upsertedCount === 1;
  }

  // First-time seed only. Seed the default groups exactly once, on the first
  // run ever (detected via 'others' above). After that, never re-create deleted
  // defaults — deletions must stick across refreshes, even if the admin deletes
  // every group. The extra count guard avoids re-seeding on top of groups that
  // a legacy migration already created.
  if (firstRun) {
    const existingNonOthers = await AccessGroup.countDocuments({ id: { $ne: 'others' } });
    if (existingNonOthers === 0) {
      const seeds = defaultGroups.filter(group => group.id !== 'others');
      if (seeds.length) {
        await AccessGroup.insertMany(seeds, { ordered: false }).catch(() => {});
      }
    }
  }

  await AccessGroup.updateOne({ id: 'others' }, { $set: { locked: true } });

  // Backfill pages added after the original seed (/simple-method, /machines)
  // ONLY when no group claims them yet — giving legacy DBs a default home in
  // 'stock' without ever forcing the page back once an admin has regrouped it.
  // (Doing this unconditionally made Simple Method un-movable between groups.)
  const existingGroups = await AccessGroup.find().lean();
  const orphanPaths = findOrphanBackfillPaths(existingGroups);
  if (orphanPaths.length) {
    await AccessGroup.updateOne(
      { id: 'stock' },
      { $addToSet: { paths: { $each: orphanPaths } } },
    );
  }
  const petitionListPaths = findOrphanBackfillPaths(existingGroups, PETITION_BACKFILL_PATHS);
  const petitionListGroupId = findGroupForBackfill(existingGroups, 'samples', '/petition');
  if (petitionListPaths.length && petitionListGroupId) {
    await AccessGroup.updateOne(
      { id: petitionListGroupId },
      { $addToSet: { paths: { $each: petitionListPaths } } },
    );
  }
  const coaPaths = findOrphanBackfillPaths(existingGroups, ['/coa', '/coa/:id']);
  const coaGroupId = findGroupForBackfill(existingGroups, 'qc', '/qc-approval');
  if (coaPaths.length && coaGroupId) {
    await AccessGroup.updateOne(
      { id: coaGroupId },
      { $addToSet: { paths: { $each: coaPaths } } },
    );
  }
  const assignPaths = findOrphanBackfillPaths(existingGroups, ['/petition/assign']);
  const assignGroupId =
    findGroupForBackfill(existingGroups, 'lab', '/petitions-old/assign') ||
    findGroupForBackfill(existingGroups, 'lab', '/lab-testing') ||
    findGroupForBackfill(existingGroups, 'results', '/record-results');
  if (assignPaths.length && assignGroupId) {
    await AccessGroup.updateOne(
      { id: assignGroupId },
      { $addToSet: { paths: { $each: assignPaths } } },
    );
  }
  return AccessGroup.find().sort({ sortOrder: 1, name: 1 }).lean();
}

async function ensureRoleFamilyDefaults() {
  // qc-approver: สร้างครั้งแรกเท่านั้น (admin แก้สิทธิ์ต่อได้ใน access matrix โดยไม่ถูกทับ)
  for (const role of defaultRoles.filter((item) => [LAB_BASE_ROLE, QC_BASE_ROLE, 'qc-approver'].includes(item.id))) {
    await Role.updateOne(
      { id: role.id },
      { $setOnInsert: role },
      { upsert: true },
    );
  }
  for (const [id, family] of knownRoleFamilies.entries()) {
    await Role.updateOne(
      { id, $or: [{ family: { $exists: false } }, { family: null }] },
      { $set: { family } },
    );
  }
}

async function ensureDefaultRolePermissionGrants() {
  for (const grant of defaultRolePermissionGrants) {
    await Role.updateOne(
      { id: grant.id },
      { $addToSet: { permissions: { $each: grant.permissions } } },
    );
  }
}

async function ensureDefaults() {
  const groups = await ensureGroups();
  const count = await Role.countDocuments();
  if (count === 0) {
    await Role.insertMany(defaultRoles);
  }
  await Role.updateOne(
    { id: 'admin' },
    { $addToSet: { permissions: { $each: groups.map(group => group.id) } } },
  );
  await ensureRoleFamilyDefaults();
  await ensureDefaultRolePermissionGrants();
  return groups;
}

async function getRolePermissions(rolesInput) {
  const roles = normalizeRoles(
    Array.isArray(rolesInput) ? { roles: rolesInput } : { role: rolesInput },
  );
  if (roles.length === 0) roles.push('viewer');
  const roleDocs = await Role.find(roles.includes('admin') ? {} : { id: { $in: roles } }).lean();
  const permsByRole = Object.fromEntries(roleDocs.map((r) => [r.id, r.permissions || []]));
  return unionPermissions(roles, permsByRole);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function uniqueRoleIds(values, fallback = 'viewer') {
  const source = Array.isArray(values) && values.length > 0 ? values : [fallback];
  const seen = new Set();
  const out = [];
  for (const value of source) {
    const id = String(value ?? '').trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length > 0 ? out : [fallback];
}

async function normalizeRequestedRoles(values, fallback = 'viewer') {
  const requested = uniqueRoleIds(values, fallback);
  const found = await Role.find({ id: { $in: requested } }).lean();
  const foundIds = new Set(found.map((role) => role.id));
  const missing = requested.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    const error = new Error('role not found');
    error.status = 400;
    throw error;
  }
  return mergeBaseRolesForFamilies(requested, found);
}

async function applyStoredBaseRoles(user) {
  const current = normalizeRoles(user);
  const roleDocs = current.length > 0 ? await Role.find({ id: { $in: current } }).lean() : [];
  applyBaseRolesToUser(user, roleDocs);
  return user;
}

function formatUser(user, permissions) {
  const roles = normalizeRoles(user);
  return {
    id: user._id.toString(),
    name: user.name || '',
    email: user.email,
    roleId: primaryRole(roles),
    roleIds: roles,
    permissions,
    department: user.department || 'Unassigned',
    position: user.position || 'Unassigned',
    employeeId: user.employeeId || '',
    signatureUrl: user.signatureUrl || '',
    status: user.status || 'active',
    lastActive: user.lastActive || 'Never',
    authProvider: user.authProvider || 'local',
  };
}

function formatRole(role) {
  const rawRole = typeof role?.toObject === 'function'
    ? role.toObject({ defaults: false })
    : role;
  const hasFamilyMetadata = typeof role?.$isDefault === 'function'
    ? !role.$isDefault('family') && role.family !== null
    : hasOwn(rawRole, 'family') && rawRole.family !== null;
  const family = hasFamilyMetadata
    ? normalizeRoleFamily(rawRole.family)
    : roleFamilyForId(rawRole.id);
  return {
    id: rawRole.id,
    name: rawRole.name,
    description: rawRole.description || '',
    locked: rawRole.locked,
    dashboardProfile: rawRole.dashboardProfile || null,
    family,
  };
}

function formatGroup(group) {
  return {
    id: group.id,
    name: group.name,
    description: group.description || '',
    paths: group.paths || [],
    locked: group.locked,
    sortOrder: group.sortOrder ?? 0,
  };
}

// Resolve the HR employee record for an email (live webhook). Returns the fields
// to apply, or null if no match / HR unreachable. Non-fatal: never throws —
// logs and returns null so login flows continue.
async function resolveEmployeeLink(email) {
  try {
    const emp = findEmployeeByEmail(await fetchMonthlyEmployees(), email);
    if (emp) {
      return { employeeId: emp.employeeId, name: emp.name, department: emp.department, position: emp.position };
    }
  } catch (e) {
    console.error('[auto-link] employee sync failed:', e.message);
  }
  return null;
}

// Resolve the HR record to apply for a user, preferring the already-linked
// employeeId (source of truth once linked) and falling back to an email match
// (first-time auto-link). One webhook fetch; non-fatal — returns null on miss/HR
// down so login flows continue. Once linked, HR owns the display name too.
async function resolveEmployeeForUser(employeeId, email) {
  try {
    const employees = await fetchMonthlyEmployees();
    const emp =
      (employeeId && findEmployeeById(employees, employeeId)) ||
      findEmployeeByEmail(employees, email);
    if (emp) {
      return { employeeId: emp.employeeId, name: emp.name, department: emp.department, position: emp.position };
    }
  } catch (e) {
    console.error('[auto-link] employee sync failed:', e.message);
  }
  return null;
}

router.get('/', async (req, res) => {
  try {
    const groups = await ensureDefaults();
    const [users, roles] = await Promise.all([
      User.find().sort({ name: 1, email: 1 }),
      Role.find().sort({ locked: -1, name: 1 }),
    ]);
    res.json({
      users: users.map(formatUser),
      roles: roles.map(formatRole),
      groups: groups.map(formatGroup),
      permissions: Object.fromEntries(roles.map(role => [role.id, role.permissions || []])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    await ensureDefaults();
    const { name, email, department, position, roleId, roleIds, status } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const requested = await normalizeRequestedRoles(
      Array.isArray(roleIds) && roleIds.length > 0 ? roleIds : [roleId || 'viewer'],
      'viewer',
    );

    const user = await User.create({
      name,
      email,
      department,
      position,
      roles: requested,
      status: status || 'active',
      lastActive: 'Never',
    });
    res.status(201).json(formatUser(user, await getRolePermissions(requested)));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already exists' });
    res.status(400).json({ error: err.message });
  }
});

router.post('/users/microsoft', async (req, res) => {
  try {
    await ensureDefaults();
    const { email, name, microsoftId, tenantId, department, position } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const normalizedEmail = String(email).toLowerCase();
    const now = new Date().toISOString();
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      user.authProvider = 'microsoft';
      user.microsoftId = microsoftId || user.microsoftId;
      user.tenantId = tenantId || user.tenantId;
      // Sync แผนก/ตำแหน่ง from Microsoft Graph, but never wipe an admin-set
      // value when Graph has nothing for this user.
      user.department = resolveHrField(department, user.department);
      user.position = resolveHrField(position, user.position);
      // Resolve the HR record (by existing link first, else auto-link by email).
      // Auto-link only fills an empty employeeId — never overwrites a manual link.
      const emp = await resolveEmployeeForUser(user.employeeId, normalizedEmail);
      if (emp && !user.employeeId) user.employeeId = emp.employeeId;
      if (emp && user.employeeId === emp.employeeId) {
        // Linked to an HR employee → HR is the source of truth for the display
        // name (refreshed every login) and แผนก/ตำแหน่ง, not Microsoft.
        user.name = emp.name || name || user.name || normalizedEmail;
        user.department = emp.department || user.department;
        user.position = emp.position || user.position;
      } else {
        user.name = name || user.name || normalizedEmail;
      }
      user.lastActive = now;
      await applyStoredBaseRoles(user);
      try {
        await user.save();
      } catch (e) {
        // An auto-linked employeeId that collides with another user's link must
        // not break login — drop the link (fixable later via the picker) and retry.
        if (e.code === 11000 && (e.keyPattern?.employeeId || /employeeId/.test(e.message || ''))) {
          user.employeeId = '';
          await user.save();
        } else {
          throw e;
        }
      }
      return res.json(formatUser(user, await getRolePermissions(normalizeRoles(user))));
    }

    const existingUsers = await User.countDocuments();
    const role = existingUsers === 0 ? 'admin' : 'viewer';
    // HR is the source of truth for แผนก/ตำแหน่ง when matched; otherwise keep the
    // resolveHrField/Graph value. Resolved before create so there's a single write.
    const link = await resolveEmployeeLink(normalizedEmail);
    const resolvedDepartment = (link && link.department) || resolveHrField(department, undefined);
    const resolvedPosition = (link && link.position) || resolveHrField(position, undefined);
    const roles = await normalizeRequestedRoles([role], role);
    const newUserDoc = {
      email: normalizedEmail,
      // HR is the source of truth for the display name once linked.
      name: (link && link.name) || name || normalizedEmail,
      role,
      roles,
      department: resolvedDepartment,
      position: resolvedPosition,
      employeeId: (link && link.employeeId) || '',
      status: 'active',
      lastActive: now,
      authProvider: 'microsoft',
      microsoftId,
      tenantId,
    };
    try {
      user = await User.create(newUserDoc);
    } catch (e) {
      // employeeId collision must not break first login — create without the link.
      if (e.code === 11000 && (e.keyPattern?.employeeId || /employeeId/.test(e.message || ''))) {
        user = await User.create({ ...newUserDoc, employeeId: '' });
      } else {
        throw e; // genuine email dup → outer catch → 409
      }
    }

    res.status(201).json(formatUser(user, await getRolePermissions(normalizeRoles(user))));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already exists' });
    res.status(400).json({ error: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    await ensureDefaults();
    const patch = {};
    ['name', 'email', 'department', 'position', 'status', 'lastActive'].forEach(key => {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    });
    if (req.body.roleIds !== undefined || req.body.roleId !== undefined) {
      patch.roles = await normalizeRequestedRoles(
        Array.isArray(req.body.roleIds) && req.body.roleIds.length > 0
          ? req.body.roleIds
          : [req.body.roleId],
        'viewer',
      );
    }

    if (req.body.employeeId !== undefined) {
      const employeeId = String(req.body.employeeId || '').trim();
      if (employeeId) {
        // Block linking the same employee to two users (the partial unique index
        // is the backstop; this gives a friendly 409).
        const dupe = await User.findOne({ employeeId, _id: { $ne: req.params.id } });
        if (dupe) {
          return res.status(409).json({ error: 'employee already linked to another user' });
        }
        patch.employeeId = employeeId;
        // Pull แผนก/ตำแหน่ง from the HR record (source of truth). Webhook down =
        // link the id only, leave dept/position untouched.
        try {
          const emp = findEmployeeById(await fetchMonthlyEmployees(), employeeId);
          if (emp) {
            // Linked → HR owns the display name + แผนก/ตำแหน่ง (overrides any
            // name sent in the same request body).
            patch.name = emp.name || patch.name;
            patch.department = emp.department || undefined;
            patch.position = emp.position || undefined;
          }
        } catch (e) {
          // HR webhook down — link id only.
        }
      } else {
        patch.employeeId = ''; // unlink
      }
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'user not found' });
    Object.assign(user, patch);
    await applyStoredBaseRoles(user);
    await user.save();
    res.json(formatUser(user));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'employee already linked to another user' });
    res.status(400).json({ error: err.message });
  }
});

router.post('/users/sync-employees', async (_req, res) => {
  try {
    await ensureDefaults();
    const employees = await fetchMonthlyEmployees();
    const users = await User.find();
    const plan = planEmployeeSync(
      users.map(u => ({ id: u._id.toString(), email: u.email, employeeId: u.employeeId || '' })),
      employees,
    );
    const usersById = new Map(users.map((u) => [u._id.toString(), u]));
    for (const update of plan.updates) {
      const user = usersById.get(update.userId);
      if (!user) continue;
      user.employeeId = update.employeeId;
      if (update.name) user.name = update.name;
      if (update.department) user.department = update.department;
      if (update.position) user.position = update.position;
      await applyStoredBaseRoles(user);
      await user.save();
    }
    res.json({ linked: plan.linked, alreadyLinked: plan.alreadyLinked, unmatched: plan.unmatched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (normalizeRoles(user).includes('admin')) {
      return res.status(400).json({ error: 'admin users cannot be deleted here' });
    }
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    await user.softDelete(actor);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/roles', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!hasOwn(req.body, 'family')) return res.status(400).json({ error: 'family is required' });
    const family = normalizeRoleFamily(req.body.family);
    if (String(req.body.family ?? '').trim() && !family) {
      return res.status(400).json({ error: 'invalid family' });
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const role = await Role.create({ id, name, description, family, permissions: [] });
    res.status(201).json(formatRole(role));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Role already exists' });
    res.status(400).json({ error: err.message });
  }
});

router.patch('/roles/:id', async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body.name === 'string') updates.name = req.body.name;
    if (typeof req.body.description === 'string') updates.description = req.body.description;
    if ('family' in req.body) {
      const family = normalizeRoleFamily(req.body.family);
      if (String(req.body.family ?? '').trim() && !family) {
        return res.status(400).json({ error: 'invalid family' });
      }
      updates.family = family;
    }
    if ('dashboardProfile' in req.body) {
      if (!isValidProfileId(req.body.dashboardProfile)) {
        return res.status(400).json({ error: 'invalid dashboardProfile' });
      }
      updates.dashboardProfile = req.body.dashboardProfile || '';
    }
    const role = await Role.findOneAndUpdate({ id: req.params.id }, updates, { new: true });
    if (!role) return res.status(404).json({ error: 'role not found' });
    res.json(formatRole(role));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/roles/:id', async (req, res) => {
  try {
    const role = await Role.findOne({ id: req.params.id });
    if (!role) return res.status(404).json({ error: 'role not found' });
    if (role.locked) return res.status(400).json({ error: 'locked role cannot be deleted' });
    const users = await User.find();
    // Map the actual User schema (legacy singular `role` + current `roles[]`)
    // onto the generic { roleId, roleIds } shape roleInUse() expects.
    if (roleInUse(users.map((u) => ({ roleId: u.role, roleIds: u.roles })), req.params.id)) {
      const userCount = users.filter((u) => {
        const ids = (u.roles && u.roles.length) ? u.roles : (u.role ? [u.role] : []);
        return ids.includes(req.params.id);
      }).length;
      return res.status(409).json({ error: 'role has assigned users', userCount });
    }
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    await role.softDelete(actor);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/roles/:id/permissions', async (req, res) => {
  try {
    const groups = await ensureGroups();
    const validIds = new Set([
      ...groups.map(group => group.id),
      ...groups.flatMap(group => group.paths || []),
    ]);
    // Also accept route-shaped strings (`/...`) so per-page entries from the
    // computed 'others' group — paths that live only in the frontend's
    // PAGE_ITEMS and aren't stored in any group's `paths` — survive the filter.
    const permissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.filter(id => isStorablePermission(id, validIds))
      : [];
    const role = await Role.findOneAndUpdate(
      { id: req.params.id },
      { permissions },
      { new: true },
    );
    if (!role) return res.status(404).json({ error: 'role not found' });
    res.json({ roleId: role.id, permissions: role.permissions });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/groups', async (req, res) => {
  try {
    const { name, description } = req.body;
    const paths = normalizePaths(req.body.paths);
    const id = slugify(req.body.id || name);
    if (!id) return res.status(400).json({ error: 'group id is required' });
    if (!name) return res.status(400).json({ error: 'group name is required' });

    // Place new groups right after the current last group, but always before
    // the locked 'others' catch-all (sortOrder 999).
    const last = await AccessGroup.findOne({ id: { $ne: 'others' } })
      .sort({ sortOrder: -1 })
      .lean();
    const sortOrder = (last?.sortOrder ?? 0) + 10;

    const group = await AccessGroup.create({
      id,
      name,
      description,
      paths,
      locked: false,
      sortOrder,
    });
    await Role.updateOne({ id: 'admin' }, { $addToSet: { permissions: group.id } });
    res.status(201).json(formatGroup(group));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Group already exists' });
    res.status(400).json({ error: err.message });
  }
});

router.patch('/groups/:id', async (req, res) => {
  try {
    const patch = {};
    ['name', 'description', 'sortOrder'].forEach(key => {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    });
    // 'others' membership stays computed (catch-all), but its paths are still
    // writable as an ordering hint for the sidebar.
    if (req.body.paths !== undefined) {
      patch.paths = normalizePaths(req.body.paths);
    }
    const group = await AccessGroup.findOneAndUpdate(
      { id: req.params.id },
      patch,
      { new: true },
    );
    if (!group) return res.status(404).json({ error: 'group not found' });
    res.json(formatGroup(group));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/groups/:id', async (req, res) => {
  try {
    const group = await AccessGroup.findOne({ id: req.params.id });
    if (!group) return res.status(404).json({ error: 'group not found' });
    if (group.locked) return res.status(400).json({ error: 'locked group cannot be deleted' });
    const actor = req.query.actor || (req.body && req.body.actor) || 'system';
    await group.softDelete(actor);
    await Role.updateMany({}, { $pull: { permissions: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
