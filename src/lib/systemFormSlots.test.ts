import { describe, expect, it } from "vitest";
import { annotateSystemPage, fillSystemPage, isSlotTemplate, slotCatalog, slotHtml } from "./systemFormSlots";
import { fillFieldHtml } from "./formTemplate";

const page = (name: string, checked: boolean, rows: string[]) => {
  const el = document.createElement("section");
  el.className = "pr-page2";
  el.innerHTML =
    '<div data-fit-box><div data-fit-content style="transform: scale(0.8); width: 125%">' +
    '<span class="pr-line pr-edit" contenteditable="true">' + name + "</span>" +
    '<span class="pr-cb pr-toggle' + (checked ? " pr-cb-x" : "") + '" role="checkbox" tabindex="0"></span>' +
    '<span class="pr-rd pr-toggle" role="checkbox"></span>' +
    "<table><thead><tr><th>ชื่อ</th></tr></thead><tbody>" + rows.map((r) => "<tr><td>" + r + "</td></tr>").join("") + "</tbody></table>" +
    "</div></div>";
  return el;
};

describe("system form slots", () => {
  it("ผูกช่องแล้วเติมข้อมูลจริงได้ครบ แม้ผู้ใช้แก้หน้าตา", () => {
    const tpl = annotateSystemPage(page("ตัวอย่าง", false, ["a"]));
    expect(isSlotTemplate(tpl)).toBe(true);
    expect(tpl).not.toContain('contenteditable="true"');
    expect(tpl).toContain('data-slot="e0" contenteditable="false"'.replace(' contenteditable="false"', "")); // มีเลขช่อง
    expect((tpl.match(/contenteditable="false"/g) ?? []).length).toBe(3); // ช่องข้อความ + กล่องติ๊ก 2 = ก้อนเดียว ลบทั้งก้อนได้
    expect(tpl).not.toContain("scale(0.8)");
    // ผู้ใช้แก้: เพิ่มหัวข้อ + เปลี่ยนสีหัวตาราง
    const edited = "<h1>หัวใหม่</h1>" + tpl.replace("<th>ชื่อ</th>", '<th style="color:red">ชื่อตัวอย่าง</th>');
    const out = document.createElement("div");
    out.innerHTML = fillSystemPage(edited, page("สมชาย", true, ["A-1", "A-2"]));
    expect(out.innerHTML).not.toContain("contenteditable");
    expect(out.querySelector("h1")!.textContent).toBe("หัวใหม่");
    expect(out.querySelector("[data-slot=e0]")!.textContent).toBe("สมชาย");
    expect(out.querySelector("[data-slot=e0]")!.classList.contains("fv-slot")).toBe(false);
    expect(out.querySelector("[data-slot=c0]")!.classList.contains("pr-cb-x")).toBe(true);
    expect(out.querySelector("[data-slot=c1]")!.classList.contains("pr-rd-x")).toBe(false);
    expect(Array.from(out.querySelectorAll("tbody td")).map((t) => t.textContent)).toEqual(["A-1", "A-2"]);
    expect(out.querySelector("th")!.getAttribute("style")).toBe("color:red");
  });

  it("กล่องติ๊กที่เคยติ๊กในแม่แบบ จะตามข้อมูลจริงตอนพิมพ์", () => {
    const tpl = annotateSystemPage(page("x", true, []));
    const out = document.createElement("div");
    out.innerHTML = fillSystemPage(tpl, page("y", false, []));
    expect(out.querySelector("[data-slot=c0]")!.classList.contains("pr-cb-x")).toBe(false);
  });

  it("ลบช่องแล้วแทรกกลับจากรายการได้ และช่องกรอกที่เพิ่มพิมพ์เป็นเส้นประให้เขียน", () => {
    const src = document.createElement("section");
    src.innerHTML = '<div>โทรศัพท์ : <span class="pr-line pr-edit" style="min-width: 3.5cm">034-1</span> E-mail : <span class="pr-line pr-edit">a@x</span></div>'
      + '<div><span class="pr-cb pr-toggle pr-cb-x"></span> 1.1 ลูกค้ามาเอง</div>';
    const tpl = annotateSystemPage(src);
    const cat = slotCatalog(tpl);
    expect(cat.map((c) => [c.slot, c.label])).toEqual([["e0", "โทรศัพท์"], ["e1", "E-mail"], ["c0", "1.1 ลูกค้ามาเอง"]]);
    // ผู้ใช้ลบทุกช่อง แล้วแทรกโทรศัพท์กลับ 2 ที่ + ช่องกรอกของตัวเอง
    const edited = "<p>โทร " + slotHtml(cat[0]) + " สำรอง " + slotHtml(cat[0]) + " ผู้ตรวจ " + fillFieldHtml("text", "ผู้ตรวจ") + fillFieldHtml("checkbox", "ผ่าน") + "</p>";
    const real = document.createElement("section");
    real.innerHTML = src.innerHTML.replace("034-1", "02-999");
    const out = document.createElement("div");
    out.innerHTML = fillSystemPage(edited, real);
    expect(Array.from(out.querySelectorAll("[data-slot=e0]")).map((x) => x.textContent)).toEqual(["02-999", "02-999"]);
    expect(out.querySelector("[data-slot=e0]")!.getAttribute("style")).toContain("3.5cm");
    expect(out.textContent).not.toContain("[ผู้ตรวจ]");
    expect(out.querySelector('[aria-label="ผู้ตรวจ"]')!.className).toBe("pr-line pr-edit");
    expect(out.querySelector('[aria-label="ผ่าน"]')!.className).toBe("pr-cb pr-toggle");
  });
});
