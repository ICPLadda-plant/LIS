const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('./petitions');
const Petition = require('../models/Petition');
const DocumentNumberConfig = require('../models/DocumentNumberConfig');
const User = require('../models/User');
const LabFreeAssign = require('../models/LabFreeAssign');

function handler(path, method) {
  const layer = router.stack.find((entry) => entry.route
    && entry.route.path === path
    && entry.route.methods[method]);
  return layer.route.stack[0].handle;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(path, method, { body = {}, params = {}, query = {}, headers = {} } = {}) {
  const res = response();
  const get = (name) => headers[Object.keys(headers).find((key) => key.toLowerCase() === String(name).toLowerCase())];
  await handler(path, method)({ body, params, query, headers: {}, get }, res);
  return res;
}

// จำลองผู้ใช้ที่ล็อกอิน (currentUser หา User จาก header X-LIS-User) + สถานะมอบหมายอิสระ
async function withLabUser(user, freeUntil, run) {
  const originals = { userFindOne: User.findOne, freeFindOne: LabFreeAssign.findOne };
  User.findOne = () => ({ lean: async () => user });
  LabFreeAssign.findOne = () => ({ lean: async () => (freeUntil === undefined ? null : { key: 'lab', freeUntil, setBy: 'Head' }) });
  try {
    return await run({ 'X-LIS-User': user?.email || '' });
  } finally {
    User.findOne = originals.userFindOne;
    LabFreeAssign.findOne = originals.freeFindOne;
  }
}

const LAB_HEAD = { _id: 'u-head', email: 'head@lab.test', name: 'Lab Head', roles: ['lab-head'], status: 'active' };
const ANALYST = { _id: 'u-a', email: 'a@lab.test', name: 'Analyst A', employeeId: 'E77', roles: ['lab-analyze'], status: 'active' };

test('GET / filters assigned petitions by current assignee before pagination', async () => {
  const originals = {
    petitionFind: Petition.find,
    petitionCountDocuments: Petition.countDocuments,
    petitionAggregate: Petition.aggregate,
  };
  let findQuery;
  try {
    Petition.find = (query) => {
      findQuery = query;
      return {
        sort: () => ({
          skip: () => ({
            limit: async () => [],
          }),
        }),
      };
    };
    Petition.countDocuments = async () => 0;
    Petition.aggregate = async () => [];

    const res = await invoke('/', 'get', {
      query: {
        status: 'sampleSent,pendingReview,inProgress',
        assignedToEmployeeId: 'E123',
        assignedToName: 'Analyst A',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(findQuery.$or, [
      { 'assignedTo.employeeId': 'E123' },
      { 'assignedTo.name': 'Analyst A' },
    ]);
    assert.deepEqual(findQuery.status, { $in: ['sampleSent', 'pendingReview', 'inProgress'] });
  } finally {
    Petition.find = originals.petitionFind;
    Petition.countDocuments = originals.petitionCountDocuments;
    Petition.aggregate = originals.petitionAggregate;
  }
});

test('GET / awaitingQcApproval returns petitions after either track confirms results', async () => {
  const originals = {
    petitionFind: Petition.find,
    petitionCountDocuments: Petition.countDocuments,
    petitionAggregate: Petition.aggregate,
  };
  let findQuery;
  try {
    Petition.find = (query) => {
      findQuery = query;
      return {
        sort: () => ({
          skip: () => ({
            limit: async () => [],
          }),
        }),
      };
    };
    Petition.countDocuments = async () => 0;
    Petition.aggregate = async () => [];

    const res = await invoke('/', 'get', { query: { awaitingQcApproval: 'true' } });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(findQuery.status, { $nin: ['approved', 'rejected'] });
    assert.deepEqual(findQuery.$or, [
      { qcCompletedAt: { $ne: null } },
      { labCompletedAt: { $ne: null } },
    ]);
  } finally {
    Petition.find = originals.petitionFind;
    Petition.countDocuments = originals.petitionCountDocuments;
    Petition.aggregate = originals.petitionAggregate;
  }
});

test('PATCH /:id/assign requires Lab receipt, not QC receipt', async () => {
  const originalFindOne = Petition.findOne;
  const originalSave = Petition.prototype.save;
  try {
    let saved = false;
    Petition.findOne = async () => ({ status: 'pendingReview', qcReceivedAt: new Date(), receivedAt: new Date() });
    Petition.prototype.save = async () => { saved = true; };
    const res = await withLabUser(LAB_HEAD, undefined, (headers) => invoke('/:id/assign', 'patch', {
      params: { id: 'P-2609-0001' },
      body: { employeeId: 'E1', name: 'Analyst' },
      headers,
    }));
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error.message, /Lab ต้องรับตัวอย่างก่อน/);
    assert.equal(saved, false);
  } finally {
    Petition.findOne = originalFindOne;
    Petition.prototype.save = originalSave;
  }
});

test('PATCH /:id/assign is read-only for non-head Lab staff', async () => {
  const res = await withLabUser(ANALYST, undefined, (headers) => invoke('/:id/assign', 'patch', {
    params: { id: 'P-2609-0001' },
    body: { employeeId: 'E1', name: 'Analyst' },
    headers,
  }));
  assert.equal(res.statusCode, 403);
});

test('PUT /lab-free-assign is head-only and rejects past or over-long windows', async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const denied = await withLabUser(ANALYST, undefined, (headers) => invoke('/lab-free-assign', 'put', { body: { until: future }, headers }));
  assert.equal(denied.statusCode, 403);
  const past = await withLabUser(LAB_HEAD, undefined, (headers) => invoke('/lab-free-assign', 'put', { body: { until: new Date(Date.now() - 1000).toISOString() }, headers }));
  assert.equal(past.statusCode, 400);
  const tooLong = await withLabUser(LAB_HEAD, undefined, (headers) => invoke('/lab-free-assign', 'put', { body: { until: new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString() }, headers }));
  assert.equal(tooLong.statusCode, 400);
});

test('POST /:id/claim needs an open free-assign window', async () => {
  const expired = new Date(Date.now() - 1000);
  const res = await withLabUser(ANALYST, expired, (headers) => invoke('/:id/claim', 'post', { params: { id: 'P-2609-0001' }, headers }));
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error.message, /มอบหมายอิสระ/);
});

test('POST /:id/claim refuses work that already has an assignee', async () => {
  const originalFindOne = Petition.findOne;
  try {
    Petition.findOne = async () => ({ status: 'inProgress', labReceivedAt: new Date(), assignedTo: { employeeId: 'E1', name: 'Someone' } });
    const res = await withLabUser(ANALYST, new Date(Date.now() + 3600 * 1000), (headers) => invoke('/:id/claim', 'post', { params: { id: 'P-2609-0001' }, headers }));
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error.message, /มีผู้รับงานนี้แล้ว/);
  } finally {
    Petition.findOne = originalFindOne;
  }
});

