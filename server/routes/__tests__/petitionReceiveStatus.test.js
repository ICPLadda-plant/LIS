const petitionRouter = require('../petitions');
const Petition = require('../../models/Petition');
const PetitionAuditLog = require('../../models/PetitionAuditLog');

function routeHandler(path, method = 'patch') {
  const layer = petitionRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

function mockResponse() {
  return {
    statusCode: 200,
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(body) {
      this.body = body;
      return this;
    }),
  };
}

describe('petition receive route', () => {
  const originals = {
    findOne: Petition.findOne,
    findOneAndUpdate: Petition.findOneAndUpdate,
    auditCreate: PetitionAuditLog.create,
  };

  afterEach(() => {
    Petition.findOne = originals.findOne;
    Petition.findOneAndUpdate = originals.findOneAndUpdate;
    PetitionAuditLog.create = originals.auditCreate;
    jest.restoreAllMocks();
  });

  test('receiving QC from deliveringQC advances to pendingReview and backfills sampleSentAt', async () => {
    const handler = routeHandler('/:id/receive');
    const beforePetition = {
      _id: 'petition-1',
      petitionNo: 'P-2609-0001',
      dept: 'production',
      status: 'deliveringQC',
      submittedBy: { name: 'Requester', department: 'IT' },
      items: [{ seq: 1, sampleName: 'Sample A', batchNo: 'B-6' }],
    };
    let updatePayload;
    Petition.findOne = jest.fn(() => ({
      lean: jest.fn().mockResolvedValue(beforePetition),
    }));
    Petition.findOneAndUpdate = jest.fn(async (_query, update) => {
      updatePayload = update;
      return { ...beforePetition, ...update.$set };
    });
    PetitionAuditLog.create = jest.fn().mockResolvedValue({});

    const request = {
      params: { id: 'P-2609-0001' },
      body: { actor: 'QC Tester', side: 'qc' },
    };
    const response = mockResponse();

    await handler(request, response);

    expect(response.statusCode).toBe(200);
    expect(updatePayload.$set).toEqual(expect.objectContaining({
      status: 'pendingReview',
      sampleSentAt: expect.any(Date),
      receivedAt: expect.any(Date),
      receivedBy: 'QC Tester',
      qcReceivedAt: expect.any(Date),
      qcReceivedBy: 'QC Tester',
    }));
    expect(response.body.status).toBe('pendingReview');
  });
});
