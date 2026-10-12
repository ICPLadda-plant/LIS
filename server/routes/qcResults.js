const express = require("express");
const router = express.Router();
const mongoose = require('mongoose');
const QCTestResult = require("../models/QCTestResult");
const Parameter = require("../models/Parameter");
const Petition = require("../models/Petition");
const { scheduleOrUnlockPhase2 } = require("../lib/phaseAdvance");
const PetitionAuditLog = require('../models/PetitionAuditLog');
const { qcResultAuditEvent, qcResultNote } = require('../lib/auditEvents');
const { pendingAdditionalSamples, requiredSampleRoundId } = require('../lib/additionalSamples');
const { currentUser, canTestSide } = require('./additionalSamples');
const { normalizeRoles } = require('../lib/roles');
const { notifyPetitionEvent } = require('../lib/lineNotify');
const { serializePetitionWrite } = require('../lib/petitionWriteQueue');
const {
  computeAbnormalFlags,
  ensureRequestedIdsPresent,
  getEntryValuesJS,
} = require('../lib/abnormalFlags');

async function resultRoundContext(req, res, parameter) {
  const petition = await Petition.findById(req.body.petitionId).lean();
  if (!petition || !parameter) {
    res.status(404).json({ error: 'ไม่พบคำขอหรือหัวข้อทดสอบ' });
    return null;
  }
  const side = parameter.scope === 'lab' ? 'lab' : 'qc';
  if (!Number.isInteger(req.body.itemSeq) || !petition.items?.some(item => item.seq === req.body.itemSeq)) {
    res.status(400).json({ error: 'ไม่พบรายการตัวอย่างในคำขอนี้' });
    return null;
  }
  const sampleRoundId = requiredSampleRoundId(petition, side, req.body.itemSeq);
  if (pendingAdditionalSamples(petition, side).length || String(req.body.sampleRoundId || '') !== sampleRoundId) {
    res.status(409).json({ error: 'รอบตัวอย่างเปลี่ยนแปลงหรือยังไม่ได้รับ กรุณาโหลดคำขอใหม่' });
    return null;
  }
  if (petition.additionalSampleRequests?.length) {
    const user = await currentUser(req);
    if (!user || !canTestSide(user, petition, side)) {
      res.status(user ? 403 : 401).json({ error: 'ไม่มีสิทธิ์บันทึกผลให้ฝ่ายนี้' });
      return null;
    }
    const sideIsClosed = side === 'qc'
      ? Boolean(petition.qcCompletedAt)
      : false;
    if (['approved', 'rejected'].includes(petition.status) || sideIsClosed) {
      res.status(409).json({ error: 'ฝ่ายนี้ยืนยันผลแล้ว ไม่สามารถแก้ผลตรวจได้' });
      return null;
    }
  }
  const round = petition.additionalSampleRequests?.find(entry => String(entry._id) === sampleRoundId);
  if (sampleRoundId && req.body.phase === 2 && round?.currentPhase !== 2) {
    res.status(409).json({ error: 'ตัวอย่างรอบนี้ยังไม่เปิด Phase 2 กรุณารอเงื่อนไขของรอบใหม่' });
    return null;
  }
  const allowedRoundIds = new Set(['', ...(petition.additionalSampleRequests || []).filter(round => round.side === side && round.status === 'received' && round.items.some(item => item.itemSeq === Number(req.body.itemSeq))).map(round => String(round._id))]);
  return { sampleRoundId, allowedRoundIds };
}

