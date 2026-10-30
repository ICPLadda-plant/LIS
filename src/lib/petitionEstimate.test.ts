import { describe, expect, it } from "vitest";
import { addWorkingMinutes, endOfNextWorkingDay, estimatePetitionEnd, LAB_WORK_END_HOUR, resolveLabExpected } from "./petitionEstimate";
import type { Petition } from "@/types/petition.types";

// ปฏิทินอ้างอิง: 13 ก.ค. 2026 = จันทร์, 18 ก.ค. = เสาร์, 19 ก.ค. = อาทิตย์
const at = (day: number, hour: number, minute = 0) => new Date(2026, 6, day, hour, minute);

describe("addWorkingMinutes", () => {
  it("บวกภายในวันเดียวกันเมื่อเวลายังเหลือพอ", () => {
    expect(addWorkingMinutes(at(13, 9), 120)).toEqual(at(13, 11));
  });

  it("ข้ามไปวันทำการถัดไปเมื่อเวลาไม่พอ (16:00 + 3 ชม. -> 10:00 วันถัดไป)", () => {
    expect(addWorkingMinutes(at(13, 16), 180)).toEqual(at(14, 10));
  });

  it("ตกพอดี 17:00 -> คืน 17:00 ของวันเดียวกัน ไม่ข้ามไปวันถัดไป (16:00 + 1 ชม.)", () => {
    expect(addWorkingMinutes(at(13, 16), 60)).toEqual(at(13, 17));
  });

  it("เริ่มก่อนเวลางาน ให้ดันไป 08:00 ของวันเดียวกันก่อน", () => {
    expect(addWorkingMinutes(at(13, 6, 30), 60)).toEqual(at(13, 9));
  });

  it("เริ่มหลังเลิกงาน ให้ดันไป 08:00 ของวันถัดไปก่อน", () => {
    expect(addWorkingMinutes(at(13, 19, 14), 60)).toEqual(at(14, 9));
  });

  it("เสาร์เป็นวันทำงานปกติ", () => {
    expect(addWorkingMinutes(at(18, 9), 60)).toEqual(at(18, 10));
  });

  it("ข้ามวันอาทิตย์ (เสาร์ 16:00 + 2 ชม. -> จันทร์ 09:00)", () => {
    expect(addWorkingMinutes(at(18, 16), 120)).toEqual(at(20, 9));
  });

  it("เริ่มวันอาทิตย์ ให้ดันไป 08:00 วันจันทร์ก่อน", () => {
    expect(addWorkingMinutes(at(19, 10), 60)).toEqual(at(20, 9));
  });

  it("ข้ามหลายวัน (9 ชม./วัน)", () => {
    // 08:00 จันทร์ + 20 ชม. = 9 (จ.) + 9 (อ.) + 2 -> พุธ 10:00
    expect(addWorkingMinutes(at(13, 8), 20 * 60)).toEqual(at(15, 10));
  });

  it("นาที <= 0 คืนเวลาหลังดันเข้าหน้าต่างทำงานแล้ว", () => {
    expect(addWorkingMinutes(at(13, 6), 0)).toEqual(at(13, 8));
    expect(addWorkingMinutes(at(13, 10), -30)).toEqual(at(13, 10));
  });

  it("ไม่แก้ค่า Date ที่รับเข้ามา", () => {
    const input = at(13, 9);
    addWorkingMinutes(input, 120);
    expect(input).toEqual(at(13, 9));
  });
});

describe("endOfNextWorkingDay", () => {
  it("คืน 17:00 ของวันทำการถัดไป", () => {
    expect(endOfNextWorkingDay(at(13, 10, 15))).toEqual(at(14, 17));
  });

  it("จากวันศุกร์ไปวันเสาร์ (เสาร์ทำงาน)", () => {
    expect(endOfNextWorkingDay(at(17, 10))).toEqual(at(18, 17));
  });

  it("จากวันเสาร์ ข้ามอาทิตย์ไปจันทร์", () => {
    expect(endOfNextWorkingDay(at(18, 10))).toEqual(at(20, 17));
  });

  it("จากวันอาทิตย์ ไปจันทร์", () => {
    expect(endOfNextWorkingDay(at(19, 10))).toEqual(at(20, 17));
  });
});

