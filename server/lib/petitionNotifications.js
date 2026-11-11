// กฎแจ้งเตือนกลางของคำขอ: audit log 1 แถว → แจ้งเตือนกี่อันและใครควรได้รับ
// ใช้ร่วมกันทั้งกระดิ่งในเว็บ (routes/notifications.js) และ PWA push (lib/webPush.js)
// Pure — ไม่แตะ DB. LINE กลุ่มยังใช้ lineNotify.describeEvent แยกต่างหาก
//
// ผู้รับเขียนเป็น to = { roles, people }
//   roles: 'qc' = ทุก role ตระกูล QC, 'lab' = ทุก role ตระกูล Lab, อื่น ๆ = role id ตรงตัว
//   people: [{ employeeId, email, name }] = งานของตัวเอง (ผู้ยื่น / ผู้รับงาน Lab / ผู้ทำงานฝั่ง QC)
const { assigneeSide, describeEvent, itemsSummary, isAdditionalSampleEvent } = require('./lineNotify');
const { hasLabTrack } = require('./petitionStatusLog');
const { requiresQcTrack } = require('./petitionSubmissionRules');
const { roleFamilyForId } = require('./roleFamilies');

const SIDE_LABELS = { lab: 'Lab', qc: 'QC' };
const FOLLOW_UP_TYPES = new Set(['additionalProcessRequested', 'otherRequest']);

const norm = (value) => String(value ?? '').trim().toLowerCase();

function person(source) {
  if (!source) return null;
  const out = {
    employeeId: String(source.employeeId || '').trim(),
    email: norm(source.email),
    name: String(source.name || '').trim(),
  };
  if (!out.employeeId && !out.email && (!out.name || norm(out.name) === 'system')) return null;
  return out;
}

const people = (...sources) => sources.flat().map(person).filter(Boolean);

function submitterPeople(petition) {
  const submitted = petition?.submittedBy || {};
  return people({
    employeeId: submitted.employeeId,
    email: submitted.email || petition?.productionWorkflow?.requesterEmail,
    name: submitted.employeeId ? '' : submitted.name,
  });
}

function labOwnerPeople(petition) {
  const assignee = petition?.assignedTo;
  if (!assignee || assigneeSide(assignee) !== 'lab') return [];
  return people(assignee);
}

// ผู้ที่ทำงานฝั่ง QC ของคำขอนี้ = เจ้าของงาน QC (รับตัวอย่าง / บันทึกผล / ยืนยันผล)
function qcOwnerPeople(petition) {
  const receipts = (petition?.labelReceipts || []).filter((entry) => entry?.side === 'qc').map((entry) => ({ name: entry.receivedBy }));
  return people(
    petition?.qcHandlers || [],
    { name: petition?.qcReceivedBy },
    { name: petition?.qcCompletedBy },
    receipts,
  );
}

function sentToLab(petition) {
  return petition?.sentToLab === true ||
    petition?.sendToLab === true ||
    (petition?.items || []).some((item) => item?.sentToLab === true || item?.sendToLab === true);
}

function splitText(text) {
  const [first, ...rest] = String(text || '').split('\n');
  const message = rest.map((s) => s.trim()).filter(Boolean).join(' · ');
  return { title: first.trim(), message: message || undefined };
}

function levelForEvent(log) {
  if (log?.toStatus === 'rejected') return 'error';
  if (log?.toStatus === 'success' || log?.toStatus === 'approved') return 'success';
  if (log?.toStatus === 'inProgress' && log?.metadata?.returnTo) return 'warning';
  if (String(log?.note || '').includes('ผิดปกติ')) return 'warning';
  return 'info';
}

function sideOwners(petition, side) {
  if (side === 'qc') return qcOwnerPeople(petition);
  if (side === 'lab') return labOwnerPeople(petition);
  return [...qcOwnerPeople(petition), ...labOwnerPeople(petition)];
}

