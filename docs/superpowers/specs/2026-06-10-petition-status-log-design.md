# Petition `status_log` — Derived Human-Readable Status Timeline

**Date:** 2026-06-10
**Branch:** develop
**Status:** Design approved, pending spec review

## Problem

`Petition.status` is a coarse enum (`deliveringQC → sampleSent → pendingReview → inProgress → success → approved/rejected`). It does not convey:

- Which side (Lab / QC) has received the sample when only one has.
- Live QC testing progress (which parameters entered, overall %).
- The two distinct end-of-job confirmation steps (waiting for Lab results, then waiting for the QC head to sign off).

We want a richer, human-readable **`status_log`** — both a *current* detailed status and a *timeline* — exposed by the petitions API.

## Decisions (from brainstorming)

1. **Derive on read** — no new DB field. The API computes `status_log` from existing data (`Petition`, `PetitionAuditLog`, `QCTestResult`, `Parameter`). Keeps a single source of truth, no data drift, live QC %.
2. **Timeline from `PetitionAuditLog`** — map each existing audit event to a Thai label. `current` is computed live from petition state (so the QC % is fresh between events).
3. **QC % = lightweight server heuristic** — do NOT port the heavy frontend `matchParametersForItem` / `expandFieldForItem` / simple-method logic. Approximate at the (item × parameter) granularity. Acceptable that it may differ slightly from the QC page's field/unit-level bar.
4. **QC label shows parameter names + %** — e.g. `QC กำลังตรวจ — pH, ความชื้น (45%)`.
5. **QC-centric** — Lab appears only as received / waiting milestones, not full Lab testing detail.
6. **End-of-job ordering** — Lab finishes first, then waits for the QC head to confirm/close: `รอ QC ยืนยันผล` (per-sample) → `success` = `เสร็จสิ้น — รอหัวหน้า QC ยืนยัน` → `approved` = `หัวหน้า QC อนุมัติ — ปิดงาน`.

## Architecture

No schema change. New pure-function module + one read endpoint.

### `server/lib/petitionStatusLog.js`

```
buildStatusLog(petition, auditLogs, qcResults, parameters, labDone) → { current, timeline }
computeQcHeuristic(petition, qcResults, parameters)                 → { filled, total, percent }
```

All pure (no DB access) so they are unit-testable. The route loads the inputs and calls them.

### Endpoint

`GET /api/petitions/status-log/:id` — mounted twice (`/api` + `/LIS/api`) automatically via `mountApi()` like every other route. `:id` resolves by `_id` (when a valid ObjectId) else by `petitionNo`, matching the existing `GET /:id` pattern. The path is **literal-first** (`status-log` segment before `:id`), like the other collection routes `/audit-logs`, `/scan/:code`, so it can never be shadowed by the generic `/:id`.

Route handler:
1. Load petition (404 if missing).
2. Load `PetitionAuditLog.find({ petitionId }).sort({ createdAt: 1 })`.
3. Load `QCTestResult.find({ petitionId })` and active `Parameter.find({ status: 'active' })` (only needed when status is in the testing range; may be skipped for terminal/pre-testing states as an optimization, but correctness does not depend on it).
4. Compute `labDone` (see Rule 5 predicate): load `PhysicalResult.find({ sampleId: { $in: labSampleIds } })` for the petition's lab sampleIds.
5. `res.json(buildStatusLog(petition, auditLogs, qcResults, parameters, labDone))`.

**Ordering note:** declared among the other literal-first routes (e.g. `/audit-logs`, `/scan/:code`), *before* the generic `GET /:id`. Because `status-log` is a fixed first segment, it is structurally unambiguous against `/:id` regardless of order — but keep it before `/:id` for consistency with the file.

### Response shape

```jsonc
{
  "current": { "label": "QC กำลังตรวจ — pH, ความชื้น (45%)", "side": "qc", "percent": 45 },
  "timeline": [
    { "label": "ยื่นคำขอ", "at": "2026-06-10T...", "actor": "..." },
    { "label": "QC รับตัวอย่าง", "at": "...", "actor": "...", "side": "qc" },
    { "label": "QC บันทึกผล — pH", "at": "...", "actor": "..." }
  ]
}
```

- `current.side` ∈ `qc | lab | undefined`. `current.percent` present only during QC testing.
- timeline entries: `{ label, at, actor, side? }`, ascending by `at`.

## Timeline derivation (audit event → label)

