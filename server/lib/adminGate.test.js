const { createAdminGate } = require('./adminGate');

function makeReq(headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[String(name).toLowerCase()] };
}
function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const USERS = {
  'admin@icpladda.com': { email: 'admin@icpladda.com', name: 'แอดมิน', roles: ['admin'] },
  'lab@icpladda.com': { email: 'lab@icpladda.com', name: 'แล็บ', roles: ['lab'] },
};
const deps = {
  findUserByEmail: async (email) => USERS[email] || null,
  isDevBypass: () => false,
  warn: () => {},
};

test('ไม่มี header X-LIS-User → 401', async () => {
  const gate = createAdminGate(deps);
  const res = makeRes();
  let called = false;
  await gate(makeReq(), res, () => { called = true; });
  expect(called).toBe(false);
  expect(res.statusCode).toBe(401);
});

test('user ไม่ใช่ admin → 403', async () => {
  const gate = createAdminGate(deps);
  const res = makeRes();
  await gate(makeReq({ 'X-LIS-User': 'lab@icpladda.com' }), res, () => {});
  expect(res.statusCode).toBe(403);
});

test('ไม่มี user คนนี้ใน DB → 403', async () => {
  const gate = createAdminGate(deps);
  const res = makeRes();
  await gate(makeReq({ 'X-LIS-User': 'ghost@icpladda.com' }), res, () => {});
  expect(res.statusCode).toBe(403);
});

test('admin ผ่าน และตั้ง req.adminUser (ตัวพิมพ์ใหญ่ในอีเมลก็ต้องผ่าน)', async () => {
  const gate = createAdminGate(deps);
  const req = makeReq({ 'X-LIS-User': 'Admin@ICPLadda.com' });
  let called = false;
  await gate(req, makeRes(), () => { called = true; });
  expect(called).toBe(true);
  expect(req.adminUser).toEqual({ email: 'admin@icpladda.com', name: 'แอดมิน' });
});

test('โหมด dev (ALLOW_DEV_STATUS) ผ่านได้โดยไม่ต้องมี header', async () => {
  const gate = createAdminGate({ ...deps, isDevBypass: () => true });
  let called = false;
  await gate(makeReq(), makeRes(), () => { called = true; });
  expect(called).toBe(true);
});

test('DB พัง → 500 ไม่ใช่ปล่อยผ่าน', async () => {
  const gate = createAdminGate({
    ...deps,
    findUserByEmail: async () => { throw new Error('db down'); },
  });
  const res = makeRes();
  let called = false;
  await gate(makeReq({ 'X-LIS-User': 'admin@icpladda.com' }), res, () => { called = true; });
  expect(called).toBe(false);
  expect(res.statusCode).toBe(500);
});

test('admin ที่ถูกระงับ (inactive) → 403', async () => {
  const gate = createAdminGate({
    ...deps,
    findUserByEmail: async () => ({ email: 'old-admin@icpladda.com', name: 'อดีตแอดมิน', roles: ['admin'], status: 'inactive' }),
  });
  const res = makeRes();
  let called = false;
  await gate(makeReq({ 'X-LIS-User': 'old-admin@icpladda.com' }), res, () => { called = true; });
  expect(called).toBe(false);
  expect(res.statusCode).toBe(403);
});
