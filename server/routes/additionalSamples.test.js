const test = require('node:test');
const assert = require('node:assert/strict');
const Petition = require('../models/Petition');
const QCTestResult = require('../models/QCTestResult');
const Parameter = require('../models/Parameter');
const User = require('../models/User');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const lineNotify = require('../lib/lineNotify');
const notifications = [];
lineNotify.notifyPetitionEvent = async (petition, payload) => notifications.push(payload);
const petitions = require('./petitions');
const results = require('./qcResults');
const { router: additional } = require('./additionalSamples');
const { isPetitionComplete } = require('../lib/petitionStatusLog');

const petitionId = '507f1f77bcf86cd799439011';
const parameterId = '507f1f77bcf86cd799439012';
const roundId = '507f1f77bcf86cd799439013';
const code = 'LIS-EXTRA-00000000-0000-4000-8000-000000000001';
const round = { _id: roundId, qrCode: code, side: 'qc', status: 'requested', items: [{ itemSeq: 1, quantity: 2 }], previousResults: [] };
const base = { _id: petitionId, __v: 0, petitionNo: 'P-2609-0010', dept: 'production', status: 'inProgress', qcReceivedAt: new Date(), labReceivedAt: new Date(), submittedBy: { department: 'FG', employeeId: 'FG01' }, items: [{ seq: 1, sampleName: 'Sample', batchNo: 'B-001', sendToLab: true }], additionalSampleRequests: [round], reviewHistory: [] };

async function invoke(router, path, method, body = {}, params = { id: petitionId }) {
  const layer = router.stack.find(entry => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, 'route exists: ' + method + ' ' + path);
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack[0].handle({ body, params, query: {}, headers: {}, get: name => name === 'X-LIS-User' ? 'tester@example.test' : undefined }, res);
  return res;
}

function fixture(context, overrides = {}) {
  const state = structuredClone({ ...base, ...overrides });
  const writes = [];
  const document = () => {
    const doc = structuredClone(state);
    doc.toObject = () => structuredClone(state);
    doc.save = async () => {
      for (const [key, value] of Object.entries(doc)) if (typeof value !== 'function') state[key] = value;
      writes.push({ save: true });
      return doc;
    };
    return doc;
  };
  context.mock.method(Petition, 'findById', () => Object.assign(Promise.resolve(document()), { lean: async () => structuredClone(state) }));
  context.mock.method(Petition, 'findOne', () => ({ lean: async () => structuredClone(state) }));
  context.mock.method(Petition, 'findOneAndUpdate', async (filter, update) => {
    writes.push({ filter, update });
    if (update.$push?.additionalSampleRequests) state.additionalSampleRequests.push({ ...update.$push.additionalSampleRequests, _id: String(update.$push.additionalSampleRequests._id) });
    for (const [key, value] of Object.entries(update.$set || update)) {
      if (key.startsWith('additionalSampleRequests.$.')) {
        const target = state.additionalSampleRequests.find(entry => String(entry._id) === String(filter.additionalSampleRequests.$elemMatch._id));
        target[key.slice('additionalSampleRequests.$.'.length)] = value;
      } else state[key] = value;
    }
    if (update.$inc?.__v) state.__v += update.$inc.__v;
    return document();
  });
  context.mock.method(Petition, 'findByIdAndUpdate', async () => { writes.push({ generic: true }); return document(); });
  context.mock.method(User, 'findOne', () => ({ lean: async () => ({ name: 'Tester', email: 'tester@example.test', role: 'admin', roles: ['admin'], status: 'active' }) }));
  context.mock.method(PetitionAuditLog, 'create', async value => value);
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [] }));
  return { state, writes };
}

