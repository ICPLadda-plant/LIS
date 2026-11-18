const mockDailyCheckCreate = jest.fn();

jest.mock('../models/DailyCheck', () => ({
  create: (...args) => mockDailyCheckCreate(...args),
}));

const router = require('./dailyChecks');

const postHandler = router.stack.find(
  (layer) => layer.route?.path === '/' && layer.route.methods.post,
).route.stack[0].handle;

const validBody = () => ({
  scaleId: 'scale-1',
  scaleName: 'LD-005 - เครื่องชั่งดิจิตอล 2 ตำแหน่ง',
  model: 'Balance A',
  weights100: ['100.01', '100.01', '100.01'],
  weights10: ['10.01', '10.01', '10.01'],
  avg100: 100.01,
  avg10: 10.01,
  status100: 'pass',
  status10: 'pass',
  tolerance: 0.05,
  recorder: 'Dev Administrator',
});

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('POST /daily-checks', () => {
  beforeEach(() => {
    mockDailyCheckCreate.mockReset();
    mockDailyCheckCreate.mockImplementation(async (doc) => doc);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('saves a calibration outside the morning and afternoon periods', async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 3, 18, 30) });
    const res = mockResponse();

    await postHandler({ body: validBody() }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockDailyCheckCreate).toHaveBeenCalledTimes(1);
    expect(mockDailyCheckCreate.mock.calls[0][0].period).toBeUndefined();
    expect(mockDailyCheckCreate.mock.calls[0][0].status).toBe('pass');
  });

  test('keeps the period label for a calibration within the morning period', async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 3, 9, 0) });
    const res = mockResponse();

    await postHandler({ body: validBody() }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockDailyCheckCreate.mock.calls[0][0].period).toBe('morning');
  });

  test('rejects zero and negative weight values', async () => {
    const res = mockResponse();
    await postHandler({ body: { ...validBody(), weights10: ['-0.09', '10.01', '10.01'] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'ค่าน้ำหนักทุกค่าต้องเป็นตัวเลขที่มากกว่า 0' });
    expect(mockDailyCheckCreate).not.toHaveBeenCalled();
  });

  test('saves a selected past date and rejects future dates', async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 17, 9, 0) });
    const pastRes = mockResponse();
    await postHandler({ body: { ...validBody(), date: '2026-11-12' } }, pastRes);
    expect(mockDailyCheckCreate.mock.calls[0][0]).toMatchObject({ date: '2026-11-12', period: undefined });

    mockDailyCheckCreate.mockClear();
    const futureRes = mockResponse();
    await postHandler({ body: { ...validBody(), date: '2026-11-18' } }, futureRes);
    expect(futureRes.status).toHaveBeenCalledWith(400);
    expect(mockDailyCheckCreate).not.toHaveBeenCalled();
  });
});
