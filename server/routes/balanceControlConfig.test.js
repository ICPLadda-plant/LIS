const mockFind = jest.fn();
const mockFindOneAndUpdate = jest.fn();

jest.mock('../models/BalanceControlConfig', () => ({
  find: (...args) => ({ lean: () => mockFind(...args) }),
  findOneAndUpdate: (...args) => ({ lean: () => mockFindOneAndUpdate(...args) }),
}));

const router = require('./balanceControlConfig');

const handler = (method, path) => router.stack.find(
  (layer) => layer.route?.path === path && layer.route.methods[method],
).route.stack[0].handle;

const getHandler = handler('get', '/');
const putHandler = handler('put', '/:scaleId');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('GET /balance-control-config', () => {
  beforeEach(() => mockFind.mockReset());

  it('returns defaults for all five scales when nothing is stored', async () => {
    mockFind.mockResolvedValue([]);
    const res = mockResponse();
    await getHandler({}, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.map((d) => d.scaleId)).toEqual(['scale-1', 'scale-2', 'scale-3', 'scale-4', 'scale-5']);
    expect(data[0]).toMatchObject({ brand: 'Mettler Toledo', model: 'MS3002S', nominal: 100, mean: null, sd: null });
  });

  it('merges stored control values over the defaults', async () => {
    mockFind.mockResolvedValue([{ scaleId: 'scale-2', brand: 'Mettler Toledo', model: 'MS204', weightCode: 'GL55-11006', nominal: 100, mean: 99.99972, sd: 0.0000476, mpe: 0.5, updatedDate: '2026-10-26' }]);
    const res = mockResponse();
    await getHandler({}, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data[1]).toMatchObject({ scaleId: 'scale-2', weightCode: 'GL55-11006', mean: 99.99972, sd: 0.0000476 });
    expect(data[0].mean).toBeNull();
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
    [{ mean: 'abc', sd: 0.1 }, 'ค่า Mean ต้องเป็นตัวเลข'],
    [{ mean: 100, sd: null }, 'ค่า STD ต้องเป็นตัวเลข'],
    [{ mean: 100, sd: 0 }, 'ค่า STD ต้องมากกว่า 0'],
    [{ mean: 100, sd: 0.1, updatedDate: '26/10/2569' }, 'วันที่ปรับปรุงต้องอยู่ในรูปแบบ YYYY-MM-DD'],
  ])('rejects invalid body %j', async (body, message) => {
    const res = mockResponse();
    await putHandler({ params: { scaleId: 'scale-1' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: message });
  });

  it('upserts valid control values', async () => {
    const res = mockResponse();
    await putHandler({
      params: { scaleId: 'scale-2' },
      body: { weightCode: ' GL55-11006 ', mean: 99.99972, sd: 0.0000476, mpe: 0.5, updatedDate: '2026-10-26' },
    }, res);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { scaleId: 'scale-2' },
      expect.objectContaining({ brand: 'Mettler Toledo', model: 'MS204', weightCode: 'GL55-11006', nominal: 100, mean: 99.99972 }),
      { new: true, upsert: true },
    );
    expect(res.json.mock.calls[0][0].data).toMatchObject({ scaleId: 'scale-2', sd: 0.0000476, updatedDate: '2026-10-26' });
  });
});