test('request creates a unique round with archived failed results and leaves LAB completion intact', async context => {
  const labCompletedAt = new Date('2026-09-19T01:00:00Z');
  const { state } = fixture(context, { additionalSampleRequests: [], labCompletedAt });
  const saved = { petitionId, itemSeq: 1, parameterId, values: { value: 12 }, sampleRoundId: '' };
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [saved] }));
  context.mock.method(Parameter, 'find', () => ({ lean: async () => [{ _id: parameterId, scope: 'qc', valueFields: [{ label: 'value', type: 'number', standardOperator: 'lte', standardValue: 10 }] }] }));
  const res = await invoke(additional, '/:id/additional-samples', 'post', { side: 'qc', reason: 'ผลไม่ผ่าน', items: [{ itemSeq: 1, quantity: 2, weights: [125, 1001] }] });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const created = state.additionalSampleRequests[0];
  assert.deepEqual(created.items, [{ itemSeq: 1, quantity: 2, weights: [125, 1001] }]);
  const persisted = new Petition({ ...state, additionalSampleRequests: [created] });
  assert.ifError(persisted.additionalSampleRequests[0].items[0].validateSync());
  assert.deepEqual(persisted.additionalSampleRequests[0].items[0].weights.toObject(), [125, 1001]);
  assert.match(created.qrCode, /^LIS-EXTRA-[0-9a-f-]{36}$/);
  assert.notEqual(created.qrCode, state.petitionNo);
  assert.deepEqual(created.previousResults, [saved]);
  assert.equal(state.qcCompletedAt, null);
  assert.deepEqual(state.labCompletedAt, labCompletedAt);
  assert.equal(notifications.at(-1).metadata.type, 'additionalSampleRequested');
  assert.deepEqual(notifications.at(-1).metadata.items[0].weights, [125, 1001]);
});

test('schema accepts positive integer grams and legacy requests but rejects invalid weights', () => {
  for (const weights of [[1, 125], [200, 1001]]) {
    const document = new Petition({ additionalSampleRequests: [{ items: [{ itemSeq: 1, quantity: 2, weights }] }] });
    assert.ifError(document.additionalSampleRequests[0].items[0].validateSync());
  }
  for (const weights of [null, [], [100], [100, 0], [100, -200], [100, 1.5], [100, null], [100, Infinity], [100, NaN], [100, Number.MAX_SAFE_INTEGER + 1], [100, 500, 500]]) {
    const document = new Petition({ additionalSampleRequests: [{ items: [{ itemSeq: 1, quantity: 2, weights }] }] });
    assert.ok(document.additionalSampleRequests[0].items[0].validateSync(), JSON.stringify(weights));
  }
  const legacy = new Petition({ additionalSampleRequests: [{ items: [{ itemSeq: 1, quantity: 500 }] }] });
  assert.ifError(legacy.additionalSampleRequests[0].items[0].validateSync());
  assert.equal(legacy.additionalSampleRequests[0].items[0].weights, undefined);
});

test('new QR lookup returns its round metadata, not the original QR context', async context => {
  fixture(context);
  const res = await invoke(petitions, '/scan/:code', 'get', {}, { code });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scannedAdditionalSampleId, roundId);
  assert.equal(res.body.scannedAdditionalSampleCode, code);
});

test('original QR can deliver pending additional round while receive remains authenticated', async context => {
  const { writes } = fixture(context);
  const deliver = await invoke(petitions, '/:id/deliver', 'patch', { side: 'qc', additionalSampleId: roundId, additionalSampleCode: code });
  assert.equal(deliver.statusCode, 200);
  assert.equal(writes.length, 1);
  const receive = await invoke(petitions, '/:id/receive', 'patch', { side: 'qc', additionalSampleId: roundId, additionalSampleCode: code });
  assert.equal(receive.statusCode, 200);
});

