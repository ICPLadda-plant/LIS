// แจ้งผลกลับไป Production System เมื่อคำขอที่มาจาก Production ปิดงาน (success/approved)
// Production รับที่ api/lis_result_callback.php แล้วเปลี่ยน sample เป็น result_received / reported
const crypto = require('crypto');

const DEFAULT_URL = 'https://app-plant.icpladda.com/production-react/api/lis_result_callback.php';
const DONE_STATUSES = ['success', 'approved'];

function callbackUrl() {
  const v = process.env.PRODUCTION_RESULT_CALLBACK_URL;
  if (v === undefined) return DEFAULT_URL;
  return String(v).trim(); // ตั้งค่าว่างเพื่อปิดการแจ้งกลับ
}

function buildCallbackBody(petition) {
  const requestNo = String(petition?.productionWorkflow?.requestNo || '').trim();
  if (!requestNo) return null;
  if (!DONE_STATUSES.includes(petition?.status)) return null;
  const summary = petition.status === 'approved'
    ? `LIS ${petition.petitionNo}: ออก Final Result แล้ว`
    : `LIS ${petition.petitionNo}: ตรวจเสร็จสิ้น`;
  return {
    request_no: requestNo,
    petition_no: petition.petitionNo,
    status: petition.status,
    result_summary: summary,
    result_url: `https://app-plant.icpladda.com/LIS/petitions/${encodeURIComponent(petition.petitionNo)}`,
  };
}

// แจ้งผลราย batch ทันทีที่ทุกรายการของ batch นั้นอนุมัติครบ (ก่อนคำร้องจะปิดทั้งใบ)
// callback เดิมรับ request_no/result_summary/result_url; batch_no จำกัดให้อัปเดตเฉพาะแถวของ batch นั้น
function buildBatchCallbackBody(petition, batchNo, summary) {
  const requestNo = String(petition?.productionWorkflow?.requestNo || '').trim();
  const batch = String(batchNo || '').trim();
  if (!requestNo || !batch) return null;
  return {
    request_no: requestNo,
    batch_no: batch,
    petition_no: petition.petitionNo,
    status: 'approved',
    result_summary: `LIS ${petition.petitionNo} Batch ${batch}: อนุมัติแล้ว${summary ? ` — ${summary}` : ''}`,
    result_url: `https://app-plant.icpladda.com/LIS/petitions/${encodeURIComponent(petition.petitionNo)}`,
  };
}

async function postCallback(body) {
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
  return json;
}

async function sendProductionResult(petition) {
  return postCallback(buildCallbackBody(petition));
}

async function sendProductionBatchResult(petition, batchNo, summary) {
  return postCallback(buildBatchCallbackBody(petition, batchNo, summary));
}

function notifyProductionBatches(petition, batches) {
  const doc = petition?.toObject ? petition.toObject() : petition;
  for (const { batchNo, summary } of batches || []) {
    sendProductionBatchResult(doc, batchNo, summary).catch((err) => {
      console.error('[productionCallback] batch failed:', doc?.petitionNo, batchNo, err.message);
    });
  }
}

function notifyProductionOnEvent(petition, payload) {
  if (payload?.event !== 'statusChanged' || !DONE_STATUSES.includes(payload?.toStatus)) return;
  const doc = petition?.toObject ? petition.toObject() : petition;
  sendProductionResult({ ...doc, status: payload.toStatus }).catch((err) => {
    console.error('[productionCallback] failed:', doc?.petitionNo, err.message);
  });
}

module.exports = {
  buildCallbackBody,
  buildBatchCallbackBody,
  sendProductionResult,
  sendProductionBatchResult,
  notifyProductionBatches,
  notifyProductionOnEvent,
  DONE_STATUSES,
};
