import { describe, expect, it } from "vitest";
import { annotateSystemPage, fillSystemPage, isSlotTemplate } from "./systemFormSlots";

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
    expect(tpl).not.toContain("contenteditable");
    expect(tpl).not.toContain("scale(0.8)");
    // ผู้ใช้แก้: เพิ่มหัวข้อ + เปลี่ยนสีหัวตาราง
    const edited = "<h1>หัวใหม่</h1>" + tpl.replace("<th>ชื่อ</th>", '<th style="color:red">ชื่อตัวอย่าง</th>');
    const out = document.createElement("div");
    out.innerHTML = fillSystemPage(edited, page("สมชาย", true, ["A-1", "A-2"]));
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
});