function petition(overrides: Partial<Petition> = {}): Petition {
  return {
    _id: "petition-1",
    petitionNo: "P-2607-001",
    dept: "production",
    status: "inProgress",
    submittedBy: { name: "Requester", submittedAt: at(13, 9).toISOString() },
    items: [{ seq: 1, sampleName: "Sample A", batchNo: "BATCH-002", sampleId: "sample-1" }],
    createdAt: at(13, 9).toISOString(),
    updatedAt: at(13, 9).toISOString(),
    ...overrides,
  } as Petition;
}

// batchNo ลงท้าย 1 หรือ 6 = คำขอมีฝั่ง Lab (hasLabTrack)
const startedLab = (day: number, hour: number, minute = 0) => ({ employeeId: "E1", name: "Lab A", acceptedAt: at(day, hour, minute).toISOString() });
const labItem = { seq: 1, sampleName: "Sample A", batchNo: "BATCH-001", sampleId: "sample-1" };

describe("estimatePetitionEnd", () => {
  it("ยังไม่รับงานทั้งสองฝั่ง -> unreceived + 17:00 ของวันทำการถัดไปจากเวลายื่นคำขอ", () => {
    const result = estimatePetitionEnd({ petition: petition(), qcTaskCount: 3, now: at(13, 12) });

    expect(result.kind).toBe("unreceived");
    expect(result.at).toBe(at(14, 17).toISOString());
  });

  it("ยังไม่รับงาน แต่มีเวลาส่งตัวอย่าง -> นับจากเวลาส่งตัวอย่าง", () => {
    const result = estimatePetitionEnd({
      petition: petition({ sampleSentAt: at(15, 9).toISOString() }),
      qcTaskCount: 3,
      now: at(15, 12),
    });

    expect(result.at).toBe(at(16, 17).toISOString());
  });

  it("QC รับงานแล้ว -> เวลารับ + (จำนวน task x 60 นาที)", () => {
    const result = estimatePetitionEnd({
      petition: petition({ qcReceivedAt: at(13, 9).toISOString() }),
      qcTaskCount: 3,
      now: at(13, 10),
    });

    expect(result.kind).toBe("estimated");
    expect(result.at).toBe(at(13, 12).toISOString());
  });

  it("ใช้ receivedAt เป็น fallback ของ qcReceivedAt เมื่อไม่มี timestamp ฝั่งไหนเลย (ใบเก่าก่อนแยก Lab/QC)", () => {
    const result = estimatePetitionEnd({
      petition: petition({ receivedAt: at(13, 9).toISOString() }),
      qcTaskCount: 2,
      now: at(13, 10),
    });

    expect(result.at).toBe(at(13, 11).toISOString());
  });

  it("Lab รับแล้วแต่ QC ยังไม่รับ -> คิดจาก Lab ฝั่งเดียว (receivedAt เป็นเวลาที่ Lab สแกน ไม่ใช่ QC ห้ามปั้น QC candidate)", () => {
    const result = estimatePetitionEnd({
      petition: petition({
        items: [labItem],
        labReceivedAt: at(13, 9).toISOString(),
        assignedTo: startedLab(13, 9),
        receivedAt: at(13, 9).toISOString(),
        assignedMachines: [{ machineId: "m1", code: "GC-01", name: "GC 1", estimatedMinutes: 90 }],
      }),
      qcTaskCount: 5, // ถ้า bug เดิมยังอยู่ receivedAt จะถูกใช้เป็น qcReceivedAt -> 5 x 60 = 300 นาที ผิด
      now: at(13, 10),
    });

    expect(result.kind).toBe("estimated");
    // Lab เท่านั้น: 09:00 + 90 นาที = 10:30 (ไม่ใช่ QC candidate ที่ 14:00)
    expect(result.at).toBe(at(13, 10, 30).toISOString());
  });

  it("Lab รับงานแล้ว -> เวลารับ + standard time ของเครื่องที่นานที่สุด", () => {
    const result = estimatePetitionEnd({
      petition: petition({
        items: [labItem],
        labReceivedAt: at(13, 9).toISOString(),
        assignedTo: startedLab(13, 9),
        assignedMachines: [
          { machineId: "m1", code: "GC-01", name: "GC 1", estimatedMinutes: 90 },
          { machineId: "m2", code: "GC-02", name: "GC 2", estimatedMinutes: 300 },
        ],
      }),
      qcTaskCount: 0,
      now: at(13, 10),
    });

    // 09:00 + 300 นาที = 14:00 (ไม่ใช่ผลรวม 390 นาที)
    expect(result.at).toBe(at(13, 14).toISOString());
  });

  it("เครื่องที่ไม่มี standard time นับเป็น 240 นาที", () => {
    const result = estimatePetitionEnd({
      petition: petition({
        items: [labItem],
        labReceivedAt: at(13, 9).toISOString(),
        assignedTo: startedLab(13, 9),
        assignedMachines: [{ machineId: "m1", code: "HPLC-01", name: "HPLC 1" }],
      }),
      qcTaskCount: 0,
      now: at(13, 10),
    });

    expect(result.at).toBe(at(13, 13).toISOString());
  });

  it("Lab รับงานแล้วแต่ไม่มีเครื่อง -> 240 นาที", () => {
    const result = estimatePetitionEnd({
      petition: petition({ items: [labItem], labReceivedAt: at(13, 9).toISOString(), assignedTo: startedLab(13, 9) }),
      qcTaskCount: 0,
      now: at(13, 10),
    });

    expect(result.at).toBe(at(13, 13).toISOString());
  });

  it("รับครบสองฝั่ง -> เอาฝั่งที่นานที่สุด", () => {
    const result = estimatePetitionEnd({
      petition: petition({
        items: [labItem],
        qcReceivedAt: at(13, 9).toISOString(),
        labReceivedAt: at(13, 9).toISOString(),
        assignedTo: startedLab(13, 9),
        assignedMachines: [{ machineId: "m1", code: "GC-01", name: "GC 1", estimatedMinutes: 60 }],
      }),
      qcTaskCount: 4, // QC = 4 ชม. -> 13:00 ; Lab = 1 ชม. -> 10:00
      now: at(13, 10),
    });

    expect(result.at).toBe(at(13, 13).toISOString());
  });

  it("QC รับแล้วแต่ Lab ยังไม่รับ -> คิดจาก QC ฝั่งเดียว (ไม่เดาฝั่งที่ยังไม่รับ)", () => {
    const result = estimatePetitionEnd({
      petition: petition({
        items: [labItem],
        qcReceivedAt: at(13, 9).toISOString(),
        assignedMachines: [{ machineId: "m1", code: "GC-01", name: "GC 1", estimatedMinutes: 600 }],
      }),
      qcTaskCount: 1,
      now: at(13, 10),
    });

    expect(result.kind).toBe("estimated");
    expect(result.at).toBe(at(13, 10).toISOString());
  });

  it("รับงานแล้วแต่ไม่มี parameter และไม่มีฝั่ง Lab -> 17:00 ของวันทำการถัดไปจากเวลารับงาน", () => {
    const result = estimatePetitionEnd({
      petition: petition({ qcReceivedAt: at(13, 10, 15).toISOString() }),
      qcTaskCount: 0,
      now: at(13, 12),
    });

    expect(result.kind).toBe("estimated");
    expect(result.at).toBe(at(14, 17).toISOString());
  });

  it("รับงานนอกเวลาทำการ -> ดันไปเริ่ม 08:00 วันถัดไปก่อนบวก", () => {
    const result = estimatePetitionEnd({
      petition: petition({ qcReceivedAt: at(13, 19, 14).toISOString() }),
      qcTaskCount: 2,
      now: at(13, 19, 30),
    });

    expect(result.at).toBe(at(14, 10).toISOString());
  });
});
+
describe("Lab Standard Time หลังกดเริ่มงาน", () => {
  const machine = (code: string, estimatedMinutes?: number) => ({ machineId: code, code, name: code, estimatedMinutes });

  it("Lab รับตัวอย่างแล้วแต่ยังไม่กดเริ่มงาน -> waiting (รอเริ่มงาน)", () => {
    const result = estimatePetitionEnd({
      petition: petition({ items: [labItem], labReceivedAt: at(13, 9).toISOString(), assignedMachines: [machine("GC-01", 90)] }),
      qcTaskCount: 0,
      now: at(13, 12),
    });
    expect(result.kind).toBe("waiting");
  });

  it("นับต่อได้ถึง 21:00 แล้วยกส่วนที่เหลือไป 08:00 วันทำการถัดไป (19:00 + 4 ชม. -> 10:00)", () => {
    const result = resolveLabExpected(petition({
      items: [labItem], labReceivedAt: at(13, 9).toISOString(),
      assignedTo: startedLab(13, 19), assignedMachines: [machine("GC-01", 240)],
    }));
    expect(result?.at).toEqual(at(14, 10));
  });

  it("กดเริ่มงาน 16:00 + 3 ชม. -> 19:00 วันเดียวกัน", () => {
    expect(addWorkingMinutes(at(13, 16), 180, LAB_WORK_END_HOUR)).toEqual(at(13, 19));
  });

  it("เสาร์เกิน 21:00 ข้ามอาทิตย์ไปจันทร์ 08:00", () => {
    expect(addWorkingMinutes(at(18, 20), 120, LAB_WORK_END_HOUR)).toEqual(at(20, 9));
  });

  it("เครื่องที่นานที่สุดไม่มี Standard Time -> ใช้ 240 นาทีและติดธง approximate", () => {
    const result = estimatePetitionEnd({
      petition: petition({
        items: [labItem], labReceivedAt: at(13, 9).toISOString(),
        assignedTo: startedLab(13, 9), assignedMachines: [machine("GC-01", 60), machine("HPLC-01")],
      }),
      qcTaskCount: 0,
      now: at(13, 10),
    });
    expect(result.at).toBe(at(13, 13).toISOString());
    expect(result.approximate).toBe(true);
  });

  it("Re-check ที่ยังไม่ออกผล -> เริ่มนับใหม่จากเวลาสั่ง Re-check ด้วยเครื่องจาก snapshot เดิม", () => {
    const result = resolveLabExpected(petition({
      items: [labItem], labReceivedAt: at(13, 9).toISOString(),
      labRecheckRequestedAt: at(14, 10).toISOString(), labApprovedAt: null,
      assignedMachines: [],
      labExpected: {
        startedAt: at(13, 9).toISOString(), at: at(13, 11).toISOString(), minutes: 120, estimated: false,
        basis: [{ code: "GC-01", minutes: 120, source: "standard" }],
      },
    }));
    expect(result?.at).toEqual(at(14, 12));
  });

  it("ใช้ค่าที่บันทึกไว้เมื่อจุดเริ่มนับตรงกัน (ไม่เปลี่ยนตามตาราง Standard Time ใหม่)", () => {
    const result = resolveLabExpected(petition({
      items: [labItem], labReceivedAt: at(13, 9).toISOString(),
      assignedTo: startedLab(13, 9), assignedMachines: [machine("GC-01", 600)],
      labExpected: {
        startedAt: at(13, 9).toISOString(), at: at(13, 11).toISOString(), minutes: 120, estimated: false,
        basis: [{ code: "GC-01", minutes: 120, source: "standard" }],
      },
    }));
    expect(result?.at).toEqual(at(13, 11));
  });
});

