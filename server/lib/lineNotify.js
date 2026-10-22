// Domain layer for LINE notifications: decide WHICH groups hear about a petition
// event and WHAT the message says, then dispatch via the line.js client.
//
// The pure functions (audiencesForEvent, describeEvent, petitionStatusText) are
// unit-tested; notifyPetitionEvent does the DB lookup + push and is fire-and-forget
// (never throws — callers in routes/petitions.js don't await it).
const LineGroup = require('../models/LineGroup');
const line = require('./line');
const { hasLabTrack, shouldSendItemToLab } = require('./petitionStatusLog');
const { requiresQcTrack } = require('./petitionSubmissionRules');
const { requesterAudience } = require('./additionalSamples');

const DEPT_LABELS = { production: 'แผนกผลิต', rm: 'แผนก RM', fg: 'แผนก FG' };
const ADDITIONAL_SAMPLE_TITLES = {
  additionalSampleRequested: 'ขอตัวอย่างเพิ่ม',
  additionalSampleSent: 'ส่งตัวอย่างเพิ่มแล้ว',
  additionalSampleReceived: 'รับตัวอย่างเพิ่มแล้ว',
};

function isAdditionalSampleEvent(payload) {
  return payload?.event === 'updated' && Object.hasOwn(ADDITIONAL_SAMPLE_TITLES, payload?.metadata?.type);
}

// Which side a single assignee belongs to (mirrors assigneeSideOf in
// petitionStatusLog.js): Lab if dept/position mentions lab/วิเคราะห์, else QC.
function assigneeSide(assignee) {
  if (!assignee) return null;
  const hay = `${assignee.department || ''} ${assignee.position || ''}`.toLowerCase();
  if (hay.includes('lab') || hay.includes('วิเคราะห์')) return 'lab';
  return 'qc';
}

function hasLabItem(petition) {
  return (petition?.items || []).some((it) => shouldSendItemToLab(it));
}

// Short "N รายการ · <first sample>" summary line for a petition's items.
function itemsSummary(petition) {
  const items = petition?.items || [];
  if (!items.length) return '-';
  const first = items[0]?.sampleName || items[0]?.commonName || '-';
  const extra = items.length - 1;
  return extra > 0 ? `${items.length} รายการ · ${first} +${extra}` : `${items.length} รายการ · ${first}`;
}

// Human-readable current status (mirrors the frontend petitionStatusBadge, including
// the both-done-pending-Lab-approval case). Used in bot status replies.
function petitionStatusText(petition) {
  const s = petition?.status;
  if (s === 'success') return 'ตรวจครบทุกส่วน — รอหัวหน้า QC ยืนยัน';
  if (s === 'approved') return 'ออก Final Result แล้ว — ปิดงาน';
  if (s === 'rejected') return 'ถูกส่งกลับให้แก้ไข';
  if (petition?.qcCompletedAt && petition?.labCompletedAt && !petition?.labApprovedAt) {
    return 'รอตรวจ';
  }
  if (petition?.qcCompletedAt) return 'QC ตรวจครบ · รอส่วนอื่น';
  if (petition?.labApprovedAt) return requiresQcTrack(petition) ? 'ผล Lab ออกแล้ว · รอ QC' : 'ผล Lab ออกแล้ว · รอ Final Result';
  if (petition?.labCompletedAt) return 'รอออกผล';
  if (s === 'inProgress') return 'กำลังตรวจ';
  if (s === 'pendingReview') return 'รับตัวอย่างแล้ว';
  if (s === 'deliveringQC' && (petition?.qcReceivedAt || petition?.labReceivedAt || petition?.receivedAt)) return 'รับตัวอย่างแล้ว';
  if (s === 'sampleSent') return 'ส่งตัวอย่างแล้ว — รอรับ';
  if (s === 'deliveringQC') return 'กำลังส่งตัวอย่าง';
  return String(s || '-');
}

// Audiences (LineGroup.audience keys) that should hear about an audit event.
// Empty array = do not notify.
function audiencesForEvent(petition, payload) {
  if (isAdditionalSampleEvent(payload)) {
    const { side, additionalSampleId, type } = payload.metadata;
    if (!['qc', 'lab'].includes(side) || typeof additionalSampleId !== 'string' || !additionalSampleId.trim()) return [];
    return type === 'additionalSampleSent' ? [side] : [requesterAudience(petition)].filter(Boolean);
  }
  const qcTrack = requiresQcTrack(petition);
  const labTrack = hasLabTrack(petition);
  const bothSides = [qcTrack ? 'qc' : null, labTrack ? 'lab' : null].filter(Boolean);
  const sampleSentAudiences = () => {
    if (!qcTrack) return [...new Set(['lab', requesterAudience(petition)].filter(Boolean))];
    const sentToLab =
      petition?.sentToLab === true ||
      petition?.sendToLab === true ||
      ((petition ?? {}).items ?? []).some((item) => item?.sentToLab === true || item?.sendToLab === true);
    return [...new Set(['qc', sentToLab ? 'lab' : null, requesterAudience(petition)].filter(Boolean))];
  };
  switch (payload?.event) {
    case 'created':
      return qcTrack ? ['qc'] : ['lab'];
    case 'assigned': {
      const side = assigneeSide(payload?.metadata?.assignee || petition?.assignedTo);
      return side ? [side] : bothSides;
    }
    case 'statusChanged':
      switch (payload?.toStatus) {
        case 'sampleSent': return sampleSentAudiences();
        // ผลออก/ปิดงาน → แจ้งฝ่ายตรวจ + แจ้งกลับแผนกผู้ยื่นคำขอ (petition.dept ตรงกับ audience key)
        case 'success':    return [...bothSides, petition?.dept].filter(Boolean);
        case 'approved':   return [qcTrack ? 'qc' : null, petition?.dept].filter(Boolean);
        case 'rejected':   return bothSides;
        default:           return [];
      }
    case 'updated': {
      if (payload?.metadata?.audience) {
        const selected = payload.metadata.audience;
        if (selected === 'qc') return ['qc'];
        if (selected === 'lab') return ['lab'];
        if (selected === 'requester') return [petition?.dept].filter(Boolean);
        if (selected === 'all') return [...new Set([...bothSides, petition?.dept, 'all'].filter(Boolean))];
      }
      // per-track บันทึกผล / lab-approve / lab-reject — notify only that side
      const side = payload?.metadata?.side;
      return side === 'lab' || side === 'qc' ? [side] : [];
    }
    default:
      return [];
  }
}

