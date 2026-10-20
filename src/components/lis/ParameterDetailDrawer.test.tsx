import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterItem } from "@/lib/api";
import { formatTimerHuman } from "@/lib/parameterValidation";
import { ParameterDetailDrawer } from "./ParameterDetailDrawer";

const groupNameById = new Map([["g1", "กลุ่มน้ำ"]]);

const sourceParam: ParameterItem = {
  _id: "src1",
  name: "ความหนืดก่อนกวน",
  scope: "qc",
  valueFields: [{ label: "ค่าแรก", type: "float" }],
};

function renderDrawer(parameter: ParameterItem, onEdit = vi.fn(), onClose = vi.fn()) {
  render(
    <ParameterDetailDrawer
      parameter={parameter}
      allParameters={[parameter, sourceParam]}
      groupNameById={groupNameById}
      onEdit={onEdit}
      onClose={onClose}
    />,
  );
  return { onEdit, onClose };
}

describe("ParameterDetailDrawer", () => {
  it("header: ชื่อ + scope + → Lab + สถานะ + note", () => {
    renderDrawer({
      _id: "p1",
      name: "ความหนืด",
      scope: "qc",
      shareWithLab: true,
      status: "active",
      note: "เขย่าก่อนวัด",
      valueFields: [],
    });
    expect(screen.getByText("ความหนืด")).toBeInTheDocument();
    expect(screen.getByText("QC")).toBeInTheDocument();
    expect(screen.getByText("→ Lab")).toBeInTheDocument();
    expect(screen.getByText("เปิด")).toBeInTheDocument();
    expect(screen.getByText("เขย่าก่อนวัด")).toBeInTheDocument();
  });

  it("ใช้กับ: applyAll โชว์ 'ทั้งหมด'", () => {
    renderDrawer({ _id: "p1", name: "X", applyAll: true, valueFields: [] });
    expect(screen.getByText("ทั้งหมด")).toBeInTheDocument();
  });

  it("ใช้กับ: โชว์ค่าเต็มทุกมิติ ไม่ตัด +N และ resolve ชื่อกลุ่ม", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      commonNames: ["EC", "SC", "WP"],
      itemGroups: ["g1"],
      valueFields: [],
    });
    for (const v of ["EC", "SC", "WP", "กลุ่มน้ำ"]) {
      expect(screen.getByText(v)).toBeInTheDocument();
    }
    expect(screen.queryByText(/\+1/)).not.toBeInTheDocument();
  });

  it("ใช้กับ: โชว์หลายกฎเป็น กฎ 1 / กฎ 2", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      applyRules: [
        { productTypes: ["powder"] },
        { commonNames: ["EC"] },
      ],
      excludeCommonNames: ["SC"],
      valueFields: [],
    });

    expect(screen.getByText("กฎ 1")).toBeInTheDocument();
    expect(screen.getByText("กฎ 2")).toBeInTheDocument();
    expect(screen.getByText("ประเภท: ผง")).toBeInTheDocument();
    expect(screen.getByText("ประเภท Common Name: EC")).toBeInTheDocument();
    expect(screen.getByText("ยกเว้น ประเภท Common Name:")).toBeInTheDocument();
    expect(screen.getByText("SC")).toBeInTheDocument();
  });

  it("number ค่าเดียว: ข้อความเกณฑ์ between + หน่วย", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        { label: "ค่า", type: "float", unit: "cP", standardOperator: "between", standardValue: 10, standardValue2: 50 },
      ],
    });
    expect(screen.getByText("ค่าปกติ: 10 - 50 cP")).toBeInTheDocument();
  });

  it("เกณฑ์ต่อสาร 7 สาร: เห็น 5 + ดูทั้งหมด (7) → กดแล้วครบ + ปุ่มเป็น ย่อ", () => {
    const subs = Array.from({ length: 7 }, (_, i) => ({
      substance: `SUB${i + 1}`,
      operator: "gte" as const,
      value: 90,
    }));
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        { label: "%AI", type: "float", unit: "%", substanceMode: true, substanceStandards: subs },
      ],
    });
    expect(screen.getByText(/เกณฑ์ต่อสาร \(7 สาร\)/)).toBeInTheDocument();
    expect(screen.getByText(/SUB5/)).toBeInTheDocument();
    expect(screen.queryByText(/SUB6/)).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "ดูทั้งหมด (7)" });
    fireEvent.click(toggle);
    expect(screen.getByText(/SUB7/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ย่อ" })).toBeInTheDocument();
  });

  it("เกณฑ์ต่อสาร ≤5 สาร: ไม่มีปุ่มดูทั้งหมด", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        {
          label: "%AI",
          type: "float",
          substanceMode: true,
          substanceStandards: [{ substance: "SUB1", operator: "gte", value: 90 }],
        },
      ],
    });
    expect(screen.queryByRole("button", { name: /ดูทั้งหมด/ })).not.toBeInTheDocument();
  });

  it("enum: chip ตาม optionOutputs + requireNoteOn", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        {
          label: "ลักษณะ",
          type: "enum",
          options: ["ใส", "ขุ่น", "อื่นๆ"],
          optionOutputs: {
            "ใส": { kind: "normal" },
            "ขุ่น": { kind: "abnormal" },
            "อื่นๆ": { kind: "text", text: "ระบุเพิ่ม" },
          },
          requireNoteOn: ["ขุ่น"],
        },
      ],
    });
    expect(screen.getByText("ปกติ")).toBeInTheDocument();
    expect(screen.getByText("ไม่ปกติ")).toBeInTheDocument();
    expect(screen.getByText('ข้อความ: "ระบุเพิ่ม"')).toBeInTheDocument();
    expect(screen.getByText("ต้องกรอกหมายเหตุ")).toBeInTheDocument();
  });

  it("enum: optionFilters โชว์ไอคอน Filter + สรุปตัวกรอง เฉพาะ option ที่ตั้งไว้", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        {
          label: "ลักษณะ",
          type: "enum",
          options: ["ใส", "ขุ่น", "เข้ม"],
          optionFilters: {
            "ขุ่น": { commonNames: ["EC", "SC"] },
            "เข้ม": { itemGroups: ["g1"] },
          },
        },
      ],
    });
    expect(screen.getByText("common: EC/SC")).toBeInTheDocument();
    expect(screen.getByText("กลุ่ม: กลุ่มน้ำ")).toBeInTheDocument();
    const clearRow = screen.getByText("ใส").closest("div");
    expect(clearRow?.textContent).not.toMatch(/common:|กลุ่ม:/);
  });

  it("enum legacy (ไม่มี optionOutputs): expectedValues → ปกติ, ที่เหลือ → ไม่ปกติ", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        { label: "ลักษณะ", type: "enum", options: ["ใส", "ขุ่น"], expectedValues: ["ใส"] },
      ],
    });
    expect(screen.getByText("ปกติ")).toBeInTheDocument();
    expect(screen.getByText("ไม่ปกติ")).toBeInTheDocument();
  });

  it("timer/photo/file: รายละเอียดถูก", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        { label: "เวลากวน", type: "timer", timerDurationSec: 90, timerUnit: "minute" },
        { label: "รูป", type: "photo", maxPhotos: 3 },
        { label: "ผลแนบ", type: "file", allowedFileTypes: ["pdf", "excel"], maxFiles: 2 },
      ],
    });
    expect(screen.getByText(`จับเวลา: ${formatTimerHuman(90)}`)).toBeInTheDocument();
    expect(screen.getByText("สูงสุด 3 รูป")).toBeInTheDocument();
    expect(screen.getByText("PDF, EXCEL · สูงสุด 2 ไฟล์")).toBeInTheDocument();
  });

  it("reference: resolve ชื่อ parameter ต้นทาง + phase 2", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      valueFields: [
        { label: "อ้างอิง", type: "reference", refParameterId: "src1", refFieldLabel: "ค่าแรก", refPhase: 2 },
      ],
    });
    expect(screen.getByText("← ดึงจาก ความหนืดก่อนกวน · ค่าแรก · phase 2")).toBeInTheDocument();
  });

  it("chips: required/phase/trigger/หลายค่า/แบชล่าสุด", () => {
    renderDrawer({
      _id: "p1",
      name: "X",
      hasPhases: true,
      multiEntry: true,
      valueFields: [
        {
          label: "ค่า",
          type: "float",
          required: true,
          phase: "before",
          triggersPhase2: true,
          multiple: true,
          showLastBatch: true,
        },
      ],
    });
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByText("เฉพาะก่อน (Phase 1)")).toBeInTheDocument();
    expect(screen.getByText("ตัว trigger รอบตรวจซ้ำ")).toBeInTheDocument();
    expect(screen.getByText("กรอกได้หลายค่า")).toBeInTheDocument();
    expect(screen.getByText("โชว์ค่าแบชล่าสุด")).toBeInTheDocument();
    expect(screen.getByText("เป็นตัว trigger รอบตรวจซ้ำ")).toBeInTheDocument();
    expect(screen.getByText("กรอกซ้ำได้หลายรายการ")).toBeInTheDocument();
  });

  it("ไม่มีช่องค่า → ข้อความว่าง; ปุ่มแก้ไขเรียก onEdit", () => {
    const { onEdit } = renderDrawer({ _id: "p1", name: "X", valueFields: [] });
    expect(screen.getByText("— ยังไม่มีช่องค่า")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /แก้ไข/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
