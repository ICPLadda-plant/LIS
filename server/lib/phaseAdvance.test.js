const test = require('node:test');
const assert = require('node:assert/strict');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { scheduleOrUnlockPhase2, maybeAdvancePhase } = require('./phaseAdvance');

const NOW = new Date('2026-09-19T08:00:00.000Z');
const PAST = new Date('2026-09-18T08:00:00.000Z');
const FUTURE = new Date('2026-09-20T08:00:00.000Z');

function fixture(context) {
  context.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const round = {
    _id: 'qc-round-1', side: 'qc', status: 'received', items: [{ itemSeq: 1 }],
    currentPhase: 1, phase2DueAt: null, phase2UnlockedAt: null, phase2TriggeredBy: null,
  };
  const other = {
    _id: 'lab-round-1', side: 'lab', status: 'received', items: [{ itemSeq: 1 }],
    currentPhase: 1, phase2DueAt: FUTURE, phase2UnlockedAt: null,
    phase2TriggeredBy: { parameterId: 'lab-param', triggeredAt: PAST },
  };
  const petition = {
    _id: 'petition-1', petitionNo: 'P-2609-0010', status: 'inProgress',
    currentPhase: 2, phase2DueAt: PAST, phase2UnlockedAt: PAST,
    phase2TriggeredBy: { parameterId: 'original-param', triggeredAt: PAST },
    completedAt: null, qcCompletedAt: null, labCompletedAt: PAST, labApprovedAt: PAST,
    additionalSampleRequests: [round, other],
    save: context.mock.fn(async () => petition),
  };
  const find = context.mock.method(Petition, 'findById', async () => petition);
  const audit = context.mock.method(PetitionAuditLog, 'create', async (entry) => entry);
  context.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  const input = {
    petitionId: petition._id, parameter: { _id: 'qc-param', name: 'QC timer', scope: 'qc' },
    field: { type: 'timer', triggersPhase2: true, timerDurationSec: 86400 },
    fieldLabel: 'timer', value: 1, itemSeq: 1, sampleRoundId: round._id,
  };
  return { petition, round, other, input, find, audit };
}

function originalState(petition) {
  const { additionalSampleRequests, save, ...state } = petition;
  return structuredClone(state);
}

test('additional timer restarts despite original phase 2 and leaves original/other side unchanged', async (context) => {
  const { petition, round, other, input } = fixture(context);
  const original = originalState(petition);
  const untouched = structuredClone(other);
  await scheduleOrUnlockPhase2(input);
  assert.equal(petition.save.mock.callCount(), 1);
  assert.equal(round.currentPhase, 1);
  assert.deepEqual(round.phase2DueAt, FUTURE);
  assert.equal(round.phase2UnlockedAt, null);
  assert.deepEqual(round.phase2TriggeredBy, {
    parameterId: 'qc-param', parameterName: 'QC timer', fieldLabel: 'timer', itemSeq: 1, triggeredAt: NOW,
  });
  assert.deepEqual(originalState(petition), original);
  assert.deepEqual(other, untouched);
});

test('round keeps its earliest timer, never the original timer', async (context) => {
  const { petition, round, input } = fixture(context);
  round.phase2DueAt = new Date(NOW.getTime() + 3600000);
  round.phase2TriggeredBy = { parameterId: 'earlier-round-trigger' };
  await scheduleOrUnlockPhase2(input);
  assert.equal(petition.save.mock.callCount(), 0);
  assert.equal(round.phase2TriggeredBy.parameterId, 'earlier-round-trigger');
  await scheduleOrUnlockPhase2({ ...input, field: { triggersPhase2: true, type: 'checkbox' } });
  assert.deepEqual(round.phase2DueAt, NOW);
  assert.equal(petition.save.mock.callCount(), 1);
});

test('LAB scheduling updates its own received round without changing QC', async (context) => {
  const { petition, round, other, input } = fixture(context);
  const original = originalState(petition);
  const untouched = structuredClone(round);
  await scheduleOrUnlockPhase2({
    ...input, sampleRoundId: other._id, parameter: { ...input.parameter, scope: 'lab' },
    field: { triggersPhase2: true, type: 'checkbox' },
  });
  assert.deepEqual(other.phase2DueAt, NOW);
  assert.deepEqual(round, untouched);
  assert.deepEqual(originalState(petition), original);
});