test('round QR sends and receives once without replacing original timestamps', async context => {
  const { state } = fixture(context);
  const originalReceipt = state.qcReceivedAt;
  const payload = { additionalSampleId: roundId, additionalSampleCode: code, side: 'qc' };
  assert.equal((await invoke(petitions, '/:id/deliver', 'patch', payload)).statusCode, 200);
  assert.equal(state.additionalSampleRequests[0].status, 'sent');
  assert.equal((await invoke(petitions, '/:id/receive', 'patch', { ...payload, side: 'lab' })).statusCode, 409);
  assert.equal((await invoke(petitions, '/:id/receive', 'patch', payload)).statusCode, 200);
  assert.equal(state.additionalSampleRequests[0].status, 'received');
  assert.deepEqual(state.qcReceivedAt, originalReceipt);
  assert.equal(state.status, 'inProgress');
  assert.equal((await invoke(petitions, '/:id/receive', 'patch', payload)).statusCode, 409);
});

test('pending rounds block completion and review bypass even with completed flags', async context => {
  const { state, writes } = fixture(context, { qcCompletedAt: new Date(), labApprovedAt: new Date() });
  assert.equal(isPetitionComplete(state), false);
  assert.equal((await invoke(petitions, '/:id/complete', 'post', { side: 'qc' })).statusCode, 409);
  assert.equal((await invoke(petitions, '/:id/review', 'post', { action: 'approve', reviewedBy: 'Tester', status: 'approved' })).statusCode, 409);
  assert.equal(writes.length, 0);
});

test('generic PATCH cannot replace round history or forge completion stamps', async context => {
  const { writes } = fixture(context);
  for (const body of [{ additionalSampleRequests: [] }, { qcCompletedAt: new Date() }, { 'additionalSampleRequests.0.status': 'received' }, { $set: { additionalSampleRequests: [] } }]) {
    assert.equal((await invoke(petitions, '/:id', 'patch', body)).statusCode, 400);
  }
  assert.equal(writes.length, 0);
});

test('received round cannot complete with previous-round results', async context => {
  fixture(context, { additionalSampleRequests: [{ ...round, status: 'received', previousResults: [{ itemSeq: 1, parameterId, values: { value: 12 } }] }] });
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [{ itemSeq: 1, parameterId, values: { value: 5 }, sampleRoundId: '' }] }));
  assert.equal((await invoke(petitions, '/:id/complete', 'post', { side: 'qc' })).statusCode, 409);
});

test('result writes reject pending or stale rounds; first fresh write clears old values', async context => {
  const { state } = fixture(context);
  const writes = [];
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => ({ scope: 'qc', valueFields: [{ label: 'value', type: 'number' }] }) }));
  context.mock.method(QCTestResult, 'findOne', async () => ({ values: { old: 99 }, valuesPhase2: { old: 88 }, entries: [{ old: 77 }], sampleRoundId: '' }));
  context.mock.method(QCTestResult, 'findOneAndUpdate', async (filter, update) => { writes.push({ filter, update }); return update.$set; });
  const payload = { petitionId, itemSeq: 1, parameterId, fieldLabel: 'value', value: 5 };
  assert.equal((await invoke(results, '/', 'put', payload)).statusCode, 409);
  assert.equal((await invoke(results, '/entries', 'put', { ...payload, entries: [] })).statusCode, 409);
  state.additionalSampleRequests[0].status = 'received';
  assert.equal((await invoke(results, '/', 'put', payload)).statusCode, 409);
  assert.equal(writes.length, 0);
  assert.equal((await invoke(results, '/', 'put', { ...payload, sampleRoundId: roundId })).statusCode, 200);
  assert.deepEqual(writes[0].update.$set.values, { value: 5 });
  assert.deepEqual(writes[0].update.$set.valuesPhase2, {});
  assert.deepEqual(writes[0].update.$set.entries, []);
  assert.equal(writes[0].update.$set.sampleRoundId, roundId);
});

