import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeForPrint, collectDocumentCss, localPrintPageCss, PRINT_UNHIDE_CSS } from "./print";

describe("local print document", () => {
  // ก่อนแก้: index.css ซ่อน .bcr ตอนพิมพ์ ทำให้ได้กระดาษเปล่า
  it("keeps a .bcr report visible when the app's hide rule is also present", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(
      `<html><head><style>@media print { body * { visibility: hidden; } .doc-page, .doc-page * { visibility: visible; } }</style>` +
        `<style>${PRINT_UNHIDE_CSS}</style></head><body><section class="bcr">report</section></body></html>`,
    );
    doc.close();
    const report = doc.querySelector(".bcr")!;
    const printVisibility = Array.from(doc.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules) as CSSRule[])
      .filter((rule): rule is CSSMediaRule => rule instanceof (doc.defaultView as Window & typeof globalThis).CSSMediaRule)
      .flatMap((media) => Array.from(media.cssRules).map((rule) => rule.cssText));
    // กฎสุดท้ายที่ชนกับ body * ต้องเป็น visible
    const last = printVisibility.filter((text) => text.includes("body *")).at(-1);
    expect(report).not.toBeNull();
    expect(last).toContain("visible");
    frame.remove();
  });
});

describe("PRINT_UNHIDE_CSS", () => {
  // index.css ซ่อนทุกอย่างยกเว้น .doc-page ตอนพิมพ์ ทำให้รายงานอื่น (.bcr) ออกมาเป็นกระดาษเปล่า
  it("re-shows every element under @media print", () => {
    const style = document.createElement("style");
    style.textContent = PRINT_UNHIDE_CSS;
    document.head.appendChild(style);
    const media = Array.from(style.sheet!.cssRules)[0] as CSSMediaRule;
    expect(media.media.mediaText).toBe("print");
    const inner = Array.from(media.cssRules).map((rule) => rule.cssText).join(" ");
    expect(inner).toContain("body *");
    expect(inner).toContain("visible");
    style.remove();
  });
});

describe("serializeForPrint", () => {
  it("returns the element's outerHTML", () => {
    const el = document.createElement("div");
    el.className = "doc";
    el.innerHTML = "<p>hello</p>";
    expect(serializeForPrint(el)).toContain("<p>hello</p>");
    expect(serializeForPrint(el)).toContain('class="doc"');
  });

  it("prepends a <style> block when css is given", () => {
    const el = document.createElement("div");
    el.innerHTML = "x";
    const out = serializeForPrint(el, ".doc{color:red}");
    expect(out.startsWith("<style>.doc{color:red}</style>")).toBe(true);
    expect(out).toContain("x");
  });

  it("throws on null element", () => {
    expect(() => serializeForPrint(null)).toThrow();
  });
});

describe("collectDocumentCss", () => {
  let styleEl: HTMLStyleElement;
  beforeEach(() => {
    styleEl = document.createElement("style");
    styleEl.textContent = ".lis-test-marker{color:rgb(1,2,3);}";
    document.head.appendChild(styleEl);
  });
  afterEach(() => {
    styleEl.remove();
  });

  it("returns CSS text from document stylesheets including injected rules", () => {
    const css = collectDocumentCss();
    expect(css).toContain(".lis-test-marker");
  });

  it("never throws (cross-origin sheets are skipped)", () => {
    expect(() => collectDocumentCss()).not.toThrow();
  });
});

describe("localPrintPageCss", () => {
  it("uses the configured sticker paper size when printing locally", () => {
    expect(localPrintPageCss("sample-label", "label-65x25")).toContain("size: 65mm 25mm");
    expect(localPrintPageCss("stock-label", "label-100x50")).toContain("size: 100mm 50mm");
  });
});
