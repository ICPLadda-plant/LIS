const test = require('node:test');
const assert = require('node:assert');
const {
  bellDescribe,
  isCollapsibleDuplicate,
  isRelevant,
  levelForEvent,
  shouldPlaySampleArrivalSound,
  toNotification,
} = require('./petitionNotifications');

// batchNo ลงท้าย 1 หรือ 6 = งาน Lab (กติกาเดิมใน petitionStatusLog.isLabBatch)
const labItem = { batchNo: '326', sampleName: 'OMETHOATE' };
const petition = {
  _id: 'p1',
  petitionNo: 'P-2606-0018',
  dept: 'production',
  items: [labItem],
  submittedBy: { name: 'สมชาย', employeeId: 'E100', department: 'Production' },
};

const sampleLog = (type = 'additionalSampleRequested', roundId = 'round-1', side = 'lab') => ({
  _id: 'audit-round-1', petitionId: 'p1', event: 'updated', toStatus: 'inProgress',
  actor: 'ผู้ตรวจจากเซิร์ฟเวอร์', createdAt: '2026-09-19T03:00:00.000Z',
  metadata: {
    type, side, additionalSampleId: roundId, reason: 'ผลไม่ผ่าน',
    items: [{ itemSeq: 1, quantity: 2 }, { itemSeq: 2, quantity: 3 }],
    actor: 'ไม่ใช่ผู้ตรวจ', createdAt: '2000-01-01T00:00:00.000Z',
  },
});

test('additional request/receipt reaches department OR exact requester, never unrelated assignee', () => {
  for (const department of ['R&D', 'FG']) {
    const source = { ...petition, submittedBy: { ...petition.submittedBy, department }, assignedTo: { employeeId: 'E200' } };
    for (const type of ['additionalSampleRequested', 'additionalSampleReceived']) {
      const desc = bellDescribe(source, sampleLog(type));
      assert.ok(desc);
      const audience = department === 'R&D' ? 'rd' : 'fg';
      assert.deepStrictEqual(desc.audiences, [audience]);
      assert.strictEqual(isRelevant(desc, source, { employeeId: 'E100', audiences: [] }), true);
      assert.strictEqual(isRelevant(desc, source, { employeeId: 'E999', audiences: [audience] }), true);
      for (const other of ['production', 'rm', 'qc', 'lab', audience === 'rd' ? 'fg' : 'rd']) {
        assert.strictEqual(isRelevant(desc, source, { employeeId: 'E200', audiences: [other] }), false);
      }
      assert.strictEqual(isRelevant(desc, source, { employeeId: 'E10', name: 'สมชาย', audiences: [] }), false);
    }
  }
});

test('additional bell reaches requester when both department sources are missing', () => {
  const source = { _id: 'p1', submittedBy: { employeeId: 'E100' } };
  const desc = bellDescribe(source, sampleLog());
  assert.ok(desc);
  assert.strictEqual(isRelevant(desc, source, { employeeId: ' E100 ', audiences: [] }), true);
  assert.strictEqual(isRelevant(desc, source, { audiences: [] }), false);
});

test('additional sent bell only reaches requesting side, not generic job owners', () => {
  const source = { ...petition, assignedTo: { employeeId: 'E200' } };
  for (const side of ['qc', 'lab']) {
    const desc = bellDescribe(source, sampleLog('additionalSampleSent', 'round-1', side));
    assert.ok(desc);
    assert.strictEqual(isRelevant(desc, source, { employeeId: 'E999', audiences: [side] }), true);
    assert.strictEqual(isRelevant(desc, source, { employeeId: 'E100', audiences: ['production'] }), false);
    assert.strictEqual(isRelevant(desc, source, { employeeId: 'E200', audiences: [side === 'lab' ? 'qc' : 'lab'] }), false);
  }
});

test('additional bell preserves petition link/server timestamp and uses audit actor, not metadata', () => {
  const log = sampleLog();
  const desc = bellDescribe(petition, log);
  assert.ok(desc);
  const notification = toNotification(petition, log, desc);
  assert.strictEqual(notification.title, 'ขอตัวอย่างเพิ่ม ' + petition.petitionNo);
  assert.match(notification.message, /LAB/);
  assert.match(notification.message, /ผลไม่ผ่าน/);
  assert.match(notification.message, /รวม 5/);
  assert.match(notification.message, /ผู้ตรวจจากเซิร์ฟเวอร์/);
  assert.doesNotMatch(notification.message, /ไม่ใช่ผู้ตรวจ/);
  assert.strictEqual(notification.link, '/petition/p1');
  assert.strictEqual(notification.createdAt, log.createdAt);
});

