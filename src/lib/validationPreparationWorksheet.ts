import { preparationKind, preparationPlan, preparationResult, positiveNumber, type PreparationLevel, type ValidationStock } from "./validationPreparation";
import { escapeReport as e } from "./validationReport";

export function preparationWorksheet(meta: { analyte: string; method: string }, levels: PreparationLevel[], stock: number | null, stocks: ValidationStock[]) {
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  const sections = (["std", "matrix"] as const).filter(kind => levels.some(level => preparationKind(level) === kind)).map(kind => {
  const rows = levels.map((level, i) => ({ level, i })).filter(({ level }) => preparationKind(level) === kind).map(({ level, i }) => {
    const p = preparationPlan(level, stock, stocks);
    const actual = preparationResult(level, stock, stocks);
    const pipetted = level.useStockDirect ? p?.finalUl ?? null : positiveNumber(level.actualAliquot ?? level.aliquot);
    const name = level.stockId ? stocks.find(s => s.id === level.stockId)?.name || level.stockId : "Stock หลัก";
    return `<tr><td>${i + 1}</td><td>${e(name)}${level.useStockDirect ? " · ใช้ Stock โดยตรง (ไม่เจือจาง)" : ""}</td>${p ? [p.stock,level.useStockDirect ? p.stock : p.target,p.finalUl / 1000,p.aliquotUl,p.matrixUl,p.solventUl,pipetted].map((n, index) => `<td${index === 6 ? ' class="actual-volume"' : ""}>${n == null ? "—" : index >= 3 ? n.toFixed(1) : fmt(n)}</td>`).join("") : '<td colspan="7">ข้อมูลไม่ครบหรือเตรียมด้วย Stock นี้ไม่ได้ — ห้ามใช้แถวนี้เตรียมสาร</td>'}<td>${actual?.actual.toFixed(5) ?? "—"}</td></tr>`;
  }).join("");
  const basis = kind === "matrix" ? levels.filter(level => level.matrixCalculation).map(level => {
    const c = level.matrixCalculation!;
    return `<p>ระดับ ${levels.indexOf(level) + 1}: คำนวณ Matrix จาก ${e(c.percent)} %${c.basis === "ww" ? "w/w" : "w/v"}, ระดับอ้างอิง ${e(c.reference)} mg/mL, ความหนาแน่น Matrix ${e(c.density)} mg/µL${c.basis === "wv" ? `, ความหนาแน่นตัวอย่าง ${e(c.sampleDensity)} g/mL` : ""}</p>`;
  }).join("") : "";
  return `<h2>${kind === "std" ? "1. เตรียมสารมาตรฐาน (STD)" : "2. เตรียมสารที่เติม Matrix"}</h2><table><thead><tr>${["ลำดับ","Stock","C stock (mg/mL)","Final conc (mg/mL)","Final volume (mL)","ปิเปต Stock (µL)","Matrix (µL)","Solvent ตามแผน (µL)","ปิเปตจริง (µL)","Conc หลังปิเปตจริง (mg/mL)"].map((h,index) => `<th${index === 8 ? ' class="actual-volume"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>${basis}`;
  }).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบเตรียมสาร Validation</title><style>@page{size:A4 landscape;margin:12mm}body{font:12px/1.6 Tahoma,Arial,sans-serif;color:#172033;padding:16px}h1{font-size:22px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:7px;text-align:left}th{background:#eee}.actual-volume{background:#fff3cd;font-weight:700;white-space:nowrap}tr{break-inside:avoid}thead{display:table-header-group}@media print{body{padding:0}}</style></head><body><h1>ใบเตรียมสารสำหรับ Validation</h1><p>สาร: ${e(meta.analyte)} · วิธี: ${e(meta.method)}</p><p>วันที่เตรียม: __________________ ผู้เตรียม: __________________ ผู้ตรวจสอบ: __________________</p><p>Solvent ที่ใช้ / Lot: __________________________________________</p>${sections}<p>V stock = Final conc × Final volume ÷ C stock (ใช้หน่วยปริมาตรเดียวกัน)<br>V solvent จริง = V final − ปิเปตจริง − V matrix<br>Conc หลังปิเปตจริง = C stock × ปริมาตรปิเปตจริง ÷ Final volume</p><p>เติม Solvent แล้วปรับปริมาตรให้ถึง Final volume ตามวิธีที่กำหนด ปริมาตร Solvent ในตารางคำนวณจากปริมาตรที่ปิเปตจริงและ Matrix จริง<br>ปริมาตร Stock / Matrix / Solvent แสดงทศนิยม 1 ตำแหน่ง ความเข้มข้นหลังปิเปตจริงแสดง 5 ตำแหน่ง โดยคำนวณจากค่าเต็ม เลือกอุปกรณ์ปิเปตที่เหมาะสม ค่า — หมายถึงยังไม่มีข้อมูลหรือข้อมูลไม่ถูกต้อง ความเข้มข้นหลังปิเปตจริงเป็นค่าคำนวณจากการเตรียมสาร ไม่ใช่ผลวัดจากเครื่อง</p><p>บันทึกเพิ่มเติม: __________________________________________________________________________</p></body></html>`;
}
