import { solveFitScale } from "@/lib/printFit";

// "ผูกช่อง" ระหว่างฟอร์มเดิมของระบบ (React print template) กับแม่แบบที่ผู้ใช้แก้ในหน้า "จัดการเอกสาร"
// - annotate: ใส่เลขกำกับให้ช่องข้อมูล (.pr-edit), กล่องติ๊ก (.pr-toggle) และตารางรายการ (tbody ใต้ thead) ตามลำดับที่ปรากฏ
// - fill: ตอนพิมพ์ ระบบวาดฟอร์มเดิมด้วยข้อมูลจริง (ซ่อนไว้) แล้วคัดลอกค่าไปใส่ช่องที่เลขตรงกันในแม่แบบ
// ผู้ใช้จึงแก้หน้าตา/ข้อความ/ย้ายช่องได้ แต่ข้อมูลยังเหมือนฟอร์มเดิมทุกช่อง

const EDIT = ".pr-edit";
const TOGGLE = ".pr-toggle";
const rowBodies = (root: ParentNode) =>
  Array.from(root.querySelectorAll("table")).filter((t) => t.tHead).map((t) => t.tBodies[0]).filter(Boolean) as HTMLTableSectionElement[];

/** แปลง section ของฟอร์มระบบที่ render แล้ว เป็น HTML แม่แบบที่มีเลขกำกับ (ไม่แก้ DOM ต้นฉบับ) */
export function annotateSystemPage(section: HTMLElement): string {
  const page = section.cloneNode(true) as HTMLElement;
  page.querySelectorAll<HTMLElement>(EDIT).forEach((el, i) => {
    el.dataset.slot = "e" + i;
    el.classList.add("fv-slot");
    el.removeAttribute("spellcheck");
  });
  page.querySelectorAll<HTMLElement>(TOGGLE).forEach((el, i) => {
    el.dataset.slot = "c" + i;
    ["role", "tabindex", "aria-checked"].forEach((a) => el.removeAttribute(a));
  });
  lockSlots(page);
  rowBodies(page).forEach((tb, i) => { tb.dataset.slotRows = String(i); });
  // FitToBox วัดขนาดตอน render แล้วเขียน scale ลง inline style — รีเซ็ตให้แม่แบบเริ่มที่ขนาดปกติ
  page.querySelectorAll<HTMLElement>("[data-fit-content]").forEach((el) => {
    el.style.width = "100%";
    el.style.minHeight = "100%";
    el.style.transform = "none";
  });
  return page.outerHTML;
}

export const isSlotTemplate = (html: string) => html.includes("data-slot=");

/** ช่องผูกข้อมูลเป็นก้อนเดียว (แก้ข้อความข้างในไม่ได้ แต่เลือก/ลบ/ย้ายทั้งก้อนได้) — ใช้กับแม่แบบที่บันทึกไว้ก่อนหน้าด้วย */
export function lockSlots(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => el.setAttribute("contenteditable", "false"));
}

/**
 * ย่อเนื้อหาให้พอดีกรอบกระดาษแบบเดียวกับ FitToBox (กรอบความสูงตายตัว + overflow:hidden)
 * ต้องเรียกหลังเนื้อหาอยู่ใน DOM จริง ทั้งตอนแก้ใน editor และตอนพิมพ์ ไม่งั้นท่อนล่างของฟอร์มถูกตัดหาย
 */
export function refitBoxes(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-fit-box]").forEach((box) => {
    const content = Array.from(box.children).find((c) => c.hasAttribute("data-fit-content")) as HTMLElement | undefined;
    if (!content) return;
    const scale = solveFitScale({
      boxHeight: box.clientHeight,
      measureHeight: (candidate) => {
        content.style.width = 100 / candidate + "%";
        content.style.minHeight = "0";
        content.style.transform = "none";
        return content.scrollHeight;
      },
    });
    content.style.width = 100 / scale + "%";
    content.style.minHeight = 100 / scale + "%";
    content.style.transform = scale < 1 ? "scale(" + scale + ")" : "none";
    content.style.transformOrigin = "top left";
  });
}

/** เติมข้อมูลจริงจาก section ของฟอร์มระบบ (source) ลงแม่แบบ คืน HTML ที่พร้อมพิมพ์ */
export function fillSystemPage(templateHtml: string, source: HTMLElement): string {
  const doc = new DOMParser().parseFromString("<div id=root>" + templateHtml + "</div>", "text/html");
  const root = doc.getElementById("root")!;
  const edits = Array.from(source.querySelectorAll<HTMLElement>(EDIT));
  const toggles = Array.from(source.querySelectorAll<HTMLElement>(TOGGLE));
  const bodies = rowBodies(source);
  root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
    const kind = el.dataset.slot![0];
    const idx = Number(el.dataset.slot!.slice(1));
    if (kind === "e") {
      el.textContent = edits[idx]?.textContent ?? "";
      el.classList.remove("fv-slot");
      el.removeAttribute("contenteditable");
    } else if (kind === "c") {
      el.removeAttribute("contenteditable");
      const src = toggles[idx];
      const on = !!src && /pr-(cb|rd)-x/.test(src.className);
      el.classList.remove("pr-cb-x", "pr-rd-x");
      if (on) el.classList.add(el.classList.contains("pr-rd") ? "pr-rd-x" : "pr-cb-x");
    }
  });
  root.querySelectorAll<HTMLElement>("[data-slot-rows]").forEach((tb) => {
    const src = bodies[Number(tb.dataset.slotRows)];
    if (src) tb.innerHTML = src.innerHTML;
  });
  return root.innerHTML;
}
