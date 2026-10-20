const { createUploadSessionGate, isProtectedUploadPath } = require('./uploadSessionGate');

function makeRes() {
  const res = { statusCode: 200, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

describe('upload session gate', () => {
  test.each([
    '/param-files/a.pdf',
    '/param%2Dfiles/a.pdf',
    '/param%2dfiles/a.pdf',
    '//param-files/a.pdf',
    '/x/../param-files/a.pdf',
    '/./param-files/a.pdf',
    '/PARAM-FILES/a.pdf',
    '/param-files%2Fa.pdf',
    '/%E0%A4%A',
  ])('treats %s as a protected parameter attachment', (path) => {
    expect(isProtectedUploadPath(path)).toBe(true);
  });

  test.each([
    '/qc-photos/a.jpg',
    '/signatures/a.png',
    '/param-files-old/a.pdf',
  ])('leaves %s to the existing static behavior', (path) => {
    expect(isProtectedUploadPath(path)).toBe(false);
  });

  test('rejects an encoded param-files path without a session', async () => {
    const gate = createUploadSessionGate({
      getSessionUserId: () => null,
      findUserById: async () => null,
    });
    const res = makeRes();
    let called = false;
    await gate({ path: '/param%2Dfiles/a.pdf' }, res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  test('lets an active session user read param-files', async () => {
    const gate = createUploadSessionGate({
      getSessionUserId: () => 'u1',
      findUserById: async () => ({ _id: 'u1', status: 'active' }),
    });
    let called = false;
    await gate({ path: '/param-files/a.pdf' }, makeRes(), () => { called = true; });
    expect(called).toBe(true);
  });
});
