// แม่แบบเอกสารที่แก้ได้ในหน้า "จัดการเอกสาร"
// - ช่องกรอก (fill field): <span data-ff="text|date|checkbox|textarea|signature" data-ff-label="...">  ให้คนกรอกตอนพิมพ์
// - ตัวแปรระบบ (variable): <span data-fv="petitionNo">  ระบบเติมข้อมูลจริงตอนพิมพ์
// - แถวรายการ: <tr data-fv-repeat="items"> ระบบคัดลอกแถวตามจำนวนตัวอย่าง ตัวแปรในแถวใช้ key "item.xxx"
import type { Petition } from "@/types/petition.types";
import { PETITION_STATUS_CONFIG } from "@/types/petition.types";
import { formatDate } from "@/lib/dateTime";

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

export const variableHtml = (key: string, label: string) =>
  '<span class="fv" contenteditable="false" data-fv="' + key + '">{{' + esc(label) + "}}</span>&nbsp;";

export type TemplateVar = { key: string; label: string };
export type TemplateSchema = { vars: TemplateVar[]; itemVars: TemplateVar[] };

// ตัวแปรของฟอร์มกลุ่มคำร้อง
export const PETITION_SCHEMA: TemplateSchema = {
  vars: [
    { key: "petitionNo", label: "เลขที่คำร้อง" },
    { key: "status", label: "สถานะคำร้อง" },
    { key: "dept", label: "ประเภทคำร้อง" },
    { key: "submitterName", label: "ผู้ยื่นคำร้อง" },
    { key: "submitterDept", label: "หน่วยงานผู้ยื่น" },
    { key: "submittedAt", label: "วันที่ยื่น" },
    { key: "sampledBy", label: "ผู้สุ่มตัวอย่าง" },
    { key: "receivedAt", label: "วันที่รับตัวอย่าง" },
    { key: "receivedBy", label: "ผู้รับตัวอย่าง" },
    { key: "itemCount", label: "จำนวนตัวอย่าง" },
    { key: "printedAt", label: "วันที่พิมพ์" },
  ],
  itemVars: [
    { key: "item.seq", label: "ลำดับ" },
    { key: "item.sampleName", label: "ชื่อตัวอย่าง" },
    { key: "item.commonName", label: "ชื่อสามัญ" },
    { key: "item.batchNo", label: "Batch No." },
    { key: "item.lotNo", label: "Lot No." },
    { key: "item.productionDate", label: "วันผลิต" },
    { key: "item.packageUnit", label: "ขนาดบรรจุ" },
    { key: "item.testItems", label: "รายการทดสอบ" },
    { key: "item.note", label: "หมายเหตุ" },
  ],
};

// รหัสฟอร์มของระบบที่เชื่อมแม่แบบแล้ว → schema ตัวแปร
export const TEMPLATE_SCHEMAS: Record<string, TemplateSchema> = {
  "FM-QP-07-01-001": PETITION_SCHEMA,
  "FM-QP-07-04-001": PETITION_SCHEMA,
};

export type TemplateData = { vars: Record<string, string>; items: Record<string, string>[] };

export function petitionTemplateData(p: Petition): TemplateData {
  const deptLabel: Record<string, string> = { production: "ฝ่ายผลิต", rm: "วัตถุดิบ (RM)", fg: "สินค้าสำเร็จรูป (FG)" };
  return {
    vars: {
      petitionNo: p.petitionNo ?? "",
      status: PETITION_STATUS_CONFIG[p.status]?.label ?? String(p.status ?? ""),
      dept: deptLabel[p.dept] ?? String(p.dept ?? ""),
      submitterName: p.submittedBy?.name ?? "",
      submitterDept: p.submittedBy?.department ?? "",
      submittedAt: formatDate(p.submittedBy?.submittedAt, ""),
      sampledBy: p.sampledBy?.name ?? "",
      receivedAt: formatDate(p.receivedAt, ""),
      receivedBy: p.receivedBy ?? "",
      itemCount: String(p.items?.length ?? 0),
      printedAt: formatDate(new Date(), ""),
    },
    items: (p.items ?? []).map((it) => ({
      "item.seq": String(it.seq ?? ""),
      "item.sampleName": it.sampleName ?? "",
      "item.commonName": it.commonName ?? "",
      "item.batchNo": it.batchNo ?? "",
      "item.lotNo": it.lotNo ?? "",
      "item.productionDate": formatDate(it.productionDate, ""),
      "item.packageUnit": it.packageUnit ?? "",
      "item.testItems": it.testItems ?? "",
      "item.note": it.note ?? "",
    })),
  };
}

// แม่แบบเริ่มต้นเมื่อกด "แก้ฟอร์มนี้" — ผู้ใช้แก้ต่อได้ทั้งหมด
export function starterTemplateHtml(name: string, code: string, rev: string, schema: TemplateSchema): string {
  const v = (k: string) => variableHtml(k, [...schema.vars, ...schema.itemVars].find((x) => x.key === k)?.label ?? k);
  const head = schema.itemVars.slice(0, 5);
  return [
    '<h1 style="text-align:center">' + esc(name) + "</h1>",
    "<p>เลขที่: " + v("petitionNo") + " วันที่ยื่น: " + v("submittedAt") + "</p>",
    "<p>ผู้ยื่นคำร้อง: " + v("submitterName") + " หน่วยงาน: " + v("submitterDept") + "</p>",
    "<table><tbody><tr>" + head.map((x) => "<th>" + esc(x.label) + "</th>").join("") + "</tr>",
    '<tr data-fv-repeat="items">' + head.map((x) => "<td>" + v(x.key) + "</td>").join("") + "</tr></tbody></table>",
    "<p><br></p><p>ลงชื่อ " + fillFieldHtml("signature", "ผู้รับตัวอย่าง") + " วันที่ " + fillFieldHtml("date", "วันที่รับ") + "</p>",
    '<p style="text-align:right">' + esc(code + " " + rev) + "</p>",
  ].join("");
}

// เติมข้อมูลจริงลงแม่แบบ (ใช้ DOMParser จึงทำงานเฉพาะใน browser/jsdom)
export function renderTemplate(html: string, data: TemplateData): string {
  const doc = new DOMParser().parseFromString("<div id=root>" + html + "</div>", "text/html");
  const root = doc.getElementById("root")!;
  const fill = (scope: Element, values: Record<string, string>) => {
    scope.querySelectorAll<HTMLElement>("[data-fv]").forEach((el) => {
      const key = el.dataset.fv!;
      if (key in values) { el.textContent = values[key]; el.removeAttribute("contenteditable"); el.classList.add("fv-filled"); }
    });
  };
  root.querySelectorAll<HTMLElement>("[data-fv-repeat]").forEach((row) => {
    const parent = row.parentNode!;
    data.items.forEach((item) => {
      const clone = row.cloneNode(true) as HTMLElement;
      clone.removeAttribute("data-fv-repeat");
      fill(clone, item);
      parent.insertBefore(clone, row);
    });
    row.remove();
  });
  fill(root, data.vars);
  return root.innerHTML;
}

export const hasFillFields = (html: string) => html.includes("data-ff=");