function aiSummary(aiResults) {
  const rows = (Array.isArray(aiResults) ? aiResults : []).filter((row) => row?.result);
  if (!rows.length) return undefined;
  return rows.slice(0, 3).map((row) => `รายการ ${row.itemSeq}: ${row.result}`).join(' · ') + (rows.length > 3 ? ` +${rows.length - 3}` : '');
}

// แปลง audit log เป็นรายการแจ้งเตือน (ยังไม่กรองผู้ชม)
function petitionNotices(petition, log) {
  if (!log) return [];
  const id = String(petition?._id ?? log.petitionId ?? '');
  const no = petition?.petitionNo || log.petitionNo || '(ไม่ทราบเลข)';
  const meta = log.metadata || {};
  const qcTrack = requiresQcTrack(petition);
  const labTrack = hasLabTrack(petition);
  const submitter = submitterPeople(petition);
  const qcOwners = qcOwnerPeople(petition);
  const labOwner = labOwnerPeople(petition);
  const defaultLink = `/petition/${id}`;
  const out = [];
  const add = (variant, to, title, message, extra = {}) => {
    const roles = (to.roles || []).filter(Boolean);
    const list = to.people || [];
    if (!roles.length && !list.length) return;
    out.push({ variant, to: { roles, people: list }, title, message: message || undefined, level: extra.level || levelForEvent(log), link: extra.link || defaultLink, ...extra });
  };
  const ownersEdited = (title, message) => add('owners-edit', { people: [...qcOwners, ...labOwner] }, title, message);

  // ขอตัวอย่างเพิ่ม / ส่ง / รับ — ใช้ถ้อยคำเดียวกับ LINE
  if (isAdditionalSampleEvent(log)) {
    const shared = describeEvent(petition, log);
    if (!shared) return [];
    const text = splitText(shared.text);
    const { type, side } = meta;
    if (type === 'additionalSampleSent') {
      add('additional-sent', { roles: [side] }, text.title, text.message, { sound: 'sampleArrival' });
    } else if (type === 'additionalSampleRequested') {
      add('additional-requester', { people: submitter }, text.title, text.message);
      if (side === 'qc') add('additional-lab-owner', { people: labOwner }, text.title, text.message);
    } else {
      add('additional-requester', { people: submitter }, text.title, text.message);
    }
    return out;
  }

  if (meta.type === 'itemApproval') {
    const seqs = Array.isArray(meta.seqs) ? meta.seqs.join(', ') : '';
    if (meta.decision === 'approve' && meta.side === 'qc') {
      add('physical-pass', { people: [...qcOwners, ...submitter] }, `✅ ผลกายภาพผ่านแล้ว ${no}`, seqs ? `รายการที่ ${seqs}` : undefined, { level: 'success' });
    }
    if (meta.decision === 'reject') {
      add('item-reject', { people: sideOwners(petition, meta.side) }, `⛔ ไม่อนุมัติผล ${SIDE_LABELS[meta.side] || ''} ${no}`, log.note, { level: 'error' });
    }
    if (meta.preResult) {
      add('pre-result', { roles: ['qc-head'] }, `🧾 ${no} อนุมัติครบทุกรายการ — พร้อมออก Final Report`, undefined, { link: `/qc-approval/${id}`, level: 'success' });
    }
    return out;
  }

  switch (log.event) {
    case 'created': {
      const roles = [qcTrack ? 'qc' : null, labTrack ? 'lab' : null];
      const who = petition?.submittedBy?.name || '-';
      add('new', { roles }, `📋 คำขอใหม่ ${no}`, `ผู้ยื่น: ${who} · ตัวอย่าง: ${itemsSummary(petition)}`);
      break;
    }
    case 'received': {
      if (meta.partial || (meta.side !== 'qc' && meta.side !== 'lab')) break;
      if (meta.side === 'qc') add('received-qc', { roles: ['qc'] }, `📥 QC รับตัวอย่าง ${no}`);
      add('received-requester', { people: submitter }, `📥 ${SIDE_LABELS[meta.side]} รับตัวอย่าง ${no} แล้ว`);
      break;
    }
    case 'resultEntered': {
      const side = meta.side || (qcTrack ? 'qc' : null);
      if (side !== 'qc') break;
      add('result-start', { roles: ['qc'] }, `🧪 เริ่มบันทึกผล QC ${no}`, meta.parameterName, { stableId: `resultEntered:${id}:qc` });
      break;
    }
    case 'assigned': {
      const assignee = meta.assignee || petition?.assignedTo;
      const target = people(assignee);
      const name = assignee?.name || '-';
      const isLab = assigneeSide(assignee) === 'lab';
      const recheck = meta.recheckRound ? ` (Re-check รอบ ${meta.recheckRound})` : '';
      add('assigned', { people: target }, `มอบหมายงาน ${no}${recheck} ให้คุณแล้ว`, `ตัวอย่าง: ${itemsSummary(petition)}`, {
        publicTitle: `👤 มอบหมายงาน ${no}${recheck} ให้ ${name}`,
        sound: isLab ? 'labAssigned' : undefined,
      });
      const previous = person(meta.previousAssignee);
      if (previous && !(previous.employeeId && previous.employeeId === target[0]?.employeeId)) {
        add('reassigned-previous', { people: [previous] }, `🔁 งาน ${no}${recheck} ถูกมอบหมายให้ ${name} แล้ว`);
      }
      break;
    }
    case 'unassigned': {
      add('unassigned', { people: people(meta.previousAssignee) }, `↩️ ยกเลิกการมอบหมายงาน ${no}`, log.note);
      break;
    }
    case 'recheck': {
      if (meta.round) {
        const reason = meta.reason ? `เหตุผล: ${meta.reason} · ` : '';
        add('recheck-previous-owner', { people: people(meta.previousAssignee) }, `🔁 งาน ${no} ถูกสั่ง Re-check รอบ ${meta.round}`, `${reason}รอหัวหน้า Lab มอบหมายผู้รับงานใหม่`, { level: 'warning' });
        add('recheck-owners', { people: [...qcOwners, ...submitter] }, `🔎 Lab สั่ง Re-check ${no} รอบ ${meta.round}`, meta.reason, { level: 'warning' });
      } else {
        add('recheck-request', { people: [...labOwner, ...qcOwners, ...submitter] }, `🔎 มีการขอตรวจสอบซ้ำ ${no}`, log.note, { level: 'warning' });
      }
      break;
    }
    case 'statusChanged': {
      if (log.toStatus === 'sampleSent') {
        const roles = [qcTrack ? 'qc' : null, (!qcTrack || sentToLab(petition)) && labTrack ? 'lab' : null];
        add('sample-sent', { roles }, `🚚 ส่งตัวอย่างแล้ว ${no} — รอรับเข้าระบบ`, undefined, { sound: 'sampleArrival' });
      } else if (log.toStatus === 'approved') {
        add('final', { roles: ['qc-head'], people: [...qcOwners, ...submitter] }, `🎉 ${no} ออก Final Report แล้ว`, meta.conclusion === 'accepted-oos' ? 'ยอมรับผลไม่ปกติ' : undefined);
      } else if (log.toStatus === 'rejected') {
        add('returned', { people: [...submitter, ...qcOwners, ...labOwner] }, `⛔ ${no} ถูกส่งกลับให้แก้ไข`, log.note, { level: 'error' });
      } else if (log.toStatus === 'inProgress' && meta.returnTo) {
        const owners = sideOwners(petition, meta.returnTo === 'both' ? null : meta.returnTo);
        const fallbackHeads = meta.returnTo === 'qc' ? ['qc-head'] : meta.returnTo === 'lab' ? ['lab-head'] : ['qc-head', 'lab-head'];
        add('return-to-test', { people: owners, roles: owners.length ? [] : fallbackHeads }, `🔁 ส่งกลับทดสอบใหม่ ${no}`, log.note);
      } else if (log.note === 'อัปเดตคำร้อง') {
        ownersEdited(`✏️ คำขอ ${no} ถูกแก้ไข`, undefined);
      }
      if (log.toStatus === 'success') {
        add('ready-final', { roles: ['qc-head'] }, `✅ ${no} ตรวจครบทุกส่วน — รอออก Final Report`, undefined, { link: `/qc-approval/${id}` });
      }
      break;
    }
    case 'updated': {
      if (FOLLOW_UP_TYPES.has(meta.type) && meta.audience) {
        const text = splitText(`📝 ${no}\n${log.note || ''}`);
        const roles = meta.audience === 'qc' ? ['qc'] : meta.audience === 'lab' ? ['lab'] : meta.audience === 'all' ? ['qc', 'lab'] : [];
        const list = meta.audience === 'requester' || meta.audience === 'all' ? submitter : [];
        add('follow-up', { roles, people: list }, text.title, text.message);
      } else if (meta.type === 'productionEdit' || log.note === 'อัปเดตคำร้อง') {
        ownersEdited(`✏️ คำขอ ${no} ถูกแก้ไข`, meta.type === 'productionEdit' ? log.note : undefined);
      } else if (meta.overrideReason) {
        ownersEdited(`✏️ แก้ไขผลหลังปิดงาน ${no}`, log.note);
      } else if (meta.kind === 'sgEditedAfterConfirm') {
        ownersEdited(`✏️ แก้ไขค่า ถพ. ${no}`, log.note);
      } else if (meta.side === 'lab' && meta.returnTo === 'lab') {
        add('lab-return', { people: labOwner }, `🔁 หัวหน้า Lab ส่งกลับให้แก้ ${no}`, log.note, { level: 'warning' });
      }
      break;
    }
    case 'labResultEdited':
    case 'labResultCleared': {
      if (log.event === 'labResultEdited' && meta.action !== 'edit-save') break;
      add('lab-result-edit', { people: [...labOwner, ...qcOwners] }, `✏️ แก้ไขผล Lab ${no}`, log.note);
      break;
    }
    case 'deleted': {
      add('cancelled', { people: [...qcOwners, ...labOwner, ...submitter] }, `🗑️ คำขอ ${no} ถูกยกเลิก`, log.note, { level: 'warning' });
      break;
    }
    default:
      break;
  }

  // เหตุการณ์เฉพาะทาง (บันทึกใน metadata.kind) ใช้ได้ทั้ง statusChanged และ updated
  if (meta.kind === 'trackCompleted') {
    if (meta.side === 'qc') add('qc-awaiting-approval', { roles: ['qc-approver'] }, `🧾 มีผลกายภาพใหม่รอยืนยัน ${no}`, undefined, { link: `/qc-approval/${id}` });
    if (meta.side === 'lab') add('lab-awaiting-approval', { roles: ['lab-head'] }, `🧾 ผล Lab ${no} รอหัวหน้า Lab อนุมัติ`, undefined, { link: `/lab-approval/${id}` });
  }
  if (meta.kind === 'labApproved') {
    add('lab-approved-owner', { people: labOwner }, `✅ หัวหน้า Lab ออกผล ${no} แล้ว`, undefined, { level: 'success' });
    add('ai-released', { people: submitter }, `🧪 ผล %AI ออกแล้ว ${no}`, aiSummary(meta.aiResults), { level: 'success' });
  }
  if (meta.kind === 'sgConfirmed') {
    const reading = meta.value ? `${meta.batchNo ? `batch ${meta.batchNo}: ` : ''}${meta.value} ที่ ${meta.temperature ?? '-'} °C` : undefined;
    add('sg-lab-owner', { people: labOwner }, `⚖️ QC ยืนยันค่า ถพ. ${no} แล้ว`, reading);
    if (meta.releasedToLab && !labOwner.length) {
      add('sg-lab-head', { roles: ['lab-head'] }, `⚖️ งาน ${no} พร้อมให้ Lab — รอมอบหมาย`, reading, { link: '/petition/assign' });
    }
    add('sg-requester', { people: submitter }, `⚖️ ค่า ถพ. ออกแล้ว ${no}`, reading);
  }

  return out;
}