test('POST /:id/claim assigns the work to the logged-in analyst, ignoring body identity', async () => {
  const originalFindOne = Petition.findOne;
  const doc = {
    status: 'pendingReview',
    labReceivedAt: new Date(),
    async save() { throw new Error('stop-after-assign'); },
  };
  try {
    Petition.findOne = async () => doc;
    const res = await withLabUser(ANALYST, new Date(Date.now() + 3600 * 1000), (headers) => invoke('/:id/claim', 'post', {
      params: { id: 'P-2609-0001' },
      body: { employeeId: 'HACK', machines: [] },
      headers,
    }));
    assert.match(res.body.error.message, /stop-after-assign/);
    assert.equal(doc.assignedTo.employeeId, 'E77');
    assert.equal(doc.assignedTo.name, 'Analyst A');
    assert.equal(doc.assignedTo.assignedBy, 'Analyst A');
    assert.equal(doc.status, 'inProgress');
  } finally {
    Petition.findOne = originalFindOne;
  }
});


test('PATCH /:id cannot bypass Lab receipt through a general update', async () => {
  const res = await invoke('/:id', 'patch', {
    params: { id: 'P-2609-0001' },
    body: { assignedTo: { employeeId: 'E1', name: 'Analyst' } },
  });
  assert.equal(res.statusCode, 400);
});

test('POST / rejects non-production sendToLab override without item note before creating petition', async () => {
  const originals = {
    configFindOne: DocumentNumberConfig.findOne,
    petitionFindOne: Petition.findOne,
    petitionCreate: Petition.create,
  };
  let createCalled = false;
  try {
    DocumentNumberConfig.findOne = () => ({ lean: async () => null });
    Petition.findOne = () => ({ sort: () => ({ lean: async () => null }) });
    Petition.create = async () => {
      createCalled = true;
      throw new Error('create should not be called');
    };

    const res = await invoke('/', 'post', {
      body: {
        dept: 'fg',
        submittedBy: { name: 'FG User', department: 'FG' },
        deliveredBy: { name: 'Runner' },
        items: [{ seq: 2, sampleName: 'Sample B', batchNo: 'B-002', sendToLab: true, note: '' }],
      },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /เหตุผล/);
    assert.equal(createCalled, false);
  } finally {
    DocumentNumberConfig.findOne = originals.configFindOne;
    Petition.findOne = originals.petitionFindOne;
    Petition.create = originals.petitionCreate;
  }
});

test('PATCH /:id rejects non-production sendToLab override without item note before updating petition', async () => {
  const originals = {
    petitionFindById: Petition.findById,
    petitionFindByIdAndUpdate: Petition.findByIdAndUpdate,
  };
  let updateCalled = false;
  try {
    Petition.findById = async () => ({
      _id: 'petition-1',
      petitionNo: 'P-2609-0001',
      dept: 'fg',
      status: 'deliveringQC',
      submittedBy: { name: 'FG User', department: 'FG' },
      deliveredBy: { name: 'Runner' },
      items: [{ seq: 1, sampleName: 'Sample A', batchNo: 'B-001' }],
      toObject() {
        return { ...this };
      },
    });
    Petition.findByIdAndUpdate = async () => {
      updateCalled = true;
      throw new Error('update should not be called');
    };

    const res = await invoke('/:id', 'patch', {
      params: { id: 'petition-1' },
      body: {
        dept: 'fg',
        submittedBy: { name: 'FG User', department: 'FG' },
        deliveredBy: { name: 'Runner' },
        items: [{ seq: 1, sampleName: 'Sample A', batchNo: 'B-001', sendToLab: false, note: '' }],
      },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /เหตุผล/);
    assert.equal(updateCalled, false);
  } finally {
    Petition.findById = originals.petitionFindById;
    Petition.findByIdAndUpdate = originals.petitionFindByIdAndUpdate;
  }
});

test('latestDeliverableRevision follows repeated rejected resubmissions', async () => {
  const originalFindOne = Petition.findOne;
  const rejectedChild = { _id: 'petition-2', status: 'rejected' };
  const activeChild = { _id: 'petition-3', status: 'deliveringQC' };
  try {
    Petition.findOne = (query) => ({
      sort: () => ({
        lean: async () => query.revisionOf === 'petition-1' ? rejectedChild : activeChild,
      }),
    });

    const result = await router.latestDeliverableRevision({ _id: 'petition-1', status: 'rejected' });

    assert.equal(result._id, 'petition-3');
  } finally {
    Petition.findOne = originalFindOne;
  }
});