test('failed phase 2 results can request a new sample round', async context => {
  fixture(context, { additionalSampleRequests: [] });
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [{ petitionId, itemSeq: 1, parameterId, values: { value: 5 }, valuesPhase2: { value: 12 } }] }));
  context.mock.method(Parameter, 'find', () => ({ lean: async () => [{ _id: parameterId, scope: 'qc', hasPhases: true, valueFields: [{ label: 'value', type: 'number', phase: 'both', standardOperator: 'lte', standardValue: 10 }] }] }));
  const res = await invoke(additional, '/:id/additional-samples', 'post', { side: 'qc', reason: 'ผลหลังทดสอบไม่ผ่าน', items: [{ itemSeq: 1, quantity: 1 }] });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
});

test('request rejects unauthenticated, wrong-side, inactive and unassigned staff', async context => {
  const { writes, state } = fixture(context, { additionalSampleRequests: [], assignedTo: { employeeId: 'LAB01' } });
  const body = { side: 'lab', reason: 'ผลไม่ผ่าน', items: [{ itemSeq: 1, quantity: 1 }] };
  for (const [user, expected] of [[null, 401], [{ roles: ['qc-staff'] }, 403], [{ roles: ['admin'], status: 'inactive' }, 401], [{ roles: ['lab-analyze'], employeeId: 'LAB02' }, 403]]) {
    context.mock.method(User, 'findOne', () => ({ lean: async () => user }));
    const res = await invoke(additional, '/:id/additional-samples', 'post', body);
    assert.equal(res.statusCode, expected, JSON.stringify(res.body));
  }
  assert.equal(state.additionalSampleRequests.length, 0);
  assert.equal(writes.length, 0);
});

test('concurrent request rejects losing revision instead of issuing another QR', async context => {
  fixture(context, { additionalSampleRequests: [] });
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [{ petitionId, itemSeq: 1, parameterId, values: { value: 12 } }] }));
  context.mock.method(Parameter, 'find', () => ({ lean: async () => [{ _id: parameterId, scope: 'qc', valueFields: [{ label: 'value', type: 'number', standardOperator: 'lte', standardValue: 10 }] }] }));
  context.mock.method(Petition, 'findOneAndUpdate', async filter => { assert.equal(filter.__v, 0); assert.equal(filter.additionalSampleRequests.$not.$elemMatch.side, 'qc'); return null; });
  assert.equal((await invoke(additional, '/:id/additional-samples', 'post', { side: 'qc', reason: 'ผลไม่ผ่าน', items: [{ itemSeq: 1, quantity: 1 }] })).statusCode, 409);
});

for (const side of ['qc', 'lab']) test(side + ' lifecycle archives results, notifies, scans new QR, retests and completes', async context => {
  const otherSide = side === 'qc' ? 'lab' : 'qc';
  const { state } = fixture(context, { additionalSampleRequests: [], qcCompletedAt: new Date(), labCompletedAt: new Date(), labApprovedAt: new Date() });
  let saved = { petitionId, itemSeq: 1, parameterId, values: { value: 12 }, sampleRoundId: '' };
  const parameter = { _id: parameterId, scope: side, valueFields: [{ label: 'value', type: 'number', standardOperator: 'lte', standardValue: 10 }] };
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [saved] }));
  context.mock.method(QCTestResult, 'findOne', async () => saved);
  context.mock.method(QCTestResult, 'findOneAndUpdate', async (filter, update) => { saved = { ...saved, ...update.$set }; return saved; });
  context.mock.method(Parameter, 'find', () => ({ lean: async () => [parameter] }));
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => parameter }));
  const untouchedCompletion = state[otherSide + 'CompletedAt'];
  const created = await invoke(additional, '/:id/additional-samples', 'post', { side, reason: 'ตรวจใหม่', items: [{ itemSeq: 1, quantity: 2 }] });
  assert.equal(created.statusCode, 201);
  const newRound = state.additionalSampleRequests[0];
  const payload = { additionalSampleId: String(newRound._id), additionalSampleCode: newRound.qrCode, side };
  assert.equal((await invoke(petitions, '/scan/:code', 'get', {}, { code: newRound.qrCode })).body.scannedAdditionalSampleCode, newRound.qrCode);
  assert.equal((await invoke(petitions, '/:id/deliver', 'patch', payload)).statusCode, 200);
  assert.equal((await invoke(petitions, '/:id/receive', 'patch', payload)).statusCode, 200);
  assert.equal((await invoke(petitions, '/:id/complete', 'post', { side })).statusCode, 409);
  assert.equal((await invoke(results, '/', 'put', { petitionId, itemSeq: 1, parameterId, fieldLabel: 'value', value: 5, sampleRoundId: payload.additionalSampleId })).statusCode, 200);
  assert.equal((await invoke(petitions, '/:id/complete', 'post', { side })).statusCode, 200);
  if (side === 'lab') assert.equal((await invoke(petitions, '/:id/lab-approve', 'post')).statusCode, 200);
  assert.equal(state.status, 'success');
  assert.deepEqual(state[otherSide + 'CompletedAt'], untouchedCompletion);
  assert.equal(newRound.previousResults[0].values.value, 12);
  assert.equal(saved.values.value, 5);
  assert.equal((await invoke(petitions, '/:id', 'patch', { status: 'approved' })).statusCode, 200);
  assert.equal(state.status, 'approved');
});

