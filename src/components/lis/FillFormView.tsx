import { useEffect, useRef, type CSSProperties } from "react";

// แสดงเอกสารแบบให้กรอก: เปลี่ยน <span data-ff> เป็น input จริง แล้วพิมพ์ได้ทันที
// ค่าที่กรอกไม่ถูกบันทึกกลับเข้าแม่แบบ (แม่แบบใช้ซ้ำได้)
export default function FillFormView({ html, style }: { html: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = html;
    root.querySelectorAll<HTMLElement>("[data-ff]").forEach((el) => {
      const type = el.dataset.ff;
      const label = el.dataset.ffLabel || "";
      let input: HTMLElement;
      if (type === "textarea") {
        const t = document.createElement("textarea");
        t.rows = 3;
        input = t;
      } else if (type === "checkbox") {
        const c = document.createElement("input");
        c.type = "checkbox";
        input = c;
      } else {
        const i = document.createElement("input");
        i.type = type === "date" ? "date" : "text";
        if (type === "signature") i.placeholder = "ลงชื่อ";
        input = i;
      }
      input.className = "ff-input ff-" + type;
      input.setAttribute("aria-label", label);
      // input ไม่เก็บค่าไว้ใน attribute → sync เพื่อให้ print/serialize เห็นค่า
      input.addEventListener("input", () => {
        if (input instanceof HTMLInputElement && input.type === "checkbox") input.toggleAttribute("checked", input.checked);
        else if (input instanceof HTMLTextAreaElement) input.textContent = input.value;
        else input.setAttribute("value", (input as HTMLInputElement).value);
      });
      input.addEventListener("change", () => input.dispatchEvent(new Event("input")));
      el.replaceWith(input);
    });
  }, [html]);
  return <div ref={ref} style={style} aria-label="แบบฟอร์มสำหรับกรอก" className="doc-page doc-fill mx-auto bg-white text-black shadow-md print:shadow-none" />;
}