test('additional duplicate rounds collapse per petition, side and event type', () => {
  const seen = new Set();
  const first = sampleLog();
  assert.strictEqual(isCollapsibleDuplicate(first, seen), false);
  assert.strictEqual(isCollapsibleDuplicate({ ...first, _id: 'audit-duplicate' }, seen), true);
  assert.strictEqual(isCollapsibleDuplicate(sampleLog('additionalSampleRequested', 'round-2'), seen), false);
  assert.strictEqual(isCollapsibleDuplicate(sampleLog('additionalSampleRequested', 'round-1', 'qc'), seen), false);
  assert.strictEqual(isCollapsibleDuplicate(sampleLog('additionalSampleSent'), seen), false);
  assert.strictEqual(isCollapsibleDuplicate(sampleLog('additionalSampleReceived'), seen), false);
  assert.strictEqual(isCollapsibleDuplicate({ ...first, petitionId: 'p2' }, seen), false);
  assert.strictEqual(isCollapsibleDuplicate(sampleLog('additionalSampleRequested', ''), seen), false);
  assert.strictEqual(isCollapsibleDuplicate({ petitionId: 'p1', event: 'resultEntered' }, seen), false);
});

test('additional bell ID deduplicates same round across polls, preserving later rounds and stages', () => {
  const notificationId = (log) => toNotification(petition, log, bellDescribe(petition, log)).id;
  const first = sampleLog();
  assert.strictEqual(notificationId(first), notificationId({ ...first, _id: 'second-audit-id' }));
  assert.notStrictEqual(notificationId(first), notificationId(sampleLog('additionalSampleRequested', 'round-2')));
  assert.notStrictEqual(notificationId(first), notificationId(sampleLog('additionalSampleSent')));
  assert.notStrictEqual(notificationId(first), notificationId(sampleLog('additionalSampleReceived')));
});

test('bellDescribe: created ใช้ถ้อยคำร่วมกับ LINE และแตกบรรทัดแรกเป็น title', () => {
  const d = bellDescribe(petition, { event: 'created' });
  assert.deepStrictEqual(d.audiences, ['qc']);
  assert.strictEqual(d.title, '📋 คำขอใหม่ P-2606-0018');
  assert.match(d.message, /ผู้ยื่น: สมชาย/);
  assert.match(d.message, / · /); // หลายบรรทัดถูกรวบด้วย " · "
});

test('bellDescribe: assigned ในกระดิ่งบอกว่ามอบหมายให้คุณแล้ว ไม่แสดงชื่อผู้รับผิดชอบซ้ำ', () => {
  const d = bellDescribe(
    { ...petition, petitionNo: 'P-2609-0013', items: [{ batchNo: '326', sampleName: 'โบร์แลน' }] },
    { event: 'assigned', metadata: { assignee: { employeeId: 'E200', name: 'Dev Lab Analyst', department: 'Lab วิเคราะห์' } } },
  );

  assert.deepStrictEqual(d.audiences, ['lab']);
  assert.strictEqual(d.targetEmployeeId, 'E200');
  assert.strictEqual(d.title, 'มอบหมายงาน P-2609-0013 ให้คุณแล้ว');
  assert.strictEqual(d.message, 'ตัวอย่าง: 1 รายการ · โบร์แลน');
});

test('bellDescribe: received — LINE ไม่ส่ง แต่กระดิ่งส่ง โดยดู side จาก metadata', () => {
  const d = bellDescribe(petition, { event: 'received', metadata: { side: 'lab' } });
  assert.deepStrictEqual(d.audiences, ['lab']);
  assert.strictEqual(d.title, '📥 Lab รับตัวอย่าง P-2606-0018');
});

test('bellDescribe: received ที่ไม่มี side → null', () => {
  assert.strictEqual(bellDescribe(petition, { event: 'received', metadata: {} }), null);
});

test('bellDescribe: resultEntered ไม่มี side → ทั้งสองฝั่งที่งานนี้มี', () => {
  const d = bellDescribe(petition, { event: 'resultEntered', metadata: { parameterName: 'pH' } });
  assert.deepStrictEqual(d.audiences, ['qc', 'lab']);
  assert.strictEqual(d.title, '🧪 เริ่มบันทึกผล P-2606-0018');
  assert.strictEqual(d.message, 'pH');
});