| audit `event` (+ context) | label |
|---|---|
| `created` | `ยื่นคำขอ` |
| `statusChanged` → `sampleSent` | `ส่งตัวอย่าง` |
| `received`, `metadata.side === 'qc'` | `QC รับตัวอย่าง` (`side: 'qc'`) |
| `received`, `metadata.side === 'lab'` | `Lab รับตัวอย่าง` (`side: 'lab'`) |
| `assigned` | `มอบหมายให้ {petition.assignedTo.name}` (fall back to audit note) |
| `resultEntered` | `QC บันทึกผล — {param}` (param from `metadata`/note) |
| `resultUpdated` | `QC แก้ไขผล — {param}` |
| `statusChanged` → `success` | `เสร็จสิ้น — รอหัวหน้า QC ยืนยัน` |
| `statusChanged` → `approved` | `หัวหน้า QC อนุมัติ — ปิดงาน` |
| `statusChanged` → `rejected` | `ส่งกลับให้แก้ไข` |
| `reviewed` / `updated` / other | omit from timeline (or pass through audit `note`) — these are not status milestones |

Unknown/unmapped events are skipped (timeline shows milestones only, not every audit row).

## Current-status derivation — dual-track (`{ label, tracks }`)

`current` is **two parallel tracks** (QC and Lab), each advancing independently once the sample is received. Shape:

```jsonc
// example: both sides received, the single assignee is a Lab analyst
current: {
  label: "QC รับแล้ว | เจ้าหน้าที่กำลังวิเคราะห์",
  tracks: {
    qc:  { side: "qc", label: "QC รับแล้ว" },
    lab: { side: "lab", label: "เจ้าหน้าที่กำลังวิเคราะห์" }
  }
}
```

- `label` = the present tracks' labels joined by `" | "`.
- `tracks.qc` / `tracks.lab` each = `{ side, label, percent? }` (`side` is `'qc'`/`'lab'`). `percent` is set only while QC is actively entering values.
- A track is **omitted** when it doesn't apply: `tracks.lab` only exists when the petition has a lab item AND lab is not yet done; once `labDone`, the lab track drops and `current` is driven by QC alone ("Lab เสร็จ → update จาก QC").

### Terminal / pre-receive states (single label, no `tracks`)

Checked first; these short-circuit the dual-track build:

| condition | `label` | `side` |
|---|---|---|
| `status === 'approved'` | `หัวหน้า QC อนุมัติ — ปิดงาน` | — |
| `status === 'rejected'` | `ส่งกลับให้แก้ไข` | — |
| `status === 'success'` | `เสร็จสิ้น — รอหัวหน้า QC ยืนยัน` | qc |
| neither side received & `status === 'sampleSent'` | `ส่งตัวอย่างแล้ว — รอรับ` | — |
| neither side received (else) | `กำลังนำส่ง QC` | — |

### Per-track derivation (first match wins, per side)

Shared signals: `qcReceived`/`labReceived` (`= !!qcReceivedAt`/`!!labReceivedAt`); `assignee = petition.assignedTo` (single assignee); `assigneeSide = assigneeSideOf(assignee)` — `'lab'` if `assignee.department`/`position` mentions `lab`/`วิเคราะห์`, else `'qc'`, `null` when unassigned; `started = reviewHistory has an entry with action 'startTesting' OR firstResultAt set OR qc.filled > 0`; the QC heuristic `{ filled, total, percent }` + `paramNames`; `labDone`. **The assign/accept line appears only on the assignee's own side** (`isAssignee = assigneeSide === thisSide`); the other side just shows its receive state.

**QC track** (`isAssignee = assigneeSide === 'qc'`):