// Build { audiences, text } for an event, or null to skip. Pure.
function describeEvent(petition, payload) {
  const audiences = audiencesForEvent(petition, payload);
  if (isAdditionalSampleEvent(payload)) {
    const { type, side, additionalSampleId, reason, items } = payload.metadata;
    if (!['qc', 'lab'].includes(side) || typeof additionalSampleId !== 'string' || !additionalSampleId.trim()) return null;
    if (!Array.isArray(items) || !items.length || items.some((item) =>
      !Number.isInteger(item?.itemSeq) || !Number.isInteger(item?.quantity) || item.quantity < 1
    )) return null;
    const quantity = items.reduce((total, item) => total + item.quantity, 0);
    const details = items.map((item) => item.weights?.length
      ? `รายการ ${item.itemSeq}: ${item.quantity} ตัวอย่าง (${item.weights.join(', ')} กรัม)`
      : `รายการ ${item.itemSeq}: ${item.quantity}`).join(' · ');
    const no = petition?.petitionNo || payload?.petitionNo || '(ไม่ทราบเลข)';
    const requesterEmployeeId = String(petition?.submittedBy?.employeeId || '').trim();
    return {
      audiences,
      recipientEmployeeIds: type === 'additionalSampleSent' || !requesterEmployeeId ? [] : [requesterEmployeeId],
      text: `${ADDITIONAL_SAMPLE_TITLES[type]} ${no}\nฝ่ายที่ขอ: ${side.toUpperCase()}\nเหตุผล: ${reason || '-'}\nจำนวน: รวม ${quantity} (${details})\nรอบ: ${additionalSampleId}${payload.actor ? `\nผู้ดำเนินการ: ${payload.actor}` : ''}`,
    };
  }
  if (!audiences.length) return null;

  const no = petition?.petitionNo || '(ไม่ทราบเลข)';
  let text = null;

  switch (payload?.event) {
    case 'created': {
      const who = petition?.submittedBy?.name || '-';
      const dept = DEPT_LABELS[petition?.dept] || petition?.dept || '';
      text = `📋 คำขอใหม่ ${no}\nผู้ยื่น: ${who}${dept ? ` (${dept})` : ''}\nตัวอย่าง: ${itemsSummary(petition)}`;
      break;
    }
    case 'assigned': {
      const name = payload?.metadata?.assignee?.name || petition?.assignedTo?.name || '-';
      text = `👤 มอบหมายงาน ${no}\nผู้รับผิดชอบ: ${name}\nตัวอย่าง: ${itemsSummary(petition)}`;
      break;
    }
    case 'statusChanged':
      switch (payload?.toStatus) {
        case 'sampleSent':
          text = `🚚 ส่งตัวอย่างแล้ว ${no} — รอรับเข้าระบบ`;
          break;
        case 'success':
          text = `✅ ${no} ตรวจครบทุกส่วนแล้ว — รอหัวหน้า QC ยืนยัน`;
          break;
        case 'approved':
          text = `🎉 ${no} หัวหน้า QC ออก Final Result — ปิดงานแล้ว`;
          break;
        case 'rejected':
          text = `⛔ ${no} ถูกส่งกลับให้แก้ไข${payload?.note ? `\nเหตุผล: ${payload.note}` : ''}`;
          break;
      }
      break;
    case 'updated':
      if (payload?.note) text = `📝 ${no}\n${payload.note}`;
      break;
  }

  return text ? { audiences, text } : null;
}

// Resolve audiences → unique enabled groupIds (an 'all' group hears everything).
async function resolveGroupIds(audiences) {
  const wanted = [...new Set([...(audiences || []), 'all'])];
  const groups = await LineGroup.find({ audience: { $in: wanted }, enabled: true }).lean();
  return [...new Set(groups.map((g) => g.groupId).filter(Boolean))];
}

// Fire-and-forget: push the event's message to every matching group. Swallows all
// errors so a LINE outage never breaks the API request that triggered it.
async function notifyPetitionEvent(petition, payload) {
  // Web Push ไม่ขึ้นกับ LINE — require ตอนเรียกเพื่อเลี่ยง circular import กับ petitionNotifications
  require('./webPush').notifyPushForPetitionEvent(petition, payload);
  try {
    if (!line.isConfigured()) return;
    const desc = describeEvent(petition, payload);
    if (!desc) return;
    const groupIds = await resolveGroupIds(desc.audiences);
    if (!groupIds.length) return;
    await Promise.all(groupIds.map((id) => line.pushToGroup(id, desc.text)));
  } catch (err) {
    console.error('[lineNotify] notifyPetitionEvent error:', err.message);
  }
}

module.exports = {
  isAdditionalSampleEvent,
  assigneeSide,
  hasLabItem,
  itemsSummary,
  petitionStatusText,
  audiencesForEvent,
  describeEvent,
  resolveGroupIds,
  notifyPetitionEvent,
};
