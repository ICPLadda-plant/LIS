const express = require('express');
const http = require('http');

const mockMasterItemMetaFind = jest.fn();
const mockItemGroupFind = jest.fn();

jest.mock('../models/ItemGroup', () => ({ find: (...args) => mockItemGroupFind(...args) }));
jest.mock('../models/MasterItemMeta', () => ({ find: (...args) => mockMasterItemMetaFind(...args) }));

const MEDIA_URL = 'http://product-id.test/product-id/api/v1/lis/media-index';

function json(payload) {
  return Promise.resolve({
    ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(payload),
  });
}

function makeApp() {
  jest.resetModules();
  const app = express();
  app.use(require('./masterItems'));
  return app;
}

async function get(app, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const res = await global.originalFetch('http://127.0.0.1:' + server.address().port + path);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('GET /master-items + Product ID media', () => {
  const erpItems = [{ item_no: 'F-A-1X12', common_name: 'ALPHA 10% EC', image_urls: ['http://lis/own.jpg'] }, { item_no: 'F-B-1X12' }];

  beforeAll(() => { global.originalFetch = global.fetch; });
  beforeEach(() => {
    process.env.PRODUCT_ID_MEDIA_URL = MEDIA_URL;
    process.env.PRODUCT_ID_API_KEY = 'pid_test';
    mockMasterItemMetaFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    mockItemGroupFind.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
  });
  afterEach(() => {
    global.fetch = global.originalFetch;
    delete process.env.PRODUCT_ID_MEDIA_URL;
    delete process.env.PRODUCT_ID_API_KEY;
    jest.restoreAllMocks();
  });

  function mockUpstream(mediaResponse) {
    global.fetch = jest.fn((url) => {
      const target = String(url);
      if (target === MEDIA_URL) return mediaResponse();
      if (target.includes('item-product-ldi')) return json([]);
      return json(erpItems);
    });
  }

  test('adds productMedia per item and keeps the LIS imageUrls untouched', async () => {
    const media = { label: 'Overview', kind: 'image', url: 'http://pid/m.webp', thumbUrl: 'http://pid/m.thumb.webp', source: 'packaging' };
    mockUpstream(() => json({ generatedAt: 'now', items: { 'F-A-1X12': [media] } }));
    const res = await get(makeApp(), '/');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ item_no: 'F-A-1X12', productMedia: [media], image_urls: ['http://lis/own.jpg'] });
    expect(res.body[1].productMedia).toEqual([]);
    const mediaCall = global.fetch.mock.calls.find(([url]) => String(url) === MEDIA_URL);
    expect(mediaCall[1].headers['X-API-Key']).toBe('pid_test');
  });

  test('still answers when Product ID is down', async () => {
    mockUpstream(() => Promise.reject(new Error('ECONNREFUSED')));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await get(makeApp(), '/');
    expect(res.status).toBe(200);
    expect(res.body.map((item) => item.productMedia)).toEqual([[], []]);
  });
});