// ---------- จับคู่ผู้ชม ----------

function hasRoleToken(viewerRoles, token) {
  if (token === 'qc' || token === 'lab') {
    return viewerRoles.some((role) => roleFamilyForId(role) === token);
  }
  return viewerRoles.includes(token);
}

function personMatches(target, viewer) {
  const viewerId = String(viewer?.employeeId || '').trim();
  const viewerEmail = norm(viewer?.email);
  const viewerName = norm(viewer?.name);
  if (target.employeeId && viewerId) return target.employeeId === viewerId;
  if (target.email && viewerEmail) return target.email === viewerEmail;
  if (target.name && viewerName) return norm(target.name) === viewerName;
  return false;
}

function matchesRecipients(to, viewer) {
  const roles = viewer?.roles || [];
  if ((to?.roles || []).some((token) => hasRoleToken(roles, token))) return true;
  return (to?.people || []).some((target) => personMatches(target, viewer));
}

function isActor(viewer, log) {
  const actor = norm(log?.actor);
  if (!actor || actor === 'system') return false;
  return actor === norm(viewer?.name) || actor === norm(viewer?.email);
}

function isAdminViewer(viewer) {
  return (viewer?.roles || []).includes('admin');
}

function additionalSampleKey(log, petitionId = log?.petitionId) {
  if (!isAdditionalSampleEvent(log) || !petitionId) return null;
  const { type, side, additionalSampleId } = log.metadata;
  if (!['qc', 'lab'].includes(side) || typeof additionalSampleId !== 'string' || !additionalSampleId.trim()) return null;
  return JSON.stringify(['additionalSample', String(petitionId), type, side, additionalSampleId]);
}