// GET /api/qc-results/testers?petitionIds=id1,id2,...
// Returns a map of petitionId → unique tester names (from enteredBy/updatedBy)
router.get("/testers", async (req, res) => {
  try {
    const raw = String(req.query.petitionIds || "").trim();
    if (!raw) return res.json({});
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.json({});

    const docs = await QCTestResult.find(
      { petitionId: { $in: ids } },
      { petitionId: 1, enteredBy: 1, updatedBy: 1 }
    ).lean();

    const map = {};
    for (const id of ids) map[id] = [];
    const seen = {};
    for (const id of ids) seen[id] = new Set();

    // Show only the current owner (= latest editor) of each doc.
    // Matches what the detail page displays per field, so list ↔ detail are consistent.
    for (const d of docs) {
      const pid = d.petitionId;
      const name = d.updatedBy?.name || d.enteredBy?.name;
      if (name && !seen[pid].has(name)) {
        seen[pid].add(name);
        map[pid].push(name);
      }
    }
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-results/progress?petitionIds=id1,id2,...
// Returns map of petitionId → [{ itemSeq, parameterId, filledLabels }] so the
// client can compute filled vs. required totals (denominator needs Parameter
// metadata that the QCTestResult collection doesn't carry).
router.get("/progress", async (req, res) => {
  try {
    const raw = String(req.query.petitionIds || "").trim();
    if (!raw) return res.json({});
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.json({});

    const docs = await QCTestResult.find(
      { petitionId: { $in: ids } },
      { petitionId: 1, itemSeq: 1, parameterId: 1, values: 1, entries: 1 }
    ).lean();

    const paramIds = Array.from(new Set(docs.map((d) => String(d.parameterId))));
    const params = paramIds.length
      ? await Parameter.find({ _id: { $in: paramIds } }, { valueFields: 1, multiEntry: 1 }).lean()
      : [];
    const paramById = new Map(params.map((p) => [String(p._id), p]));

    const map = {};
    for (const id of ids) map[id] = [];
    for (const d of docs) {
      const param = paramById.get(String(d.parameterId)) || {};
      const labels = new Set();
      for (const values of getEntryValuesJS(d, param)) {
        for (const [k, v] of Object.entries(values)) {
          // a field counts as filled if any entry/element carries a non-empty value
          if (Array.isArray(v)) {
            if (v.some((x) => x != null && String(x).trim() !== "")) labels.add(k);
          } else if (v != null && String(v).trim() !== "") {
            labels.add(k);
          }
        }
      }
      const bucket = map[d.petitionId];
      if (bucket) {
        bucket.push({
          itemSeq: d.itemSeq,
          parameterId: String(d.parameterId),
          filledLabels: Array.from(labels),
        });
      }
    }
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-results/abnormal-flags?petitionIds=id1,id2,...
// Returns map of petitionId → boolean (true if any field in any result is abnormal).
router.get("/abnormal-flags", async (req, res) => {
  try {
    const includeRestricted = String(req.query.includeRestricted || "").trim() === "1";
    const raw = String(req.query.petitionIds || "").trim();
    if (!raw) return res.json({});
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.json({});

    const docs = await QCTestResult.find(
      { petitionId: { $in: ids } },
      { petitionId: 1, parameterId: 1, itemSeq: 1, commonName: 1, values: 1, entries: 1 }
    ).lean();
    const paramIds = Array.from(new Set(docs.map((d) => String(d.parameterId))));
    const params = paramIds.length
      ? await Parameter.find({ _id: { $in: paramIds } }, { valueFields: 1, multiEntry: 1 }).lean()
      : [];
    const petitions = await Petition.find({ _id: { $in: ids } }, { dept: 1, items: 1 }).lean();

    const map = ensureRequestedIdsPresent(
      computeAbnormalFlags({ docs, params, petitions, includeRestricted }),
      ids,
    );
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-results/last-values?commonName=&parameterId=&excludePetitionId=
// คืนผลตรวจล่าสุดก่อนหน้าของ common name + parameter เดียวกัน (ไม่รวม petition ปัจจุบัน)
router.get("/last-values", async (req, res) => {
  try {
    const commonName = String(req.query.commonName || "").trim();
    const parameterId = String(req.query.parameterId || "").trim();
    const excludePetitionId = String(req.query.excludePetitionId || "").trim();
    if (!commonName || !parameterId) return res.json({});

    const filter = { commonName, parameterId };
    if (excludePetitionId) filter.petitionId = { $ne: excludePetitionId };

    const doc = await QCTestResult.findOne(filter)
      .sort({ enteredAt: -1, updatedAt: -1 })
      .lean();

    if (!doc) return res.json({});
    res.json({ petitionNo: doc.petitionNo, enteredAt: doc.enteredAt, values: doc.values || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-results/:petitionId
router.get("/:petitionId", async (req, res) => {
  try {
    const results = await QCTestResult.find({ petitionId: req.params.petitionId }).lean();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/qc-results — upsert a single field value
router.put("/", serializePetitionWrite(async (req, res) => {
  try {
    const {
      petitionId, petitionNo,
      itemSeq, sampleId, sampleName, commonName,
      parameterId, parameterName,
      fieldLabel, value, entryIndex,
      enteredBy,
      overrideReason,
      phase, // 1 = Phase 1 (default), 2 = Phase 2 (after)
    } = req.body;

    if (!petitionId || itemSeq == null || !parameterId || !fieldLabel) {
      return res.status(400).json({ error: "petitionId, itemSeq, parameterId, fieldLabel are required" });
    }

    // sanity ceiling — entries are "unlimited" in practice but guard against runaway padding
    if (entryIndex != null && (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex > 1000)) {
      return res.status(400).json({ error: "entryIndex อยู่นอกช่วงที่อนุญาต (0–1000)" });
    }

    // Reject saves for reference fields — their value is computed, not entered
    const paramForCheck = await Parameter.findById(parameterId).lean();
    const petitionForEdit = await Petition.findById(petitionId).lean();
    const existingUser = await currentUser(req);
    const isClosed = ['approved', 'rejected'].includes(petitionForEdit?.status);
    const roles = normalizeRoles(existingUser);
    if (isClosed) {
      if (!roles.includes('qc-head') && !roles.includes('admin')) {
        return res.status(403).json({ error: 'แก้ไขผลที่ปิดงานแล้วได้เฉพาะ QC Head' });
      }
      if (!String(overrideReason || '').trim()) {
        return res.status(400).json({ error: 'กรุณาระบุเหตุผลการแก้ไขผล' });
      }
    }
    const roundContext = await resultRoundContext(req, res, paramForCheck);
    if (!roundContext) return;
    const fieldDef = paramForCheck?.valueFields?.find((f) => f.label === fieldLabel);
    if (fieldDef?.type === 'reference') {
      return res.status(400).json({ error: "ช่องนี้ดึงค่าจาก parameter อื่นโดยอัตโนมัติ — บันทึกไม่ได้" });
    }

    const phaseNum = phase === 2 ? 2 : 1;
    const valuesKey = phaseNum === 2 ? "valuesPhase2" : "values";

    const filter = { petitionId, itemSeq, parameterId };
    const now = new Date();

    const existing = await QCTestResult.findOne(filter);
    if (existing && !roundContext.allowedRoundIds.has(String(existing.sampleRoundId || ''))) return res.status(409).json({ error: 'ผลตรวจอยู่ในรอบใหม่กว่า กรุณาโหลดคำขอใหม่' });
    const newRound = String(existing?.sampleRoundId || '') !== roundContext.sampleRoundId;
    if (existing) filter.sampleRoundId = existing.sampleRoundId || { $in: ['', null] };
    const isNew = !existing;

    const baseSet = {
      petitionNo, sampleId, sampleName, commonName, parameterName,
      updatedBy: enteredBy,
      updatedAt: now,
      sampleRoundId: roundContext.sampleRoundId,
    };
    if (newRound) Object.assign(baseSet, { values: {}, valuesPhase2: {}, entries: [] });
    if (isNew || newRound || !existing?.enteredBy) {
      baseSet.enteredBy = enteredBy;
      baseSet.enteredAt = now;
    }

    let existingFieldValue;
    const update = { $set: baseSet };

    if (phaseNum === 1 && Number.isInteger(entryIndex) && entryIndex >= 0) {
      // multiEntry write: read-modify-write the entries array (avoids dot-path
      // numeric-index creating an object instead of an array)
      const entries = !newRound && Array.isArray(existing?.entries)
        ? existing.entries.map((e) => ({ ...(e || {}) }))
        : [];
      while (entries.length <= entryIndex) entries.push({});
      existingFieldValue = entries[entryIndex][fieldLabel];
      entries[entryIndex][fieldLabel] = value;
      update.$set.entries = entries;
    } else {
      existingFieldValue = newRound ? undefined : existing?.[valuesKey]?.[fieldLabel];
      if (newRound) update.$set[valuesKey] = { [fieldLabel]: value };
      else update.$set[`${valuesKey}.${fieldLabel}`] = value;
    }

    const doc = await QCTestResult.findOneAndUpdate(filter, update, {
      upsert: !existing,
      new: true,
    });
    if (!doc) return res.status(409).json({ error: 'ผลตรวจเปลี่ยนรอบแล้ว กรุณาโหลดใหม่ก่อนบันทึก' });

    // ลง audit log ระดับ field ทุกครั้งที่บันทึก (fire-and-forget — ไม่ให้กระทบการบันทึกค่า)
    const auditEvent = qcResultAuditEvent({ existingFieldValue });
    const petitionObjId = mongoose.Types.ObjectId.isValid(petitionId)
      ? new mongoose.Types.ObjectId(petitionId)
      : undefined;
    if (petitionObjId) {
      PetitionAuditLog.create({
        petitionId: petitionObjId,
        petitionNo,
        event: isClosed ? 'updated' : auditEvent,
        actor: enteredBy?.name || enteredBy?.email || 'system',
        note: isClosed ? `แก้ไขผลหลังปิดงาน: ${String(overrideReason).trim()} · ${qcResultNote(auditEvent, { parameterName, parameterId, fieldLabel, sampleName })}` : qcResultNote(auditEvent, { parameterName, parameterId, fieldLabel, sampleName }),
        metadata: { itemSeq, sampleName, commonName, parameterId, parameterName, fieldLabel, phase: phaseNum, entryIndex, overrideReason: isClosed ? String(overrideReason).trim() : undefined, audience: isClosed ? 'qc' : undefined, recipientRoles: isClosed ? ['qc-head'] : undefined },
      }).catch((err) => {
        console.error('[audit-log] qc-result write failed:', err.message);
      });
    }

    if (isClosed) {
      notifyPetitionEvent(petitionForEdit, {
        event: 'updated',
        actor: enteredBy?.name || enteredBy?.email || 'QC Head',
        note: `QC Head แก้ไขผล ${parameterName || parameterId} · เหตุผล: ${String(overrideReason).trim()}`,
        metadata: { audience: 'qc' },
      });
    }

    // If this field has triggersPhase2 and was filled in Phase 1, schedule advance
    if (phaseNum === 1 && fieldDef?.triggersPhase2 && paramForCheck) {
      try {
        await scheduleOrUnlockPhase2({
          petitionId,
          parameter: paramForCheck,
          field: fieldDef,
          fieldLabel,
          value,
          itemSeq,
          sampleRoundId: roundContext.sampleRoundId,
        });
      } catch (e) {
        if (roundContext.sampleRoundId) throw e;
        console.error("[phase-advance] schedule failed:", e.message);
      }
    }

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// PUT /api/qc-results/entries — replace the whole entries array (multiEntry add/remove)
router.put("/entries", serializePetitionWrite(async (req, res) => {
  try {
    const {
      petitionId, petitionNo, itemSeq, sampleId, sampleName, commonName,
      parameterId, parameterName, entries, enteredBy, overrideReason,
    } = req.body;
    if (!petitionId || itemSeq == null || !parameterId || !Array.isArray(entries)) {
      return res.status(400).json({ error: "petitionId, itemSeq, parameterId, entries[] required" });
    }
    if (entries.length > 1001) {
      return res.status(400).json({ error: "entries เกินจำนวนที่อนุญาต" });
    }
    const parameter = await Parameter.findById(parameterId).lean();
    const petitionForEdit = await Petition.findById(petitionId).lean();
    const entryUser = await currentUser(req);
    const isClosed = ['approved', 'rejected'].includes(petitionForEdit?.status);
    const entryRoles = normalizeRoles(entryUser);
    if (isClosed && (!entryRoles.includes('qc-head') && !entryRoles.includes('admin'))) return res.status(403).json({ error: 'แก้ไขผลที่ปิดงานแล้วได้เฉพาะ QC Head' });
    if (isClosed && !String(overrideReason || '').trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการแก้ไขผล' });
    const roundContext = await resultRoundContext(req, res, parameter);
    if (!roundContext) return;
    const filter = { petitionId, itemSeq, parameterId };
    const now = new Date();
    const existing = await QCTestResult.findOne(filter);
    if (existing && !roundContext.allowedRoundIds.has(String(existing.sampleRoundId || ''))) return res.status(409).json({ error: 'ผลตรวจอยู่ในรอบใหม่กว่า กรุณาโหลดคำขอใหม่' });
    const newRound = String(existing?.sampleRoundId || '') !== roundContext.sampleRoundId;
    if (existing) filter.sampleRoundId = existing.sampleRoundId || { $in: ['', null] };
    const update = {
      $set: {
        petitionNo, sampleId, sampleName, commonName, parameterName,
        entries, updatedBy: enteredBy, updatedAt: now,
        sampleRoundId: roundContext.sampleRoundId,
      },
    };
    if (newRound) Object.assign(update.$set, { values: {}, valuesPhase2: {} });
    if (!existing || newRound || !existing.enteredBy) {
      update.$set.enteredBy = enteredBy;
      update.$set.enteredAt = now;
    }
    const doc = await QCTestResult.findOneAndUpdate(filter, update, { upsert: !existing, new: true });
    if (!doc) return res.status(409).json({ error: 'ผลตรวจเปลี่ยนรอบแล้ว กรุณาโหลดใหม่ก่อนบันทึก' });

    // audit (fire-and-forget) — entries array was replaced (add/remove/edit of multiEntry rows).
    // entry removal deletes recorded data, so it must be audited. event is enum-constrained
    // (see PetitionAuditLog) — reuse 'resultUpdated' and put the detail in the note.
    const petitionObjId = mongoose.Types.ObjectId.isValid(petitionId)
      ? new mongoose.Types.ObjectId(petitionId)
      : undefined;
    if (petitionObjId) {
      PetitionAuditLog.create({
        petitionId: petitionObjId,
        petitionNo,
        event: isClosed ? 'updated' : 'resultUpdated',
        actor: enteredBy?.name || enteredBy?.email || 'system',
        note: `${isClosed ? `แก้ไขผลหลังปิดงาน: ${String(overrideReason).trim()} · ` : ''}QC ปรับรายการหลายค่า ${parameterName || parameterId}: ${entries.length} รายการ${sampleName ? ` (${sampleName})` : ''}`,
        metadata: { itemSeq, sampleName, commonName, parameterId, parameterName, entryCount: entries.length, overrideReason: isClosed ? String(overrideReason).trim() : undefined, audience: isClosed ? 'qc' : undefined, recipientRoles: isClosed ? ['qc-head'] : undefined },
      }).catch((err) => {
        console.error('[audit-log] qc-result entries write failed:', err.message);
      });
    }
    if (isClosed) notifyPetitionEvent(petitionForEdit, { event: 'updated', actor: enteredBy?.name || enteredBy?.email || 'QC Head', note: `QC Head แก้ไขผล ${parameterName || parameterId} · เหตุผล: ${String(overrideReason).trim()}`, metadata: { audience: 'qc' } });

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

module.exports = router;
