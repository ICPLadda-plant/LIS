// แจ้งสถานะคำขอกลับไป Production System (api/lis_result_callback.php)
// สถานะคำนวณจากเอกสาร petition ล่าสุดเสมอ — ส่งเมื่อสถานะเปลี่ยนจากครั้งก่อน
const crypto = require('crypto');
const { hasLabTrack } = require('./petitionStatusLog');
const { requiresQcTrack } = require('./petitionSubmissionRules');
const { itemRequiresSide, itemSideStatus, findItemApproval } = require('./itemApprovals');
const { isSgParameter, readSgReading } = require('./sgConfirmation');
const { aiFromQcResults } = require('./coaErp');

const DEFAULT_URL = 'https://app-plant.icpladda.com/production-react/api/lis_result_callback.php';
const LIS_BASE = 'https://app-plant.icpladda.com/LIS';

function callbackUrl() {
  const v = process.env.PRODUCTION_RESULT_CALLBACK_URL;
  if (v === undefined) return DEFAULT_URL;
  return String(v).trim(); // ตั้งค่าว่างเพื่อปิดการแจ้งกลับ
}

const ts = (d) => (d ? new Date(d).getTime() : 0);

// รหัสสถานะฝั่ง Production (lis_status)
function deriveProductionStatus(p) {
  if (!p) return null;
  if (p.status === 'rejected') return 'rejected';
  if (p.status === 'approved') return 'result_received';
  const rounds = p.additionalSampleRequests || [];
  if (rounds.some((r) => r.status === 'requested')) return 'more_sample';
  if (rounds.some((r) => r.status === 'sent')) return 'more_sample_sent';
  const recheckPending = p.labRecheckRequestedAt && ts(p.labApprovedAt) < ts(p.labRecheckRequestedAt);
  if (recheckPending && p.status === 'pendingReview' && !p.labCompletedAt) return 're_check';
  const qcDone = !requiresQcTrack(p) || !!p.qcCompletedAt;
  // ออกผล Lab ที่เกิดก่อนสั่ง Re-check ไม่นับ
  const labDone = !hasLabTrack(p) || !!p.labCompletedAt || (!!p.labApprovedAt && !recheckPending);
  if (p.status === 'success' || (qcDone && labDone && (p.qcCompletedAt || p.labCompletedAt))) return 'pre_result';
  if (p.status === 'inProgress' || (!recheckPending && p.firstResultAt)) return 'analyzing';
  if (p.qcReceivedAt || p.labReceivedAt) return 'received';
  return 'sent';
}

const SUMMARY = {
  sent: 'ส่งคำขอแล้ว', received: 'รับตัวอย่างแล้ว', analyzing: 'กำลังวิเคราะห์',
  more_sample: 'ขอตัวอย่างเพิ่ม', more_sample_sent: 'Production ส่งตัวอย่างเพิ่มแล้ว',
  re_check: 'Lab ขอ Re-check', pre_result: 'ออก pre-result แล้ว',
  result_received: 'ออกผลแล้ว', rejected: 'LIS ส่งกลับแก้ไข',
};

function moreSampleInfo(p) {
  const round = (p.additionalSampleRequests || []).find((r) => r.status !== 'received');
  if (!round) return null;
  const items = (round.items || []).map((it) => {
    const item = (p.items || []).find((x) => x.seq === it.itemSeq) || {};
    return {
      item_seq: it.itemSeq, quantity: it.quantity, sample_name: item.sampleName || '',
      batch_no: item.batchNo || '', lot_no: item.lotNo || '',
      sent_amount: it.sentAmount ?? null, sent_unit: it.sentUnit || null,
    };
  });
  return { round_id: String(round._id), side: round.side, reason: round.reason, status: round.status, requested_at: round.requestedAt, items };
}