test('bellDescribe: resultUpdated → null เสมอ (แก้ค่าทีละช่องจะเด้งรัว)', () => {
  assert.strictEqual(
    bellDescribe(petition, { event: 'resultUpdated', metadata: { side: 'qc', parameterName: 'pH' } }),
    null,
  );
});

test('bellDescribe: reviewed → null', () => {
  assert.strictEqual(bellDescribe(petition, { event: 'reviewed' }), null);
});

// Finding 3: หัวหน้า QC ส่งกลับ Lab/QC ทดสอบใหม่ — describeEvent ไม่รู้จัก (audiencesForEvent
// map ธรรมดา 'inProgress' เป็น []) จึงต้องมี bell-only fallback เอง
test('bellDescribe: statusChanged toStatus=inProgress ไม่มี metadata.returnTo (ธรรมดา) → null', () => {
  assert.strictEqual(
    bellDescribe(petition, { event: 'statusChanged', toStatus: 'inProgress' }),
    null,
  );
});

test('bellDescribe: statusChanged toStatus=inProgress + returnTo=lab → แจ้งฝั่ง lab ด้วย note เดิม', () => {
  const log = {
    event: 'statusChanged',
    toStatus: 'inProgress',
    note: 'หัวหน้า QC ส่งกลับฝั่ง Labทดสอบใหม่: กลิ่นผิดปกติ',
    metadata: { returnTo: 'lab' },
  };
  const d = bellDescribe(petition, log);
  assert.deepStrictEqual(d.audiences, ['lab']);
  assert.strictEqual(d.title, '🔁 ส่งกลับทดสอบใหม่ P-2606-0018');
  assert.strictEqual(d.message, log.note);
});

test('bellDescribe: statusChanged toStatus=inProgress + returnTo=qc → แจ้งฝั่ง qc', () => {
  const log = {
    event: 'statusChanged',
    toStatus: 'inProgress',
    note: 'หัวหน้า QC ส่งกลับฝั่ง QCทดสอบใหม่: ค่าคลาดเคลื่อน',
    metadata: { returnTo: 'qc' },
  };
  assert.deepStrictEqual(bellDescribe(petition, log).audiences, ['qc']);
});

test('bellDescribe: statusChanged toStatus=inProgress + returnTo=both → แจ้งทั้งสองฝั่งที่งานนี้มี', () => {
  const log = {
    event: 'statusChanged',
    toStatus: 'inProgress',
    note: 'หัวหน้า QC ส่งกลับทั้ง Lab และ QCทดสอบใหม่: ทวนซ้ำทั้งหมด',
    metadata: { returnTo: 'both' },
  };
  assert.deepStrictEqual(bellDescribe(petition, log).audiences, ['qc', 'lab']);
});

test('isRelevant: audience ตัดกัน → true', () => {
  const desc = { audiences: ['qc'], title: 't' };
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['qc'], employeeId: 'E999' }), true);
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], employeeId: 'E999' }), false);
});

test('bellDescribe/isRelevant: แจ้งการแก้ผลหลังปิดงานให้ QC Head ทุกคนเท่านั้น', () => {
  const log = {
    event: 'updated',
    note: 'QC Head แก้ไขผล pH · เหตุผล: กรอกผลผิด',
    metadata: { audience: 'qc', recipientRoles: ['qc-head'] },
  };
  const desc = bellDescribe(petition, log);

  assert.deepStrictEqual(desc.recipientRoles, ['qc-head']);
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['qc'], roles: ['qc-head'] }), true);
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['qc'], roles: ['qc-staff'] }), false);
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], roles: ['qc-head'] }), true);
  assert.strictEqual(toNotification(petition, log, desc).link, '/record-results/p1');
});

test('isRelevant: assigned notification ที่ระบุ targetEmployeeId เห็นเฉพาะคนถูกมอบหมาย', () => {
  const desc = { audiences: ['lab'], title: 't', targetEmployeeId: 'E200' };
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], employeeId: 'E200' }), true);
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], employeeId: 'E201' }), false);
});

test('isRelevant: assigned notification ส่วนตัวต้องไม่ fallback เป็นทั้งแผนกเมื่อไม่มี employeeId', () => {
  const desc = { audiences: ['lab'], title: 't', personal: true };
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], employeeId: 'E201' }), false);
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], employeeId: '' }), false);
});

test('isRelevant: งานที่ตัวเองถือ / คำขอที่ตัวเองยื่น → true แม้ audience ไม่ตรง', () => {
  const desc = { audiences: ['qc'], title: 't' };
  const assigned = { ...petition, assignedTo: { employeeId: 'E200', name: 'สมหญิง' } };
  assert.strictEqual(isRelevant(desc, assigned, { audiences: ['lab'], employeeId: 'E200' }), true);
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], employeeId: 'E100' }), true);
});