test('round scheduling rejects wrong side, item, missing, pending and superseded rounds', async (context) => {
  const { petition, round, input } = fixture(context);
  for (const override of [
    { sampleRoundId: 'missing' }, { sampleRoundId: '' }, { itemSeq: 2 },
    { parameter: { ...input.parameter, scope: 'lab' } },
  ]) await assert.rejects(scheduleOrUnlockPhase2({ ...input, ...override }), /รอบตัวอย่าง/);
  for (const status of ['requested', 'sent']) {
    round.status = status;
    await assert.rejects(scheduleOrUnlockPhase2(input), /รอบตัวอย่าง/);
  }
  round.status = 'received';
  petition.additionalSampleRequests.push({ ...round, _id: 'qc-round-2' });
  await assert.rejects(scheduleOrUnlockPhase2(input), /รอบตัวอย่าง/);
  petition.additionalSampleRequests.at(-1).status = 'requested';
  await assert.rejects(scheduleOrUnlockPhase2(input), /รอบตัวอย่าง/);
  assert.equal(petition.save.mock.callCount(), 0);
});

test('scheduling rejects a deleted petition for an additional round', async (context) => {
  const { input, find } = fixture(context);
  find.mock.mockImplementation(async () => null);
  await assert.rejects(scheduleOrUnlockPhase2(input), /รอบตัวอย่าง/);
});

test('round save conflicts propagate instead of reporting scheduling success', async (context) => {
  const { petition, input } = fixture(context);
  const conflict = new Error('VersionError: round changed');
  petition.save.mock.mockImplementation(async () => { throw conflict; });
  await assert.rejects(scheduleOrUnlockPhase2(input), (error) => error === conflict);
});

test('lazy advance changes only due received round, preserving parent and other side', async (context) => {
  const { petition, round, other, audit } = fixture(context);
  round.phase2DueAt = NOW;
  const original = originalState(petition);
  const untouched = structuredClone(other);
  assert.equal(await maybeAdvancePhase(petition, 'server-user'), petition);
  assert.equal(round.currentPhase, 2);
  assert.deepEqual(round.phase2UnlockedAt, NOW);
  assert.deepEqual(originalState(petition), original);
  assert.deepEqual(other, untouched);
  assert.equal(petition.save.mock.callCount(), 1);
  assert.equal(audit.mock.callCount(), 1);
  const entry = audit.mock.calls[0].arguments[0];
  assert.equal(entry.actor, 'server-user');
  assert.equal(entry.metadata.additionalSampleId, round._id);
  assert.equal(entry.metadata.side, 'qc');
  assert.deepEqual(entry.metadata.phaseAdvance, { from: 1, to: 2 });
  await maybeAdvancePhase(petition);
  assert.equal(petition.save.mock.callCount(), 1);
});

test('lazy advance ignores pending, future and superseded rounds', async (context) => {
  const { petition, round, audit } = fixture(context);
  round.phase2DueAt = PAST;
  round.status = 'sent';
  await maybeAdvancePhase(petition);
  round.status = 'received';
  petition.additionalSampleRequests.push({ ...round, _id: 'qc-round-2', phase2DueAt: FUTURE });
  await maybeAdvancePhase(petition);
  petition.additionalSampleRequests.at(-1).status = 'requested';
  await maybeAdvancePhase(petition);
  assert.equal(round.currentPhase, 1);
  assert.equal(petition.save.mock.callCount(), 0);
  assert.equal(audit.mock.callCount(), 0);
});

test('both received sides advance on their own due time in one save', async (context) => {
  const { petition, round, other, audit } = fixture(context);
  round.phase2DueAt = PAST;
  other.phase2DueAt = NOW;
  const original = originalState(petition);
  await maybeAdvancePhase(petition);
  assert.equal(round.currentPhase, 2);
  assert.equal(other.currentPhase, 2);
  assert.equal(petition.save.mock.callCount(), 1);
  assert.deepEqual(originalState(petition), original);
  assert.deepEqual(audit.mock.calls.map((call) => call.arguments[0].metadata.side).sort(), ['lab', 'qc']);
});

test('lazy save failure propagates before any audit is emitted', async (context) => {
  const { petition, round, audit } = fixture(context);
  round.phase2DueAt = PAST;
  const conflict = new Error('VersionError: changed during lazy advance');
  petition.save.mock.mockImplementation(async () => { throw conflict; });
  await assert.rejects(maybeAdvancePhase(petition), (error) => error === conflict);
  assert.equal(audit.mock.callCount(), 0);
});

