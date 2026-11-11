const { createProductMediaClient } = require('./productMediaClient');

const okResponse = (items) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ generatedAt: 'x', items }) });
const silent = { warn: jest.fn() };

describe('productMediaClient', () => {
  test('returns {} without calling the network when PRODUCT_ID_MEDIA_URL is not set', async () => {
    const fetchImpl = jest.fn();
    const client = createProductMediaClient({ getUrl: () => '', fetchImpl, logger: silent });
    await expect(client.getIndex()).resolves.toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sends the API key and caches the index for the TTL', async () => {
    let t = 0;
    const fetchImpl = jest.fn(() => okResponse({ 'F-1': [{ url: 'u' }] }));
    const client = createProductMediaClient({
      getUrl: () => 'http://pid/api/v1/lis/media-index', getApiKey: () => 'pid_key', fetchImpl, ttlMs: 1000, now: () => t, logger: silent,
    });
    expect(await client.getIndex()).toEqual({ 'F-1': [{ url: 'u' }] });
    expect(fetchImpl.mock.calls[0][1].headers['X-API-Key']).toBe('pid_key');
    t = 999;
    await client.getIndex();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 1001;
    await client.getIndex();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('falls back to the stale cache, or {} when there is none, when Product ID fails', async () => {
    let t = 0;
    const fetchImpl = jest.fn()
      .mockReturnValueOnce(Promise.reject(new Error('ECONNREFUSED')))
      .mockReturnValueOnce(okResponse({ A: [] }))
      .mockReturnValueOnce(Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    const client = createProductMediaClient({ getUrl: () => 'http://pid', fetchImpl, ttlMs: 10, now: () => t, logger: silent });
    expect(await client.getIndex()).toEqual({});
    expect(await client.getIndex()).toEqual({ A: [] });
    t = 100;
    expect(await client.getIndex()).toEqual({ A: [] });
  });

  test('gives up after the timeout', async () => {
    const fetchImpl = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const client = createProductMediaClient({ getUrl: () => 'http://pid', fetchImpl, timeoutMs: 20, logger: silent });
    await expect(client.getIndex()).resolves.toEqual({});
  });

  test('mediaFor trims the item number and ignores bad data', () => {
    const client = createProductMediaClient({ logger: silent });
    expect(client.mediaFor({ 'F-1': [{ url: 'u' }] }, ' F-1 ')).toEqual([{ url: 'u' }]);
    expect(client.mediaFor({ 'F-1': 'nope' }, 'F-1')).toEqual([]);
    expect(client.mediaFor({}, '')).toEqual([]);
  });
});