test('isRelevant: ไม่มี employeeId → ไม่ผ่านทางงานตัวเอง', () => {
  const desc = { audiences: ['qc'], title: 't' };
  assert.strictEqual(isRelevant(desc, petition, { audiences: ['lab'], employeeId: '' }), false);
});

test('isRelevant: seeAll ผ่านหมด', () => {
  const desc = { audiences: ['qc'], title: 't' };
  assert.strictEqual(isRelevant(desc, petition, { audiences: [], seeAll: true }), true);
});

test('shouldPlaySampleArrivalSound: เล่นเสียงเมื่อ sampleSent ตรง audience qc/lab เท่านั้น', () => {
  const assigned = { ...petition, assignedTo: { employeeId: 'E200', name: 'สมหญิง' } };
  const log = { event: 'statusChanged', fromStatus: 'deliveringQC', toStatus: 'sampleSent' };

  assert.strictEqual(shouldPlaySampleArrivalSound(petition, log, { audiences: ['qc'] }, { audiences: ['qc'] }), true);
  assert.strictEqual(shouldPlaySampleArrivalSound(petition, log, { audiences: ['lab'] }, { audiences: ['lab'] }), true);
  assert.strictEqual(shouldPlaySampleArrivalSound(assigned, log, { employeeId: 'E200', audiences: ['viewer'] }, { audiences: ['qc'] }), false);
  assert.strictEqual(shouldPlaySampleArrivalSound(assigned, log, { employeeId: 'E200', seeAll: true }, { audiences: ['qc'] }), false);
  assert.strictEqual(shouldPlaySampleArrivalSound(assigned, log, { employeeId: 'E201' }), false);
  assert.strictEqual(shouldPlaySampleArrivalSound(petition, log, { employeeId: 'E100' }), false);
  assert.strictEqual(
    shouldPlaySampleArrivalSound(petition, { event: 'statusChanged', fromStatus: 'inProgress', toStatus: 'sampleSent' }, { audiences: ['qc'] }, { audiences: ['qc'] }),
    false,
  );
  assert.strictEqual(
    shouldPlaySampleArrivalSound(assigned, { event: 'statusChanged', toStatus: 'approved' }, { employeeId: 'E200' }),
    false,
  );
});

test('toNotification: sampleSent sentToLab=true เล่นเสียงให้ทั้ง QC และ Lab, sentToLab=false เล่นเฉพาะ QC', () => {
  const log = {
    _id: 'log-sent-lab-routing',
    petitionId: 'p1',
    event: 'statusChanged',
    fromStatus: 'deliveringQC',
    toStatus: 'sampleSent',
    createdAt: '2026-08-01T02:00:00.000Z',
  };
  const sentToLab = { ...petition, sentToLab: true, items: [{ batchNo: '320', sampleName: 'QC only by batch' }] };
  const qcOnly = { ...petition, sentToLab: false, items: [labItem] };
  const sentToLabDesc = bellDescribe(sentToLab, log);
  const qcOnlyDesc = bellDescribe(qcOnly, log);

  assert.deepStrictEqual(sentToLabDesc.audiences, ['qc', 'lab', 'production']);
  assert.strictEqual(toNotification(sentToLab, log, sentToLabDesc, { audiences: ['qc'] }).playSound, true);
  assert.strictEqual(toNotification(sentToLab, log, sentToLabDesc, { audiences: ['lab'] }).playSound, true);
  assert.deepStrictEqual(qcOnlyDesc.audiences, ['qc', 'production']);
  assert.strictEqual(toNotification(qcOnly, log, qcOnlyDesc, { audiences: ['qc'] }).playSound, true);
  assert.strictEqual(toNotification(qcOnly, log, qcOnlyDesc, { audiences: ['lab'] }).playSound, undefined);
});

test('levelForEvent: rejected/success/approved/ผิดปกติ/อื่น', () => {
  assert.strictEqual(levelForEvent({ event: 'statusChanged', toStatus: 'rejected' }), 'error');
  assert.strictEqual(levelForEvent({ event: 'statusChanged', toStatus: 'success' }), 'success');
  assert.strictEqual(levelForEvent({ event: 'statusChanged', toStatus: 'approved' }), 'success');
  assert.strictEqual(levelForEvent({ event: 'updated', note: 'พบค่าผิดปกติ 2 รายการ' }), 'warning');
  assert.strictEqual(levelForEvent({ event: 'created' }), 'info');
});

