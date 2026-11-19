const mockFind = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockCodeFind = jest.fn();
const mockCodeUpsert = jest.fn();

jest.mock('../models/BalanceControlConfig', () => ({
  find: (...args) => ({ lean: () => mockFind(...args) }),
  findOneAndUpdate: (...args) => ({ lean: () => mockFindOneAndUpdate(...args) }),
}));
jest.mock('../models/BalanceWeightCode', () => ({
  find: (...args) => ({ lean: () => mockCodeFind(...args) }),
  findOneAndUpdate: (...args) => ({ lean: () => mockCodeUpsert(...args) }),
}));

const router = require('./balanceControlConfig');

const handler = (method, path) => router.stack.find(
  (layer) => layer.route?.path === path && layer.route.methods[method],
).route.stack[0].handle;

const getHandler = handler('get', '/');
const putHandler = handler('put', '/:scaleId');
const putCodeHandler = handler('put', '/weight-code/:nominal');
const baselineValues = Array.from({ length: 20 }, (_, index) => 100 + index / 1000);
const baselineMean = baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length;
const baselineSd = Math.sqrt(baselineValues.reduce((sum, value) => sum + (value - baselineMean) ** 2, 0) / (baselineValues.length - 1));

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('GET /balance-control-config', () => {
  beforeEach(() => {
    mockFind.mockReset();
    mockCodeFind.mockReset();
    mockCodeFind.mockResolvedValue([]);
  });

  it('returns two control weights for all five scales when nothing is stored', async () => {
    mockFind.mockResolvedValue([]);
    const res = mockResponse();
    await getHandler({}, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data).toHaveLength(10);
    expect(data.slice(0, 2)).toMatchObject([{ scaleId: 'scale-1', nominal: 500 }, { scaleId: 'scale-1', nominal: 10 }]);
    expect(data[0]).toMatchObject({ brand: 'Mettler Toledo', model: 'MS3002S', mean: null, sd: null });
  });

  it('merges stored control values over the defaults', async () => {
    mockFind.mockResolvedValue([{ scaleId: 'scale-2', brand: 'Mettler Toledo', model: 'MS204', nominal: 100, mean: 99.99972, sd: 0.0000476, updatedDate: '2026-10-26' }]);
    mockCodeFind.mockResolvedValue([{ nominal: 100, weightCode: 'GL55-11006' }]);
    const res = mockResponse();
    await getHandler({}, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.find((item) => item.scaleId === 'scale-2' && item.nominal === 100)).toMatchObject({ weightCode: 'GL55-11006', mean: 99.99972, sd: 0.0000476 });
    expect(data[0].mean).toBeNull();
  });

  it('applies a shared weight code to every scale and adds its weight size', async () => {
    mockFind.mockResolvedValue([]);
    mockCodeFind.mockResolvedValue([{ nominal: 250, weightCode: 'W-250' }]);
    const res = mockResponse();
    await getHandler({}, res);
    const { data } = res.json.mock.calls[0][0];
    const at250 = data.filter((item) => item.nominal === 250);
    expect(at250).toHaveLength(5);
    expect(at250.every((item) => item.weightCode === 'W-250')).toBe(true);
  });
});

describe('PUT /balance-control-config/weight-code/:nominal', () => {
  beforeEach(() => {
    mockCodeUpsert.mockReset();
    mockCodeUpsert.mockResolvedValue({});
  });

  it('rejects a non-integer weight size', async () => {
    const res = mockResponse();
    await putCodeHandler({ params: { nominal: '0.5' }, body: { weightCode: 'W-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCodeUpsert).not.toHaveBeenCalled();
  });

  it('upserts a trimmed weight code for one weight size', async () => {
    const res = mockResponse();
    await putCodeHandler({ params: { nominal: '10' }, body: { weightCode: ' GL55-11006 ' } }, res);
    expect(mockCodeUpsert).toHaveBeenCalledWith(
      { nominal: 10 },
      { $set: { nominal: 10, weightCode: 'GL55-11006' } },
      { new: true, upsert: true },
    );
    expect(res.json).toHaveBeenCalledWith({ data: { nominal: 10, weightCode: 'GL55-11006' } });
  });
});

describe('PUT /balance-control-config/:scaleId', () => {
  beforeEach(() => {
    mockFindOneAndUpdate.mockReset();
    mockFindOneAndUpdate.mockImplementation(async (_q, update) => update);
  });

  it('rejects an unknown scale id', async () => {
    const res = mockResponse();
    await putHandler({ params: { scaleId: 'scale-9' }, body: { mean: 100, sd: 0.1 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [{ baselineValues: baselineValues.slice(0, 19) }, 'กรอกค่าบันทึกให้ครบ 20 ค่า'],
    [{ baselineValues: [...baselineValues.slice(0, 19), 'abc'] }, 'กรอกค่าบันทึกให้ครบ 20 ค่า'],
    [{ baselineValues, nominal: 0.5 }, 'น้ำหนักตุ้มต้องเป็นจำนวนเต็มมากกว่า 0'],
    [{ baselineValues, updatedDate: '26/10/2569' }, 'วันที่ปรับปรุงต้องอยู่ในรูปแบบ YYYY-MM-DD'],
  ])('rejects invalid body %j', async (body, message) => {
    const res = mockResponse();
    await putHandler({ params: { scaleId: 'scale-1' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: message });
  });

  it('accepts an additional positive integer weight size', async () => {
    const res = mockResponse();
    await putHandler({ params: { scaleId: 'scale-1' }, body: { nominal: 250, baselineValues } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate.mock.calls[0][1].$set['controls.250']).toMatchObject({ nominal: 250 });
  });

  it('upserts valid control values', async () => {
    const res = mockResponse();
    await putHandler({
      params: { scaleId: 'scale-2' },
      body: { nominal: 100, baselineValues, updatedDate: '2026-10-26' },
    }, res);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { scaleId: 'scale-2' },
      { $set: expect.objectContaining({
        scaleId: 'scale-2',
        brand: 'Mettler Toledo',
        model: 'MS204',
        'controls.100': expect.objectContaining({ nominal: 100, mean: baselineMean, sd: baselineSd, baselineValues }),
      }) },
      { new: true, upsert: true },
    );
    expect(res.json.mock.calls[0][0].data).toMatchObject({ scaleId: 'scale-2', mean: baselineMean, sd: baselineSd, baselineValues, updatedDate: '2026-10-26' });
  });

  it('upserts 20 identical values with zero STD', async () => {
    const res = mockResponse();
    await putHandler({ params: { scaleId: 'scale-1' }, body: { nominal: 10, baselineValues: Array(20).fill(10) } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toMatchObject({ scaleId: 'scale-1', mean: 10, sd: 0 });
  });
});
