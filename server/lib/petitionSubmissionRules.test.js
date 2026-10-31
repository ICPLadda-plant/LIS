const test = require('node:test');
const assert = require('node:assert');
const {
  defaultSendItemToLab,
  isResearchAndDevelopmentDepartment,
  normalizePetitionItems,
  normalizeSampledBy,
  requiresDeliveryAndBatch,
  requiresQcTrack,
  routeTargetsForSubmission,
  validatePetitionSubmission,
} = require('./petitionSubmissionRules');

test('isResearchAndDevelopmentDepartment accepts R & D department variants', () => {
  assert.strictEqual(isResearchAndDevelopmentDepartment('R & D'), true);
  assert.strictEqual(isResearchAndDevelopmentDepartment('r&d'), true);
  assert.strictEqual(isResearchAndDevelopmentDepartment('R and D'), false);
});

test('requiresDeliveryAndBatch is false only for R & D submitters', () => {
  assert.strictEqual(requiresDeliveryAndBatch({ submittedBy: { department: 'R & D' } }), false);
  assert.strictEqual(requiresDeliveryAndBatch({ submittedBy: { department: 'Production' } }), true);
  assert.strictEqual(requiresDeliveryAndBatch({}), true);
});

test('requiresQcTrack is false only for R & D submitters', () => {
  assert.strictEqual(requiresQcTrack({ submittedBy: { department: 'R & D' } }), false);
  assert.strictEqual(requiresQcTrack({ submittedBy: { department: 'Production' } }), true);
  assert.strictEqual(requiresQcTrack({}), true);
});

test('requiresQcTrack honors an explicitly selected route', () => {
  assert.strictEqual(requiresQcTrack({ submittedBy: { department: 'ควบคุมคุณภาพ' }, routeTargets: ['qc'] }), true);
  assert.strictEqual(requiresQcTrack({ submittedBy: { department: 'ควบคุมคุณภาพ' }, routeTargets: ['lab'] }), false);
});

test('validatePetitionSubmission allows R & D submissions without deliverer or batch', () => {
  assert.strictEqual(validatePetitionSubmission({
    dept: 'production',
    submittedBy: { name: 'Research User', department: 'R & D' },
    items: [{ seq: 1, sampleName: 'Sample A', batchNo: '' }],
  }), null);
});

test('validatePetitionSubmission no longer requires a deliverer, but still requires batch for non-R&D submissions', () => {
  assert.strictEqual(validatePetitionSubmission({
    dept: 'production',
    submittedBy: { name: 'Production User', department: 'Production' },
    items: [{ seq: 1, sampleName: 'Sample A', batchNo: 'B-001' }],
  }), null);

  assert.match(validatePetitionSubmission({
    dept: 'production',
    submittedBy: { name: 'Production User', department: 'Production' },
    deliveredBy: { name: 'Runner' },
    items: [{ seq: 1, sampleName: 'Sample A', batchNo: '' }],
  }), /แบช/);
});

test('validatePetitionSubmission requires item note when sendToLab overrides batch suffix default outside production', () => {
  assert.match(validatePetitionSubmission({
    dept: 'rm',
    submittedBy: { name: 'RM User', department: 'RM' },
    deliveredBy: { name: 'Runner' },
    items: [{ seq: 2, sampleName: 'Sample B', batchNo: 'B-002', sendToLab: true, note: '' }],
  }), /โปรดระบุเหตุผล/);

  assert.match(validatePetitionSubmission({
    dept: 'fg',
    submittedBy: { name: 'FG User', department: 'FG' },
    deliveredBy: { name: 'Runner' },
    items: [{ seq: 3, sampleName: 'Sample C', batchNo: 'B-001', sendToLab: false, note: '' }],
  }), /โปรดระบุเหตุผล/);

  assert.strictEqual(validatePetitionSubmission({
    dept: 'rm',
    submittedBy: { name: 'RM User', department: 'RM' },
    deliveredBy: { name: 'Runner' },
    items: [{ seq: 4, sampleName: 'Sample D', batchNo: 'B-002', sendToLab: true, note: 'ส่งตรวจเพิ่ม' }],
  }), null);
});

test('validatePetitionSubmission lets production change Lab routing without a reason', () => {
  assert.strictEqual(validatePetitionSubmission({
    dept: 'production',
    submittedBy: { name: 'Production User', department: 'Production' },
    items: [
      { seq: 1, sampleName: 'Sample B', batchNo: 'B-002', sendToLab: true, note: '' },
      { seq: 2, sampleName: 'Sample C', batchNo: 'B-001', sendToQc: true, sendToLab: false, note: '' },
    ],
  }), null);
});
+
test('normalizePetitionItems keeps production QC / Lab (AI) choices without LIS override', () => {
  const [publicHealth, labOnly] = normalizePetitionItems([
    { seq: 1, sampleName: 'S', commonName: 'CYPERMETHRIN 10% W/V EC (PUBLIC HEALTH)', batchNo: 'B-001', sendToQc: true, sendToLab: false },
    { seq: 2, sampleName: 'T', batchNo: 'B-002', sendToQc: false, sendToLab: true },
  ], { department: 'Production', petitionNo: 'P-2611-0002' });
  assert.strictEqual(publicHealth.sendToLab, false);
  assert.strictEqual(publicHealth.sendToQc, true);
  assert.strictEqual(labOnly.sendToLab, true);
  assert.strictEqual(labOnly.sendToQc, false);
});