function toNotification(petition, log, notice, { publicView = false } = {}) {
  const petitionId = String(petition?._id ?? log?.petitionId ?? '');
  const baseId = notice.stableId || additionalSampleKey(log, petitionId) || String(log?._id);
  const notification = {
    id: notice.stableId || additionalSampleKey(log, petitionId) ? baseId : `${baseId}:${notice.variant}`,
    petitionId,
    petitionNo: petition?.petitionNo || log?.petitionNo || '',
    event: log?.event,
    fromStatus: log?.fromStatus,
    toStatus: log?.toStatus,
    title: publicView && notice.publicTitle ? notice.publicTitle : notice.title,
    message: notice.message,
    level: notice.level,
    link: notice.link,
    createdAt: log?.createdAt,
  };
  if (notice.sound && !publicView) {
    notification.playSound = true;
    if (notice.sound !== 'sampleArrival') notification.sound = notice.sound;
  }
  return notification;
}

// viewer = { roles (รวม role พื้นฐานแล้ว), employeeId, email, name, seeAll }
// คืนแจ้งเตือนอย่างมาก 1 อันต่อ audit log เพื่อไม่ให้เหตุการณ์เดียวขึ้นซ้ำ
function notificationForViewer(petition, log, viewer) {
  const notices = petitionNotices(petition, log);
  if (!notices.length) return null;
  if (!isActor(viewer, log)) {
    const mine = notices.find((notice) => matchesRecipients(notice.to, viewer));
    if (mine) return toNotification(petition, log, mine);
  }
  if (viewer?.seeAll && isAdminViewer(viewer)) {
    return toNotification(petition, log, notices.find((notice) => notice.publicTitle) || notices[0], { publicView: true });
  }
  return null;
}

// resultEntered เกิดทุกช่องที่กรอก — เก็บเฉพาะแถวใหม่สุดต่อคำขอ (log เรียงใหม่→เก่า)
function isCollapsibleDuplicate(log, seenKeys) {
  const key = additionalSampleKey(log) || (log?.event === 'resultEntered' ? String(log?.petitionId || '') : '');
  if (!key) return false;
  if (seenKeys.has(key)) return true;
  seenKeys.add(key);
  return false;
}

module.exports = {
  petitionNotices,
  notificationForViewer,
  matchesRecipients,
  hasRoleToken,
  personMatches,
  isCollapsibleDuplicate,
  levelForEvent,
  qcOwnerPeople,
  toNotification,
};
