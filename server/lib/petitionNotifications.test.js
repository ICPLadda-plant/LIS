const test = require('node:test');
const assert = require('node:assert');
const { notificationForViewer, isCollapsibleDuplicate, petitionNotices } = require('./petitionNotifications');

// ผู้ชมตัวอย่างครบทุก role (roles รวม role พื้นฐานของตระกูลแล้ว เหมือน viewerFromUser)
const viewers = {
  qcStaff: { roles: ['qc-staff'], employeeId: 'Q1', name: 'QC เอ', email: 'qc1@x' },
  qcOther: { roles: ['qc-staff'], employeeId: 'Q2', name: 'QC บี', email: 'qc2@x' },
  qcHead: { roles: ['qc-head', 'qc-staff'], employeeId: 'QH', name: 'หัวหน้า QC', email: 'qch@x' },
  qcApprover: { roles: ['qc-approver', 'qc-staff'], employeeId: 'QA', name: 'ผู้อนุมัติ QC', email: 'qca@x' },
  qcDataConfig: { roles: ['qc-data-config', 'qc-staff'], employeeId: 'QD', name: 'QC Config', email: 'qcd@x' },
  labAssignee: { roles: ['lab-analyze'], employeeId: 'E200', name: 'สมหญิง', email: 'lab1@x' },
  labOther: { roles: ['lab-analyze'], employeeId: 'E201', name: 'สมศรี', email: 'lab2@x' },
  labHead: { roles: ['lab-head', 'lab-analyze'], employeeId: 'LH', name: 'หัวหน้า Lab', email: 'labh@x' },
  labInventory: { roles: ['lab-inventory', 'lab-analyze'], employeeId: 'LI', name: 'คลัง Lab', email: 'labi@x' },
  labDataConfig: { roles: ['lab-data-config', 'lab-analyze'], employeeId: 'LD', name: 'Lab Config', email: 'labd@x' },
  submitter: { roles: ['viewer'], employeeId: 'E100', name: 'สมชาย', email: 'req@x' },
  viewerOther: { roles: ['viewer'], employeeId: 'E999', name: 'คนอื่น', email: 'other@x' },
  customRole: { roles: ['production-planner'], employeeId: 'P1', name: 'วางแผน', email: 'plan@x' },
  admin: { roles: ['admin'], employeeId: 'AD', name: 'แอดมิน', email: 'admin@x' },
};
const QC_ALL = ['qcApprover', 'qcDataConfig', 'qcHead', 'qcOther', 'qcStaff'];
const LAB_ALL = ['labAssignee', 'labDataConfig', 'labHead', 'labInventory', 'labOther'];