test('validatePetitionSubmission requires at least one send target per production batch', () => {
  assert.match(validatePetitionSubmission({
    dept: 'production',
    submittedBy: { name: 'Production User', department: 'Production' },
    items: [{ seq: 1, sampleName: 'S', batchNo: 'B-002', sendToQc: false, sendToLab: false }],
  }), /กรุณาเลือกส่งวิเคราะห์อย่างน้อย 1 ช่อง/);
});

test('routeTargetsForSubmission drops QC only when every batch skips QC', () => {
  const body = { dept: 'production', submittedBy: { name: 'P', department: 'Production' } };
  const labOnly = { sampleName: 'S', batchNo: 'B-2', sendToQc: false, sendToLab: true };
  assert.deepStrictEqual(routeTargetsForSubmission(body, [labOnly, labOnly]), ['lab']);
  assert.strictEqual(routeTargetsForSubmission(body, [labOnly, { ...labOnly, sendToQc: true }]), undefined);
  assert.deepStrictEqual(routeTargetsForSubmission({ ...body, routeTargets: ['qc', 'lab'] }, [labOnly]), ['qc', 'lab']);
});

test('normalizeSampledBy keeps the QC sampler name and id', () => {
  assert.deepStrictEqual(normalizeSampledBy({ employeeId: ' 7 ', name: ' นายอติภัทร  จารุณ ' }), { employeeId: '7', name: 'นายอติภัทร  จารุณ' });
  assert.strictEqual(normalizeSampledBy({ name: ' ' }), undefined);
});


test('validatePetitionSubmission does not require override note for mandatory Lab product groups', () => {
  assert.strictEqual(validatePetitionSubmission({
    dept: 'production',
    submittedBy: { name: 'Production User', department: 'Production' },
    deliveredBy: { name: 'Runner' },
    items: [{ seq: 5, sampleName: 'Sample E', commonName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)', batchNo: 'B-002', sendToLab: false, note: '' }],
  }), null);
});

test('validatePetitionSubmission requires sampleQuantity to be a positive integer', () => {
  assert.match(validatePetitionSubmission({
    dept: 'production',
    submittedBy: { name: 'Production User', department: 'Production' },
    deliveredBy: { name: 'Runner' },
    items: [{ seq: 1, sampleName: 'Sample A', batchNo: 'B-001', sampleQuantity: 0 }],
  }), /จำนวนตัวอย่าง/);
});

test('normalizePetitionItems fills boolean sendToLab from legacy batch suffix defaults', () => {
  assert.deepStrictEqual(
    normalizePetitionItems([
      { seq: 1, batchNo: 'B-001' },
      { seq: 2, batchNo: 'B-002' },
      { seq: 3, batchNo: 'B-003', sendToLab: true },
    ], { department: 'Production', petitionNo: 'P-1' }).map((item) => item.sendToLab),
    [true, false, true],
  );
});

test('normalizePetitionItems forces PUBLIC HEALTH and LIVE STOCK products to Lab', () => {
  assert.strictEqual(defaultSendItemToLab({ commonName: 'CYPERMETHRIN 10% W/V EC (PUBLIC HEALTH)', batchNo: 'B-002' }), true);
  assert.deepStrictEqual(
    normalizePetitionItems([
      { seq: 1, commonName: 'CYPERMETHRIN 10% W/V EC (PUBLIC HEALTH)', batchNo: 'B-002', sendToLab: false },
      { seq: 2, sampleName: 'BIFENTHRIN 10% W/V EC (LIVE STOCK)', batchNo: 'B-002' },
    ], { department: 'Production', petitionNo: 'P-1' }).map((item) => item.sendToLab),
    [true, true],
  );
});

test('normalizePetitionItems forces rodenticide products to Lab every batch', () => {
  assert.strictEqual(defaultSendItemToLab({ commonName: 'BROMADIOLONE 0.005% W/W SAND GRANULE', batchNo: 'B-002' }), true);
  assert.deepStrictEqual(
    normalizePetitionItems([
      { seq: 1, sampleName: 'โบรมาดิโอโลน', commonName: 'BROMADIOLONE 0.005% W/W SAND GRANULE', batchNo: 'B-002', sendToLab: false },
    ], { department: 'Production', petitionNo: 'P-1' }).map((item) => item.sendToLab),
    [true],
  );
});

test('normalizePetitionItems defaults sampleQuantity to 1 and preserves entered quantity', () => {
  assert.deepStrictEqual(
    normalizePetitionItems([
      { seq: 1, batchNo: 'B-001' },
      { seq: 2, batchNo: 'B-002', sampleQuantity: '3' },
    ], { department: 'Production', petitionNo: 'P-1' }).map((item) => item.sampleQuantity),
    [1, 3],
  );
});

test('normalizePetitionItems pairs active ingredients with their percentages', () => {
  assert.strictEqual(
    normalizePetitionItems([
      { seq: 1, commonName: 'CYMOXANIL + MANCOZEB 8% + 64% WP' },
    ], { department: 'Production', petitionNo: 'P-1' })[0].commonName,
    'CYMOXANIL 8% + MANCOZEB 64% WP',
  );
});

test('normalizePetitionItems sets R&D items to sendToLab true by default', () => {
  assert.deepStrictEqual(
    normalizePetitionItems([
      { seq: 1, batchNo: '' },
    ], { department: 'R & D', petitionNo: 'P-2' }),
    [{ seq: 1, batchNo: '', sampleQuantity: 1, sendToLab: true, submissionNo: 'P-2' }],
  );
});