| condition | `label` |
|---|---|
| `!qcReceived` | `QC รอรับ` |
| `total > 0 && filled >= total` | `QC ตรวจครบ — รอยืนยัน` |
| `0 < filled` (entering) | `QC กำลังตรวจ — {entered "param › field" labels} ({percent}%)` (sets `percent`) |
| `isAssignee && !started` | `QC มอบหมายงานแล้ว รอเจ้าหน้าที่รับงาน` |
| `isAssignee && started` | `QC {assignee.name} รับงานแล้ว · กำลังตรวจ` |
| else (received, not this side's assignment, nothing entered) | `QC รับแล้ว` |

QC progress (the `filled`-based rows) is shown regardless of `assigneeSide`, since QC values are entered independently of who the single `assignedTo` is.

**Lab track** (`isAssignee = assigneeSide === 'lab'`; only built when the petition has a lab item; `null`/omitted when `labDone`):

| condition | `label` |
|---|---|
| `labDone` | *(track omitted)* |
| `!labReceived` | `Lab รอรับ` |
| `isAssignee && !started` | `เจ้าหน้าที่กำลังวิเคราะห์` |
| `isAssignee && started` | `Lab {assignee.name} รับงานแล้ว · กำลังตรวจ` |
| else (received, not this side's assignment) | `Lab รับแล้ว` |

### Why this subsumes the old single-label rules

- "รอผลตรวจจาก Lab" → now expressed as `QC ตรวจครบ — รอยืนยัน | Lab … กำลังตรวจ` (QC done, lab still running).
- "รอ QC ยืนยันผล" → `labDone` drops the lab track, leaving `QC ตรวจครบ — รอยืนยัน` alone, the final state before `success`.
- One-side-received → e.g. `QC รับแล้ว | Lab รอรับ`.

### Known approximations (data-model limits, documented intentionally)

- **Single `assignedTo` → side inferred from HR fields**: the petition has one assignee, not one per side. The assign/accept line therefore shows on only one track, chosen by `assigneeSideOf` (department/position contains `lab`/`วิเคราะห์` → Lab, else QC). The other side shows plain `รับแล้ว`. This is a heuristic — a Lab analyst whose HR department doesn't mention "lab"/"วิเคราะห์" would be misattributed to QC.
- **Shared `started` signal**: `startTesting` (reviewHistory) / `firstResultAt` / QC `filled` are per-petition, so the assignee side flips "รอเจ้าหน้าที่รับงาน" → "รับงานแล้ว" off this single signal. `QrStartTestingModal` is currently a placeholder, so in practice `started` is driven by `firstResultAt` / QC `filled` until that accept-flow is built.
- **labDone predicate** (unchanged): the petition has ≥ 1 lab item AND not every lab sampleId has a completed `PhysicalResult`. Lab sampleIds derived via `sampleIdsFromPetition` restricted to `batchNo` ending 1/6; `labDone` = every such sampleId has a `PhysicalResult` with `status === 'completed'`. Route loads `PhysicalResult.find({ sampleId: { $in: labSampleIds } })` and passes `labDone` into `buildStatusLog` (keeps the pure function DB-free).

## QC heuristic (`computeQcHeuristic`) — FIELD granularity

Counts individual **value-fields**, not whole parameters, so entering one field of a
multi-field parameter is *not* 100%.

- **total** = for each `petition.items[i]` × each active QC parameter `p` (`p.status === 'active'`, `(p.scope ?? 'qc') !== 'lab'`) that applies to the item under the **lightweight** predicate below, add the count of `p`'s **countable value-fields** (`countableFields` = `valueFields` with `type !== 'photo'`, mirroring the frontend `isCountableField`).
  - applies-to predicate: `p.applyAll`, **or** `p.commonNames` contains `item.commonName` (case-insensitive, trimmed), **or** `p.itemNames` contains `item.sampleName` (trimmed), **or** `item.testItems` (comma-split, lowercased) contains `p.name`.
  - Deliberately **omits** productType/subCategory/itemGroup/simple-method dimensions, and does **not** unit-expand substance-mode fields (the QC page counts per-substance units) — those are the documented approximations.
- **filled** = total non-empty entries across all `qcResults[].values` (`countFilledFields`), capped at `total`.
- **percent** = `total > 0 ? round(filled / total * 100) : 0`.

**`enteredFieldLabels`** returns the distinct `"{paramName} › {fieldKey}"` labels of filled fields (ordered by the result's `enteredAt` then key order; substance keys `label::สาร` render as `label — สาร`). These are what the `QC กำลังตรวจ — …` label lists, so the user sees *which field* is being filled (e.g. `กายภาพ › สี`).

`filled` is capped at `total` for display so percent never exceeds 100 even if the heuristic denominator under-counts.

## Testing

`server/lib/petitionStatusLog.test.js` — uses Node's built-in `node:test` + `node:assert` (CommonJS `require`), matching every existing `server/lib/*.test.js`. Run with `node --test lib/petitionStatusLog.test.js` from `server/`. (The root Vitest config only includes `src/**`, so server libs are tested with the Node runner, not Vitest.)

- Each `current` rule 1–10 returns the expected label/side given a crafted petition + inputs.
- `computeQcHeuristic`: filled/total/percent for applyAll, commonName match, testItems match, no-match (total 0 → 0%), partial, 100%, over-count cap.
- Timeline: event→label mapping for every mapped event; unmapped events skipped; ascending order; `side` propagated for `received`.
- Edge cases: only-one-side received (both orders), lab batch present vs absent, success/approved/rejected terminal labels.

Pure functions only — no DB, no HTTP. Route wiring verified manually / by a lightweight existing-pattern smoke check.

## Out of scope

- No frontend rendering in this spec (API only). A consumer (petition detail timeline UI) can be a follow-up.
- No changes to existing `status` enum, audit logging, or approval flow.
- Exact field/unit-level QC % parity with the QC page (intentionally approximate).
