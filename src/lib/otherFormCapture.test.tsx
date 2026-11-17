import { describe, expect, it, vi } from "vitest";
import { SYSTEM_DOCS } from "@/lib/documentRegistry";
import { SYSTEM_FORM_CAPTURE } from "@/lib/systemFormCapture";
import { captureOtherForm, hasOtherFormCapture } from "@/lib/otherFormCapture";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));

const key = (d: { code: string; name: string }) => (d.code && d.code !== "-" ? d.code : d.name);

describe("captureOtherForm", () => {
  const others = SYSTEM_DOCS.filter((d) => !SYSTEM_FORM_CAPTURE[d.code]);
  it("ทุกฟอร์มในทะเบียนมีหน้าตาจริงให้เริ่มแม่แบบ", () => {
    expect(others.filter((d) => !hasOtherFormCapture(key(d))).map(key)).toEqual([]);
  });
  it.each(others.map((d) => [key(d)]))("%s render ได้", async (k) => {
    const html = await captureOtherForm(k);
    expect(html.replace(/<style>[\s\S]*?<\/style>/g, "").length).toBeGreaterThan(100);
  });
  it("ป้ายสินค้า อย. ใช้แบบมีสัญลักษณ์อันตราย", async () => {
    expect(await captureOtherForm("F-LAB-01-10")).toContain("sample-label-hazard-form");
    expect(await captureOtherForm("F-LAB-01-12")).not.toContain("sample-label-hazard-form");
  });
});
