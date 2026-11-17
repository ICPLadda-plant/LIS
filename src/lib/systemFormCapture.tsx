import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import PetitionPrintTemplate from "@/components/petition/PetitionPrintTemplate";
import { api } from "@/lib/api";
import { annotateSystemPage, slotCatalog, type SlotInfo } from "@/lib/systemFormSlots";
import type { LabRequest } from "@/types/labRequest.types";
import type { Petition } from "@/types/petition.types";

// ฟอร์มระบบที่แก้เป็นแม่แบบได้ → render จาก component เดิมแล้วเลือก section ไหน
export const SYSTEM_FORM_CAPTURE: Record<string, { selector: string }> = {
  "FM-QP-07-01-001": { selector: ".pr-page1" },
  "FM-QP-07-04-001": { selector: ".pr-page2" },
};

// ใช้คำร้องล่าสุดที่มีใบคำขอ เพื่อให้แม่แบบเริ่มต้นแสดงค่าตัวอย่างจริง (ตอนพิมพ์ระบบเติมข้อมูลคำร้องนั้น ๆ เอง)
async function samplePetition(): Promise<{ petition: Petition; labRequest: LabRequest }> {
  const empty = { petition: { items: [], dept: "production", submittedBy: { name: "" } } as unknown as Petition, labRequest: { sampleSeq: 1, requester: {} } as unknown as LabRequest };
  try {
    const list = await api.get<{ items?: LabRequest[] }>("/lab-requests?limit=1");
    const lr = list.data.data?.items?.[0] as (LabRequest & { petitionId?: string }) | undefined;
    if (!lr?.petitionId) return empty;
    const p = await api.get<Petition>("/petitions/" + lr.petitionId);
    return { petition: p.data.data, labRequest: lr };
  } catch {
    return empty;
  }
}

/** สร้าง HTML แม่แบบจากฟอร์มเดิมของระบบ (หน้าตาเหมือนฟอร์มที่พิมพ์อยู่ + เลขกำกับทุกช่องข้อมูล) */
export async function captureSystemForm(code: string): Promise<string> {
  const cfg = SYSTEM_FORM_CAPTURE[code];
  if (!cfg) throw new Error("ฟอร์มนี้ยังแก้เป็นแม่แบบไม่ได้");
  const { petition, labRequest } = await samplePetition();
  const host = document.createElement("div");
  // ต้องอยู่ใน layout จริง (ไม่ใช่ display:none) เพื่อให้ FitToBox วัดขนาดได้
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;pointer-events:none;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<PetitionPrintTemplate labRequest={labRequest} petition={petition} />));
    const section = host.querySelector<HTMLElement>(cfg.selector);
    if (!section) throw new Error("render ฟอร์มระบบไม่สำเร็จ");
    const css = host.querySelector("style")?.textContent ?? "";
    return "<style>" + css + '</style><div class="pr-root">' + annotateSystemPage(section) + "</div>";
  } finally {
    root.unmount();
    host.remove();
  }
}

const catalogCache = new Map<string, Promise<SlotInfo[]>>();
/** ช่องทั้งหมดของฟอร์มระบบ (ชื่อ + ค่าตัวอย่าง) สำหรับเมนู "แทรกช่องข้อมูลจากระบบ" — render ครั้งเดียวต่อฟอร์ม */
export function systemFormCatalog(code: string): Promise<SlotInfo[]> {
  if (!catalogCache.has(code)) {
    const p = captureSystemForm(code).then(slotCatalog);
    p.catch(() => catalogCache.delete(code));
    catalogCache.set(code, p);
  }
  return catalogCache.get(code)!;
}
