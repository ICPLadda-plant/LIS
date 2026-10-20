import { describe, it, expect } from "vitest";
import { buildApprovalGroups, filterApprovalGroupsByScope } from "./qcApprovalRows";
import type { ParameterItem } from "@/lib/api";
import type { Petition, QCTestResult } from "@/types/petition.types";

const param = (over: Partial<ParameterItem> = {}): ParameterItem => ({
  _id: "p1",
  name: "density",
  scope: "qc",
  applyAll: true,
  valueFields: [
    { label: "ค่า", type: "number", standardOperator: "between", standardValue: 10, standardValue2: 20, unit: "g" },
  ],
  ...(over as ParameterItem),
});

const petition = (): Petition => ({
  _id: "pet1",
  petitionNo: "Q-001",
  status: "success",
  dept: "rm",
  items: [
    { seq: 1, sampleName: "ตัวอย่าง A", commonName: "density", sampleId: "S1", batchNo: "B1", testItems: "density" },
  ],
} as unknown as Petition);

const result = (value: unknown): QCTestResult => ({
  itemSeq: 1,
  parameterId: "p1",
  parameterName: "ความหนาแน่น",
  values: { ค่า: value },
} as unknown as QCTestResult);

describe("buildApprovalGroups", () => {
  it("จับคู่พารามิเตอร์ + เติมค่าที่บันทึก + เกณฑ์มาตรฐาน", () => {
    const groups = buildApprovalGroups(petition(), [param()], [result(15)], new Map());
    expect(groups).toHaveLength(1);
    const row = groups[0].params[0].rows[0];
    expect(row.value).toBe("15");
    expect(row.standardText).toBe("10 - 20 g");
    expect(row.abnormal).toBe(false);
  });

  it("ตั้งธง abnormal เมื่อค่าหลุดเกณฑ์", () => {
    const groups = buildApprovalGroups(petition(), [param()], [result(99)], new Map());
    expect(groups[0].params[0].rows[0].abnormal).toBe(true);
  });

  it("ค่าว่างเมื่อไม่มีผลบันทึก", () => {
    const groups = buildApprovalGroups(petition(), [param()], [], new Map());
    expect(groups[0].params[0].rows[0].value).toBe("");
  });

  it("ตั้ง unmatched เมื่อไม่มีพารามิเตอร์ตรง", () => {
    const groups = buildApprovalGroups(petition(), [], [result(15)], new Map());
    expect(groups[0].unmatched).toBe(true);
    expect(groups[0].params).toHaveLength(0);
  });

  it("ยังแสดงช่วงผ่านอัตโนมัติในหน้าอนุมัติ QC สำหรับเกณฑ์ตามเปอร์เซ็นต์สาร", () => {
    const labelParam = param({
      valueFields: [
        {
          label: "Assay",
          type: "number",
          unit: "%",
          labelToleranceMode: true,
          labelToleranceStandards: [
            { substance: "A", autoPct: 2.5, headPct: 5 },
          ],
        },
      ],
    });
    const labelPetition = {
      ...petition(),
      items: [
        { seq: 1, sampleName: "Sample A", commonName: "A 1%", sampleId: "S1", batchNo: "B1", testItems: "density" },
      ],
    } as unknown as Petition;
    const qcResult = {
      itemSeq: 1,
      parameterId: "p1",
      parameterName: "density",
      values: { "Assay::a": 1 },
    } as unknown as QCTestResult;

    const groups = buildApprovalGroups(labelPetition, [labelParam], [qcResult], new Map(), { includeRestrictedStandards: true });
    const row = groups[0].params[0].rows[0];

    expect(row.standardText).toContain("ผ่านเกณฑ์ 25% 0.9750–1.0250");
    expect(row.standardText).toContain("\nเกณฑ์กรม 0.9500–1.0500");
    expect(row.standardText).toContain("เกณฑ์กรม 0.9500–1.0500");
  });

  it("แสดงเฉพาะเกณฑ์กรมในหน้ารายละเอียดผล Lab", () => {
    const labelParam = param({
      valueFields: [
        {
          label: "Assay",
          type: "number",
          unit: "%",
          labelToleranceMode: true,
          labelToleranceStandards: [
            { substance: "A", autoPct: 2.5, headPct: 5 },
          ],
        },
      ],
    });
    const labelPetition = {
      ...petition(),
      items: [
        { seq: 1, sampleName: "Sample A", commonName: "A 1%", sampleId: "S1", batchNo: "B1", testItems: "density" },
      ],
    } as unknown as Petition;
    const qcResult = {
      itemSeq: 1,
      parameterId: "p1",
      parameterName: "density",
      values: { "Assay::a": 1 },
    } as unknown as QCTestResult;

    const groups = buildApprovalGroups(labelPetition, [labelParam], [qcResult], new Map(), {
      includeRestrictedStandards: true,
      showAutoPassRange: false,
    });
    const row = groups[0].params[0].rows[0];

    expect(row.standardText).toBe("เกณฑ์กรม 0.9500–1.0500 %");
    expect(row.standardText).not.toContain("ผ่านเกณฑ์ 25%");
  });

  it("รวม lab param เข้ากลุ่มของ lab item พร้อมติด scope=lab (qc param ยัง scope=qc)", () => {
    const qcParam = param({ _id: "q1", name: "qc-density" });
    const labParam = param({ _id: "l1", name: "lab-assay", scope: "lab" });
    // item batch "B1" ลงท้าย 1 = lab batch → lab param ต้อง match; testItems ครอบทั้งสองชื่อ
    const labPetition = {
      ...petition(),
      items: [{ seq: 1, sampleName: "ตัวอย่าง A", commonName: "density", sampleId: "S1", batchNo: "B1", testItems: "qc-density, lab-assay" }],
    } as unknown as Petition;
    const groups = buildApprovalGroups(labPetition, [qcParam, labParam], [], new Map());
    const byId = Object.fromEntries(groups[0].params.map((p) => [p.parameterId, p]));
    expect(byId.q1.scope).toBe("qc");
    expect(byId.l1.scope).toBe("lab");
  });

  it("ไม่ดึง lab param ลง item ที่ไม่ใช่ lab batch", () => {
    const labParam = param({ _id: "l1", name: "lab-assay", scope: "lab" });
    // batch "B2" ลงท้าย 2 ≠ lab batch → lab param ต้องไม่ถูกดึงเข้า
    const nonLabPetition = {
      ...petition(),
      items: [{ seq: 1, sampleName: "ตัวอย่าง B", commonName: "density", sampleId: "S2", batchNo: "B2", testItems: "lab-assay" }],
    } as unknown as Petition;
    const groups = buildApprovalGroups(nonLabPetition, [labParam], [], new Map());
    expect(groups[0].params.find((p) => p.parameterId === "l1")).toBeUndefined();
  });

  it("เรียงผล %AI ตามแบบฟอร์มและไม่แสดงแถวรวมซ้ำ", () => {
    const labParam = param({
      _id: "l1",
      name: "%AI",
      scope: "lab",
      valueFields: [{
        label: "%AI",
        type: "float",
        unit: "%",
        labelToleranceMode: true,
        labelToleranceStandards: [{
          substance: "IMIDACLOPRID",
          autoPct: null,
          headPct: null,
          mode: "range",
          autoMode: "none",
          headMode: "range",
          passLow: 68.13,
          passHigh: 71.88,
          failLow: 67.5,
          failHigh: 72.5,
        }],
      }],
    });
    const labPetition = {
      ...petition(),
      items: [{ seq: 1, sampleName: "ตัวอย่าง A", commonName: "IMIDACLOPRID 70%", sampleId: "S1", batchNo: "B1", testItems: "%AI" }],
    } as unknown as Petition;
    const labResult = {
      itemSeq: 1,
      parameterId: "l1",
      parameterName: "%AI",
      values: {
        "Area Inj.1": 3.545,
        "Area Inj.2": 3.545,
        "Area Inj.3": 3.545,
        "Area Average": 3.54,
        "Area %RSD": 0,
        "% Sample Average": 68.72,
        "% Sample %RSD": 2.22,
        "%AI": 68.72,
        "% Sample 1": 69.0548,
        "% Sample 2": 67.0587,
        "% Sample 3": 70.0587,
        "%AI::imidacloprid": 68.72,
      },
    } as unknown as QCTestResult;

    const groups = buildApprovalGroups(labPetition, [labParam], [labResult], new Map(), {
      includeResultOnlyFields: true,
      showAutoPassRange: false,
    });
    expect(groups[0].params[0].rows.map((row) => row.label)).toEqual([
      "Area Inj.1",
      "Area Inj.2",
      "Area Inj.3",
      "Area Average",
      "Area %RSD",
      "% Sample 1",
      "% Sample 2",
      "% Sample 3",
      "% Sample Average",
      "% Sample %RSD",
      "%AI — IMIDACLOPRID",
    ]);
    expect(groups[0].params[0].rows.at(-1)?.standardText).toBe("เกณฑ์กรม 67.50–72.50 %");
  });

  it("หน้า QC เลือกผล Lab ของ %AI เฉพาะค่าสรุป", () => {
    const groups = [{
      seq: 1,
      sampleName: "ตัวอย่าง A",
      params: [{
        parameterId: "l1",
        parameterName: "%AI",
        scope: "lab" as const,
        hasPhases: false,
        rows: [
          { key: "area", label: "Area Inj.1", value: "100", standardText: "", abnormal: false, note: "", phase: 1 as const },
          { key: "ai-empty", label: "%AI — A", value: "", standardText: "", abnormal: false, note: "", phase: 1 as const },
          { key: "ai", label: "%AI", value: "1.1", standardText: "", abnormal: false, note: "", phase: 1 as const },
        ],
      }],
      unmatched: false,
    }];

    const filtered = filterApprovalGroupsByScope(groups, "lab", { aiSummaryOnly: true });
    expect(filtered[0].params[0].rows.map((row) => row.label)).toEqual(["%AI"]);
  });

  it("หน้า QC ไม่แสดง %AI แถวรวมซ้ำเมื่อมีค่ารายสารแล้ว", () => {
    const groups = [{
      seq: 1,
      sampleName: "ตัวอย่าง A",
      params: [{
        parameterId: "l1",
        parameterName: "%AI",
        scope: "lab" as const,
        hasPhases: false,
        rows: [
          { key: "substance", label: "%AI — A", value: "1.1", standardText: "0.9 - 1.2", abnormal: false, note: "", phase: 1 as const },
          { key: "generic", label: "%AI", value: "1.1", standardText: "", abnormal: false, note: "", phase: 1 as const },
        ],
      }],
      unmatched: false,
    }];

    const filtered = filterApprovalGroupsByScope(groups, "lab", { aiSummaryOnly: true });
    expect(filtered[0].params[0].rows.map((row) => row.label)).toEqual(["%AI — A"]);
  });

  // Fix 2 — phase-2 test
  it("phase-2: สร้าง row phase:2 จาก valuesPhase2 และไม่สับสนกับ phase 1", () => {
    const phasedParam = param({
      hasPhases: true,
      valueFields: [
        // "before" field — ปรากฏเฉพาะ phase 1
        { label: "ก่อน", type: "number", standardOperator: "gte", standardValue: 5, unit: "mL", phase: "before" },
        // "after" field — ปรากฏเฉพาะ phase 2
        { label: "หลัง", type: "number", standardOperator: "lte", standardValue: 30, unit: "mL", phase: "after" },
      ],
    });

    const qcResult: QCTestResult = {
      itemSeq: 1,
      parameterId: "p1",
      parameterName: "ทดสอบ",
      values: { ก่อน: 10 },
      valuesPhase2: { หลัง: 25 },
    } as unknown as QCTestResult;

    const groups = buildApprovalGroups(petition(), [phasedParam], [qcResult], new Map());
    const rows = groups[0].params[0].rows;

    // must have exactly 2 rows: one per phase
    expect(rows).toHaveLength(2);

    const phase1Row = rows.find((r) => r.phase === 1);
    const phase2Row = rows.find((r) => r.phase === 2);

    // phase-1 row: "before" field with phase-1 value
    expect(phase1Row).toBeDefined();
    expect(phase1Row!.label).toBe("ก่อน");
    expect(phase1Row!.value).toBe("10");
    expect(phase1Row!.standardText).toBe("≥ 5 mL");
    expect(phase1Row!.abnormal).toBe(false);

    // phase-2 row: "after" field with valuesPhase2 value
    expect(phase2Row).toBeDefined();
    expect(phase2Row!.label).toBe("หลัง · ตรวจซ้ำ Phase 2");
    expect(phase2Row!.value).toBe("25");
    expect(phase2Row!.standardText).toBe("≤ 30 mL");
    expect(phase2Row!.abnormal).toBe(false);

    // "after" field must NOT appear in phase-1 rows
    const phase1Labels = rows.filter((r) => r.phase === 1).map((r) => r.label);
    expect(phase1Labels).not.toContain("หลัง");

    // "before" field must NOT appear in phase-2 rows
    const phase2Labels = rows.filter((r) => r.phase === 2).map((r) => r.label);
    expect(phase2Labels).not.toContain("ก่อน · ตรวจซ้ำ Phase 2");
  });

  it("phase-2: parameter เดิมที่ไม่ใช่ตัว trigger (เช่น %AI) แสดงผลตรวจซ้ำหลังอบ ส่วนตัว trigger ไม่มีแถว Phase 2", () => {
    const aiParam = param({
      _id: "ai",
      name: "%AI",
      valueFields: [{ label: "ผล", type: "number", standardOperator: "between", standardValue: 9, standardValue2: 11, unit: "%" }],
    });
    const ovenParam = param({
      _id: "oven",
      name: "อบ 14 วัน",
      hasPhases: true,
      valueFields: [{ label: "เวลาอบ", type: "timer", timerUnit: "day", timerDurationSec: 14 * 86400, triggersPhase2: true }],
    });
    const phase2Petition = {
      ...petition(),
      items: [{ ...petition().items[0], testItems: "%AI, อบ 14 วัน" }],
      currentPhase: 2,
      phase2DueAt: "2026-10-01T00:00:00.000Z",
      phase2TriggeredBy: { parameterId: "oven", fieldLabel: "เวลาอบ", itemSeq: 1, triggeredAt: "2026-09-17T00:00:00.000Z" },
    } as unknown as Petition;
    const results = [
      { itemSeq: 1, parameterId: "ai", values: { ผล: 10 }, valuesPhase2: { ผล: 8 } },
      { itemSeq: 1, parameterId: "oven", values: { เวลาอบ: "done" }, valuesPhase2: {} },
    ] as unknown as QCTestResult[];

    const groups = buildApprovalGroups(phase2Petition, [aiParam, ovenParam], results, new Map());
    const ai = groups[0].params.find((group) => group.parameterId === "ai")!;
    const oven = groups[0].params.find((group) => group.parameterId === "oven")!;

    expect(ai.rows.map((row) => [row.label, row.value, row.phase, row.abnormal])).toEqual([
      ["ผล", "10", 1, false],
      ["ผล · ตรวจซ้ำ Phase 2", "8", 2, true],
    ]);
    expect(oven.rows.every((row) => row.phase === 1)).toBe(true);
  });

  it("phase-2: ยังไม่ถึงรอบตรวจซ้ำ ไม่สร้างแถว Phase 2 ให้ parameter ปกติ", () => {
    const groups = buildApprovalGroups(petition(), [param()], [result(15)], new Map());
    expect(groups[0].params[0].rows.every((row) => row.phase === 1)).toBe(true);
  });

  // Fix 2 — conditionalMode test
  it("conditionalMode: standardText และ abnormal สะท้อนเกณฑ์ที่ resolve จาก conditionalStandards", () => {
    // param มี field "ปริมาณ" ที่ conditionalMode=true
    // กฎ: ถ้า field "ประเภท" (ใน param เดียวกัน) = "A" → ≥ 90; กฎ default (conditions=[]) → ≥ 50
    const conditionalParam = param({
      valueFields: [
        {
          label: "ประเภท",
          type: "text",
        },
        {
          label: "ปริมาณ",
          type: "number",
          conditionalMode: true,
          conditionalStandards: [
            {
              label: "type-A",
              conditions: [
                { sourceFieldLabel: "ประเภท", op: "eq", value: "A" },
              ],
              operator: "gte",
              value: 90,
              value2: null,
            },
            {
              label: "default",
              conditions: [],   // empty = matches always (default row)
              operator: "gte",
              value: 50,
              value2: null,
            },
          ],
        },
      ],
    });

    // QC result: ประเภท = "A", ปริมาณ = 85 → abnormal under ≥ 90 rule
    const qcResult: QCTestResult = {
      itemSeq: 1,
      parameterId: "p1",
      parameterName: "conditionalTest",
      values: { ประเภท: "A", ปริมาณ: 85 },
    } as unknown as QCTestResult;

    const groups = buildApprovalGroups(petition(), [conditionalParam], [qcResult], new Map());
    const rows = groups[0].params[0].rows;

    const quantityRow = rows.find((r) => r.label === "ปริมาณ");
    expect(quantityRow).toBeDefined();
    // should resolve to the type-A rule (≥ 90)
    expect(quantityRow!.standardText).toBe("≥ 90");
    // 85 < 90 → abnormal
    expect(quantityRow!.abnormal).toBe(true);

    // Now test with a value that passes type-A rule
    const qcResultPass: QCTestResult = {
      itemSeq: 1,
      parameterId: "p1",
      parameterName: "conditionalTest",
      values: { ประเภท: "A", ปริมาณ: 95 },
    } as unknown as QCTestResult;

    const groupsPass = buildApprovalGroups(petition(), [conditionalParam], [qcResultPass], new Map());
    const quantityRowPass = groupsPass[0].params[0].rows.find((r) => r.label === "ปริมาณ");
    expect(quantityRowPass!.abnormal).toBe(false);

    // Now test default rule: ประเภท = "B" → ≥ 50, ปริมาณ = 40 → abnormal
    const qcResultDefault: QCTestResult = {
      itemSeq: 1,
      parameterId: "p1",
      parameterName: "conditionalTest",
      values: { ประเภท: "B", ปริมาณ: 40 },
    } as unknown as QCTestResult;

    const groupsDefault = buildApprovalGroups(petition(), [conditionalParam], [qcResultDefault], new Map());
    const quantityRowDefault = groupsDefault[0].params[0].rows.find((r) => r.label === "ปริมาณ");
    expect(quantityRowDefault!.standardText).toBe("≥ 50");
    expect(quantityRowDefault!.abnormal).toBe(true);
  });
});
