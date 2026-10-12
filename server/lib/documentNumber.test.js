const { describe, it, test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULTS,
  escapeRegex,
  buildScanPrefix,
  validateDocNumberConfig,
} = require('./documentNumber');

// Fixed date: 2026-06-15. getFullYear()=2026 → yy=slice(-2)="26"; month index 5 → mm="06".
const JUNE_2026 = new Date(2026, 5, 15);

test('DEFAULTS build the exact legacy prefixes', () => {
  assert.strictEqual(buildScanPrefix(DEFAULTS.petition, JUNE_2026), 'P-2606-');
  assert.strictEqual(buildScanPrefix(DEFAULTS.sampleReceipt, JUNE_2026), 'RCV-2026-');
  assert.strictEqual(buildScanPrefix(DEFAULTS.labRequest, JUNE_2026), 'L-2606-');
});

test('buildScanPrefix: 4-digit year, no month', () => {
  const cfg = { prefix: 'P', yearFormat: 'yyyy', includeMonth: false, separator: '-', seqPadding: 4 };
  assert.strictEqual(buildScanPrefix(cfg, JUNE_2026), 'P-2026-');
});

test('buildScanPrefix: empty separator concatenates', () => {
  const cfg = { prefix: 'P', yearFormat: 'yy', includeMonth: true, separator: '', seqPadding: 4 };
  assert.strictEqual(buildScanPrefix(cfg, JUNE_2026), 'P2606');
});

test('buildScanPrefix: empty prefix keeps date anchor', () => {
  const cfg = { prefix: '', yearFormat: 'yy', includeMonth: true, separator: '-', seqPadding: 4 };
  assert.strictEqual(buildScanPrefix(cfg, JUNE_2026), '2606-');
});

test('buildScanPrefix: prefix only, no date (never resets)', () => {
  const cfg = { prefix: 'X', yearFormat: 'none', includeMonth: false, separator: '-', seqPadding: 4 };
  assert.strictEqual(buildScanPrefix(cfg, JUNE_2026), 'X-');
});

test('escapeRegex escapes regex-special chars', () => {
  assert.strictEqual(escapeRegex('P.('), 'P\\.\\(');
});

test('validate: rejects when no prefix and no year', () => {
  const err = validateDocNumberConfig({ prefix: '  ', yearFormat: 'none', includeMonth: true, separator: '-', seqPadding: 4 });
  assert.match(err, /prefix หรือปี/);
});

test('validate: accepts prefix-only', () => {
  assert.strictEqual(validateDocNumberConfig({ prefix: 'P', yearFormat: 'none', includeMonth: false, separator: '-', seqPadding: 4 }), null);
});

test('validate: accepts year-only (no prefix)', () => {
  assert.strictEqual(validateDocNumberConfig({ prefix: '', yearFormat: 'yyyy', includeMonth: false, separator: '-', seqPadding: 4 }), null);
});

test('validate: rejects seqPadding out of range', () => {
  assert.match(validateDocNumberConfig({ prefix: 'P', yearFormat: 'yy', includeMonth: true, separator: '-', seqPadding: 0 }), /จำนวนหลัก/);
  assert.match(validateDocNumberConfig({ prefix: 'P', yearFormat: 'yy', includeMonth: true, separator: '-', seqPadding: 11 }), /จำนวนหลัก/);
});

test('validate: rejects bad yearFormat', () => {
  assert.match(validateDocNumberConfig({ prefix: 'P', yearFormat: 'decade', includeMonth: true, separator: '-', seqPadding: 4 }), /yearFormat/);
});

test('validate: rejects separator longer than 3', () => {
  assert.match(validateDocNumberConfig({ prefix: 'P', yearFormat: 'yy', includeMonth: true, separator: '----', seqPadding: 4 }), /ตัวคั่น/);
});

test('validate: rejects month-only (no year + includeMonth)', () => {
  assert.match(validateDocNumberConfig({ prefix: 'P', yearFormat: 'none', includeMonth: true, separator: '-', seqPadding: 4 }), /ใส่เดือน ต้องเลือกปีด้วย/);
});

describe('docType ใหม่ของฟอร์ม F-WAR-03', () => {
  const { DEFAULTS, DOC_TYPES, buildScanPrefix } = require('./documentNumber');

  it('มี goodsReceipt และ rawMaterialInspection อยู่ใน DOC_TYPES', () => {
    assert.ok(DOC_TYPES.includes('goodsReceipt'));
    assert.ok(DOC_TYPES.includes('rawMaterialInspection'));
  });

  it('ใบรับสินค้าเดินเลขเป็น GR-YYMM-####', () => {
    const prefix = buildScanPrefix(DEFAULTS.goodsReceipt, new Date(2026, 6, 20));
    assert.strictEqual(prefix, 'GR-2607-');
  });

  it('ใบตรวจสอบวัตถุดิบเดินเลขเป็น RMI-YYMM-####', () => {
    const prefix = buildScanPrefix(DEFAULTS.rawMaterialInspection, new Date(2026, 6, 20));
    assert.strictEqual(prefix, 'RMI-2607-');
  });
});
