import { describe, expect, it } from "vitest";
import { renderTemplate, starterTemplateHtml, PETITION_SCHEMA, hasFillFields } from "./formTemplate";

describe("renderTemplate", () => {
  it("เติมตัวแปรและคัดลอกแถวรายการตามจำนวนตัวอย่าง พร้อม escape HTML", () => {
    const html = starterTemplateHtml("ใบคำขอ", "FM-1", "R01", PETITION_SCHEMA);
    expect(hasFillFields(html)).toBe(true);
    const out = renderTemplate(html, {
      vars: { petitionNo: "P-001", submittedAt: "16/11/2569", submitterName: "สมชาย", submitterDept: "ผลิต" },
      items: [{ "item.seq": "1", "item.sampleName": "<b>A</b>" }, { "item.seq": "2", "item.sampleName": "B" }],
    });
    const el = document.createElement("div");
    el.innerHTML = out;
    expect(el.textContent).toContain("P-001");
    expect(el.textContent).toContain("สมชาย");
    expect(el.querySelectorAll("tr").length).toBe(3); // หัวตาราง + 2 แถว
    expect(el.querySelector("[data-fv-repeat]")).toBeNull();
    expect(el.querySelector("b")).toBeNull(); // ค่าจากข้อมูลไม่ถูกตีความเป็น HTML
    expect(el.textContent).toContain("<b>A</b>");
  });
});
