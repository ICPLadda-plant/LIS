const Petition = require("../models/Petition");
const PetitionAuditLog = require("../models/PetitionAuditLog");
const { pendingAdditionalSamples, requiredSampleRoundId } = require("./additionalSamples");

// When a triggersPhase2 field is filled, schedule the petition's Phase 2 unlock.
// - Timer fields wait timerDurationSec from the time the trigger was filled.
// - Non-timer fields (e.g. a "done" enum/checkbox) unlock Phase 2 immediately.
async function scheduleOrUnlockPhase2({ petitionId, parameter, field, fieldLabel, value, itemSeq, sampleRoundId = "" }) {
  if (!field || !field.triggersPhase2) return;
  if (value === null || value === undefined || value === "") return;

  const petition = await Petition.findById(petitionId);
  const roundId = String(sampleRoundId || "");
  if (!petition) {
    if (roundId) throw new Error("ไม่พบคำขอของรอบตัวอย่างเพิ่ม");
    return;
  }
  const side = parameter.scope === "lab" ? "lab" : "qc";
  if (pendingAdditionalSamples(petition, side).length || requiredSampleRoundId(petition, side, itemSeq) !== roundId) {
    throw new Error("รอบตัวอย่างเปลี่ยนแปลงหรือยังไม่ได้รับ กรุณาโหลดคำขอใหม่");
  }
  const target = roundId
    ? petition.additionalSampleRequests.find(round => String(round._id) === roundId && round.status === "received" && round.side === side)
    : petition;
  if (!target) throw new Error("ไม่พบรอบตัวอย่างเพิ่มที่รับแล้วของฝ่ายนี้");
  if (target.currentPhase === 2) return;

  let dueAt;
  if (field.type === "timer" && field.timerDurationSec > 0) {
    dueAt = new Date(Date.now() + field.timerDurationSec * 1000);
  } else {
    dueAt = new Date();
  }

  // If a trigger was already scheduled, keep the earliest due time
  // (whichever trigger completes first wins).
  if (target.phase2DueAt && target.phase2DueAt < dueAt) return;

  if (roundId) {
    target.currentPhase = 1;
    target.phase2UnlockedAt = null;
  }
  target.phase2DueAt = dueAt;
  target.phase2TriggeredBy = {
    parameterId: String(parameter._id),
    parameterName: parameter.name,
    fieldLabel,
    itemSeq,
    triggeredAt: new Date(),
    // ใบหลัก: จำว่าฝั่งไหน trigger เพื่อเปิดงานฝั่งนั้นให้ยืนยันผล Phase 2 (รอบตัวอย่างเพิ่มมี side ของรอบอยู่แล้ว)
    ...(roundId ? {} : { side }),
  };
  await petition.save();
}

// Lazy auto-advance: called by GET endpoints so a petition transitions to
// Phase 2 the next time it's read after phase2DueAt elapses. Avoids cron.
async function maybeAdvancePhase(petition, actor = "system") {
  if (!petition) return petition;
  const now = new Date();
  const advanceOriginal = petition.currentPhase === 1 && petition.phase2DueAt && petition.phase2DueAt <= now;
  const rounds = (petition.additionalSampleRequests || []).filter(round =>
    round.status === "received" && (round.currentPhase ?? 1) === 1 && round.phase2DueAt && round.phase2DueAt <= now &&
    !pendingAdditionalSamples(petition, round.side).length &&
    round.items.some(item => requiredSampleRoundId(petition, round.side, item.itemSeq) === String(round._id))
  );
  if (!advanceOriginal && !rounds.length) return petition;

  const beforeStatus = petition.status;
  if (advanceOriginal) {
    petition.currentPhase = 2;
    petition.phase2UnlockedAt = now;
    // ผล Phase 2 ยังไม่มี → ฝั่งที่ trigger ต้องยืนยันผลใหม่ (ไม่งั้นหัวหน้าออก Final Result ข้ามผล Phase 2 ได้)
    // trigger เก่าที่ไม่มี side = เปิดทั้งสองฝั่ง
    const side = petition.phase2TriggeredBy?.side;
    if (side !== "lab") {
      petition.qcCompletedAt = null;
      petition.qcCompletedBy = undefined;
    }
    if (side !== "qc") {
      petition.labCompletedAt = null;
      petition.labCompletedBy = undefined;
      petition.labApprovedAt = null;
      petition.labApprovedBy = undefined;
    }
    if (petition.status === "success") {
      petition.status = "inProgress";
      petition.completedAt = null;
    }
  }
  for (const round of rounds) {
    round.currentPhase = 2;
    round.phase2UnlockedAt = now;
  }
  await petition.save();

  if (advanceOriginal) PetitionAuditLog.create({
    petitionId: petition._id,
    petitionNo: petition.petitionNo,
    event: "statusChanged",
    fromStatus: beforeStatus,
    toStatus: petition.status,
    actor,
    note: "เริ่ม Phase 2 (ตรวจซ้ำหลัง trigger)",
    metadata: { phaseAdvance: { from: 1, to: 2 } },
  }).catch((err) => console.error("[audit-log] phase advance:", err.message));
  for (const round of rounds) {
    await PetitionAuditLog.create({
      petitionId: petition._id,
      petitionNo: petition.petitionNo,
      event: "updated",
      toStatus: petition.status,
      actor,
      note: `เริ่ม Phase 2 ของตัวอย่างเพิ่ม ${round.side.toUpperCase()}`,
      metadata: { additionalSampleId: String(round._id), side: round.side, phaseAdvance: { from: 1, to: 2 } },
    });
  }

  return petition;
}

module.exports = { scheduleOrUnlockPhase2, maybeAdvancePhase };
