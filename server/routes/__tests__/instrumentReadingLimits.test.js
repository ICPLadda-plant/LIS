const { boundedTimeoutMs, readBodyWithLimit } = require('../instrument-readings');

function streamResponse(chunks, headers = {}) {
  let index = 0;
  return {
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () => (index < chunks.length
          ? { done: false, value: new TextEncoder().encode(chunks[index++]) }
          : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
  };
}

describe('instrument reading limits', () => {
  test('clamps stored timeoutMs to the server range', () => {
    expect(boundedTimeoutMs(undefined)).toBe(5000);
    expect(boundedTimeoutMs(0)).toBe(5000);
    expect(boundedTimeoutMs(100)).toBe(500);
    expect(boundedTimeoutMs(8000)).toBe(8000);
    expect(boundedTimeoutMs(2147483647)).toBe(60000);
  });

  test('reads a normal JSON body', async () => {
    const text = await readBodyWithLimit(streamResponse(['{"v":', '1}']), 1024);
    expect(JSON.parse(text)).toEqual({ v: 1 });
  });

  test('stops reading once the body exceeds the limit', async () => {
    const controller = new AbortController();
    await expect(readBodyWithLimit(streamResponse(['x'.repeat(600), 'x'.repeat(600)]), 1000, controller))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(controller.signal.aborted).toBe(true);
  });

  test('rejects a declared content-length above the limit before reading', async () => {
    await expect(readBodyWithLimit(streamResponse(['{}'], { 'content-length': '5000' }), 1000))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
});
