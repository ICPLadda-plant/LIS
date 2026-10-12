const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Petition = require('../models/Petition');
const Parameter = require('../models/Parameter');
const QCTestResult = require('../models/QCTestResult');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { createLisSessionCookieValue } = require('../lib/lisSessionCookie');
const qcResults = require('./qcResults');

const petitionId = '507f1f77bcf86cd799439011';
const parameterId = '507f1f77bcf86cd799439012';

async function saveAs(context, email, ip = '127.0.0.1', cookie, onAudit = () => {}, options = {}) {
  const fieldLabel = options.fieldLabel || 'สี';
  const value = options.value ?? 'แดง';
  context.mock.method(User, 'findOne', () => ({ lean: async () => null }));
  context.mock.method(Petition, 'findById', () => ({ lean: async () => ({
    _id: petitionId, status: 'approved', petitionNo: 'P-1', items: [{ seq: 1 }],
  }) }));
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => ({
    _id: parameterId, scope: 'qc', valueFields: [{ label: fieldLabel, type: 'text' }],
  }) }));
  context.mock.method(QCTestResult, 'findOne', async () => ({
    sampleRoundId: '', values: options.existingValues || { สี: 'เดิม' }, enteredBy: { name: 'Tester' },
  }));
  context.mock.method(QCTestResult, 'findOneAndUpdate', async (filter, update) => {
    options.onWrite?.({ filter, update });
    return update.$set;
  });
  context.mock.method(PetitionAuditLog, 'create', async (entry) => { onAudit(entry); return {}; });

  const layer = qcResults.stack.find((entry) => entry.route?.path === '/' && entry.route.methods.put);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await layer.route.stack[0].handle({
    body: { petitionId, petitionNo: 'P-1', itemSeq: 1, parameterId, parameterName: 'กายภาพ', fieldLabel, value, overrideReason: 'กรอกผลผิด' },
    headers: cookie ? { cookie } : {}, ip, get: (name) => name.toLowerCase() === 'x-lis-user' ? email : undefined,
  }, res);
  return res;
}

test('อ่านค่า legacy ที่ MongoDB แยกชื่อ field ตรงจุดกลับเป็น key เดิม', async (context) => {
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [{
    values: { 'Area Inj': { 1: '3.545', 2: '3.545', 3: '3.545' } },
    valuesPhase2: {},
  }] }));
  const layer = qcResults.stack.find((entry) => entry.route?.path === '/:petitionId' && entry.route.methods.get);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

  await layer.route.stack[0].handle({ params: { petitionId } }, res);

  assert.deepEqual(res.body[0].values, {
    'Area Inj.1': '3.545',
    'Area Inj.2': '3.545',
    'Area Inj.3': '3.545',
  });
});

test('บันทึกชื่อ field ที่มีจุดเป็น literal key โดยไม่สร้าง object ซ้อน', async (context) => {
  const previous = process.env.ALLOW_DEV_STATUS;
  process.env.ALLOW_DEV_STATUS = 'true';
  let written;
  try {
    const response = await saveAs(
      context,
      'admin-dept-dept-123.dev@icpladda.com',
      '127.0.0.1',
      undefined,
      () => {},
      {
        fieldLabel: 'Area Inj.1',
        value: '3.545',
        existingValues: { keep: 'เดิม' },
        onWrite: ({ update }) => { written = update; },
      },
    );
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.deepEqual(written.$set.values, { keep: 'เดิม', 'Area Inj.1': '3.545' });
    assert.equal(written.$set['values.Area Inj.1'], undefined);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DEV_STATUS;
    else process.env.ALLOW_DEV_STATUS = previous;
  }
});

test('dev Admin บันทึกผลคำร้องที่อนุมัติแล้วได้เฉพาะ local dev', async (context) => {
  const previous = process.env.ALLOW_DEV_STATUS;
  process.env.ALLOW_DEV_STATUS = 'true';
  try {
    const allowed = await saveAs(context, 'admin-dept-dept-123.dev@icpladda.com');
    assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.body));
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DEV_STATUS;
    else process.env.ALLOW_DEV_STATUS = previous;
  }
});

test('การแก้ผลที่ปิดงานสร้าง notification สำหรับ QC Head ทุกคน', async (context) => {
  const previous = process.env.ALLOW_DEV_STATUS;
  process.env.ALLOW_DEV_STATUS = 'true';
  let audit;
  try {
    const response = await saveAs(context, 'admin-dept-dept-123.dev@icpladda.com', '127.0.0.1', undefined, (entry) => { audit = entry; });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(audit.event, 'updated');
    assert.equal(audit.metadata.audience, 'qc');
    assert.deepEqual(audit.metadata.recipientRoles, ['qc-head']);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DEV_STATUS;
    else process.env.ALLOW_DEV_STATUS = previous;
  }
});

test('dev Admin ยังแก้ผลได้เมื่อ browser มี session เก่าของบทบาทอื่น', async (context) => {
  const previousFlag = process.env.ALLOW_DEV_STATUS;
  const previousSecret = process.env.LIS_SESSION_SECRET;
  process.env.ALLOW_DEV_STATUS = 'true';
  process.env.LIS_SESSION_SECRET = 'test-secret';
  context.mock.method(User, 'findById', () => ({ lean: async () => ({ email: 'viewer@example.test', roles: ['viewer'], status: 'active' }) }));
  try {
    const cookie = `lis_session=${createLisSessionCookieValue('507f1f77bcf86cd799439014')}`;
    const response = await saveAs(context, 'admin-dept-dept-123.dev@icpladda.com', '127.0.0.1', cookie);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  } finally {
    if (previousFlag === undefined) delete process.env.ALLOW_DEV_STATUS;
    else process.env.ALLOW_DEV_STATUS = previousFlag;
    if (previousSecret === undefined) delete process.env.LIS_SESSION_SECRET;
    else process.env.LIS_SESSION_SECRET = previousSecret;
  }
});

test('dev Viewer และ dev Admin จากเครื่องอื่นแก้ผล approved ไม่ได้', async (context) => {
  const previous = process.env.ALLOW_DEV_STATUS;
  process.env.ALLOW_DEV_STATUS = 'true';
  try {
    const viewer = await saveAs(context, 'viewer-dept-dept-123.dev@icpladda.com');
    assert.equal(viewer.statusCode, 403);
    const remote = await saveAs(context, 'admin-dept-dept-123.dev@icpladda.com', '10.0.0.1');
    assert.equal(remote.statusCode, 403);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DEV_STATUS;
    else process.env.ALLOW_DEV_STATUS = previous;
  }
});

test('ปิดโหมด dev แล้ว header บทบาทจำลองแก้ผล approved ไม่ได้', async (context) => {
  const previous = process.env.ALLOW_DEV_STATUS;
  delete process.env.ALLOW_DEV_STATUS;
  try {
    const response = await saveAs(context, 'admin-dept-dept-123.dev@icpladda.com');
    assert.equal(response.statusCode, 403);
  } finally {
    if (previous !== undefined) process.env.ALLOW_DEV_STATUS = previous;
  }
});