test('additional completion and approval require authenticated side or head permission', async context => {
  const { state, writes } = fixture(context, { status: 'success', additionalSampleRequests: [{ ...round, status: 'received' }], labCompletedAt: new Date() });
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [{ itemSeq: 1, parameterId, sampleRoundId: roundId, values: { value: 5 } }] }));
  context.mock.method(User, 'findOne', () => ({ lean: async () => null }));
  assert.equal((await invoke(petitions, '/:id/complete', 'post', { side: 'qc' })).statusCode, 401);
  assert.equal((await invoke(petitions, '/:id', 'patch', { status: 'approved' })).statusCode, 401);
  state.status = 'inProgress';
  assert.equal((await invoke(petitions, '/:id/lab-approve', 'post')).statusCode, 401);
  context.mock.method(User, 'findOne', () => ({ lean: async () => ({ roles: ['qc-staff'], name: 'Staff' }) }));
  assert.equal((await invoke(petitions, '/:id/lab-approve', 'post')).statusCode, 403);
  state.status = 'success';
  assert.equal((await invoke(petitions, '/:id', 'patch', { status: 'approved', actor: 'Fake head' })).statusCode, 403);
  assert.equal(writes.length, 0);
});

test('creation rejects injected additional sample rounds before database writes', async context => {
  fixture(context);
  const res = await invoke(petitions, '/', 'post', { dept: 'production', submittedBy: { name: 'Requester', department: 'Production' }, deliveredBy: { name: 'Runner' }, items: [{ seq: 1, sampleName: 'A', batchNo: 'B-001' }], additionalSampleRequests: [{ ...round, status: 'received' }] });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /รอบตัวอย่าง/);
});

test('stale petition snapshot never migrates a newer result back to an older round', async context => {
  fixture(context, { additionalSampleRequests: [{ ...round, status: 'received' }] });
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => ({ scope: 'qc', valueFields: [] }) }));
  context.mock.method(QCTestResult, 'findOne', async () => ({ sampleRoundId: 'newer-round', values: { value: 7 } }));
  context.mock.method(QCTestResult, 'findOneAndUpdate', async () => { throw new Error('must not overwrite newer round'); });
  const body = { petitionId, itemSeq: 1, parameterId, fieldLabel: 'value', value: 5, sampleRoundId: roundId };
  assert.equal((await invoke(results, '/', 'put', body)).statusCode, 409);
  assert.equal((await invoke(results, '/entries', 'put', { ...body, entries: [{ value: 5 }] })).statusCode, 409);
});