// ผลราย batch ให้ Production เห็น: ค่า ถพ. (จากผล QC), กายภาพผ่าน/ไม่ผ่าน, %AI (เฉพาะ batch ที่ส่ง Lab)
// %AI ส่งตัวเลขเมื่อ Lab อนุมัติรายการแล้วเท่านั้น ระหว่างวิเคราะห์ส่งแค่สถานะ "pending"
// sgParameterIds = รหัสพารามิเตอร์ QC ที่เก็บค่า ถพ. (ไม่ส่ง = อ่านจากผลทุกตัว)
function batchResults(petition, qcResults = [], sgParameterIds = null) {
  const groups = new Map();
  for (const item of petition?.items || []) {
    const batchNo = String(item.batchNo || '').trim();
    const key = batchNo || `#${item.seq}`;
    if (!groups.has(key)) groups.set(key, { batchNo, items: [] });
    groups.get(key).items.push(item);
  }
  const resultsFor = (seq) => (qcResults || []).filter((r) => Number(r.itemSeq) === Number(seq));
  const isSgResult = (r) => (sgParameterIds ? sgParameterIds.has(String(r.parameterId)) : true);
  return [...groups.values()].map(({ batchNo, items }) => {
    const qcItems = items.filter((item) => itemRequiresSide(petition, item, 'qc'));
    const labItems = items.filter((item) => itemRequiresSide(petition, item, 'lab'));
    const qcStatuses = qcItems.map((item) => itemSideStatus(petition, item, 'qc'));
    const labStatuses = labItems.map((item) => itemSideStatus(petition, item, 'lab'));
    const physical = !qcItems.length ? 'none'
      : qcStatuses.every((s) => s === 'approved') ? 'approved'
        : qcStatuses.some((s) => s === 'rejected') ? 'rejected' : 'pending';
    const labApproved = labItems.length > 0 && labStatuses.every((s) => s === 'approved');
    const aiStatus = !labItems.length ? 'none'
      : labApproved
        ? (labItems.some((item) => findItemApproval(petition, item.seq, 'lab')?.conclusion === 'accepted-oos') ? 'fail' : 'pass')
        : 'pending';
    let sg = '';
    let sgTemp = '';
    for (const item of items) {
      const reading = resultsFor(item.seq).filter(isSgResult).map(readSgReading).find((r) => r.value);
      if (reading) { sg = reading.value; sgTemp = reading.temperature; break; }
    }
    let ai = '';
    if (labApproved) {
      for (const item of labItems) {
        const found = aiFromQcResults(resultsFor(item.seq), item.commonName);
        if (found?.result) { ai = found.result; break; }
      }
    }
    return {
      batch_no: batchNo,
      item_seqs: items.map((item) => item.seq),
      sg, sg_temp: sgTemp, physical, ai, ai_status: aiStatus,
    };
  });
}

function buildCallbackBody(petition, qcResults = [], sgParameterIds = null) {
  const requestNo = String(petition?.productionWorkflow?.requestNo || '').trim();
  if (!requestNo) return null;
  const lisStatus = deriveProductionStatus(petition);
  if (!lisStatus) return null;
  return {
    request_no: requestNo,
    petition_no: petition.petitionNo,
    lis_status: lisStatus,
    result_summary: `LIS ${petition.petitionNo}: ${SUMMARY[lisStatus] || lisStatus}`,
    result_url: `${LIS_BASE}/petitions/${encodeURIComponent(petition.petitionNo)}`,
    more_sample: moreSampleInfo(petition),
    batch_results: batchResults(petition, qcResults, sgParameterIds),
  };
}

// LIS ยกเลิกคำขอ → Production เปลี่ยนคำขอเป็น cancelled พร้อมเหตุผล
function buildCancelCallbackBody(petition, { reason, actor, at } = {}) {
  const requestNo = String(petition?.productionWorkflow?.requestNo || '').trim();
  if (!requestNo) return null;
  const why = String(reason || '').trim();
  return {
    request_no: requestNo,
    petition_no: petition.petitionNo,
    lis_status: 'cancelled',
    result_summary: `LIS ${petition.petitionNo}: ยกเลิกคำขอ${why ? ` — ${why}` : ''}`,
    cancel_reason: why,
    cancelled_by: String(actor || '').trim(),
    cancelled_at: (at ? new Date(at) : new Date()).toISOString(),
  };
}

