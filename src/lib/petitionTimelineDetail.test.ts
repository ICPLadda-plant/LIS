import { describe, expect, it } from "vitest";
import type { ParameterItem, QCProgressEntry } from "@/lib/api";
import type { Petition, PetitionAuditLogEntry } from "@/types/petition.types";
import { buildTimelineDetailModel } from "./petitionTimelineDetail";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 6, day, hour, minute).toISOString();

function petition(overrides: Partial<Petition> = {}): Petition {
  return {
    _id: "petition-1",
    petitionNo: "P-2607-001",
    dept: "production",
    status: "inProgress",
    submittedBy: { name: "Requester", submittedAt: at(13, 9) },
    items: [{ seq: 1, sampleName: "Sample A", batchNo: "BATCH-002", sampleId: "sample-1" }],
    createdAt: at(13, 9),
    updatedAt: at(13, 9),
    ...overrides,
  } as Petition;
}

const requiredParameter: ParameterItem = {
  _id: "parameter-1",
  name: "Required checks",
  scope: "qc",
  status: "active",
  applyAll: true,
  valueFields: [
    { label: "Viscosity", type: "number", required: true },
    { label: "Color", type: "text", required: true },
    { label: "Evidence", type: "photo", required: true },
    { label: "Optional note", type: "text", required: false },
  ],
};

function model(
  petitionData: Petition,
  parameters: ParameterItem[] = [],
  progressEntries: QCProgressEntry[] = [],
  auditLogs: PetitionAuditLogEntry[] = [],
  now = new Date(2026, 6, 13, 12),
  itemSeq: number | null = null,
) {
  return buildTimelineDetailModel({ petition: petitionData, parameters, progressEntries, auditLogs, itemSeq }, now);
}

