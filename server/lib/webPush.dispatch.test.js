// จำลองการส่ง PWA ทั้งเส้นทาง: audit log / AppNotification → เลือกผู้รับ → web-push.sendNotification
const test = require('node:test');
const assert = require('node:assert');
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const Petition = require('../models/Petition');
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { dispatchPetitionLogPush, dispatchAppNotificationPush } = require('./webPush');
const { notificationForViewer } = require('./petitionNotifications');
const { viewerFromUser } = require('./notificationViewer');

const users = [
  { email: 'qc@x', roles: ['qc-staff'], employeeId: 'Q1', name: 'QC เอ' },
  { email: 'head@x', roles: ['qc-head', 'qc-staff'], employeeId: 'QH', name: 'หัวหน้า QC' },
  { email: 'approver@x', roles: ['qc-approver'], employeeId: 'QA', name: 'ผู้อนุมัติ' },
  { email: 'lab@x', roles: ['lab-analyze'], employeeId: 'E200', name: 'สมหญิง' },
  { email: 'labhead@x', roles: ['lab-head'], employeeId: 'LH', name: 'หัวหน้า Lab' },
  { email: 'inv@x', roles: ['lab-inventory'], employeeId: 'LI', name: 'คลัง' },
  { email: 'req@x', roles: ['viewer'], employeeId: 'E100', name: 'สมชาย' },
  { email: 'admin@x', roles: ['admin'], employeeId: 'AD', name: 'แอดมิน' },
];
const petition = {
  _id: '65f0c0ffee0000000000abcd',
  petitionNo: 'P-2611-0001',
  routeTargets: ['qc', 'lab'],
  items: [{ seq: 1, batchNo: '326', sampleName: 'OMETHOATE' }],
  submittedBy: { name: 'สมชาย', employeeId: 'E100' },
  assignedTo: { employeeId: 'E200', name: 'สมหญิง', department: 'Lab วิเคราะห์' },
  qcHandlers: [{ employeeId: 'Q1', name: 'QC เอ' }],
};
const lean = (value) => ({ lean: async () => value });

let sent = [];
test.before(() => {
  process.env.VAPID_PUBLIC_KEY = 'test-public';
  process.env.VAPID_PRIVATE_KEY = 'test-private';
  webpush.setVapidDetails = () => undefined;
  webpush.sendNotification = async (sub, body) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(body) }); };
  PushSubscription.find = () => lean(users.map((u) => ({ _id: u.email, email: u.email, endpoint: 'https://push.example/' + u.email, keys: {} })));
  PushSubscription.updateOne = async () => undefined;
  User.find = () => lean(users);
  Petition.findById = () => lean(petition);
  PetitionAuditLog.exists = async () => null;
});
test.beforeEach(() => { sent = []; });

const receivers = () => sent.map((s) => s.endpoint.replace('https://push.example/', '')).sort();
const bellReceivers = (entry) => users
  .filter((u) => notificationForViewer(petition, entry, viewerFromUser(u)))
  .map((u) => u.email)
  .sort();

const scenarios = [
  ['คำขอใหม่', { event: 'created' }],
  ['ส่งตัวอย่างแล้ว', { event: 'statusChanged', fromStatus: 'deliveringQC', toStatus: 'sampleSent' }],
  ['QC รับตัวอย่าง', { event: 'received', metadata: { side: 'qc' } }],
  ['เริ่มบันทึกผล QC', { event: 'resultEntered', metadata: { side: 'qc' } }],
  ['ผลกายภาพรอยืนยัน', { event: 'updated', metadata: { side: 'qc', kind: 'trackCompleted' } }],
  ['ผล Lab รออนุมัติ', { event: 'updated', metadata: { side: 'lab', kind: 'trackCompleted' } }],
  ['กายภาพผ่าน', { event: 'reviewed', metadata: { type: 'itemApproval', side: 'qc', decision: 'approve', seqs: [1] } }],
  ['รอออก Final Report', { event: 'statusChanged', toStatus: 'success' }],
  ['ออก Final Report', { event: 'statusChanged', toStatus: 'approved' }],
  ['มอบหมายงาน', { event: 'assigned', metadata: { assignee: petition.assignedTo } }],
  ['ยืนยัน ถพ.', { event: 'updated', metadata: { kind: 'sgConfirmed', value: '1.1', temperature: '25' } }],
  ['หัวหน้า Lab ออกผล', { event: 'updated', metadata: { side: 'lab', kind: 'labApproved', aiResults: [{ itemSeq: 1, result: '45%' }] } }],
  ['Re-check', { event: 'recheck', metadata: { round: 1, previousAssignee: petition.assignedTo } }],
  ['ส่งกลับให้แก้ไข', { event: 'statusChanged', toStatus: 'rejected', note: 'แก้ชื่อ' }],
];

for (const [name, entry] of scenarios) {
  test('PWA ส่งให้ทุกคนที่ได้รับในกระดิ่ง: ' + name, async () => {
    const log = { _id: 'log-' + name, petitionId: petition._id, actor: 'ระบบทดสอบ', createdAt: new Date(), ...entry };
    const expected = bellReceivers(log);
    assert.ok(expected.length > 0, 'ต้องมีผู้รับในกระดิ่ง');
    await dispatchPetitionLogPush(log);
    assert.deepStrictEqual(receivers(), expected);
    assert.ok(sent.every((s) => s.title && s.tag && /^(petition|qc-approval|lab-approval)\//.test(s.url)));
  });
}

test('PWA แจ้งเตือนที่ไม่ผูกคำขอ: สต็อก → Lab Inventory, ระบบ → admin, งานด่วน/Daily Check → ตระกูล QC/Lab', async () => {
  const cases = [
    [{ key: 'stock:low:1', kind: 'stock', title: 'สารใกล้หมด', recipientRoles: ['lab-inventory'], link: '/stock' }, ['inv@x']],
    [{ key: 'system:503:1', kind: 'system', title: 'บริการไม่พร้อมใช้งาน (503)', recipientRoles: ['admin'] }, ['admin@x']],
    [{ key: 'urgent:qc:1', kind: 'urgent', title: 'งานด่วน', recipientRoles: ['qc'], pushOnly: true }, ['approver@x', 'head@x', 'qc@x']],
    [{ key: 'dailyCheck:1', kind: 'dailyCheck', title: 'Daily Check', recipientRoles: ['lab'], pushOnly: true }, ['inv@x', 'lab@x', 'labhead@x']],
  ];
  for (const [doc, expected] of cases) {
    sent = [];
    await dispatchAppNotificationPush({ ...doc, createdAt: new Date() });
    assert.deepStrictEqual(receivers(), expected, doc.key);
  }
});
