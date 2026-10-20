const express = require('express');
const http = require('http');

const mockMasterItemMetaFind = jest.fn();
const mockItemGroupFind = jest.fn();

jest.mock('../models/ItemGroup', () => ({
  find: (...args) => mockItemGroupFind(...args),
}));

jest.mock('../models/MasterItemMeta', () => ({
  find: (...args) => mockMasterItemMetaFind(...args),
}));

function jsonResponse(payload, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: jest.fn().mockResolvedValue(payload),
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
  });
}

function makeApp() {
  jest.resetModules();
  const router = require('./masterItems');
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function request(app, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path, method: 'GET' },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode,
                body: body ? JSON.parse(body) : null,
              });
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('masterItems route', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    mockMasterItemMetaFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    mockItemGroupFind.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('GET / adds all matching groups with exclusions taking precedence', async () => {
    const groups = [
      { _id: 'common', name: 'Common', commonNames: [' diuron 80% wp '] },
      { _id: 'trade', name: 'Trade', tradeNames: [' brand '] },
      { _id: 'manual', name: 'Manual', includeItemNos: [' FG-001 ', 'META-ONLY'] },
      { _id: 'excluded', name: 'Excluded', commonNames: ['DIURON 80% WP'], includeItemNos: ['FG-001'], excludeItemNos: [' FG-001 '] },
      { _id: 'case', name: 'Case sensitive code', includeItemNos: ['fg-001'] },
    ];
    mockItemGroupFind.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(groups) }) });
    mockMasterItemMetaFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([
      { itemNo: 'META-ONLY', itemName: 'Local item' },
    ]) });
    global.fetch
      .mockReturnValueOnce(jsonResponse([
        { item_no: ' FG-001 ', common_name: 'diuron 80% wp', trade_name: 'Brand', unit_cost: 42 },
        { item_no: 'NONE', common_name: '' },
      ]))
      .mockReturnValueOnce(jsonResponse([{ itemCode: 'LDI-001', commonName: 'DIURON 80% WP' }]));

    const res = await request(makeApp(), '/');

    expect(res.status).toBe(200);
    expect(mockItemGroupFind).toHaveBeenCalledWith({ status: 'active' });
    expect(res.body[0]).toMatchObject({ unit_cost: 42, itemGroups: [
      { _id: 'common', name: 'Common' },
      { _id: 'trade', name: 'Trade' },
      { _id: 'manual', name: 'Manual' },
    ] });
    expect(res.body[1].itemGroups).toEqual([]);
    expect(res.body[2].itemGroups).toEqual([
      { _id: 'common', name: 'Common' }, { _id: 'excluded', name: 'Excluded' },
    ]);
    expect(res.body[3].itemGroups).toEqual([{ _id: 'manual', name: 'Manual' }]);
  });

  test('GET / returns an empty group list when no active groups exist', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse([{ item_no: 'FG-001' }]))
      .mockReturnValueOnce(jsonResponse([]));
    const res = await request(makeApp(), '/');
    expect(res.status).toBe(200);
    expect(res.body[0].itemGroups).toEqual([]);
  });

  test('GET /common-names returns grouped common names before /:id fallback', async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse([
        { item_no: 'FG-001', common_name: 'DIURON 80% WP + HEXAZINONE 13.2% SL' },
        { item_no: 'FG-002', common_name: 'DIURON 80% WP' },
        { item_no: 'RM-001', item_name2: 'ABAMECTIN 1.8% EC' },
        { item_no: 'FG-003', common_name: 'CYMOXANIL (MIX A+B)' },
      ]))
      .mockReturnValueOnce(jsonResponse([
        { item_no: 'LDI-001', commonName: 'HEXAZINONE 13.2% SL' },
      ]));

    const res = await request(makeApp(), '/common-names');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { key: 'abamectin 1.8% ec', commonName: 'ABAMECTIN 1.8% EC', itemCount: 1, itemNos: ['RM-001'], imageUrl: '', imageUrls: [] },
      { key: 'cymoxanil (mix a+b)', commonName: 'CYMOXANIL (MIX A+B)', itemCount: 1, itemNos: ['FG-003'], imageUrl: '', imageUrls: [] },
      { key: 'diuron 80% wp', commonName: 'DIURON 80% WP', itemCount: 2, itemNos: ['FG-001', 'FG-002'], imageUrl: '', imageUrls: [] },
      { key: 'diuron 80% wp + hexazinone 13.2% sl', commonName: 'DIURON 80% WP + HEXAZINONE 13.2% SL', itemCount: 1, itemNos: ['FG-001'], imageUrl: '', imageUrls: [] },
      { key: 'hexazinone 13.2% sl', commonName: 'HEXAZINONE 13.2% SL', itemCount: 2, itemNos: ['FG-001', 'LDI-001'], imageUrl: '', imageUrls: [] },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('GET /common-names includes saved master item photos from meta', async () => {
    mockMasterItemMetaFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          itemNo: 'FG-010',
          imageUrls: [
            '/LIS/uploads/qc-photos/diuron-front.webp',
            '/LIS/uploads/qc-photos/diuron-label.png',
          ],
        },
        {
          itemNo: 'META-ONLY',
          itemName: 'ABAMECTIN A',
          itemType: 'ABAMECTIN 1.8% EC',
          imageUrl: '/LIS/uploads/qc-photos/abamectin.jpg',
        },
      ]),
    });
    global.fetch
      .mockReturnValueOnce(jsonResponse([
        { item_no: 'FG-010', common_name: 'DIURON 80% WP' },
      ]))
      .mockReturnValueOnce(jsonResponse([]));

    const res = await request(makeApp(), '/common-names');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        key: 'abamectin 1.8% ec',
        commonName: 'ABAMECTIN 1.8% EC',
        itemCount: 1,
        itemNos: ['META-ONLY'],
        imageUrl: '/LIS/uploads/qc-photos/abamectin.jpg',
        imageUrls: ['/LIS/uploads/qc-photos/abamectin.jpg'],
      },
      {
        key: 'diuron 80% wp',
        commonName: 'DIURON 80% WP',
        itemCount: 1,
        itemNos: ['FG-010'],
        imageUrl: '/LIS/uploads/qc-photos/diuron-front.webp',
        imageUrls: [
          '/LIS/uploads/qc-photos/diuron-front.webp',
          '/LIS/uploads/qc-photos/diuron-label.png',
        ],
      },
    ]);
  });
});
