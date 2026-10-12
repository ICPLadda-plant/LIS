import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ValidationPreparation from "../ValidationPreparation";
import { defaultPreparationLevels, preparationTemplate, type PreparationLevel } from "@/lib/validationPreparation";

it("แยก STD และ Matrix ตามหน้าที่เลือกและพิมพ์เฉพาะส่วนที่แสดง", () => {
 const props = { stock: 2, stocks: [], levels: defaultPreparationLevels(), onChange: vi.fn(), analyte: "QA", method: "GC", matrixEnabled: true };
 const { rerender } = render(<ValidationPreparation {...props} section="std" />);
 expect(screen.getByLabelText("Final volume std")).toBeInTheDocument();
 expect(screen.queryByText("คำนวณ Matrix จาก %ยา")).not.toBeInTheDocument();
 rerender(<ValidationPreparation {...props} section="matrix" />);
 expect(screen.queryByLabelText("Final volume std")).not.toBeInTheDocument();
 expect(screen.getByText("คำนวณ Matrix จาก %ยา")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "พิมพ์ตารางคำนวณการเตรียมสาร" }));
 const html = screen.getByTitle("ใบเตรียมสาร").getAttribute("srcdoc");
 expect(html).toContain("เตรียมสารที่เติม Matrix");
 expect(html).not.toContain("เตรียมสารมาตรฐาน (STD)");
});

