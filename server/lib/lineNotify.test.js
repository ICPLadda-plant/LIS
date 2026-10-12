const test = require('node:test');
const assert = require('node:assert');
const {
  assigneeSide,
  petitionStatusText,
  audiencesForEvent,
  describeEvent,
  notifyPetitionEvent,
} = require('./lineNotify');
const LineGroup = require('../models/LineGroup');
const line = require('./line');

const additionalPetition = {
  _id: 'p1', petitionNo: 'P-2609-0018', dept: 'production',
  submittedBy: { employeeId: 'E100', department: 'R & D' },
};
const additionalEvent = (type = 'additionalSampleRequested', side = 'lab') => ({
  event: 'updated', toStatus: 'inProgress', actor: 'เจ้าหน้าที่จากเซิร์ฟเวอร์',
  metadata: {
    type, side, additionalSampleId: 'round-1', reason: 'ผลไม่ผ่านเกณฑ์',
    items: [{ itemSeq: 1, quantity: 2 }, { itemSeq: 3, quantity: 4 }],
  },
});

test('additional requested/received route to submitted department before form dept', () => {
  for (const [department, audience] of [
    ['R&D', 'rd'], ['R & D', 'rd'], ['RD', 'rd'], ['FG', 'fg'],
    ['production', 'production'], ['แผนกผลิต', 'production'], ['RM', 'rm'],
  ]) {
    const source = { ...additionalPetition, submittedBy: { department } };
    for (const type of ['additionalSampleRequested', 'additionalSampleReceived']) {
      assert.deepStrictEqual(audiencesForEvent(source, additionalEvent(type)), [audience]);
    }
  }
  assert.deepStrictEqual(audiencesForEvent({ dept: 'rm' }, additionalEvent()), ['rm']);
});

test('additional sent routes only to requesting side', () => {
  for (const side of ['qc', 'lab']) {
    assert.deepStrictEqual(
      audiencesForEvent(additionalPetition, additionalEvent('additionalSampleSent', side)), [side],
    );
  }
});

test('additional descriptions include round, side, reason and summed quantities without a note', () => {
  for (const [type, title] of [
    ['additionalSampleRequested', 'ขอตัวอย่างเพิ่ม'],
    ['additionalSampleSent', 'ส่งตัวอย่างเพิ่มแล้ว'],
    ['additionalSampleReceived', 'รับตัวอย่างเพิ่มแล้ว'],
  ]) {
    for (const side of ['qc', 'lab']) {
      const desc = describeEvent(additionalPetition, additionalEvent(type, side));
      assert.ok(desc);
      assert.ok(desc.text.startsWith(title + ' P-2609-0018'));
      assert.match(desc.text, new RegExp(side.toUpperCase()));
      assert.match(desc.text, /ผลไม่ผ่านเกณฑ์/);
      assert.match(desc.text, /รวม 6/);
      assert.match(desc.text, /รายการ 1: 2/);
      assert.match(desc.text, /รายการ 3: 4/);
      assert.match(desc.text, /round-1/);
      assert.match(desc.text, /เจ้าหน้าที่จากเซิร์ฟเวอร์/);
    }
  }
});

test('additional descriptions include each selected sample weight', () => {
  const desc = describeEvent(additionalPetition, { ...additionalEvent(), metadata: { ...additionalEvent().metadata, items: [{ itemSeq: 1, quantity: 2, weights: [100, 500] }] } });
  assert.ok(desc);
  assert.match(desc.text, /รายการ 1: 2 ตัวอย่าง \(100, 500 กรัม\)/);
});

test('additional request without department still describes personal bell delivery', () => {
  const desc = describeEvent({ submittedBy: { employeeId: 'E100' } }, additionalEvent());
  assert.ok(desc);
  assert.deepStrictEqual(desc.audiences, []);
});

test('malformed additional metadata never falls through to generic updated notifications', () => {
  for (const patch of [
    { side: 'fg' }, { additionalSampleId: '' }, { additionalSampleId: ' ' },
    { items: undefined }, { items: [] }, { items: [null] },
    { items: [{ itemSeq: 1, quantity: 0 }] }, { items: [{ itemSeq: 1, quantity: '2' }] },
  ]) {
    const payload = additionalEvent();
    payload.metadata = { ...payload.metadata, ...patch };
    payload.note = 'must not notify';
    assert.strictEqual(describeEvent(additionalPetition, payload), null);
  }
});

