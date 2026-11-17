import { solveFitScale } from "@/lib/printFit";

// "ผูกช่อง" ระหว่างฟอร์มเดิมของระบบ (React print template) กับแม่แบบที่ผู้ใช้แก้ในหน้า "จัดการเอกสาร"
// - annotate: ใส่เลขกำกับให้ช่องข้อมูล (.pr-edit), กล่องติ๊ก (.pr-toggle) และตารางรายการ (tbody ใต้ thead) ตามลำดับที่ปรากฏ
// - fill: ตอนพิมพ์ ระบบวาดฟอร์มเดิมด้วยข้อมูลจริง (ซ่อนไว้) แล้วคัดลอกค่าไปใส่ช่องที่เลขตรงกันในแม่แบบ
// ผู้ใช้จึงแก้หน้าตา/ข้อความ/ย้ายช่องได้ แต่ข้อมูลยังเหมือนฟอร์มเดิมทุกช่อง

const EDIT = ".pr-edit";
const TOGGLE = ".pr-toggle";

export type SlotInfo = { slot: string; kind: "e" | "c"; label: string; sample: string; className: string; style: string };

// ชื่อช่องสำหรับให้ผู้ใช้เลือก: ข้อความก่อนหน้า (ช่องข้อมูล เช่น "โทรศัพท์ :") หรือข้อความถัดไป (กล่องติ๊ก เช่น "1.1 ลูกค้ามาเอง")
function nearbyText(el: Element, dir: "before" | "after"): string {
  const block = el.closest("div, td, th, p, li, section") ?? el.parentElement;
  if (!block) return "";
  const range = el.ownerDocument.createRange();
  // หยุดที่ช่องข้างเคียงในบล็อกเดียวกัน — ชื่อช่องคือข้อความระหว่างช่อง เช่น "โทรศัพท์ : [..] E-mail : [..]"
  const others = Array.from(block.querySelectorAll(EDIT + ", " + TOGGLE)).filter((x) => x !== el);
  const isBefore = (x: Element) => !!(x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (dir === "before") {
    const prev = others.filter(isBefore).pop();
    if (prev) range.setStartAfter(prev); else range.setStart(block, 0);
    range.setEndBefore(el);
  } else {
    const next = others.find((x) => !isBefore(x));
    range.setStartAfter(el);
    if (next) range.setEndBefore(next); else range.setEnd(block, block.childNodes.length);
  }
  const frag = range.cloneContents();
  frag.querySelectorAll(EDIT).forEach((x) => x.remove()); // ไม่เอาค่าของช่องข้างเคียงมาปน
  const text = (frag.textContent ?? "").replace(/\s+/g, " ").trim();
  const cut = dir === "before" ? text.slice(-28) : text.slice(0, 28);
  return cut.replace(/^[\s:(/)]+|[\s:(/)]+$/g, "").trim();
}
const rowBodies = (root: ParentNode) =>
  Array.from(root.querySelectorAll("table")).filter((t) => t.tHead).map((t) => t.tBodies[0]).filter(Boolean) as HTMLTableSectionElement[];

/** แปลง section ของฟอร์มระบบที่ render แล้ว เป็น HTML แม่แบบที่มีเลขกำกับ (ไม่แก้ DOM ต้นฉบับ) */
export function annotateSystemPage(section: HTMLElement): string {
  const page = section.cloneNode(true) as HTMLElement;
  page.querySelectorAll<HTMLElement>(EDIT).forEach((el, i) => {
    el.dataset.slot = "e" + i;
    el.classList.add("fv-slot");
    el.removeAttribute("spellcheck");
    el.dataset.slotLabel = nearbyText(section.querySelectorAll(EDIT)[i], "before") || "ช่องข้อมูล " + (i + 1);
  });
  page.querySelectorAll<HTMLElement>(TOGGLE).forEach((el, i) => {
    el.dataset.slot = "c" + i;
    ["role", "tabindex", "aria-checked"].forEach((a) => el.removeAttribute(a));
    el.dataset.slotLabel = nearbyText(section.querySelectorAll(TOGGLE)[i], "after") || "กล่องติ๊ก " + (i + 1);
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

/** รายการช่องทั้งหมดของฟอร์มระบบ (จากแม่แบบที่เพิ่ง capture) สำหรับให้ผู้ใช้แทรกกลับ/เพิ่มซ้ำ */
export function slotCatalog(templateHtml: string): SlotInfo[] {
  const doc = new DOMParser().parseFromString("<div id=root>" + templateHtml + "</div>", "text/html");
  return Array.from(doc.querySelectorAll<HTMLElement>("[data-slot]")).map((el) => ({
    slot: el.dataset.slot!,
    kind: el.dataset.slot![0] as "e" | "c",
    label: el.dataset.slotLabel || el.dataset.slot!,
    sample: (el.textContent ?? "").trim(),
    className: el.className.replace(/\b(slot-selected|pr-cb-x|pr-rd-x)\b/g, "").trim(),
    style: el.getAttribute("style") ?? "",
  }));
}

const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** HTML ของช่องที่แทรกเพิ่ม — เลขช่องเดียวกับฟอร์มเดิม ระบบจึงเติมข้อมูลจริงให้ตอนพิมพ์ */
export function slotHtml(info: SlotInfo): string {
  return '<span class="' + escAttr(info.className) + '" style="' + escAttr(info.style) + '" data-slot="' + info.slot
    + '" data-slot-label="' + escAttr(info.label) + '" contenteditable="false">' + (info.kind === "e" ? escAttr(info.sample) : "") + "</span>";
}

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
  // ช่องกรอกที่ผู้ใช้เพิ่ม (data-ff): พิมพ์เป็นเส้นประให้เขียน/พิมพ์เติมในหน้าตัวอย่างก่อนพิมพ์ได้ — ไม่ใช่ข้อความ [ชื่อช่อง]
  root.querySelectorAll<HTMLElement>("[data-ff]").forEach((el) => {
    const blank = doc.createElement("span");
    if (el.dataset.ff === "checkbox") {
      blank.className = "pr-cb pr-toggle";
    } else {
      blank.className = "pr-line pr-edit";
      blank.setAttribute("contenteditable", "true");
      blank.style.minWidth = el.dataset.ff === "textarea" ? "12cm" : el.dataset.ff === "signature" ? "5cm" : "3cm";
    }
    blank.setAttribute("aria-label", el.dataset.ffLabel ?? "");
    el.replaceWith(blank);
  });
  return root.innerHTML;
}
