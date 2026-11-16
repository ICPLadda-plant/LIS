import { describe, expect, it } from "vitest";
import { fillFieldHtml, hasFillFields } from "./formTemplate";

describe("fill fields", () => {
  it("escape ชื่อช่อง และตรวจว่ามีช่องกรอก", () => {
    const html = fillFieldHtml("text", '<b>"x"</b>');
    expect(hasFillFields(html)).toBe(true);
    expect(html).not.toContain("<b>");
    expect(hasFillFields("<p>none</p>")).toBe(false);
  });
});