const basePetition = {
  _id: 'p1',
  petitionNo: 'P-2611-0001',
  routeTargets: ['qc', 'lab'],
  items: [{ seq: 1, batchNo: '326', sampleName: 'OMETHOATE' }],
  submittedBy: { name: 'สมชาย', employeeId: 'E100', department: 'Production' },
  assignedTo: { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' },
  qcHandlers: [{ employeeId: 'Q1', name: 'QC เอ', email: 'qc1@x' }],
};

let seq = 0;
const log = (over) => ({ _id: 'log' + (++seq), petitionId: 'p1', actor: 'ระบบทดสอบ', createdAt: '2026-11-11T03:00:00.000Z', ...over });

function recipients(petition, entry) {
  return Object.keys(viewers).filter((key) => notificationForViewer(petition, entry, viewers[key])).sort();
}
const sorted = (list) => [...list].sort();

test('คำขอใหม่: ทุก role ตระกูล QC และ Lab ได้รับ แต่ viewer/role อื่น/admin ไม่ได้', () => {
  assert.deepStrictEqual(recipients(basePetition, log({ event: 'created' })), sorted([...QC_ALL, ...LAB_ALL]));
  const qcOnly = { ...basePetition, routeTargets: ['qc'] };
  assert.deepStrictEqual(recipients(qcOnly, log({ event: 'created' })), sorted(QC_ALL));
});

test('แผนกไม่มีผลแล้ว: viewer ที่อยู่แผนก QC ไม่ได้รับงานของฝั่ง QC', () => {
  const viewerInQcDept = { roles: ['viewer'], employeeId: 'V1', department: 'QC ควบคุมคุณภาพ' };
  assert.strictEqual(notificationForViewer(basePetition, log({ event: 'created' }), viewerInQcDept), null);
});

test('ส่งตัวอย่างแล้ว: QC มีเสียง ส่วน Lab ได้รับเฉพาะงานที่ส่ง Lab หรืองาน Lab อย่างเดียว', () => {
  const entry = log({ event: 'statusChanged', fromStatus: 'deliveringQC', toStatus: 'sampleSent' });
  assert.deepStrictEqual(recipients(basePetition, entry), sorted(QC_ALL));
  assert.strictEqual(notificationForViewer(basePetition, entry, viewers.qcStaff).playSound, true);
  assert.deepStrictEqual(recipients({ ...basePetition, sentToLab: true }, entry), sorted([...QC_ALL, ...LAB_ALL]));
  const labOnly = { ...basePetition, routeTargets: ['lab'] };
  assert.deepStrictEqual(recipients(labOnly, entry), sorted(LAB_ALL));
  assert.strictEqual(notificationForViewer(labOnly, entry, viewers.labOther).playSound, true);
});

test('QC รับตัวอย่าง: QC ทุกคน + ผู้ยื่น; รับบางป้ายยังไม่แจ้ง', () => {
  assert.deepStrictEqual(recipients(basePetition, log({ event: 'received', metadata: { side: 'qc' } })), sorted([...QC_ALL, 'submitter']));
  assert.deepStrictEqual(recipients(basePetition, log({ event: 'received', metadata: { side: 'qc', partial: true } })), []);
  assert.deepStrictEqual(recipients(basePetition, log({ event: 'received', metadata: { side: 'lab' } })), ['submitter']);
});

test('เริ่มบันทึกผลฝั่ง QC: QC ทุกคน, id คงที่ต่อคำขอ; ผลฝั่ง Lab ไม่แจ้ง', () => {
  const first = log({ event: 'resultEntered', metadata: { side: 'qc', parameterName: 'pH' } });
  assert.deepStrictEqual(recipients(basePetition, first), sorted(QC_ALL));
  const a = notificationForViewer(basePetition, first, viewers.qcOther).id;
  const b = notificationForViewer(basePetition, log({ event: 'resultEntered', metadata: { side: 'qc' } }), viewers.qcOther).id;
  assert.strictEqual(a, b);
  assert.deepStrictEqual(recipients(basePetition, log({ event: 'resultEntered', metadata: { side: 'lab' } })), []);
});

test('QC Approval: ได้แจ้งเมื่อมีผลกายภาพใหม่รอยืนยัน', () => {
  const entry = log({ event: 'updated', metadata: { side: 'qc', kind: 'trackCompleted' } });
  assert.deepStrictEqual(recipients(basePetition, entry), ['qcApprover']);
  assert.strictEqual(notificationForViewer(basePetition, entry, viewers.qcApprover).link, '/qc-approval/p1');
});

test('Lab Head: ได้แจ้งเมื่อผล Lab บันทึกแล้วรออนุมัติ', () => {
  const entry = log({ event: 'updated', metadata: { side: 'lab', kind: 'trackCompleted' } });
  assert.deepStrictEqual(recipients(basePetition, entry), ['labHead']);
});

test('QC Approval กดกายภาพผ่าน: เจ้าของงาน QC + ผู้ยื่น (QC คนอื่นไม่ได้)', () => {
  const entry = log({ event: 'reviewed', metadata: { type: 'itemApproval', side: 'qc', decision: 'approve', seqs: [1] } });
  assert.deepStrictEqual(recipients(basePetition, entry), ['qcStaff', 'submitter']);
});

test('QC Head: แจ้งเมื่องานรอออก Final Report (ครบทุกส่วน / Pre Result) และเมื่อออก Final แล้ว', () => {
  assert.deepStrictEqual(recipients(basePetition, log({ event: 'statusChanged', toStatus: 'success' })), ['qcHead']);
  const pre = log({ event: 'reviewed', metadata: { type: 'itemApproval', side: 'qc', decision: 'approve', seqs: [1], preResult: true } });
  assert.ok(recipients(basePetition, pre).includes('qcHead'));
  assert.deepStrictEqual(recipients(basePetition, log({ event: 'statusChanged', toStatus: 'approved' })), ['qcHead', 'qcStaff', 'submitter']);
});

test('มอบหมายงาน: ผู้รับงานคนเดียวพร้อมเสียง; ผู้รับงานเดิมรู้ว่างานไปอยู่กับใคร', () => {
  const entry = log({
    event: 'assigned',
    metadata: { assignee: basePetition.assignedTo, previousAssignee: { employeeId: 'E201', name: 'สมศรี' }, recheckRound: 2 },
  });
  assert.deepStrictEqual(recipients(basePetition, entry), ['labAssignee', 'labOther']);
  const mine = notificationForViewer(basePetition, entry, viewers.labAssignee);
  assert.strictEqual(mine.sound, 'labAssigned');
  assert.match(mine.title, /ให้คุณแล้ว/);
  assert.match(notificationForViewer(basePetition, entry, viewers.labOther).title, /ถูกมอบหมายให้ สมหญิง/);
});

test('Re-check: ผู้รับงานเดิมรู้ว่าถูกสั่ง Re-check, เจ้าของงาน QC และผู้ยื่นได้รับ', () => {
  const petition = { ...basePetition, assignedTo: undefined };
  const entry = log({ event: 'recheck', metadata: { side: 'lab', round: 2, reason: 'ค่าเพี้ยน', previousAssignee: { employeeId: 'E200', name: 'สมหญิง' } } });
  assert.deepStrictEqual(recipients(petition, entry), ['labAssignee', 'qcStaff', 'submitter']);
  assert.match(notificationForViewer(petition, entry, viewers.labAssignee).message, /รอหัวหน้า Lab มอบหมาย/);
});

test('QC ยืนยัน ถพ.: ผู้รับงาน Lab + ผู้ยื่นเห็นค่า; ยังไม่มีผู้รับงาน → หัวหน้า Lab', () => {
  const entry = log({ event: 'updated', metadata: { kind: 'sgConfirmed', value: '1.12', temperature: '25', batchNo: '326', releasedToLab: true } });
  assert.deepStrictEqual(recipients(basePetition, entry), ['labAssignee', 'submitter']);
  assert.match(notificationForViewer(basePetition, entry, viewers.submitter).message, /1\.12 ที่ 25/);
  assert.deepStrictEqual(recipients({ ...basePetition, assignedTo: undefined }, entry), ['labHead', 'submitter']);
});

test('หัวหน้า Lab ออกผล: ผู้รับงาน Lab + ผู้ยื่นเห็น %AI', () => {
  const entry = log({ event: 'updated', metadata: { side: 'lab', kind: 'labApproved', aiResults: [{ itemSeq: 1, result: '45.2%' }] } });
  assert.deepStrictEqual(recipients(basePetition, entry), ['labAssignee', 'submitter']);
  assert.match(notificationForViewer(basePetition, entry, viewers.submitter).message, /45\.2%/);
});

test('QC ขอตัวอย่างเพิ่ม: ผู้ยื่น + ผู้รับงาน Lab ของงานนั้น', () => {
  const entry = log({
    event: 'updated',
    metadata: { type: 'additionalSampleRequested', side: 'qc', additionalSampleId: 'r1', reason: 'ไม่พอ', items: [{ itemSeq: 1, quantity: 1 }] },
  });
  assert.deepStrictEqual(recipients(basePetition, entry), ['labAssignee', 'submitter']);
});

test('แก้ไขคำขอ: เจ้าของงาน QC และผู้รับงาน Lab', () => {
  const entry = log({ event: 'updated', note: 'Production แก้ไขรายการ', metadata: { type: 'productionEdit', mode: 'review' } });
  assert.deepStrictEqual(recipients(basePetition, entry), ['labAssignee', 'qcStaff']);
});

test('ส่งกลับให้แก้ไข: ผู้ยื่นได้รับ', () => {
  assert.ok(recipients(basePetition, log({ event: 'statusChanged', toStatus: 'rejected', note: 'ชื่อผิด' })).includes('submitter'));
});

test('คนที่ทำรายการเองไม่ได้รับแจ้งเตือนของตัวเอง', () => {
  const entry = log({ event: 'statusChanged', toStatus: 'approved', actor: 'หัวหน้า QC' });
  assert.ok(!recipients(basePetition, entry).includes('qcHead'));
});

test('Admin: ปกติได้เฉพาะงานของตัวเอง, เปิดดูทั้งระบบได้ทุกเหตุการณ์แบบไม่ซ้ำ', () => {
  const entry = log({ event: 'assigned', metadata: { assignee: basePetition.assignedTo } });
  assert.strictEqual(notificationForViewer(basePetition, entry, viewers.admin), null);
  const all = notificationForViewer(basePetition, entry, { ...viewers.admin, seeAll: true });
  assert.match(all.title, /ให้ สมหญิง/);
  assert.strictEqual(all.playSound, undefined);
  // role อื่นเปิด seeAll ไม่มีผล
  assert.strictEqual(notificationForViewer(basePetition, entry, { ...viewers.viewerOther, seeAll: true }), null);
});

test('petitionNotices: เหตุการณ์ที่ไม่มีผู้รับคืนลิสต์ว่าง', () => {
  assert.deepStrictEqual(petitionNotices(basePetition, log({ event: 'resultUpdated', metadata: { side: 'qc' } })), []);
});

test('isCollapsibleDuplicate: resultEntered ของคำขอเดียวกันเหลือแถวใหม่สุดแถวเดียว', () => {
  const logs = [
    ...Array.from({ length: 30 }, () => ({ event: 'resultEntered', petitionId: 'p1' })),
    { event: 'statusChanged', toStatus: 'rejected', petitionId: 'p1' },
  ];
  const seen = new Set();
  assert.strictEqual(logs.filter((entry) => !isCollapsibleDuplicate(entry, seen)).length, 2);
});
