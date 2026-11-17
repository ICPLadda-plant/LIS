// ช่องกรอกในเอกสารที่สร้าง/นำเข้าในหน้า "จัดการเอกสาร"
// <span data-ff="text|date|checkbox|textarea|signature" data-ff-label="..."> ให้คนกรอกตอนพิมพ์ (โหมดกรอกแบบฟอร์ม)
export type FillFieldType = "text" | "date" | "checkbox" | "textarea" | "signature";
export const FILL_FIELDS: { type: FillFieldType; label: string }[] = [
  { type: "text", label: "ช่องข้อความ" },
  { type: "date", label: "ช่องวันที่" },
  { type: "checkbox", label: "ช่องติ๊ก" },
  { type: "textarea", label: "ช่องข้อความยาว" },
  { type: "signature", label: "ช่องลายเซ็น" },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export const fillFieldHtml = (type: FillFieldType, label: string) =>
  '<span class="ff" contenteditable="false" data-ff="' + type + '" data-ff-label="' + esc(label) + '">[' + esc(label) + "]</span>&nbsp;";

export const hasFillFields = (html: string) => html.includes("data-ff=");