test('additional metadata does not change routing or wording of other event paths', () => {
  const payload = { ...additionalEvent(), event: 'created' };
  const desc = describeEvent(additionalPetition, payload);
  assert.deepStrictEqual(desc.audiences, ['lab']);
  assert.match(desc.text, /คำขอใหม่/);
  assert.strictEqual(desc.recipientEmployeeIds, undefined);
});

test('LINE fanout uses only enabled department/side and all groups, with unique group IDs', async (context) => {
  context.mock.method(line, 'isConfigured', () => true);
  const pushes = context.mock.method(line, 'pushToGroup', async () => ({ ok: true }));
  const groups = [
    ...['rd', 'fg', 'rm', 'production', 'qc', 'lab', 'all'].map((audience) => ({
      audience, groupId: 'group-' + audience, enabled: true,
    })),
    { audience: 'rd', groupId: 'disabled', enabled: false },
    { audience: 'rd', groupId: 'group-all', enabled: true },
  ];
  const lookup = context.mock.method(LineGroup, 'find', (query) => ({
    lean: async () => groups.filter((group) => group.enabled === query.enabled && query.audience.$in.includes(group.audience)),
  }));
  const network = context.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden in notification QA'); });
  for (const [type, side, department, expected] of [
    ['additionalSampleRequested', 'qc', 'R&D', 'rd'],
    ['additionalSampleRequested', 'lab', 'FG', 'fg'],
    ['additionalSampleRequested', 'lab', 'RM', 'rm'],
    ['additionalSampleRequested', 'qc', 'ผลิต', 'production'],
    ['additionalSampleSent', 'lab', 'R&D', 'lab'],
    ['additionalSampleSent', 'qc', 'FG', 'qc'],
    ['additionalSampleReceived', 'lab', 'R&D', 'rd'],
    ['additionalSampleReceived', 'qc', 'FG', 'fg'],
  ]) {
    pushes.mock.resetCalls();
    const source = { ...additionalPetition, submittedBy: { department } };
    await notifyPetitionEvent(source, additionalEvent(type, side));
    assert.deepStrictEqual(lookup.mock.calls.at(-1).arguments[0], {
      audience: { $in: [expected, 'all'] }, enabled: true,
    });
    assert.deepStrictEqual(pushes.mock.calls.map((call) => call.arguments[0]).sort(), ['group-' + expected, 'group-all'].sort());
    assert.ok(pushes.mock.calls.every((call) => call.arguments[1] === describeEvent(source, additionalEvent(type, side)).text));
  }
  assert.strictEqual(network.mock.callCount(), 0);
});

test('LINE group schema accepts rd without connecting to MongoDB', () => {
  assert.ok(LineGroup.AUDIENCES.includes('rd'));
  assert.strictEqual(new LineGroup({ groupId: 'group-rd', audience: 'rd' }).validateSync(), undefined);
});

const labItem = { batchNo: '326', sampleName: 'OMETHOATE' }; // ends in 6 → lab batch
const qcOnlyItem = { batchNo: '320', sampleName: 'FOO' };    // ends in 0 → not lab

test('assigneeSide: lab dept/position → lab, else qc', () => {
  assert.strictEqual(assigneeSide({ department: 'Lab วิเคราะห์' }), 'lab');
  assert.strictEqual(assigneeSide({ position: 'นักวิเคราะห์' }), 'lab');
  assert.strictEqual(assigneeSide({ department: 'QC' }), 'qc');
  assert.strictEqual(assigneeSide(null), null);
});

test('petitionStatusText: both tested, lab not approved → รอตรวจ', () => {
  const p = { status: 'inProgress', qcCompletedAt: 'T', labCompletedAt: 'T' };
  assert.strictEqual(petitionStatusText(p), 'รอตรวจ');
});

test('petitionStatusText: Lab tested, waiting for result → รอออกผล', () => {
  const p = { status: 'inProgress', labCompletedAt: 'T' };
  assert.strictEqual(petitionStatusText(p), 'รอออกผล');
});

test('petitionStatusText: qc only → รอส่วนอื่น', () => {
  assert.strictEqual(
    petitionStatusText({ status: 'inProgress', qcCompletedAt: 'T' }),
    'QC ตรวจครบ · รอส่วนอื่น',
  );
});

test('audiencesForEvent: created → qc only', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ items: [labItem] }, { event: 'created' }),
    ['qc'],
  );
});

