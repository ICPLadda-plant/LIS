const mockFind = jest.fn();
const mockFindById = jest.fn();

jest.mock('../lib/adminGate', () => ({ requireAuthenticatedUser: (_req, _res, next) => next() }));
jest.mock('../models/Role', () => ({}));
jest.mock('../models/LisDocument', () => ({
  find: () => ({ sort: () => ({ lean: () => mockFind() }) }),
  findById: (...a) => mockFindById(...a),
}));

const router = require('./lisDocuments');

const handler = (method, path) => router.stack.find(
  (l) => l.route?.path === path && l.route.methods[method],
).route.stack[0].handle;

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const qc = { email: 'qc@x.com', roles: ['qc-staff'] };
const docs = [
  { _id: '1', title: 'ทุกคน', html: '<p>a</p>', viewers: [], managers: [], createdBy: 'h@x.com' },
  { _id: '2', title: 'เฉพาะ Lab', html: '', viewers: ['lab-head'], managers: [], createdBy: 'h@x.com' },
  { _id: '3', title: 'QC จัดการ', html: '', viewers: ['lab-head'], managers: ['qc-staff'], createdBy: 'h@x.com' },
];

test('GET / คืนเฉพาะเอกสารที่เห็นได้ ไม่ส่ง html และบอก canEdit', async () => {
  mockFind.mockResolvedValue(docs);
  const res = mockResponse();
  await handler('get', '/')({ authenticatedUser: qc }, res);
  const data = res.json.mock.calls[0][0].data;
  expect(data.map((d) => d.title)).toEqual(['ทุกคน', 'QC จัดการ']);
  expect(data[0].html).toBeUndefined();
  expect(data.map((d) => d.canEdit)).toEqual([false, true]);
});

test('GET /:id ไม่มีสิทธิ์เห็น = 403', async () => {
  mockFindById.mockReturnValue({ lean: () => Promise.resolve(docs[1]) });
  const res = mockResponse();
  await handler('get', '/:id')({ authenticatedUser: qc, params: { id: '2' } }, res);
  expect(res.status).toHaveBeenCalledWith(403);
});

test('PUT /:id ไม่ใช่ผู้จัดการ = 403 และไม่บันทึก', async () => {
  const save = jest.fn();
  mockFindById.mockResolvedValue({ ...docs[0], save });
  const res = mockResponse();
  await handler('put', '/:id')({ authenticatedUser: qc, params: { id: '1' }, body: { title: 'x' } }, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(save).not.toHaveBeenCalled();
});

test('DELETE /:id ผู้จัดการลบได้ (soft delete)', async () => {
  const softDelete = jest.fn();
  mockFindById.mockResolvedValue({ ...docs[2], softDelete });
  const res = mockResponse();
  await handler('delete', '/:id')({ authenticatedUser: qc, params: { id: '3' } }, res);
  expect(softDelete).toHaveBeenCalledWith('qc@x.com');
});
