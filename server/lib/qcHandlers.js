// บันทึกว่าใครทำงานฝั่ง QC ของคำขอ (รับตัวอย่าง / บันทึกผล / ยืนยันผล)
// ใช้ตัดสิน "งานของตัวเอง" ของ QC ในระบบแจ้งเตือน (lib/petitionNotifications.qcOwnerPeople)
const Petition = require('../models/Petition');

function handlerFrom(source) {
  if (!source) return null;
  const out = {
    employeeId: String(source.employeeId || '').trim(),
    email: String(source.email || '').trim().toLowerCase(),
    name: String(source.name || '').trim(),
  };
  if (!out.employeeId && !out.email && (!out.name || out.name.toLowerCase() === 'system')) return null;
  return out;
}

// เพิ่มครั้งเดียวต่อคน — ไม่แตะ __v จึงไม่ชนกับ version guard ของ route อื่น
async function recordQcHandler(petitionId, source) {
  const handler = handlerFrom(source);
  if (!petitionId || !handler) return;
  const notSeen = handler.employeeId
    ? { 'qcHandlers.employeeId': { $ne: handler.employeeId } }
    : handler.email
      ? { 'qcHandlers.email': { $ne: handler.email } }
      : { 'qcHandlers.name': { $ne: handler.name } };
  try {
    await Petition.updateOne({ _id: petitionId, ...notSeen }, { $push: { qcHandlers: handler } });
  } catch (err) {
    console.error('[qcHandlers] record failed:', err.message);
  }
}

// ผู้ใช้จาก session/X-LIS-User ก่อน ไม่พบใช้ชื่อ actor ที่ client ส่งมา
async function recordQcHandlerFromRequest(req, petitionId, fallbackName) {
  const { currentUser } = require('../routes/additionalSamples');
  const user = await currentUser(req).catch(() => null);
  await recordQcHandler(petitionId, user || { name: fallbackName });
}

module.exports = { recordQcHandler, recordQcHandlerFromRequest, handlerFrom };