describe("buildTimelineDetailModel", () => {
  it("รับตัวอย่างแล้วแต่ยังไม่มี parameter/Lab -> คาดการณ์ 17:00 ของวันทำการถัดไป", () => {
    const now = new Date(2026, 6, 13, 12);
    const result = model(petition({ qcReceivedAt: at(13, 10, 15) }), [], [], [], now);

    expect(result.header.startAt).toBe(at(13, 10, 15));
    expect(result.header.endAt).toBe(at(14, 17));
    expect(result.header.endKind).toBe("estimated");
    expect(result.header.overdue).toBe(false);
    // header คาดการณ์ไปวันถัดไปได้ แต่กราฟลากถึงแค่ตอนนี้ — ไม่ดันแท็บวันไปวันที่ยังไม่มีกิจกรรม
    expect(result.timeline.endAt).toBe(now.toISOString());
    expect(result.timeline.days.map((day) => day.label)).toEqual(["13 ก.ค."]);
  });

  it("ยังไม่รับตัวอย่าง -> endKind = unreceived", () => {
    const result = model(petition(), [requiredParameter], [], [], new Date(2026, 6, 13, 12));

    expect(result.header.endKind).toBe("unreceived");
    expect(result.header.endAt).toBe(at(14, 17));
    expect(result.header.overdue).toBe(false);
  });

  it("คำร้องที่เพิ่งสร้าง (ยังไม่รับ) แกนกราฟต้องไม่ดันไปวันคาดการณ์ +1 — ลากถึงแค่ตอนนี้", () => {
    const now = new Date(2026, 6, 13, 12);
    const result = model(petition(), [requiredParameter], [], [], now);

    // header ยังโชว์เวลาคาดการณ์ (จบวันทำการถัดไป) ได้ตามเดิม — มันมี label "ค่าประมาณ" กำกับ
    expect(result.header.endKind).toBe("unreceived");
    expect(result.header.endAt).toBe(at(14, 17));
    // แต่กราฟ (แท็บวัน) ต้องสะท้อนของจริง = วันนี้วันเดียว ไม่มีแท็บวัน +1 ที่ยังไม่มีกิจกรรม
    expect(result.timeline.endAt).toBe(now.toISOString());
    expect(result.timeline.days.map((day) => day.label)).toEqual(["13 ก.ค."]);
  });

  it("QC รับตัวอย่างแล้ว -> คาดการณ์จากจำนวน task (1 task = 1 ชม.)", () => {
    // requiredParameter x 1 ตัวอย่าง = 1 task -> 10:00 + 1 ชม. = 11:00
    const result = model(
      petition({ qcReceivedAt: at(13, 10) }),
      [requiredParameter],
      [],
      [],
      new Date(2026, 6, 13, 10, 30),
    );

    expect(result.header.endAt).toBe(at(13, 11));
    expect(result.header.endKind).toBe("estimated");
  });

  it("งานเลยเวลาคาดการณ์ -> overdue = true และแกนเวลาลากถึงตอนนี้", () => {
    const now = new Date(2026, 6, 13, 15);
    const result = model(petition({ qcReceivedAt: at(13, 10) }), [requiredParameter], [], [], now);

    expect(result.header.endAt).toBe(at(13, 11));
    expect(result.header.overdue).toBe(true);
    // แท่งที่ยังทำอยู่ลากถึง now — แกนต้องไม่จบก่อน now ไม่งั้นแท่งทะลุขอบ
    expect(result.timeline.endAt).toBe(now.toISOString());
  });

  it("คำร้องที่รับตัวอย่างนอกเวลาทำการ (19:14): เวลาคาดการณ์ต้องไม่ย้อนไปก่อนเวลาเริ่ม", () => {
    const now = new Date(2026, 6, 13, 19, 30);
    const result = model(petition({ qcReceivedAt: at(13, 19, 14) }), [requiredParameter], [], [], now);

    expect(result.header.startAt).toBe(at(13, 19, 14));
    // ดันไป 08:00 วันถัดไปก่อน แล้วบวก 1 ชม.
    expect(result.header.endAt).toBe(at(14, 9));
    expect(new Date(result.header.endAt).getTime()).toBeGreaterThanOrEqual(new Date(result.header.startAt).getTime());
  });

  it("expands a same-day completed timeline after 17:00 when actual data is later", () => {
    const result = model(petition({
      status: "approved",
      qcReceivedAt: at(13, 10),
      approvedAt: at(13, 18, 30),
    }));

    expect(result.header.endAt).toBe(at(13, 18, 30));
    expect(result.header.endKind).toBe("actual");
    expect(result.header.overdue).toBe(false);
    expect(result.timeline.endAt).toBe(at(13, 18, 30));
    expect(result.timeline.ticks.at(-1)).toMatchObject({ at: at(13, 18, 30), label: "18:30" });
    // แท็บวัน (ไม่ใช่ header/timeline โดยรวม) ขยายตามกฎ ceil ชั่วโมง: 18:30 -> 19:00
    expect(result.timeline.days[0]).toMatchObject({ startAt: at(13, 8), endAt: at(13, 19) });
  });

  it("splits multi-day timelines into local day windows", () => {
    const result = model(
      petition({
        submittedBy: { name: "Requester", submittedAt: at(12, 9) },
        createdAt: at(12, 9),
        qcReceivedAt: at(12, 10),
        firstResultAt: at(13, 9),
      }),
      [],
      [],
      [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.timeline.days.map((day) => day.label)).toEqual(["12 ก.ค.", "13 ก.ค."]);
    expect(result.timeline.days[0]).toMatchObject({ startAt: at(12, 8), endAt: at(12, 17) });
    expect(result.timeline.days[1]).toMatchObject({ startAt: at(13, 8), endAt: at(13, 17) });
    expect(result.timeline.days[0]?.rows.find((row) => row.key === "submitted")).toMatchObject({ visible: true });
    expect(result.timeline.days[1]?.rows.find((row) => row.key === "submitted")).toMatchObject({ visible: false });
  });

  it("counts received work as the first progress step before required fields are filled", () => {
    const result = model(
      petition({ status: "inProgress", qcReceivedAt: at(13, 10) }),
      [requiredParameter],
      [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: [] }],
    );

    expect(result.progress).toEqual({ filled: 1, total: 5, percent: 20 });
  });

  it("counts received work, required fields, and Pre Result before Final Result", () => {
    const result = model(
      petition({ status: "success", qcReceivedAt: at(13, 10) }),
      [requiredParameter],
      [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity", "Color"] }],
    );

    expect(result.tasks).toMatchObject([{ parameterName: "Required checks", total: 2, filled: 2, state: "recorded" }]);
    expect(result.progress).toEqual({ filled: 4, total: 5, percent: 80 });
  });

  it("reports 100 percent only after Final Result approval and formats parameter result activity", () => {
    const result = model(
      petition({ status: "approved", qcReceivedAt: at(13, 10), approvedAt: at(13, 15) }),
      [requiredParameter],
      [{ itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity", "Color"] }],
      [{
        _id: "audit-1",
        petitionId: "petition-1",
        petitionNo: "P-2607-001",
        event: "resultEntered",
        actor: "Analyst",
        metadata: { parameterName: "Required checks" },
        createdAt: at(13, 11),
      }],
    );

    expect(result.progress).toEqual({ filled: 5, total: 5, percent: 100 });
    expect(result.activities[0]).toMatchObject({ actor: "Analyst", label: expect.stringContaining("Required checks") });
  });

  it("keeps structured assignment and field-level result details in activities", () => {
    const result = model(
      petition(),
      [],
      [],
      [
        {
          _id: "assigned-1",
          petitionId: "petition-1",
          petitionNo: "P-2607-001",
          event: "assigned",
          actor: "QC Lead",
          metadata: { assignee: { name: "Analyst" } },
          createdAt: at(13, 10),
        },
        {
          _id: "result-1",
          petitionId: "petition-1",
          petitionNo: "P-2607-001",
          event: "resultUpdated",
          actor: "Analyst",
          metadata: { parameterName: "Required checks", fieldLabel: "Viscosity", sampleName: "Sample A" },
          createdAt: at(13, 11),
        },
      ],
    );

    expect(result.activities[0]?.label).toContain("Viscosity");
    expect(result.activities[0]?.label).toContain("Sample A");
    expect(result.activities[1]?.label).toContain("Analyst");
  });

  it("ทุกสถานะเป็นช่วงเวลาที่ลากถึงสถานะถัดไป และปิดท้ายด้วยจุด Final Result", () => {
    const result = model(petition({
      status: "approved",
      items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
      submittedBy: { name: "Requester", submittedAt: at(13, 8) },
      createdAt: at(13, 8),
      sampleSentAt: at(13, 8, 30),
      qcReceivedAt: at(13, 9),
      assignedTo: { employeeId: "L001", name: "Lab Analyst", assignedAt: at(13, 9, 30) },
      labReceivedAt: at(13, 10),
      qcCompletedAt: at(13, 13),
      labCompletedAt: at(13, 14),
      labApprovedAt: at(13, 15),
      approvedAt: at(13, 16),
    }), [], [], [], new Date(2026, 6, 13, 17));

    expect(result.timeline.rows).toEqual([
      { key: "submitted", label: "ยื่นคำขอ", kind: "bar", track: "stage", at: null, startAt: at(13, 8), endAt: at(13, 8, 30), done: true },
      { key: "sample-sent", label: "ส่งตัวอย่าง", kind: "bar", track: "stage", at: null, startAt: at(13, 8, 30), endAt: at(13, 9), done: true },
      { key: "assigned", label: "มอบหมายงาน Lab", kind: "bar", track: "lab", at: null, startAt: at(13, 9, 30), endAt: at(13, 10), done: true },
      { key: "qc-analyzing", label: "QC กำลังวิเคราะห์", kind: "bar", track: "qc", at: null, startAt: at(13, 9), endAt: at(13, 13), done: true },
      { key: "lab-analyzing", label: "Lab กำลังวิเคราะห์", kind: "bar", track: "lab", at: null, startAt: at(13, 10), endAt: at(13, 14), done: true },
      { key: "lab-approval", label: "ออกผล Lab", kind: "bar", track: "lab", at: null, startAt: at(13, 14), endAt: at(13, 15), done: true },
      { key: "pre-result", label: "Pre Result", kind: "bar", track: "stage", at: null, startAt: at(13, 14), endAt: at(13, 16), done: true },
      { key: "final", label: "Final Result", kind: "milestone", track: "stage", at: at(13, 16), startAt: null, endAt: null, done: true },
    ]);
  });

  it("แถว ส่งตัวอย่าง จบที่อันที่มาก่อนระหว่าง QC เริ่มวิเคราะห์ กับ มอบหมายงาน Lab", () => {
    const labItem = { seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" };

    const qcFirst = model(petition({
      items: [labItem],
      sampleSentAt: at(13, 8),
      qcReceivedAt: at(13, 9),
      assignedTo: { employeeId: "L001", name: "Lab Analyst", assignedAt: at(13, 11) },
    }));
    expect(qcFirst.timeline.rows.find((row) => row.key === "sample-sent")).toMatchObject({
      startAt: at(13, 8),
      endAt: at(13, 9),
      done: true,
    });

    const assignFirst = model(petition({
      items: [labItem],
      sampleSentAt: at(13, 8),
      assignedTo: { employeeId: "L001", name: "Lab Analyst", assignedAt: at(13, 8, 30) },
      qcReceivedAt: at(13, 11),
    }));
    expect(assignFirst.timeline.rows.find((row) => row.key === "sample-sent")).toMatchObject({
      startAt: at(13, 8),
      endAt: at(13, 8, 30),
      done: true,
    });
  });

  it("คำร้องที่ไม่ได้สแกนส่ง ให้แถว ส่งตัวอย่าง เริ่มที่เวลารับตัวอย่างที่เร็วสุด", () => {
    const result = model(petition({ labReceivedAt: at(13, 11), qcReceivedAt: at(13, 10) }));

    expect(result.timeline.rows.find((row) => row.key === "sample-sent")).toMatchObject({
      startAt: at(13, 10),
      done: true,
    });
  });

  it("มี sampleSentAt จริงแต่ไม่มี qcReceivedAt (มีแค่ qcCompletedAt) → แถว ส่งตัวอย่าง ต้องไม่จบก่อนเริ่ม", () => {
    // qcCompletedAt อย่างเดียวทำให้ qcStartAt ใช้ fallbackStartAt (จุดเริ่มกราฟ) ซึ่งอาจเร็วกว่า sampleSentAt จริง
    // ห้ามให้ fallback นั้นหลุดมาเป็น endAt ของแถวนี้ ไม่งั้นแท่งจะจบก่อนเริ่ม
    const result = model(
      petition({
        submittedBy: { name: "Requester", submittedAt: at(13, 8) },
        createdAt: at(13, 8),
        sampleSentAt: at(13, 8, 30),
        qcCompletedAt: at(13, 11),
      }),
      [], [], [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.timeline.rows.find((row) => row.key === "sample-sent")).toMatchObject({
      startAt: at(13, 8, 30),
      endAt: at(13, 12),
      done: false,
    });
  });

  it("ยังไม่ส่งและยังไม่มีใครรับ → แถว ส่งตัวอย่าง ไม่มีแท่ง", () => {
    const result = model(petition());

    expect(result.timeline.rows.find((row) => row.key === "sample-sent")).toMatchObject({
      startAt: null,
      endAt: null,
      done: false,
    });
  });

  it("แถวที่ยังไม่จบ ลากถึงเวลาปัจจุบันและยังไม่ done", () => {
    const result = model(
      petition({ submittedBy: { name: "Requester", submittedAt: at(13, 9) }, createdAt: at(13, 9) }),
      [], [], [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.timeline.rows.find((row) => row.key === "submitted")).toMatchObject({
      startAt: at(13, 9),
      endAt: at(13, 12),
      done: false,
    });
  });

  it("Pre Result เริ่มเมื่อบันทึกผลครบทั้ง Lab และ QC (เอาอันที่ช้ากว่า)", () => {
    const labItem = { seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" };

    const labLast = model(petition({
      items: [labItem],
      qcReceivedAt: at(13, 9),
      labReceivedAt: at(13, 10),
      qcCompletedAt: at(13, 13),
      labCompletedAt: at(13, 14),
    }), [], [], [], new Date(2026, 6, 13, 16));
    expect(labLast.timeline.rows.find((row) => row.key === "pre-result")).toMatchObject({
      startAt: at(13, 14),
      endAt: at(13, 16),
      done: false,
    });

    const qcLast = model(petition({
      items: [labItem],
      qcReceivedAt: at(13, 9),
      labReceivedAt: at(13, 10),
      labCompletedAt: at(13, 12),
      qcCompletedAt: at(13, 15),
    }), [], [], [], new Date(2026, 6, 13, 16));
    expect(qcLast.timeline.rows.find((row) => row.key === "pre-result")).toMatchObject({
      startAt: at(13, 15),
      endAt: at(13, 16),
      done: false,
    });
  });

  it("Pre Result ยังไม่เริ่ม ถ้ามีแค่ฝั่งเดียวที่บันทึกผลครบ", () => {
    const result = model(petition({
      items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
      qcReceivedAt: at(13, 9),
      labReceivedAt: at(13, 10),
      labCompletedAt: at(13, 14),
    }), [], [], [], new Date(2026, 6, 13, 16));

    expect(result.timeline.rows.find((row) => row.key === "pre-result")).toMatchObject({
      startAt: null,
      endAt: null,
      done: false,
    });
  });

  it("คำร้องที่ไม่มี Lab: ตัดแถวฝั่ง Lab ทิ้ง และ Pre Result เริ่มที่ QC บันทึกผล", () => {
    const result = model(petition({
      status: "approved",
      qcReceivedAt: at(13, 9),
      assignedTo: { employeeId: "L001", name: "Stray Lab Analyst", assignedAt: at(13, 11) },
      qcCompletedAt: at(13, 13),
      approvedAt: at(13, 16),
    }), [], [], [], new Date(2026, 6, 13, 17));

    expect(result.timeline.rows.map((row) => row.key)).toEqual([
      "submitted",
      "sample-sent",
      "qc-analyzing",
      "pre-result",
      "final",
    ]);
    expect(result.timeline.rows.find((row) => row.key === "pre-result")).toMatchObject({
      startAt: at(13, 13),
      endAt: at(13, 16),
      done: true,
    });
  });

  it("แถว ออกผล Lab ลากจาก Lab บันทึกผล ถึง หัวหน้า Lab ออกผล", () => {
    const result = model(petition({
      items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
      qcReceivedAt: at(13, 9),
      labReceivedAt: at(13, 10),
      labCompletedAt: at(13, 14),
      labApprovedAt: at(13, 15),
    }), [], [], [], new Date(2026, 6, 13, 16));

    expect(result.timeline.rows.find((row) => row.key === "lab-approval")).toMatchObject({
      label: "ออกผล Lab",
      kind: "bar",
      track: "lab",
      startAt: at(13, 14),
      endAt: at(13, 15),
      done: true,
    });
  });

  it("คำร้องปิดแล้วแต่ไม่มี labApprovedAt (รูข้อมูลเก่า) → แถว ออกผล Lab จบที่ approvedAt ไม่ลากถึงวันนี้", () => {
    const result = model(petition({
      status: "approved",
      items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
      qcReceivedAt: at(13, 9),
      assignedTo: { employeeId: "L001", name: "Lab Analyst", assignedAt: at(13, 9, 30) },
      labReceivedAt: at(13, 10),
      qcCompletedAt: at(13, 12),
      labCompletedAt: at(13, 13),
      // ไม่มี labApprovedAt โดยตั้งใจ — จำลองคำร้องเก่าที่ยังไม่มีด่านนี้ตอนบันทึก
      approvedAt: at(13, 16),
    }), [], [], [], new Date(2026, 6, 20, 12)); // now = 7 วันหลัง approvedAt

    expect(result.timeline.rows.find((row) => row.key === "lab-approval")).toMatchObject({
      label: "ออกผล Lab",
      kind: "bar",
      track: "lab",
      startAt: at(13, 13),
      endAt: at(13, 16),
      done: false,
    });
  });

  it("จุด Final Result ยังไม่ done เมื่อหัวหน้า QC ยังไม่อนุมัติ", () => {
    const result = model(petition({ qcReceivedAt: at(13, 9), qcCompletedAt: at(13, 13) }));

    expect(result.timeline.rows.find((row) => row.key === "final")).toMatchObject({
      kind: "milestone",
      at: null,
      done: false,
    });
  });

  it("คำร้องที่ถูกส่งกลับแก้ไข: Pre Result จบที่ rejectedAt และจุดปิดท้ายเปลี่ยนชื่อ", () => {
    const result = model(petition({
      status: "rejected",
      qcReceivedAt: at(13, 9),
      qcCompletedAt: at(13, 13),
      rejectedAt: at(13, 14),
    }), [], [], [], new Date(2026, 6, 13, 16));

    expect(result.timeline.rows.find((row) => row.key === "pre-result")).toMatchObject({
      startAt: at(13, 13),
      endAt: at(13, 14),
      done: true,
    });
    expect(result.timeline.rows.find((row) => row.key === "final")).toMatchObject({
      label: "ส่งกลับแก้ไข",
      kind: "milestone",
      at: at(13, 14),
      done: true,
    });
  });

  it("ตัดแถวสถานะเก่า (บันทึกผล / QC ครบ / Lab ครบ) ออกจาก timeline", () => {
    const result = model(petition({ qcReceivedAt: at(13, 9), firstResultAt: at(13, 10), qcCompletedAt: at(13, 12) }));

    expect(result.timeline.rows.map((row) => row.key)).not.toContain("results");
    expect(result.timeline.rows.map((row) => row.key)).not.toContain("qc-completed");
    expect(result.timeline.rows.map((row) => row.key)).not.toContain("lab-completed");
  });

  it("จุดยื่นคำขอขยายช่วง timeline ให้เริ่มก่อนวันรับตัวอย่าง แต่ header ยังนับจากเวลารับ", () => {
    const result = model(
      petition({
        submittedBy: { name: "Requester", submittedAt: at(12, 9) },
        createdAt: at(12, 9),
        qcReceivedAt: at(13, 10),
      }),
      [],
      [],
      [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.header.startAt).toBe(at(13, 10));
    expect(result.header.startKind).toBe("received");
    expect(result.timeline.startAt).toBe(at(12, 8));
    // กราฟลากถึงแค่ตอนนี้ (13 12:00) ไม่ดันไปวันคาดการณ์ (14) — จึงมีแค่ 12 กับ 13
    expect(result.timeline.days.map((day) => day.label)).toEqual(["12 ก.ค.", "13 ก.ค."]);
    expect(result.timeline.days[0]?.rows.find((row) => row.key === "submitted")).toMatchObject({ visible: true });
    expect(result.timeline.rows.find((row) => row.key === "submitted")).toMatchObject({
      startAt: at(12, 9),
      endAt: at(13, 10),
      done: true,
    });
  });

  it("แท่ง QC กำลังวิเคราะห์ ลากจาก QC รับตัวอย่าง ถึงเวลาปัจจุบันเมื่อยังไม่จบ", () => {
    const result = model(petition({ qcReceivedAt: at(13, 9) }), [], [], [], new Date(2026, 6, 13, 12));

    expect(result.timeline.rows.find((row) => row.key === "qc-analyzing")).toMatchObject({
      label: "QC กำลังวิเคราะห์",
      kind: "bar",
      track: "qc",
      startAt: at(13, 9),
      endAt: at(13, 12),
      done: false,
    });
  });

  it("แท่ง QC กำลังวิเคราะห์ จบที่ QC บันทึกครบ", () => {
    const result = model(petition({ qcReceivedAt: at(13, 9), qcCompletedAt: at(13, 11) }), [], [], [], new Date(2026, 6, 13, 12));

    expect(result.timeline.rows.find((row) => row.key === "qc-analyzing")).toMatchObject({
      startAt: at(13, 9),
      endAt: at(13, 11),
      done: true,
    });
  });

  it("แท่ง Lab กำลังวิเคราะห์ เริ่มที่ Lab รับตัวอย่าง และจบที่ Lab บันทึกครบ", () => {
    const labPetition = petition({
      items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
      qcReceivedAt: at(13, 9),
      labReceivedAt: at(13, 10),
    });

    const open = model(labPetition, [], [], [], new Date(2026, 6, 13, 12));
    expect(open.timeline.rows.find((row) => row.key === "lab-analyzing")).toMatchObject({
      label: "Lab กำลังวิเคราะห์",
      track: "lab",
      startAt: at(13, 10),
      endAt: at(13, 12),
      done: false,
    });

    const done = model(
      petition({
        items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
        qcReceivedAt: at(13, 9),
        labReceivedAt: at(13, 10),
        labCompletedAt: at(13, 14),
      }),
      [], [], [],
      new Date(2026, 6, 13, 16),
    );
    expect(done.timeline.rows.find((row) => row.key === "lab-analyzing")).toMatchObject({
      startAt: at(13, 10),
      endAt: at(13, 14),
      done: true,
    });
  });

  it("ยังไม่รับตัวอย่าง → ไม่วาดแท่งวิเคราะห์ของฝั่งนั้น", () => {
    const result = model(
      petition({
        items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
        qcReceivedAt: at(13, 9),
      }),
      [], [], [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.timeline.rows.find((row) => row.key === "lab-analyzing")).toMatchObject({
      startAt: null,
      endAt: null,
      done: false,
    });
  });

  it("QC มี qcCompletedAt แต่ไม่มีเวลารับตัวอย่าง → แท่ง QC วิเคราะห์ ใช้จุดเริ่มกราฟเป็น fallback", () => {
    const result = model(
      petition({ qcCompletedAt: at(13, 11) }),
      [], [], [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.timeline.rows.find((row) => row.key === "qc-analyzing")).toMatchObject({
      startAt: at(13, 9),
      endAt: at(13, 11),
      done: true,
    });
  });

  it("Lab มี labCompletedAt แต่ไม่มี labReceivedAt → แท่ง Lab วิเคราะห์ เริ่มที่ assignedTo.assignedAt", () => {
    const result = model(
      petition({
        items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
        assignedTo: { employeeId: "L001", name: "Lab Analyst", assignedAt: at(13, 10) },
        labCompletedAt: at(13, 14),
      }),
      [], [], [],
      new Date(2026, 6, 13, 16),
    );

    expect(result.timeline.rows.find((row) => row.key === "lab-analyzing")).toMatchObject({
      startAt: at(13, 10),
      endAt: at(13, 14),
      done: true,
    });
  });

  it("ยังไม่รับตัวอย่างและยังไม่จบฝั่ง QC (ไม่มีทั้ง receivedAt และ completedAt) → ไม่วาดแท่ง qc-analyzing แม้มี fallback", () => {
    const result = model(petition(), [], [], [], new Date(2026, 6, 13, 12));

    expect(result.timeline.rows.find((row) => row.key === "qc-analyzing")).toMatchObject({
      startAt: null,
      endAt: null,
      done: false,
    });
  });

  it("qcTaskCount ที่ใช้คาดการณ์ นับเฉพาะ parameter สโคป QC — สโคป lab ไม่ถูกนับซ้ำเข้า QC candidate", () => {
    const labItem = { seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" };
    const qcScopeParameter: ParameterItem = {
      _id: "parameter-qc",
      name: "QC check",
      scope: "qc",
      status: "active",
      applyAll: true,
      valueFields: [{ label: "Viscosity", type: "number", required: true }],
    };
    const labScopeParameter: ParameterItem = {
      _id: "parameter-lab",
      name: "Lab check",
      scope: "lab",
      status: "active",
      applyAll: true,
      valueFields: [{ label: "Assay", type: "number", required: true }],
    };

    const result = model(
      petition({ items: [labItem], qcReceivedAt: at(13, 9) }),
      [qcScopeParameter, labScopeParameter],
      [],
      [],
      new Date(2026, 6, 13, 9, 30),
    );

    // progress ยังนับทั้งสอง scope เหมือนเดิม (ไม่แตะพฤติกรรมนี้)
    expect(result.tasks).toHaveLength(2);
    // ถ้านับผิดเป็น 2 task -> 09:00 + 2x60 = 11:00; ที่ถูกคือนับแค่ QC 1 task -> 09:00 + 60 = 10:00
    expect(result.header.endAt).toBe(at(13, 10));
  });

  it("R&D timeline tasks show lab parameters only and still match items without lab batch numbers", () => {
    const researchItem = { seq: 1, sampleName: "Research Sample", batchNo: "", sampleId: "sample-rd" };
    const labScopeParameter: ParameterItem = {
      _id: "parameter-lab",
      name: "Lab assay",
      scope: "lab",
      status: "active",
      applyAll: true,
      valueFields: [{ label: "Assay", type: "number", required: true }],
    };
    const qcSharedParameter: ParameterItem = {
      _id: "parameter-qc",
      name: "กายภาพ",
      scope: "qc",
      shareWithLab: true,
      status: "active",
      applyAll: true,
      valueFields: [{ label: "Appearance", type: "text", required: true }],
    };

    const result = model(
      petition({
        submittedBy: { name: "R&D Requester", department: "R & D", submittedAt: at(13, 9) },
        items: [researchItem],
        labReceivedAt: at(13, 10),
      }),
      [labScopeParameter, qcSharedParameter],
      [],
      [],
      new Date(2026, 6, 13, 10, 30),
    );

    expect(result.tasks.map((task) => task.parameterName)).toEqual(["Lab assay"]);
    expect(result.tasks[0]).toMatchObject({ scope: "lab", itemSeq: 1, total: 1 });
  });

  it("ไม่มีแถวราย parameter ใน timeline อีกต่อไป", () => {
    const result = model(petition({ qcReceivedAt: at(13, 9) }), [requiredParameter], [], []);

    expect(result.timeline.rows.some((row) => row.key.startsWith("param::"))).toBe(false);
    expect(result.tasks).toHaveLength(1);
  });

  it("ทุกแท็บวันมีครบทุกแถว เพื่อให้ลำดับแถวไม่ขยับ", () => {
    const result = model(
      petition({ qcReceivedAt: at(12, 10), qcCompletedAt: at(13, 9) }),
      [requiredParameter],
      [],
      [],
      new Date(2026, 6, 13, 12),
    );

    const keysByDay = result.timeline.days.map((day) => day.rows.map((row) => row.key));
    expect(keysByDay[0]).toEqual(result.timeline.rows.map((row) => row.key));
    expect(keysByDay[1]).toEqual(result.timeline.rows.map((row) => row.key));
  });

  it("ตัดแท่งที่กินข้ามวันให้พอดีหน้าต่างของแต่ละวัน พร้อมบอกว่าต่อเนื่อง", () => {
    const result = model(
      petition({ qcReceivedAt: at(12, 10), qcCompletedAt: at(13, 11) }),
      [],
      [],
      [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.timeline.days[0]?.rows.find((row) => row.key === "qc-analyzing")).toMatchObject({
      visible: true,
      segmentStartAt: at(12, 10),
      segmentEndAt: at(12, 17),
      continuesBefore: false,
      continuesAfter: true,
    });

    expect(result.timeline.days[1]?.rows.find((row) => row.key === "qc-analyzing")).toMatchObject({
      visible: true,
      segmentStartAt: at(13, 8),
      segmentEndAt: at(13, 11),
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it("แถวที่ไม่มีแท่งหรือจุดในวันนั้น ได้ visible = false", () => {
    const result = model(petition({
      items: [{ seq: 1, sampleName: "Lab Sample", batchNo: "BATCH-001", sampleId: "sample-1" }],
      qcReceivedAt: at(13, 9),
    }));

    expect(result.timeline.days[0]?.rows.find((row) => row.key === "lab-analyzing")).toMatchObject({
      visible: false,
      segmentStartAt: null,
      segmentEndAt: null,
    });
  });

  it("แท่ง ยื่นคำขอ ที่เริ่มนอกเวลาทำการ (18:30) ไม่หายไป — วันนั้นขยายหน้าต่างให้ครอบคลุม แล้วยังต่อเนื่องไปแท็บวันถัดไปด้วย", () => {
    const result = model(
      petition({
        submittedBy: { name: "Requester", submittedAt: at(13, 18, 30) },
        createdAt: at(13, 18, 30),
        qcReceivedAt: at(14, 9),
      }),
      [], [], [],
      new Date(2026, 6, 14, 12),
    );

    // กราฟลากถึงแค่ตอนนี้ (14 12:00) ไม่ดันไปวันคาดการณ์ (15) — จึงมีแค่ 13 กับ 14
    expect(result.timeline.days.map((day) => day.label)).toEqual(["13 ก.ค.", "14 ก.ค."]);
    // วันที่ 13 มีกิจกรรมนอกเวลาทำการ (เริ่ม 18:30) หน้าต่างของวันนั้นจึงขยายถึง 19:00 (ceil ชั่วโมง)
    // แท่งเลยโผล่ในวันที่ 13 เอง (ไม่ใช่แค่วันถัดไป) และยังลากต่อเนื่องข้ามไปวันที่ 14 ด้วย
    expect(result.timeline.days[0]).toMatchObject({ endAt: at(13, 19) });
    expect(result.timeline.days[0]?.rows.find((row) => row.key === "submitted")).toMatchObject({
      visible: true,
      segmentStartAt: at(13, 18, 30),
      segmentEndAt: at(13, 19),
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(result.timeline.days[1]?.rows.find((row) => row.key === "submitted")).toMatchObject({ visible: true });
  });

  it("วันที่มีกิจกรรมนอกเวลาทำการตอนเย็น (19:14) หน้าต่างของวันนั้นขยายไปถึง 20:00 พร้อม ticks 19:00/20:00", () => {
    const result = model(
      petition({
        submittedBy: { name: "Requester", submittedAt: at(13, 19, 14) },
        createdAt: at(13, 19, 14),
        qcReceivedAt: at(14, 9),
      }),
      [], [], [],
      new Date(2026, 6, 14, 12),
    );

    expect(result.timeline.days[0]).toMatchObject({ endAt: at(13, 20) });
    expect(result.timeline.days[0]?.ticks.map((tick) => tick.label)).toEqual(expect.arrayContaining(["19:00", "20:00"]));
    expect(result.timeline.days[0]?.rows.find((row) => row.key === "submitted")).toMatchObject({
      visible: true,
      segmentStartAt: at(13, 19, 14),
    });
  });

  it("วันที่มีกิจกรรมเช้ามืดก่อนเวลาทำการ (06:30) หน้าต่างของวันนั้นขยายให้เริ่มที่ 06:00", () => {
    const result = model(
      petition({
        submittedBy: { name: "Requester", submittedAt: at(13, 6, 30) },
        createdAt: at(13, 6, 30),
        qcReceivedAt: at(13, 9),
      }),
      [], [], [],
      new Date(2026, 6, 13, 12),
    );

    expect(result.timeline.days[0]).toMatchObject({ startAt: at(13, 6) });
    expect(result.timeline.days[0]?.rows.find((row) => row.key === "submitted")).toMatchObject({
      visible: true,
      segmentStartAt: at(13, 6, 30),
    });
  });

  it("งานที่ยังไม่ปิดและเปิดดูหลัง 17:00: แท็บวันสุดท้ายไม่ขยายตามเวลาปัจจุบัน (now ไม่ใช่ timestamp จริง)", () => {
    // เวลาปัจจุบันไม่ใช่เหตุการณ์ที่บันทึกไว้ — ห้ามขยายหน้าต่างวัน (กฎเดียวกับ rowTimestampsOnDay)
    // ไม่งั้นเปิดดูตอนไหน หน้าต่างของวันนี้ก็ยืดตามไปเรื่อย ๆ
    const result = model(
      petition({
        submittedBy: { name: "Requester", submittedAt: at(12, 9) },
        createdAt: at(12, 9),
        qcReceivedAt: at(12, 10),
      }),
      [], [], [],
      new Date(2026, 6, 13, 19, 30),
    );

    expect(result.timeline.endAt).toBe(at(13, 19, 30));
    expect(result.timeline.days.at(-1)).toMatchObject({ startAt: at(13, 8), endAt: at(13, 17) });
  });

  it("วันที่กิจกรรมทั้งหมดอยู่ในเวลาทำการ ยังคงได้หน้าต่าง 08:00–17:00 พอดี (ไม่ regress)", () => {
    const result = model(petition({ qcReceivedAt: at(13, 10) }), [], [], [], new Date(2026, 6, 13, 12));

    expect(result.timeline.days[0]).toMatchObject({ startAt: at(13, 8), endAt: at(13, 17) });
  });

  const twoItemPetition = () => petition({
    qcReceivedAt: at(13, 9),
    items: [
      { seq: 1, sampleName: "Sample A", commonName: "ABAMECTIN 1.8% EC", batchNo: "BATCH-002", sampleId: "sample-1" },
      { seq: 2, sampleName: "Sample B", commonName: "EMAMECTIN 1.9% EC", batchNo: "BATCH-003", sampleId: "sample-2" },
    ],
  });

  it("กรอง tasks เหลือเฉพาะตัวอย่างที่เลือก โดยไม่มีผลกับแถว timeline", () => {
    const parameterForA: ParameterItem = {
      _id: "parameter-a",
      name: "Assay A",
      scope: "qc",
      status: "active",
      applyAll: false,
      fullCommonNames: ["ABAMECTIN 1.8% EC"],
      valueFields: [
        { label: "Viscosity", type: "number", required: true },
        { label: "Color", type: "text", required: true },
      ],
    };
    const parameterForB: ParameterItem = {
      _id: "parameter-b",
      name: "Assay B",
      scope: "qc",
      status: "active",
      applyAll: false,
      fullCommonNames: ["EMAMECTIN 1.9% EC"],
      valueFields: [
        { label: "Viscosity", type: "number", required: true },
        { label: "Color", type: "text", required: true },
      ],
    };

    const unfiltered = model(twoItemPetition(), [parameterForA, parameterForB], [], [], new Date(2026, 6, 13, 12), null);
    expect(unfiltered.tasks).toHaveLength(2);

    const result = model(
      twoItemPetition(),
      [parameterForA, parameterForB],
      [{ itemSeq: 2, parameterId: "parameter-b", filledLabels: ["Viscosity"] }],
      [],
      new Date(2026, 6, 13, 12),
      2,
    );

    expect(result.tasks).toMatchObject([{ key: "2::parameter-b", itemSeq: 2, sampleName: "Sample B", filled: 1, total: 2 }]);
    expect(result.timeline.rows.map((row) => row.key)).toEqual(unfiltered.timeline.rows.map((row) => row.key));
  });

  it("progress เป็นของตัวอย่างที่เลือก ส่วน overallProgress รวมทุกตัวอย่าง", () => {
    const result = model(
      twoItemPetition(),
      [requiredParameter],
      [
        { itemSeq: 1, parameterId: "parameter-1", filledLabels: ["Viscosity", "Color"] },
        { itemSeq: 2, parameterId: "parameter-1", filledLabels: [] },
      ],
      [],
      new Date(2026, 6, 13, 12),
      1,
    );

    expect(result.progress).toEqual({ filled: 3, total: 5, percent: 60 });
    expect(result.overallProgress).toEqual({ filled: 3, total: 7, percent: 43 });
  });

  it("แถว timeline และแท็บวัน เหมือนกันทุกตัวอย่างที่เลือก", () => {
    // batchNo ลงท้าย 1/6 → hasLabTrack จริง เพื่อให้แถวฝั่ง Lab ถูกสร้างขึ้นมาจริง
    const labTrackPetition = () => petition({
      status: "approved",
      items: [
        { seq: 1, sampleName: "Sample A", commonName: "ABAMECTIN 1.8% EC", batchNo: "BATCH-001", sampleId: "sample-1" },
        { seq: 2, sampleName: "Sample B", commonName: "EMAMECTIN 1.9% EC", batchNo: "BATCH-006", sampleId: "sample-2" },
      ],
      qcReceivedAt: at(13, 9),
      labReceivedAt: at(13, 10),
      assignedTo: { employeeId: "L001", name: "Lab Analyst", assignedAt: at(13, 9, 30) },
      labCompletedAt: at(13, 14),
      labApprovedAt: at(13, 15),
      qcCompletedAt: at(13, 13),
      approvedAt: at(13, 16),
    });

    const build = (itemSeq: number | null) => model(
      labTrackPetition(),
      [requiredParameter],
      [],
      [],
      new Date(2026, 6, 13, 17),
      itemSeq,
    );

    const expectedRows = [
      { key: "submitted", label: "ยื่นคำขอ", kind: "bar", track: "stage", at: null, startAt: at(13, 9), endAt: at(13, 9), done: true },
      { key: "sample-sent", label: "ส่งตัวอย่าง", kind: "bar", track: "stage", at: null, startAt: at(13, 9), endAt: at(13, 9), done: true },
      { key: "assigned", label: "มอบหมายงาน Lab", kind: "bar", track: "lab", at: null, startAt: at(13, 9, 30), endAt: at(13, 10), done: true },
      { key: "qc-analyzing", label: "QC กำลังวิเคราะห์", kind: "bar", track: "qc", at: null, startAt: at(13, 9), endAt: at(13, 13), done: true },
      { key: "lab-analyzing", label: "Lab กำลังวิเคราะห์", kind: "bar", track: "lab", at: null, startAt: at(13, 10), endAt: at(13, 14), done: true },
      { key: "lab-approval", label: "ออกผล Lab", kind: "bar", track: "lab", at: null, startAt: at(13, 14), endAt: at(13, 15), done: true },
      { key: "pre-result", label: "Pre Result", kind: "bar", track: "stage", at: null, startAt: at(13, 14), endAt: at(13, 16), done: true },
      { key: "final", label: "Final Result", kind: "milestone", track: "stage", at: at(13, 16), startAt: null, endAt: null, done: true },
    ];

    expect(build(1).timeline.rows).toEqual(expectedRows);
    expect(build(2).timeline.rows).toEqual(expectedRows);
    expect(build(null).timeline.rows).toEqual(expectedRows);
    expect(build(1).timeline.days.map((day) => day.key)).toEqual(build(2).timeline.days.map((day) => day.key));
  });

  it("คืนรายการแท็บครบทุกตัวอย่าง โดยใช้ commonName เป็นป้ายแท็บ", () => {
    const result = model(petition({
      qcReceivedAt: at(13, 9),
      items: [
        { seq: 1, sampleName: "Sample A", commonName: "ABAMECTIN 1.8% EC", batchNo: "BATCH-002", sampleId: "sample-1" },
        { seq: 2, sampleName: "Sample B", commonName: "EMAMECTIN 1.9% EC", batchNo: "BATCH-003", sampleId: "sample-2" },
      ],
    }));

    expect(result.items).toEqual([
      { seq: 1, label: "ABAMECTIN 1.8% EC", commonName: "ABAMECTIN 1.8% EC", batchNo: "BATCH-002", sampleName: "Sample A" },
      { seq: 2, label: "EMAMECTIN 1.9% EC", commonName: "EMAMECTIN 1.9% EC", batchNo: "BATCH-003", sampleName: "Sample B" },
    ]);
  });

  it("ป้ายแท็บถอยไปใช้ sampleName แล้วค่อย ตัวอย่างที่ N เมื่อไม่มี commonName", () => {
    const result = model(petition({
      qcReceivedAt: at(13, 9),
      items: [
        { seq: 1, sampleName: "Sample A", batchNo: "BATCH-002", sampleId: "sample-1" },
        { seq: 2, sampleName: "", batchNo: "", sampleId: "sample-2" },
      ],
    }));

    expect(result.items.map((item) => item.label)).toEqual(["Sample A", "ตัวอย่างที่ 2"]);
    expect(result.items[1]).toMatchObject({ commonName: "", batchNo: "", sampleName: "" });
  });

  it("คำขอที่ไม่มีตัวอย่างเลย คืนรายการแท็บว่าง", () => {
    const result = model(petition({ qcReceivedAt: at(13, 9), items: [] }));

    expect(result.items).toEqual([]);
  });
});
