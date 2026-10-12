// Turns PetitionAuditLog rows into in-app bell notifications. Pure — no DB access;
// routes/petitions.js loads the inputs and calls these.
//
// Wording and audience routing come from lineNotify.describeEvent so the bell and the
// LINE groups can never drift apart. The bell tolerates finer-grained events than a
// LINE group does, so the two events describeEvent deliberately skips (received /
// resultEntered) get a bell-only fallback here.
const { assigneeSide, describeEvent, itemsSummary, isAdditionalSampleEvent } = require('./lineNotify');
const { hasLabTrack } = require('./petitionStatusLog');
const { requiresQcTrack } = require('./petitionSubmissionRules');

const SIDE_LABELS = { lab: 'Lab', qc: 'QC' };
const SOUND_AUDIENCES = new Set(['qc', 'lab']);

// describeEvent builds ONE multi-line LINE message; the bell wants a short title plus
// a secondary line. First line = title, everything else collapses into message.
function splitText(text) {
  const [first, ...rest] = String(text).split('\n');
  const message = rest.map((s) => s.trim()).filter(Boolean).join(' · ');
  return { title: first.trim(), message: message || undefined };
}

function bothSides(petition) {
  return [requiresQcTrack(petition) ? 'qc' : null, hasLabTrack(petition) ? 'lab' : null].filter(Boolean);
}

function bellDescribe(petition, log) {
  const shared = describeEvent(petition, log);
  if (shared && isAdditionalSampleEvent(log)) {
    return { audiences: shared.audiences, recipientEmployeeIds: shared.recipientEmployeeIds, ...splitText(shared.text) };
  }
  if (shared && log?.event === 'assigned') {
    const no = petition?.petitionNo || log?.petitionNo || '(ไม่ทราบเลข)';
    const assignee = log?.metadata?.assignee || petition?.assignedTo;
    const targetEmployeeId = String(assignee?.employeeId || '').trim() || undefined;
    return {
      audiences: shared.audiences,
      personal: true,
      targetEmployeeId,
      title: `มอบหมายงาน ${no} ให้คุณแล้ว`,
      message: `ตัวอย่าง: ${itemsSummary(petition)}`,
    };
  }
  if (shared) return { audiences: shared.audiences, recipientRoles: log?.metadata?.recipientRoles, ...splitText(shared.text) };

  const no = petition?.petitionNo || log?.petitionNo || '(ไม่ทราบเลข)';
  const side = log?.metadata?.side;

  switch (log?.event) {
    case 'recheck': {
      const requesterIds = log?.metadata?.recipientEmployeeIds || [];
      return {
        audiences: ['qc'],
        recipientEmployeeIds: requesterIds,
        title: `🔎 ขอตรวจสอบซ้ำ ${no}`,
        message: 'มีการแจ้งเตือนไปยัง QC Head และผู้ส่งคำขอแล้ว',
      };
    }
    case 'received': {
      if (side !== 'lab' && side !== 'qc') return null;
      return { audiences: [side], title: `📥 ${SIDE_LABELS[side]} รับตัวอย่าง ${no}` };
    }
    case 'resultEntered': {
      const audiences = side === 'lab' || side === 'qc' ? [side] : bothSides(petition);
      if (!audiences.length) return null;
      return {
        audiences,
        title: `🧪 เริ่มบันทึกผล ${no}`,
        message: log?.metadata?.parameterName || undefined,
      };
    }
    case 'statusChanged': {
      // Head QC bounces the petition back to Lab/QC/both for retest (routes/petitions.js
      // ~line 1018: toStatus 'inProgress' + metadata.returnTo). audiencesForEvent maps
      // plain 'inProgress' to [] so describeEvent already returned null above — but a
      // routine inProgress transition with no returnTo (e.g. a generic field edit) must
      // stay null here too, it is not this event.
      const returnTo = log?.metadata?.returnTo;
      if (log?.toStatus !== 'inProgress' || !returnTo) return null;
      const audiences =
        returnTo === 'both' ? bothSides(petition) : returnTo === 'lab' || returnTo === 'qc' ? [returnTo] : [];
      if (!audiences.length) return null;
      return {
        audiences,
        title: `🔁 ส่งกลับทดสอบใหม่ ${no}`,
        // Reuse the note routes/petitions.js already composed ("หัวหน้า QC ส่งกลับฝั่ง...
        // ทดสอบใหม่: <reason>") instead of re-writing the Thai here.
        message: log?.note || undefined,
      };
    }
    default:
      // resultUpdated = แก้ค่าทีละช่อง (รัวเกินไป), reviewed/deleted = ไม่มีอะไรต้องบอก
      return null;
  }
}