function Fixture() {
  const [levels, setLevels] = useState([defaultPreparationLevels().find(level => level.purpose === "accuracy" && level.target === "0.5")!]);
  return <><ValidationPreparation matrixEnabled analyte="QA" method="GC" stock={2.01159} stocks={[]} levels={levels} onChange={setLevels} /><output data-testid="template">{preparationTemplate("accuracy", levels, 2.01159, [], 2)}</output></>;
}
describe("หน่วยในแผนเตรียมสาร", () => {
  it("แปลงหน่วยและคำนวณปิเปตตาม Target แบบเรียลไทม์", () => {
    render(<Fixture />);
    expect(screen.queryByLabelText("หน่วย Target ระดับ 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("target ระดับ 1")).toHaveValue(0.5);
    expect(screen.getByLabelText("aliquot ระดับ 1")).toHaveTextContent("248.6");
    fireEvent.change(screen.getByLabelText("target ระดับ 1"), { target: { value: "0.4" } });
    expect(screen.getByLabelText("aliquot ระดับ 1")).toHaveTextContent("198.8");
    fireEvent.change(screen.getByLabelText("Final volume matrix"), {target:{value:"2000"}});
    expect(screen.getByLabelText("aliquot ระดับ 1")).toHaveTextContent("397.7");
    expect(screen.getByLabelText("finalVolume ระดับ 1")).toHaveTextContent("2000");
  });
});


it("recalculates pipetting when switching stock and clears impossible dilution", () => {
  function StockFixture() {
    const [levels, setLevels] = useState([{...defaultPreparationLevels()[0], target:"0.5", aliquot:"250"}]);
    return <ValidationPreparation matrixEnabled analyte="QA" method="GC" stock={2} stocks={[{id:"other",name:"Stock มาตรฐานชื่อยาวสำหรับทดสอบ",weight:"100",purity:"100",volume:"25",certificate:"",preparedOn:""},{id:"weak",name:"เจือจาง",weight:"1",purity:"100",volume:"25",certificate:"",preparedOn:""}]} levels={levels} onChange={setLevels} />;
  }
  render(<StockFixture />);
  fireEvent.change(screen.getByLabelText("Stock ระดับ 1"), {target:{value:"other"}});
  expect(screen.getByLabelText("aliquot ระดับ 1")).toHaveTextContent("125.0");
  expect(screen.getAllByText("Stock มาตรฐานชื่อยาวสำหรับทดสอบ")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Stock ระดับ 1"), {target:{value:"weak"}});
  expect(screen.getByLabelText("aliquot ระดับ 1")).toHaveTextContent("—");
});

it("updates Matrix and Solvent when percent changes and final volume scales", () => {
 render(<Fixture />);
 expect(screen.queryByRole("checkbox", {name:"คำนวณ Matrix จาก %ยา ตามข้อ 6.5.2"})).not.toBeInTheDocument();
 expect(screen.getByLabelText("%ยา", {exact:true})).toHaveValue(null);
 fireEvent.change(screen.getByLabelText("%ยา", {exact:true}),{target:{value:"25"}});
 fireEvent.change(screen.getByLabelText("ระดับอ้างอิง (mg/mL)"),{target:{value:"1"}});
 fireEvent.change(screen.getByLabelText("ความหนาแน่น Matrix (mg/µL)"),{target:{value:"1"}});
 expect(screen.getByLabelText("matrix ระดับ 1")).toHaveValue(4);
 fireEvent.change(screen.getByLabelText("%ยา", {exact:true}),{target:{value:"10"}});
 expect(screen.getByLabelText("matrix ระดับ 1")).toHaveValue(10);
 fireEvent.change(screen.getByLabelText("Final volume matrix"),{target:{value:"2000"}});
 expect(screen.getByLabelText("matrix ระดับ 1")).toHaveValue(20);
 fireEvent.change(screen.getByLabelText("ฐาน %ยา"),{target:{value:"wv"}});
 expect(screen.getByLabelText("matrix ระดับ 1")).toHaveValue(null);
});


it("calculates Actual from rounded or explicitly entered pipetting",()=>{
 render(<Fixture/>);
 expect(screen.getByLabelText("ปิเปตจริง ระดับ 1")).toHaveValue(248.6);
 expect(screen.getByTestId("template").textContent).toContain(String(2.01159*248.6/1000));
 fireEvent.change(screen.getByLabelText("ปิเปตจริง ระดับ 1"),{target:{value:"250"}});
 expect(screen.getByTestId("template").textContent).toContain("0.5028975");
 fireEvent.change(screen.getByLabelText("target ระดับ 1"),{target:{value:"0.4"}});
 expect(screen.getByLabelText("ปิเปตจริง ระดับ 1")).toHaveValue(250);
 fireEvent.change(screen.getByLabelText("ปิเปตจริง ระดับ 1"),{target:{value:""}});
 expect(screen.getByTestId("template").textContent).toBe("");
});

it("เลือกใช้ Stock โดยตรงโดยไม่ต้องกรอกปิเปตเจือจาง และเปลี่ยนกลับได้", () => {
 function DirectStockFixture() {
  const [levels, setLevels] = useState<PreparationLevel[]>([{ ...defaultPreparationLevels()[4], actualAliquot: "" }]);
  return <ValidationPreparation matrixEnabled analyte="QA" method="GC" stock={1.044173} stocks={[]} levels={levels} onChange={setLevels} />;
 }
 render(<DirectStockFixture />);
 fireEvent.click(screen.getByLabelText("ใช้ Stock โดยตรง ระดับ 1"));
 expect(screen.getByText("1.04417")).toBeInTheDocument();
 expect(screen.getByLabelText("aliquot ระดับ 1")).toHaveTextContent("1000.0");
 expect(screen.queryByLabelText("ปิเปตจริง ระดับ 1")).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText("ใช้ Stock โดยตรง ระดับ 1"));
 expect(screen.getByLabelText("ปิเปตจริง ระดับ 1")).toHaveValue(null);
 expect(screen.getByLabelText("aliquot ระดับ 1")).toHaveTextContent("957.7");
});

it("เลือกปลายทาง STD และใช้ปุ่มบันทึกใต้ตาราง", () => {
 const save = vi.fn();
 render(<ValidationPreparation matrixEnabled analyte="QA" method="GC" stock={2} stocks={[]} levels={defaultPreparationLevels()} onChange={() => {}} onSaveTo={save} />);
 fireEvent.change(screen.getByLabelText("นำ STD ไปคำนวณที่"), { target: { value: "accuracy" } });
 fireEvent.click(screen.getByRole("button", { name: "บันทึก STD และไป Accuracy" }));
 expect(save).toHaveBeenCalledWith("accuracy");
 fireEvent.change(screen.getByLabelText("นำ STD ไปคำนวณที่"), { target: { value: "precision" } });
 fireEvent.click(screen.getByRole("button", { name: "บันทึก STD และไป Precision" }));
 expect(save).toHaveBeenCalledWith("precision");
});

it("ไม่แสดงและไม่คำนวณ Matrix จนกว่าจะบันทึกส่ง STD ไป Accuracy หรือ Precision", () => {
 const change = vi.fn();
 const levels = defaultPreparationLevels();
 const { rerender } = render(<ValidationPreparation stock={2} stocks={[]} levels={levels} onChange={change} analyte="QA" method="GC" />);
 expect(screen.queryByText("คำนวณ Matrix จาก %ยา")).not.toBeInTheDocument();
 expect(screen.queryByLabelText("Final volume matrix")).not.toBeInTheDocument();
 expect(change.mock.calls[0][0].slice(5)).toEqual(levels.slice(5));
 rerender(<ValidationPreparation matrixEnabled stock={2} stocks={[]} levels={levels} onChange={change} analyte="QA" method="GC" />);
 expect(screen.getByText("คำนวณ Matrix จาก %ยา")).toBeInTheDocument();
 expect(screen.getByLabelText("Final volume matrix")).toBeInTheDocument();
 expect(screen.queryByText(/ตามข้อ 6\.5\.2/)).not.toBeInTheDocument();
});
