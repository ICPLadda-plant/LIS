const test = require('node:test');
const assert = require('node:assert');
const { parseCommand, extractPetitionNo } = require('./line');
const line = require('../lib/line');
const lineNotify = require('../lib/lineNotify');
const testHandler = require('./line').stack.find((layer) => layer.route?.path === '/test').route.stack.at(-1).handle;

for (const [label, results, expectedStatus, expectedSent] of [
  ['success', [{ ok: true }, { ok: true }], 200, 2],
  ['forbidden', [{ ok: false, status: 403, error: 'check messages:send and routing' }], 502, 0],
  ['partial success', [{ ok: true }, { ok: false, status: 403, error: 'check messages:send and routing' }], 502, 1],
  ['not configured', [{ ok: false, skipped: true, error: 'LINEMA_API_KEY not set' }], 503, 0],
]) {
  test(`POST /line/test: reports actual delivery results (${label})`, async (context) => {
    const groupIds = results.map((result, index) => `C${index}`);
    context.mock.method(lineNotify, 'resolveGroupIds', async () => groupIds);
    const push = context.mock.method(line, 'pushToGroup', async (groupId) => results[groupIds.indexOf(groupId)]);
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    await testHandler({ body: { audience: 'qc', message: 'hello' } }, response);

    assert.strictEqual(response.statusCode, expectedStatus);
    assert.strictEqual(response.body.sent, expectedSent);
    assert.deepStrictEqual(response.body.results, results);
    assert.strictEqual(push.mock.callCount(), groupIds.length);
    const failure = results.find((result) => !result.ok);
    if (failure) assert.ok(response.body.error.message.includes(failure.error));
  });
}

test('extractPetitionNo: pulls & normalizes a petition no from free text', () => {
  assert.strictEqual(extractPetitionNo('ขอสถานะ P-2606-0018 หน่อย'), 'P-2606-0018');
  assert.strictEqual(extractPetitionNo('p2606 018'), 'P-2606-0018'); // pads to 4 digits
  assert.strictEqual(extractPetitionNo('ไม่มีเลข'), null);
});

test('parseCommand: help / id / bind / unbind', () => {
  assert.deepStrictEqual(parseCommand('/help'), { type: 'help' });
  assert.deepStrictEqual(parseCommand('เมนู'), { type: 'help' });
  assert.deepStrictEqual(parseCommand('/id'), { type: 'id' });
  assert.deepStrictEqual(parseCommand('/ผูก qc'), { type: 'bind', audience: 'qc' });
  assert.deepStrictEqual(parseCommand('/ผูก rd'), { type: 'bind', audience: 'rd' });
  assert.deepStrictEqual(parseCommand('/bind RD'), { type: 'bind', audience: 'rd' });
  assert.deepStrictEqual(parseCommand('/bind LAB'), { type: 'bind', audience: 'lab' });
  assert.deepStrictEqual(parseCommand('/ยกเลิก'), { type: 'unbind' });
});

test('parseCommand: pending / today summaries', () => {
  assert.deepStrictEqual(parseCommand('งานค้าง'), { type: 'pending' });
  assert.deepStrictEqual(parseCommand('ค้าง'), { type: 'pending' });
  assert.deepStrictEqual(parseCommand('/pending'), { type: 'pending' });
  assert.deepStrictEqual(parseCommand('งานวันนี้'), { type: 'today' });
  assert.deepStrictEqual(parseCommand('/today'), { type: 'today' });
});

test('parseCommand: /ถาม AI question (works in groups; keeps full question)', () => {
  assert.deepStrictEqual(
    parseCommand('/ถาม P-2606-0018 ค้างที่ขั้นไหน'),
    { type: 'ask', question: 'P-2606-0018 ค้างที่ขั้นไหน' },
  );
  assert.deepStrictEqual(parseCommand('/ai วันนี้มีงานเข้ากี่ราย'), { type: 'ask', question: 'วันนี้มีงานเข้ากี่ราย' });
  // bare "/ถาม" with no question is not an ask command
  assert.deepStrictEqual(parseCommand('/ถาม'), { type: 'unknown' });
});

test('parseCommand: petition status wins over batch', () => {
  assert.deepStrictEqual(parseCommand('P-2606-0018'), { type: 'status', petitionNo: 'P-2606-0018' });
  assert.deepStrictEqual(parseCommand('สถานะ P-2606-0018'), { type: 'status', petitionNo: 'P-2606-0018' });
});

test('parseCommand: batch / lot search needs a keyword', () => {
  assert.deepStrictEqual(parseCommand('batch 326'), { type: 'batch', term: '326' });
  assert.deepStrictEqual(parseCommand('แบตช์ 326'), { type: 'batch', term: '326' });
  assert.deepStrictEqual(parseCommand('lot: A123'), { type: 'batch', term: 'A123' });
  // bare number without keyword → not a batch search (avoids spamming groups)
  assert.deepStrictEqual(parseCommand('326'), { type: 'unknown' });
});

test('parseCommand: unrelated text → unknown', () => {
  assert.deepStrictEqual(parseCommand('สวัสดีครับ'), { type: 'unknown' });
});
