jest.mock('../models/User', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock('../models/Role', () => ({ find: jest.fn() }));
jest.mock('../models/AccessGroup', () => ({ find: jest.fn() }));

const User = require('../models/User');
const { requirePageAccess } = require('./pageAccessGate');

function makeReq(email, ip) {
  return {
    ip,
    get: (name) => String(name).toLowerCase() === 'x-lis-user' ? email : undefined,
    headers: {},
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (statusCode) => { res.statusCode = statusCode; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe('requirePageAccess synthetic dev user', () => {
  const previousAllowDevStatus = process.env.ALLOW_DEV_STATUS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ALLOW_DEV_STATUS = 'true';
  });

  afterAll(() => {
    if (previousAllowDevStatus === undefined) delete process.env.ALLOW_DEV_STATUS;
    else process.env.ALLOW_DEV_STATUS = previousAllowDevStatus;
  });

  test('allows a local synthetic admin without a MongoDB user', async () => {
    const req = makeReq('admin.dev@icpladda.com', '::1');
    const next = jest.fn();

    await requirePageAccess(['/qc-testing'])(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.currentUser).toMatchObject({
      email: 'admin.dev@icpladda.com',
      roles: expect.arrayContaining(['admin']),
      status: 'active',
    });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('does not allow the synthetic dev bypass from a remote address', async () => {
    User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const res = makeRes();
    const next = jest.fn();

    await requirePageAccess(['/qc-testing'])(makeReq('admin.dev@icpladda.com', '10.0.0.5'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
