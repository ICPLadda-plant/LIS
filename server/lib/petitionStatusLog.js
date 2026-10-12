// Derives a human-readable status_log ({ current, timeline }) for a petition.
// Pure functions — NO DB access. The route loads inputs and calls buildStatusLog.
const { defaultSendItemToLab, isLabBatchNo, isMandatoryLabProduct, isResearchAndDevelopmentDepartment, requiresQcTrack } = require('./petitionSubmissionRules');

// Lab batch rule (mirrors src/types/petition.types.ts isLabBatch):
// last char of trimmed batchNo is '1' or '6'.
function isLabBatch(batchNo) {
  return isLabBatchNo(batchNo);
}

function shouldSendItemToLab(item) {
  if (!item) return false;
  if (isMandatoryLabProduct(item)) return true;
  return typeof item.sendToLab === 'boolean' ? item.sendToLab : defaultSendItemToLab(item);
}

function hasLabTrack(petition) {
  if (isResearchAndDevelopmentDepartment(petition?.submittedBy?.department)) return true;
  return ((petition ?? {}).items ?? []).some((it) => shouldSendItemToLab(it));
}

// True if a QCTestResult.values object has at least one non-empty field value.
function hasFilledValue(values) {
  if (!values || typeof values !== 'object') return false;
  return Object.values(values).some((v) => v != null && String(v).trim() !== '');
}