test('round audit failure propagates rather than silently disappearing', async (context) => {
  const { petition, round, audit } = fixture(context);
  round.phase2DueAt = PAST;
  const failure = new Error('Audit unavailable');
  audit.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(maybeAdvancePhase(petition), (error) => error === failure);
  assert.equal(petition.save.mock.callCount(), 1);
});

test('legacy scheduling and lazy advancement still use original petition phase', async (context) => {
  const { petition, input, audit } = fixture(context);
  petition.additionalSampleRequests = [];
  petition.currentPhase = 1;
  petition.phase2DueAt = null;
  petition.status = 'success';
  petition.completedAt = PAST;
  await scheduleOrUnlockPhase2({ ...input, sampleRoundId: undefined });
  assert.deepEqual(petition.phase2DueAt, FUTURE);
  await maybeAdvancePhase(petition);
  assert.equal(petition.currentPhase, 1);
  context.mock.timers.setTime(FUTURE.getTime());
  await maybeAdvancePhase(petition);
  assert.equal(petition.currentPhase, 2);
  assert.equal(petition.status, 'inProgress');
  assert.equal(petition.completedAt, null);
  assert.deepEqual(petition.phase2UnlockedAt, FUTURE);
  assert.equal(audit.mock.calls[0].arguments[0].event, 'statusChanged');
});

// ── Phase 2 ต้องเปิดงานของฝั่งที่ trigger ให้ต้องยืนยันผลใหม่ ไม่งั้นหัวหน้าออก Final Result ข้ามผล Phase 2 ได้
const { isPetitionComplete } = require('./petitionStatusLog');

function originalPhaseFixture(context, side) {
  const f = fixture(context);
  f.petition.additionalSampleRequests = [];
  f.petition.currentPhase = 1;
  f.petition.phase2DueAt = PAST;
  f.petition.phase2UnlockedAt = null;
  f.petition.phase2TriggeredBy = { parameterId: 'p', side, triggeredAt: PAST };
  f.petition.status = 'success';
  f.petition.completedAt = PAST;
  f.petition.qcCompletedAt = PAST;
  f.petition.qcCompletedBy = 'qc-user';
  f.petition.labCompletedAt = PAST;
  f.petition.labCompletedBy = 'lab-user';
  f.petition.labApprovedAt = PAST;
  f.petition.labApprovedBy = 'lab-head';
  f.petition.items = [{ batchNo: 'B-1', sampleName: 'x' }]; // batch ลงท้าย 1 = มี Lab track
  return f;
}

test('original Phase 2 triggered on QC side reopens QC only, so petition is no longer complete', async (context) => {
  const { petition } = originalPhaseFixture(context, 'qc');
  await maybeAdvancePhase(petition);
  assert.equal(petition.currentPhase, 2);
  assert.equal(petition.qcCompletedAt, null);
  assert.equal(petition.qcCompletedBy, undefined);
  assert.deepEqual(petition.labApprovedAt, PAST);
  assert.deepEqual(petition.labCompletedAt, PAST);
  assert.equal(isPetitionComplete(petition), false);
});

test('original Phase 2 triggered on Lab side reopens Lab only (completion and approval)', async (context) => {
  const { petition } = originalPhaseFixture(context, 'lab');
  await maybeAdvancePhase(petition);
  assert.equal(petition.labCompletedAt, null);
  assert.equal(petition.labApprovedAt, null);
  assert.equal(petition.labApprovedBy, undefined);
  assert.deepEqual(petition.qcCompletedAt, PAST);
  assert.equal(isPetitionComplete(petition), false);
});

test('legacy trigger without side reopens both tracks (safe default)', async (context) => {
  const { petition } = originalPhaseFixture(context, undefined);
  await maybeAdvancePhase(petition);
  assert.equal(petition.qcCompletedAt, null);
  assert.equal(petition.labCompletedAt, null);
  assert.equal(petition.labApprovedAt, null);
});

test('original scheduling records the trigger side', async (context) => {
  const { petition, input } = fixture(context);
  petition.additionalSampleRequests = [];
  petition.currentPhase = 1;
  petition.phase2DueAt = null;
  await scheduleOrUnlockPhase2({ ...input, sampleRoundId: undefined });
  assert.equal(petition.phase2TriggeredBy.side, 'qc');
  await scheduleOrUnlockPhase2({
    ...input, sampleRoundId: undefined, parameter: { ...input.parameter, scope: 'lab' },
    field: { triggersPhase2: true, type: 'checkbox' },
  });
  assert.equal(petition.phase2TriggeredBy.side, 'lab');
});