test('new round cannot save phase 2 before its own timer unlocks', async context => {
  const { state } = fixture(context, { currentPhase: 2, additionalSampleRequests: [{ ...round, status: 'received', currentPhase: 1 }] });
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => ({ scope: 'qc', hasPhases: true, valueFields: [] }) }));
  context.mock.method(QCTestResult, 'findOne', async () => ({ sampleRoundId: roundId, values: { value: 2 } }));
  context.mock.method(QCTestResult, 'findOneAndUpdate', async (filter, update) => update.$set);
  const body = { petitionId, itemSeq: 1, parameterId, fieldLabel: 'value', value: 5, phase: 2, sampleRoundId: roundId };
  assert.equal((await invoke(results, '/', 'put', body)).statusCode, 409);
  state.additionalSampleRequests[0].currentPhase = 2;
  assert.equal((await invoke(results, '/', 'put', body)).statusCode, 200);
});

test('pending request waits for an in-flight saved result before snapshotting it', async context => {
  const { state } = fixture(context, { additionalSampleRequests: [] });
  const parameter = { _id: parameterId, scope: 'qc', valueFields: [{ label: 'value', type: 'number', standardOperator: 'lte', standardValue: 10 }] };
  let saved = { petitionId, itemSeq: 1, parameterId, values: { value: 12 }, sampleRoundId: '' };
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  context.mock.method(Parameter, 'findById', () => ({ lean: async () => parameter }));
  context.mock.method(Parameter, 'find', () => ({ lean: async () => [parameter] }));
  context.mock.method(QCTestResult, 'findOne', async () => saved);
  context.mock.method(QCTestResult, 'find', () => ({ lean: async () => [saved] }));
  context.mock.method(QCTestResult, 'findOneAndUpdate', async (filter, update) => {
    entered();
    await barrier;
    saved = { ...saved, values: update.$set.values };
    return saved;
  });
  const writing = invoke(results, '/', 'put', { petitionId, itemSeq: 1, parameterId, fieldLabel: 'value', value: 18 });
  await started;
  const requesting = invoke(additional, '/:id/additional-samples', 'post', { side: 'qc', reason: 'ตรวจยืนยัน', items: [{ itemSeq: 1, quantity: 2 }] });
  release();
  assert.equal((await writing).statusCode, 200);
  assert.equal((await requesting).statusCode, 201);
  assert.equal(state.additionalSampleRequests[0].previousResults[0].values.value, 18);
  assert.equal((await invoke(results, '/', 'put', { petitionId, itemSeq: 1, parameterId, fieldLabel: 'value', value: 22 })).statusCode, 409);
});

test('manual phase unlock targets only the requested received round', async context => {
  const other = { ...round, _id: 'lab-round', side: 'lab', status: 'received', currentPhase: 1 };
  const { state } = fixture(context, { currentPhase: 2, additionalSampleRequests: [{ ...round, status: 'received', currentPhase: 1 }, other] });
  context.mock.method(Petition, 'findOne', () => Petition.findById(petitionId));
  const res = await invoke(petitions, '/:id/advance-phase', 'patch', { additionalSampleId: roundId, side: 'qc' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(state.additionalSampleRequests[0].currentPhase, 2);
  assert.equal(state.additionalSampleRequests[1].currentPhase, 1);
  assert.equal(state.currentPhase, 2);
});

test('rework clears terminal decision metadata before returning to testing', async context => {
  const { state } = fixture(context, {
    status: 'success',
    conclusion: 'accepted-oos',
    conclusionNote: 'เดิม',
    approvedAt: new Date(),
    rejectedAt: new Date(),
    additionalSampleRequests: [],
  });
  const res = await invoke(petitions, '/:id', 'patch', {
    status: 'rejected', target: 'qc', revisionNote: 'ตรวจใหม่',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.status, 'inProgress');
  assert.equal(state.conclusion, null);
  assert.equal(state.conclusionNote, null);
  assert.equal(state.approvedAt, null);
  assert.equal(state.rejectedAt, null);
});
