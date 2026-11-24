const test = require('node:test');
const assert = require('node:assert/strict');
const QCTestResult = require('../models/QCTestResult');
const StockUnit = require('../models/StockUnit');
const qcResults = require('./qcResults');

test('PBZ ใช้ Peak area และ Internal std เฉพาะชื่อยาเดียวกันในวันนี้', async (context) => {
  let weightFilter;
  let dailyFilter;
  context.mock.method(StockUnit, 'findOne', () => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) }));
  context.mock.method(QCTestResult, 'findOne', (filter) => {
    weightFilter = filter;
    return { sort: () => ({ lean: async () => null }) };
  });
  context.mock.method(QCTestResult, 'find', (filter) => {
    dailyFilter = filter;
    return { sort: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }) };
  });

  const layer = qcResults.stack.find((entry) => entry.route?.path === '/paclobutrazol-std-weights');
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await layer.route.stack[0].handle({ query: { commonName: 'PACLOBUTRAZOL 25% SC' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(weightFilter.commonName, undefined, 'น้ำหนัก Std ยังใช้ค่าล่าสุดจนเปลี่ยนขวด');
  assert.equal(dailyFilter.commonName, 'PACLOBUTRAZOL 25% SC');
  assert.ok(dailyFilter.updatedAt.$gte instanceof Date);
  assert.ok(Date.now() - dailyFilter.updatedAt.$gte.getTime() < 24 * 3600 * 1000);
});