// Lightweight QC-applicability check (heuristic — intentionally OMITS
// productType / subCategory / itemGroup / simple-method dimensions that the
// frontend matchParametersForItem uses).
function qcParamAppliesToItem(param, item) {
  const commonName = String(item.commonName ?? '').trim().toUpperCase();
  if (commonName && (param.excludeCommonNames ?? []).some((c) => String(c).trim().toUpperCase() === commonName)) {
    return false;
  }
  const sampleName = String(item.sampleName ?? '').trim();
  if (sampleName && (param.excludeItemNames ?? []).some((n) => String(n).trim() === sampleName)) {
    return false;
  }
  if (commonName && (param.commonNames ?? []).some((c) => String(c).trim().toUpperCase() === commonName)) {
    return true;
  }
  if (param.applyAll) return true;
  if (sampleName && (param.itemNames ?? []).some((n) => String(n).trim() === sampleName)) {
    return true;
  }
  const testNames = String(item.testItems ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (testNames.length && testNames.includes(String(param.name ?? '').trim().toLowerCase())) {
    return true;
  }
  return false;
}

// Countable value-fields of a parameter (mirrors the frontend `isCountableField`:
// everything except photo). substanceMode fields are NOT unit-expanded here — that
// is the documented heuristic approximation vs the QC page's per-substance bar.
function countableFields(param) {
  return (param.valueFields ?? []).filter((f) => f && f.type !== 'photo');
}

// Number of non-empty entries in a QCTestResult.values object.
function countFilledFields(values) {
  if (!values || typeof values !== 'object') return 0;
  return Object.values(values).filter((v) => v != null && String(v).trim() !== '').length;
}

// { filled, total, percent } at FIELD granularity — total counts every countable
// value-field of every matched QC param (so entering one field of many is < 100%).
function computeQcHeuristic(petition, qcResults, parameters) {
  const items = (petition ?? {}).items ?? [];
  const qcParams = (parameters ?? []).filter(
    (p) => p.status === 'active' && (p.scope ?? 'qc') !== 'lab',
  );

  let total = 0;
  for (const item of items) {
    for (const p of qcParams) {
      if (qcParamAppliesToItem(p, item)) total += countableFields(p).length;
    }
  }

  let filled = 0;
  for (const r of qcResults ?? []) filled += countFilledFields(r.values);
  if (total > 0 && filled > total) filled = total; // cap so percent never exceeds 100
  const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
  return { filled, total, percent };
}

// Distinct "param › field" labels for each filled field, ordered by the result's
// enteredAt then key order. e.g. กายภาพ with values { สี: 'แดง' } → "กายภาพ › สี".
function enteredFieldLabels(qcResults) {
  const rows = (qcResults ?? [])
    .filter((r) => hasFilledValue(r.values))
    .slice()
    .sort((a, b) => new Date(a.enteredAt ?? 0) - new Date(b.enteredAt ?? 0));
  const seen = new Set();
  const labels = [];
  for (const r of rows) {
    const param = String(r.parameterName ?? r.parameterId ?? '').trim();
    for (const [key, val] of Object.entries(r.values ?? {})) {
      if (val == null || String(val).trim() === '') continue;
      const field = String(key).replace('::', ' — '); // substance keys are label::สาร
      const label = param ? `${param} › ${field}` : field;
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  return labels;
}

// Current detailed status. First matching rule wins (see spec table).
// qc = output of computeQcHeuristic; fieldLabels = enteredFieldLabels(...) ("param › field");
// labDone = every lab sampleId has a completed PhysicalResult (route-computed).
function buildCurrent(petition, qc, fieldLabels, labDone) {
  const status = petition.status;

  // --- terminal / pre-receive states: single label, no tracks ---
  if (status === 'approved') return { label: 'หัวหน้า QC ออก Final Result — ปิดงาน' };
  if (status === 'rejected') return { label: 'ส่งกลับให้แก้ไข' };
  if (status === 'success') return { label: 'เสร็จสิ้น — รอหัวหน้า QC ยืนยัน', side: 'qc' };

  const qcReceived = !!petition.qcReceivedAt;
  const labReceived = !!petition.labReceivedAt;
  if (!qcReceived && !labReceived) {
    if (status === 'sampleSent' && !isResearchAndDevelopmentDepartment(petition?.submittedBy?.department)) {
      return { label: 'ส่งตัวอย่างแล้ว — รอรับ' };
    }
    if (status !== 'sampleSent') {
      return {
        label: isResearchAndDevelopmentDepartment(petition?.submittedBy?.department)
          ? 'กำลังนำส่ง Lab'
          : 'กำลังนำส่ง QC',
      };
    }
  }

  // --- dual-track: QC and Lab advance independently ---
  const hasLabItem = hasLabTrack(petition);
  const hasQcTrack = requiresQcTrack(petition);
  const assignee = petition.assignedTo;
  const assigneeSide = assigneeSideOf(assignee); // 'lab' | 'qc' | null — assignment belongs to ONE side
  // "รับงาน" (job accepted) signal — single, per-petition (model has no per-side accept):
  // explicit startTesting review, OR first result recorded, OR QC already has values.
  const started =
    (petition.reviewHistory ?? []).some((r) => r.action === 'startTesting') ||
    !!petition.firstResultAt ||
    qc.filled > 0;

  const qcTrack = hasQcTrack
    ? buildQcTrack({
      qcReceived, isAssignee: assigneeSide === 'qc', assignee, started, qc, fieldLabels,
      qcCompleted: !!petition.qcCompletedAt,
    })
    : null;
  const labTrack = hasLabItem
    ? buildLabTrack({ labReceived, isAssignee: assigneeSide === 'lab', assignee, started, labDone })
    : null;

  const tracks = {};
  if (qcTrack) tracks.qc = { side: 'qc', ...qcTrack };
  if (labTrack) tracks.lab = { side: 'lab', ...labTrack };
  const label = [qcTrack?.label, labTrack?.label].filter(Boolean).join(' | ');
  return { label, tracks };
}

// Which side a (single) assignee belongs to, from HR department/position — the
// petition has one assignedTo with no explicit side, so the assignment line shows
// only on this track. Lab if dept/position mentions "lab"/"วิเคราะห์"; else QC.
function assigneeSideOf(assignee) {
  if (!assignee) return null;
  const hay = `${assignee.department || ''} ${assignee.position || ''}`.toLowerCase();
  if (hay.includes('lab') || hay.includes('วิเคราะห์')) return 'lab';
  return 'qc';
}

// QC side of `current`. Returns { label, percent? }. `isAssignee` = the single
// petition assignee belongs to QC (only then does the assign/accept line show here).
// "ตรวจครบ" is driven by the authoritative qcCompletedAt flag (set when QC presses
// บันทึกผล via POST /complete), NOT by the qc.filled>=qc.total heuristic: `filled`
// counts per-substance keys + stray result rows that `total` does not, so the
// heuristic can reach 100% while required cells are still empty (P-2606-0013).
function buildQcTrack({ qcReceived, isAssignee, assignee, started, qc, fieldLabels, qcCompleted }) {
  if (!qcReceived) return { label: 'QC รอรับ' };
  if (qcCompleted) return { label: 'QC ตรวจครบ — รอยืนยัน' };
  if (qc.filled > 0) {
    // Heuristic percent is approximate and can hit 100 before QC confirms — cap at
    // 99 so the in-progress bar never reads fully done ahead of the qcCompletedAt flag.
    const percent = Math.min(qc.percent, 99);
    const names = (fieldLabels ?? []).length ? ` — ${fieldLabels.join(', ')}` : '';
    return { label: `QC กำลังตรวจ${names} (${percent}%)`, percent };
  }
  if (isAssignee) {
    return started
      ? { label: `QC ${assignee.name} รับงานแล้ว · กำลังตรวจ` }
      : { label: 'QC มอบหมายงานแล้ว รอเจ้าหน้าที่รับงาน' };
  }
  return { label: 'QC รับแล้ว' };
}

// Lab side of `current`. Returns { label } or null (omitted when lab is done).
// `isAssignee` = the single petition assignee belongs to Lab.
function buildLabTrack({ labReceived, isAssignee, assignee, started, labDone }) {
  if (labDone) return null; // lab finished → drop track, QC drives from here
  if (!labReceived) return { label: 'Lab รอรับ' };
  if (isAssignee) {
    return started
      ? { label: `Lab ${assignee.name} รับงานแล้ว · กำลังตรวจ` }
      : { label: 'Lab มอบหมายงานแล้ว รอเจ้าหน้าที่รับงาน' };
  }
  return { label: 'Lab รับแล้ว' };
}

// Maps one audit-log row to a Thai milestone label, or null to skip it.
function timelineLabel(log, petition) {
  const md = log.metadata || {};
  switch (log.event) {
    case 'created':
      return 'ยื่นคำขอ';
    case 'received':
      return md.side === 'lab' ? 'Lab รับตัวอย่าง' : 'QC รับตัวอย่าง';
    case 'assigned':
      return petition?.assignedTo?.name
        ? `มอบหมายให้ ${petition.assignedTo.name}`
        : (log.note || 'มอบหมาย');
    case 'resultEntered': {
      const p = md.parameterName || md.parameterId || '';
      return p ? `QC บันทึกผล — ${p}` : 'QC บันทึกผล';
    }
    case 'resultUpdated': {
      const p = md.parameterName || md.parameterId || '';
      return p ? `QC แก้ไขผล — ${p}` : 'QC แก้ไขผล';
    }
    case 'updated':
      if (md.type === 'additionalSampleRequested') return 'ต้องการตัวอย่างเพิ่ม';
      if (md.type === 'additionalProcessRequested') return 'ขอเพิ่มกระบวนการ';
      if (md.type === 'otherRequest') return 'แจ้งคำขออื่นๆ';
      return null;
    case 'statusChanged':
      if (log.toStatus === 'sampleSent') return 'ส่งตัวอย่าง';
      if (log.toStatus === 'success') return 'เสร็จสิ้น — รอหัวหน้า QC ยืนยัน';
      if (log.toStatus === 'approved') return 'หัวหน้า QC ออก Final Result — ปิดงาน';
      if (log.toStatus === 'rejected') return 'ส่งกลับให้แก้ไข';
      return null; // other status transitions are not milestones
    default:
      return null; // reviewed / updated / deleted → skipped
  }
}

// Builds the milestone timeline from audit logs (assumed already ascending by createdAt).
function buildTimeline(auditLogs, petition) {
  const out = [];
  for (const log of auditLogs ?? []) {
    const label = timelineLabel(log, petition);
    if (!label) continue;
    const entry = { label, at: log.createdAt, actor: log.actor };
    if (log.event === 'received' && log.metadata?.side) entry.side = log.metadata.side;
    if (log.event === 'assigned') {
      // assignment belongs to ONE side — derive from the assignee snapshot logged
      // at assign time (falls back to the petition's current assignee on old logs).
      const side = assigneeSideOf(log.metadata?.assignee || petition?.assignedTo);
      if (side) entry.side = side;
    }
    out.push(entry);
  }
  return out;
}

// Keep readings from earlier additional-sample rounds alongside the current results.
function buildTestResults(petition, qcResults, parameters) {
  const paramById = new Map((parameters ?? []).map((param) => [String(param._id), param]));
  const itemsBySeq = new Map((petition.items ?? []).map((item) => [item.seq, item]));
  const output = [];
  const snapshotted = new Set();
  const resultKey = (result) => `${result.itemSeq}:${result.parameterId}:${result.sampleRoundId || ''}`;
  const append = (result, side, sampleRoundId) => {
    const item = itemsBySeq.get(result.itemSeq);
    const base = {
      itemSeq: result.itemSeq,
      sampleId: result.sampleId || item?.sampleId || null,
      sampleName: result.sampleName || item?.sampleName || null,
      side,
      sampleRoundId: String(sampleRoundId || ''),
      parameterName: result.parameterName || paramById.get(String(result.parameterId))?.name || '',
    };
    const addValues = (values, phase, entryIndex) => {
      for (const [fieldLabel, value] of Object.entries(values ?? {})) {
        if (value == null || String(value).trim() === '' || /__source$/.test(fieldLabel)) continue;
        const label = fieldLabel.split('::')[0].trim();
        if (!/^(?:ค่าถพ\.|density)$/i.test(label) && !/^%\s*ai(?:$|\s|[-—:])/i.test(label)) continue;
        output.push({ ...base, fieldLabel, value, phase, ...(entryIndex == null ? {} : { entryIndex }) });
      }
    };
    addValues(result.values, 1);
    addValues(result.valuesPhase2, 2);
    for (const [index, values] of (result.entries ?? []).entries()) addValues(values, 1, index);
  };

  for (const round of petition.additionalSampleRequests ?? []) {
    for (const result of round.previousResults ?? []) {
      snapshotted.add(resultKey(result));
      append(result, round.side, result.sampleRoundId);
    }
  }
  for (const result of qcResults ?? []) {
    if (snapshotted.has(resultKey(result))) continue;
    const param = paramById.get(String(result.parameterId));
    if (!param) continue;
    append(result, param.scope === 'lab' ? 'lab' : 'qc', result.sampleRoundId);
  }
  return output;
}

// Success gate — true when every REQUIRED track has recorded completion.
// QC is required on EVERY petition; Lab is required only when the petition has a
// lab-batch item. A petition may transition to `success` only when this holds —
// so a single track finishing (Lab OR QC) never completes the petition alone.
function isPetitionComplete(petition) {
  if (petition?.additionalSampleRequests?.some(round => round.status !== 'received')) return false;
  const hasLabItem = hasLabTrack(petition);
  const qcDone = !!(petition ?? {}).qcCompletedAt;
  const labDone = !hasLabItem || !!(petition ?? {}).labApprovedAt;
  return (!requiresQcTrack(petition) || qcDone) && labDone;
}

// Top-level: assemble { current, timeline } from route-loaded inputs.
function buildStatusLog(petition, auditLogs, qcResults, parameters, labDone) {
  const qc = computeQcHeuristic(petition, qcResults, parameters);
  const fieldLabels = enteredFieldLabels(qcResults);
  const current = buildCurrent(petition, qc, fieldLabels, !!labDone);
  const timeline = buildTimeline(auditLogs, petition);
  const testResults = buildTestResults(petition, qcResults, parameters);
  return { current, timeline, testResults };
}

module.exports = {
  isLabBatch,
  shouldSendItemToLab,
  hasLabTrack,
  hasFilledValue,
  qcParamAppliesToItem,
  countableFields,
  countFilledFields,
  computeQcHeuristic,
  enteredFieldLabels,
  buildCurrent,
  timelineLabel,
  buildTimeline,
  buildTestResults,
  buildStatusLog,
  isPetitionComplete,
};
