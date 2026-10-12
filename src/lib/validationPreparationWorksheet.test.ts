import { expect, it } from "vitest";
import { preparationPlan, defaultPreparationLevels } from "./validationPreparation";
import { preparationWorksheet } from "./validationPreparationWorksheet";
it("plans without actual pipetting and subtracts matrix from solvent", () => {
 const row = { ...defaultPreparationLevels()[0], target: "0.5", finalVolume: "10000", aliquot: "", matrix: "4" };
 expect(preparationPlan(row, 2, [])).toEqual({stock:2,target:0.5,finalUl:10000,matrixUl:4,aliquotUl:2500,solventUl:7496});
 expect(preparationPlan({...row,target:"3"},2,[])).toBeNull();
 expect(preparationPlan({...row,stockId:"missing"},2,[])).toBeNull();
 expect(preparationPlan({...row,target:"500",targetUnit:"µg/mL"},2,[])?.aliquotUl).toBe(2500);
 const html=preparationWorksheet({analyte:"<script>alert(1)</script>",method:"QA"},[row],2,[]);
 expect(html).toContain("7496.0"); expect(html).not.toContain("<script>"); expect(html).toContain("ปิเปตจริง");
});

it("prints STD before Matrix without a purpose column", () => {
 const base = defaultPreparationLevels()[0];
 const html = preparationWorksheet({analyte:"QA",method:"GC"}, [{...base, preparationKind:"matrix",matrix:"0"},{...base,id:"std",matrix:"0"}],2,[]);
 expect(html).not.toContain("ใช้สำหรับ");
 expect(html.indexOf("1. เตรียมสารมาตรฐาน (STD)")).toBeLessThan(html.indexOf("2. เตรียมสารที่เติม Matrix"));
 expect((html.match(/<table>/g) || []).length).toBe(2);
});

it("prints entered pipetting and concentration from actual volume for STD and Matrix", () => {
 const base = {...defaultPreparationLevels()[0], target:"0.5", actualAliquot:"260", finalVolume:"1000"};
 const html = preparationWorksheet({analyte:"QA",method:"GC"}, [base,{...base,id:"matrix",matrix:"4",preparationKind:"matrix"}],2,[]);
 expect(html).toContain("Conc หลังปิเปตจริง (mg/mL)");
 expect((html.match(/<td class="actual-volume">260.0<\/td><td>0.52000<\/td>/g) || []).length).toBe(2);
 expect(html).toContain("Solvent ตามแผน");
});

it("keeps missing or invalid actual concentration blank and supports undiluted stock", () => {
 const base = defaultPreparationLevels()[0];
 const render = (overrides: Partial<typeof base>) => preparationWorksheet({analyte:"QA",method:"GC"},[{...base,...overrides}],1.044173,[]);
 expect(render({actualAliquot:""})).toContain('<td class="actual-volume">—</td><td>—</td>');
 expect(render({actualAliquot:"1001"})).toContain('<td class="actual-volume">1001.0</td><td>—</td>');
 expect(render({useStockDirect:true,target:"1"})).toContain('<td class="actual-volume">1000.0</td><td>1.04417</td>');
});