async function postProductionCallback(body) {
  const url = callbackUrl();
  if (!url || !body) return { skipped: true };
  const raw = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  const secret = String(process.env.PRODUCTION_RESULT_SECRET || '').trim();
  if (secret) headers['X-LIS-Signature'] = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const res = await fetch(url, { method: 'POST', headers, body: raw });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok || !json || json.ok !== true) {
    const detail = json?.error || text.replace(/<[^>]+>/g, '').trim().slice(0, 300);
    throw new Error(`production callback ${res.status}: ${detail}`);
  }
  if (!json.updated) console.warn('[productionCallback] ไม่พบ request_no ใน Production:', body.request_no);
  return { ...json, lis_status: body.lis_status };
}

function sendProductionStatus(petition, qcResults = [], sgParameterIds = null) {
  return postProductionCallback(buildCallbackBody(petition, qcResults, sgParameterIds));
}

function sendProductionCancel(petition, info) {
  return postProductionCallback(buildCancelCallbackBody(petition, info));
}

async function loadResultsForCallback(petitionId) {
  const QCTestResult = require('../models/QCTestResult');
  const Parameter = require('../models/Parameter');
  const qcResults = await QCTestResult.find({ petitionId: String(petitionId) }).lean();
  const ids = [...new Set(qcResults.map((r) => String(r.parameterId)).filter(Boolean))];
  const params = ids.length ? await Parameter.find({ _id: { $in: ids.filter((id) => /^[a-f0-9]{24}$/i.test(id)) } }, { valueFields: 1, scope: 1 }).lean() : [];
  const sgParameterIds = new Set(params.filter((p) => p.scope !== 'lab' && isSgParameter(p)).map((p) => String(p._id)));
  return { qcResults, sgParameterIds };
}

// โหลด petition ล่าสุด แล้วส่งถ้าสถานะ รอบตัวอย่างเพิ่ม หรือผลราย batch เปลี่ยน
async function syncPetition(id, { force = false } = {}) {
  const Petition = require('../models/Petition');
  const doc = await Petition.findById(id).lean();
  if (!doc) return { skipped: true };
  const { qcResults, sgParameterIds } = await loadResultsForCallback(doc._id);
  const body = buildCallbackBody(doc, qcResults, sgParameterIds);
  if (!body) return { skipped: true };
  const resultsKey = crypto.createHash('sha1').update(JSON.stringify(body.batch_results)).digest('hex').slice(0, 12);
  const key = body.lis_status + '|' + (body.more_sample ? body.more_sample.round_id + ':' + body.more_sample.status : '') + '|' + resultsKey;
  if (!force && doc.productionWorkflow?.lastSyncKey === key) return { skipped: true, unchanged: true };
  const result = await postProductionCallback(body);
  await Petition.updateOne({ _id: doc._id }, { $set: {
    'productionWorkflow.lastSyncKey': key,
    'productionWorkflow.lisStatus': body.lis_status,
    'productionWorkflow.lastSyncAt': new Date(),
  } });
  return result;
}

function notifyProductionOnEvent(petition) {
  const id = petition?._id;
  if (!id || !petition?.productionWorkflow?.requestNo) return;
  // รอให้ route บันทึกเอกสารเสร็จก่อน (บาง route log ก่อน save)
  setTimeout(() => {
    syncPetition(id).catch((err) => console.error('[productionCallback] failed:', petition.petitionNo, err.message));
  }, 1500);
}

// approvals ยังเรียกแจ้งราย batch อยู่ — สถานะทั้งใบคำนวณใหม่จาก petition ล่าสุดอยู่แล้ว จึงส่งต่อให้ sync ปกติ
function notifyProductionBatches(petition) {
  notifyProductionOnEvent(petition);
}

module.exports = {
  deriveProductionStatus,
  batchResults,
  buildCallbackBody,
  buildCancelCallbackBody,
  sendProductionStatus,
  sendProductionCancel,
  syncPetition,
  notifyProductionOnEvent,
  notifyProductionBatches,
};
