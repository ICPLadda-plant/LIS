// แจ้งสถานะคำขอกลับไป Production System (api/lis_result_callback.php)
// สถานะคำนวณจากเอกสาร petition ล่าสุดเสมอ — ส่งเมื่อสถานะเปลี่ยนจากครั้งก่อน
const crypto = require('crypto');
const { hasLabTrack } = require('./petitionStatusLog');
const { requiresQcTrack } = require('./petitionSubmissionRules');

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

function buildCallbackBody(petition) {
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
  };
}

async function sendProductionStatus(petition) {
  const url = callbackUrl();
  const body = buildCallbackBody(petition);
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

// โหลด petition ล่าสุด แล้วส่งถ้าสถานะหรือรอบตัวอย่างเพิ่มเปลี่ยน
async function syncPetition(id, { force = false } = {}) {
  const Petition = require('../models/Petition');
  const doc = await Petition.findById(id).lean();
  const body = buildCallbackBody(doc);
  if (!body) return { skipped: true };
  const key = body.lis_status + '|' + (body.more_sample ? body.more_sample.round_id + ':' + body.more_sample.status : '');
  if (!force && doc.productionWorkflow?.lastSyncKey === key) return { skipped: true, unchanged: true };
  const result = await sendProductionStatus(doc);
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

module.exports = { deriveProductionStatus, buildCallbackBody, sendProductionStatus, syncPetition, notifyProductionOnEvent };