test('audiencesForEvent routes R&D created and sampleSent to lab and requester', () => {
  const petition = {
    submittedBy: { department: 'R & D' },
    items: [{ seq: 1, sampleName: 'R&D sample', batchNo: '' }],
  };
  assert.deepStrictEqual(audiencesForEvent(petition, { event: 'created' }), ['lab']);
  assert.deepStrictEqual(
    audiencesForEvent(petition, { event: 'statusChanged', toStatus: 'sampleSent' }),
    ['lab', 'rd'],
  );
});

test('audiencesForEvent: sampleSent uses petition.sentToLab to decide Lab sound audience', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ sentToLab: true, items: [qcOnlyItem] }, { event: 'statusChanged', toStatus: 'sampleSent' }),
    ['qc', 'lab'],
  );
  assert.deepStrictEqual(
    audiencesForEvent({ sentToLab: false, items: [labItem] }, { event: 'statusChanged', toStatus: 'sampleSent' }),
    ['qc'],
  );
});

test('audiencesForEvent: sampleSent also notifies the requester department', () => {
  assert.deepStrictEqual(
    audiencesForEvent(
      { submittedBy: { department: 'ผลิต 01' }, items: [qcOnlyItem] },
      { event: 'statusChanged', toStatus: 'sampleSent' },
    ),
    ['qc', 'production'],
  );
});

test('audiencesForEvent: success with lab item → qc + lab', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ items: [labItem] }, { event: 'statusChanged', toStatus: 'success' }),
    ['qc', 'lab'],
  );
});

test('audiencesForEvent: success without lab item → qc only', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ items: [qcOnlyItem] }, { event: 'statusChanged', toStatus: 'success' }),
    ['qc'],
  );
});

test('audiencesForEvent: success notifies the requester dept too', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ dept: 'rm', items: [labItem] }, { event: 'statusChanged', toStatus: 'success' }),
    ['qc', 'lab', 'rm'],
  );
  assert.deepStrictEqual(
    audiencesForEvent({ dept: 'fg', items: [qcOnlyItem] }, { event: 'statusChanged', toStatus: 'approved' }),
    ['qc', 'fg'],
  );
});

test('audiencesForEvent: assigned routes to the assignee side', () => {
  assert.deepStrictEqual(
    audiencesForEvent(
      { items: [labItem] },
      { event: 'assigned', metadata: { assignee: { department: 'Lab' } } },
    ),
    ['lab'],
  );
});

test('audiencesForEvent: approved → qc only; unknown status → none', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ items: [labItem] }, { event: 'statusChanged', toStatus: 'approved' }),
    ['qc'],
  );
  assert.deepStrictEqual(
    audiencesForEvent({ items: [labItem] }, { event: 'statusChanged', toStatus: 'inProgress' }),
    [],
  );
});

test('audiencesForEvent: updated with side → that side only, without side → none', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ items: [labItem] }, { event: 'updated', metadata: { side: 'lab' } }),
    ['lab'],
  );
  assert.deepStrictEqual(
    audiencesForEvent({ items: [labItem] }, { event: 'updated', metadata: {} }),
    [],
  );
});

test('audiencesForEvent: updated can target QC explicitly', () => {
  assert.deepStrictEqual(
    audiencesForEvent({ items: [labItem] }, { event: 'updated', metadata: { audience: 'qc' } }),
    ['qc'],
  );
});

test('describeEvent: created builds message + audiences', () => {
  const d = describeEvent(
    { petitionNo: 'P-2606-0018', dept: 'rm', items: [labItem], submittedBy: { name: 'สมชาย' } },
    { event: 'created' },
  );
  assert.deepStrictEqual(d.audiences, ['qc']);
  assert.match(d.text, /คำขอใหม่ P-2606-0018/);
  assert.match(d.text, /สมชาย/);
});

test('describeEvent: rejected includes reason note', () => {
  const d = describeEvent(
    { petitionNo: 'P-1', items: [qcOnlyItem] },
    { event: 'statusChanged', toStatus: 'rejected', note: 'ผลไม่ผ่าน' },
  );
  assert.deepStrictEqual(d.audiences, ['qc']);
  assert.match(d.text, /ถูกส่งกลับให้แก้ไข/);
  assert.match(d.text, /ผลไม่ผ่าน/);
});

test('describeEvent: unhandled event → null', () => {
  assert.strictEqual(describeEvent({ items: [] }, { event: 'reviewed' }), null);
  assert.strictEqual(
    describeEvent({ items: [] }, { event: 'updated', metadata: { side: 'lab' } }),
    null, // no note → nothing to say
  );
});