test('levelForEvent: statusChanged toStatus=inProgress + returnTo → warning (ถูกสั่งให้ทำใหม่)', () => {
  assert.strictEqual(
    levelForEvent({ event: 'statusChanged', toStatus: 'inProgress', metadata: { returnTo: 'lab' } }),
    'warning',
  );
});

test('levelForEvent: statusChanged toStatus=inProgress ไม่มี returnTo → info เหมือนเดิม (ไม่ถูกรบกวน)', () => {
  assert.strictEqual(levelForEvent({ event: 'statusChanged', toStatus: 'inProgress' }), 'info');
});

test('toNotification: id = audit log id, link ชี้หน้า timeline ของคำขอ', () => {
  const log = { _id: 'log1', event: 'created', createdAt: '2026-08-01T02:00:00.000Z' };
  const desc = { audiences: ['qc'], title: 'T', message: 'M' };
  assert.deepStrictEqual(toNotification(petition, log, desc), {
    id: 'log1',
    petitionId: 'p1',
    petitionNo: 'P-2606-0018',
    event: 'created',
    fromStatus: undefined,
    toStatus: undefined,
    title: 'T',
    message: 'M',
    level: 'info',
    link: '/petition/p1',
    createdAt: '2026-08-01T02:00:00.000Z',
  });
});

test('toNotification: statusChanged approved stays a normal bell notification', () => {
  const log = {
    _id: 'log-approved',
    petitionId: 'p1',
    event: 'statusChanged',
    fromStatus: 'success',
    toStatus: 'approved',
    createdAt: '2026-08-01T02:00:00.000Z',
  };
  const desc = { audiences: ['qc', 'production'], title: 'อนุมัติแล้ว' };

  const notification = toNotification(petition, log, desc);

  assert.strictEqual(notification.petitionId, 'p1');
  assert.strictEqual(notification.event, 'statusChanged');
  assert.strictEqual(notification.fromStatus, 'success');
  assert.strictEqual(notification.toStatus, 'approved');
});

test('toNotification: sampleSent งานตัวเองแต่ไม่มี audience qc/lab ไม่แนบ playSound', () => {
  const assigned = { ...petition, assignedTo: { employeeId: 'E200', name: 'สมหญิง' } };
  const log = {
    _id: 'log-sent',
    petitionId: 'p1',
    event: 'statusChanged',
    fromStatus: 'deliveringQC',
    toStatus: 'sampleSent',
    createdAt: '2026-08-01T02:00:00.000Z',
  };

  const notification = toNotification(assigned, log, { audiences: ['qc'], title: 'ส่งตัวอย่างแล้ว' }, { employeeId: 'E200' });

  assert.strictEqual(notification.playSound, undefined);
});

test('toNotification: sampleSent ที่ตรง audience ผู้รับ แนบ playSound ให้ client', () => {
  const log = {
    _id: 'log-sent-audience',
    petitionId: 'p1',
    event: 'statusChanged',
    fromStatus: 'deliveringQC',
    toStatus: 'sampleSent',
    createdAt: '2026-08-01T02:00:00.000Z',
  };

  const notification = toNotification(petition, log, { audiences: ['qc'], title: 'ส่งตัวอย่างแล้ว' }, { audiences: ['qc'] });

  assert.strictEqual(notification.playSound, true);
});