// resultEntered fires once per FORM FIELD (see qcResultAuditEvent in auditEvents.js: "log
// ทุก field"), so one analyst filling one petition emits tens of rows, each producing an
// identical bell entry. Logs arrive sorted newest-first, so the first occurrence of a
// petitionId is the newest — keep it, collapse the rest. Mutates seenPetitionIds (adds the
// key the first time it is NOT a duplicate) so a caller can thread the same Set through a
// full newest-first loop and have "first wins" fall out naturally.
function additionalSampleKey(log, petitionId = log?.petitionId) {
  if (!isAdditionalSampleEvent(log) || !petitionId) return null;
  const { type, side, additionalSampleId } = log.metadata;
  if (!['qc', 'lab'].includes(side) || typeof additionalSampleId !== 'string' || !additionalSampleId.trim()) return null;
  return JSON.stringify(['additionalSample', String(petitionId), type, side, additionalSampleId]);
}

function isCollapsibleDuplicate(log, seenPetitionIds) {
  const key = additionalSampleKey(log) || (log?.event === 'resultEntered' ? String(log?.petitionId || '') : '');
  if (!key) return false;
  if (seenPetitionIds.has(key)) return true;
  seenPetitionIds.add(key);
  return false;
}

// Does this viewer care? Audience match OR it is their own job.
function isRelevant(desc, petition, viewer) {
  if (viewer?.seeAll) return true;
  if (desc?.recipientRoles) {
    return desc.recipientRoles.some((role) => (viewer?.roles || []).includes(role));
  }
  if (desc?.recipientEmployeeIds) {
    const employeeId = String(viewer?.employeeId || '').trim();
    return (desc.audiences || []).some((audience) => (viewer?.audiences || []).includes(audience)) ||
      Boolean(employeeId && desc.recipientEmployeeIds.includes(employeeId));
  }
  if (desc?.targetEmployeeId) {
    return String(viewer?.employeeId || '').trim() === String(desc.targetEmployeeId).trim();
  }
  if (desc?.personal) return false;
  const mine = viewer?.audiences || [];
  if ((desc?.audiences || []).some((a) => mine.includes(a))) return true;

  // employeeId only — names collide, and a collision would leak someone else's work.
  const empId = String(viewer?.employeeId || '').trim();
  if (!empId) return false;
  return (
    String(petition?.assignedTo?.employeeId || '').trim() === empId ||
    String(petition?.submittedBy?.employeeId || '').trim() === empId
  );
}

function levelForEvent(log) {
  if (log?.toStatus === 'rejected') return 'error';
  if (log?.toStatus === 'success' || log?.toStatus === 'approved') return 'success';
  // Sent back to redo work — not routine info, but not the terminal-rejection 'error' either.
  if (log?.toStatus === 'inProgress' && log?.metadata?.returnTo) return 'warning';
  if (String(log?.note || '').includes('ผิดปกติ')) return 'warning';
  return 'info';
}

// id = audit log id, so NotificationContext.push() de-dupes on its own when two
// polls overlap the same window.
function shouldPlaySampleArrivalSound(petition, log, viewer, desc = {}) {
  if (log?.event !== 'statusChanged' || log?.fromStatus !== 'deliveringQC' || log?.toStatus !== 'sampleSent') return false;
  const mine = viewer?.audiences || [];
  return (desc?.audiences || []).some((a) => SOUND_AUDIENCES.has(a) && mine.includes(a));
}

function shouldPlayLabAssignedSound(petition, log, viewer) {
  if (log?.event !== 'assigned') return false;
  const assignee = log?.metadata?.assignee || petition?.assignedTo;
  if (assigneeSide(assignee) !== 'lab') return false;
  if (!(viewer?.audiences || []).includes('lab')) return false;
  const empId = String(viewer?.employeeId || '').trim();
  if (!empId) return false;
  return String(assignee?.employeeId || petition?.assignedTo?.employeeId || '').trim() === empId;
}

function toNotification(petition, log, desc, viewer) {
  const petitionId = String(petition?._id ?? log?.petitionId ?? '');
  const notification = {
    id: additionalSampleKey(log, petitionId) || String(log?._id),
    petitionId,
    petitionNo: petition?.petitionNo || log?.petitionNo || '',
    event: log?.event,
    fromStatus: log?.fromStatus,
    toStatus: log?.toStatus,
    title: desc.title,
    message: desc.message,
    level: levelForEvent(log),
    link: desc?.recipientRoles?.includes('qc-head') ? `/record-results/${petitionId}` : `/petition/${petitionId}`,
    createdAt: log?.createdAt,
  };
  if (shouldPlaySampleArrivalSound(petition, log, viewer, desc)) {
    notification.playSound = true;
  }
  if (shouldPlayLabAssignedSound(petition, log, viewer)) {
    notification.playSound = true;
    notification.sound = 'labAssigned';
  }
  return notification;
}

module.exports = {
  bellDescribe,
  isCollapsibleDuplicate,
  isRelevant,
  levelForEvent,
  shouldPlaySampleArrivalSound,
  toNotification,
};
