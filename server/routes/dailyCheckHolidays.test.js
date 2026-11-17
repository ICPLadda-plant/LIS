const mockFind = jest.fn();
const mockUpsert = jest.fn();
const mockDelete = jest.fn();

jest.mock('../models/DailyCheckHoliday', () => ({
  find: (...args) => ({ sort: () => ({ lean: () => mockFind(...args) }) }),
  findOneAndUpdate: (...args) => ({ lean: () => mockUpsert(...args) }),
  deleteOne: (...args) => mockDelete(...args),
}));

const router = require('./dailyCheckHolidays');
const handler = (method, path) => router.stack.find(
  (layer) => layer.route?.path === path && layer.route.methods[method],
).route.stack[0].handle;
const getHandler = handler('get', '/');
const putHandler = handler('put', '/:date');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  mockFind.mockReset().mockResolvedValue([]);
  mockUpsert.mockReset().mockResolvedValue({});
  mockDelete.mockReset().mockResolvedValue({});
});

it('filters by month range', async () => {
  const res = mockResponse();
  await getHandler({ query: { from: '2026-11-01', to: '2026-11-30' } }, res);
  expect(mockFind).toHaveBeenCalledWith({ date: { $gte: '2026-11-01', $lte: '2026-11-30' } });
});

it('ignores a malformed range instead of querying with it', async () => {
  const res = mockResponse();
  await getHandler({ query: { from: '01/11/2026' } }, res);
  expect(mockFind).toHaveBeenCalledWith({});
});

it('rejects a malformed date', async () => {
  const res = mockResponse();
  await putHandler({ params: { date: '17-11-2026' }, body: {} }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockUpsert).not.toHaveBeenCalled();
});

it('marks a date as a holiday', async () => {
  const res = mockResponse();
  await putHandler({ params: { date: '2026-11-18' }, body: { holiday: true, note: ' หยุดชดเชย ' } }, res);
  expect(mockUpsert).toHaveBeenCalledWith(
    { date: '2026-11-18' },
    { $set: { date: '2026-11-18', note: 'หยุดชดเชย' } },
    { new: true, upsert: true },
  );
});

it('removes the holiday when unchecked', async () => {
  const res = mockResponse();
  await putHandler({ params: { date: '2026-11-18' }, body: { holiday: false } }, res);
  expect(mockDelete).toHaveBeenCalledWith({ date: '2026-11-18' });
  expect(mockUpsert).not.toHaveBeenCalled();
});