test('toNotification: assigned ฝั่ง Lab เล่นเสียงเฉพาะคนที่ถูก assign', () => {
  const log = {
    _id: 'log-lab-assigned',
    petitionId: 'p1',
    event: 'assigned',
    createdAt: '2026-08-01T02:00:00.000Z',
    metadata: { assignee: { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' } },
  };
  const assigned = { ...petition, assignedTo: { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' } };
  const desc = { audiences: ['lab'], title: '👤 มอบหมายงาน P-2606-0018' };

  assert.deepStrictEqual(
    toNotification(assigned, log, desc, { employeeId: 'E200', audiences: ['lab'] }),
    {
      id: 'log-lab-assigned',
      petitionId: 'p1',
      petitionNo: 'P-2606-0018',
      event: 'assigned',
      fromStatus: undefined,
      toStatus: undefined,
      title: '👤 มอบหมายงาน P-2606-0018',
      message: undefined,
      level: 'info',
      link: '/petition/p1',
      createdAt: '2026-08-01T02:00:00.000Z',
      playSound: true,
      sound: 'labAssigned',
    },
  );
  assert.strictEqual(toNotification(assigned, log, desc, { employeeId: 'E201', audiences: ['lab'] }).playSound, undefined);
  assert.strictEqual(
    toNotification(
      { ...petition, assignedTo: { employeeId: 'E200', name: 'สมหญิง', department: 'QC' } },
      { ...log, metadata: { assignee: { employeeId: 'E200', name: 'สมหญิง', department: 'QC' } } },
      { audiences: ['qc'], title: '👤 มอบหมายงาน P-2606-0018' },
      { employeeId: 'E200', audiences: ['qc'] },
    ).playSound,
    undefined,
  );
});

test('toNotification: assigned ฝั่ง Lab ไม่เล่นเสียงถ้าผู้รับเป็น viewer ไม่ใช่ lab', () => {
  const log = {
    _id: 'log-lab-assigned-viewer',
    petitionId: 'p1',
    event: 'assigned',
    createdAt: '2026-08-01T02:00:00.000Z',
    metadata: { assignee: { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' } },
  };
  const assigned = { ...petition, assignedTo: { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' } };

  assert.strictEqual(
    toNotification(assigned, log, { audiences: ['lab'], title: '👤 มอบหมายงาน P-2606-0018' }, { employeeId: 'E200', audiences: ['viewer'] }).playSound,
    undefined,
  );
});

test('toNotification: role-sourced Dev Administrator lab assignment gets labAssigned sound', () => {
  const log = {
    _id: 'log-dev-admin-assigned',
    petitionId: 'p1',
    event: 'assigned',
    createdAt: '2026-08-01T02:00:00.000Z',
    metadata: { assignee: { employeeId: 'dev', name: 'Dev Administrator', department: 'Lab/วิเคราะห์', position: 'Lab Analyst' } },
  };
  const assigned = { ...petition, assignedTo: log.metadata.assignee };

  const notification = toNotification(
    assigned,
    log,
    { audiences: ['lab'], title: '👤 มอบหมายงาน P-2606-0018' },
    { employeeId: 'dev', audiences: ['lab'] },
  );

  assert.strictEqual(notification.playSound, true);
  assert.strictEqual(notification.sound, 'labAssigned');
});

// Finding 1: resultEntered fires once per form field (qcResultAuditEvent logs every
// field), so a burst of rows for one petition must collapse to just the newest — or
// it fills the capped /notifications response and crowds out real milestones.
test('isCollapsibleDuplicate: first resultEntered for a petition → not a duplicate, marks it seen', () => {
  const seen = new Set();
  assert.strictEqual(isCollapsibleDuplicate({ event: 'resultEntered', petitionId: 'p1' }, seen), false);
  assert.ok(seen.has('p1'));
});

test('isCollapsibleDuplicate: second+ resultEntered for the same petition → duplicate', () => {
  const seen = new Set(['p1']);
  assert.strictEqual(isCollapsibleDuplicate({ event: 'resultEntered', petitionId: 'p1' }, seen), true);
});

test('isCollapsibleDuplicate: resultEntered for a different petition → not a duplicate', () => {
  const seen = new Set(['p1']);
  assert.strictEqual(isCollapsibleDuplicate({ event: 'resultEntered', petitionId: 'p2' }, seen), false);
  assert.ok(seen.has('p2'));
});

test('isCollapsibleDuplicate: non-resultEntered events are never collapsed, even for a seen petition', () => {
  const seen = new Set(['p1']);
  assert.strictEqual(
    isCollapsibleDuplicate({ event: 'statusChanged', toStatus: 'rejected', petitionId: 'p1' }, seen),
    false,
  );
});

test('isCollapsibleDuplicate: newest-first loop keeps only the first resultEntered and reaches an older rejected row', () => {
  // Simulates the exact scenario from the finding: 30 resultEntered rows for one
  // petition (newest-first) followed by an older 'rejected' row for the same petition.
  const logs = [
    ...Array.from({ length: 30 }, (_, i) => ({ event: 'resultEntered', petitionId: 'p1', seq: i })),
    { event: 'statusChanged', toStatus: 'rejected', petitionId: 'p1', seq: 30 },
  ];
  const seen = new Set();
  const survivors = logs.filter((log) => !isCollapsibleDuplicate(log, seen));
  assert.strictEqual(survivors.length, 2); // 1 newest resultEntered + the rejected row
  assert.strictEqual(survivors[0].event, 'resultEntered');
  assert.strictEqual(survivors[1].event, 'statusChanged');
});
