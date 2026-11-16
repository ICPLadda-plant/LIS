import { useRef, useState } from "react";
import mammoth from "mammoth";
import HTMLtoDOCX from "@turbodocx/html-to-docx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, FilePlus, FileUp, Highlighter, Italic,
  List, ListOrdered, Printer, Redo2, Save, Strikethrough, Table, Trash2, Underline, Undo2, Download, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

type Doc = { id: string; title: string; html: string; source: "สร้างเอง" | "นำเข้า Word"; updatedAt: string };

// ponytail: เก็บใน localStorage (เฉพาะเครื่องนี้, ~5MB). ย้ายไป API server เมื่อต้องแชร์เอกสารข้ามผู้ใช้
const KEY = "lis.documents";
const load = (): Doc[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };

const FONTS = ["TH Sarabun New", "Angsana New", "Cordia New", "Tahoma", "Arial", "Times New Roman"];
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32];
// ponytail: execCommand เป็น API เก่าแต่ทุกเบราว์เซอร์ยังรองรับ; เปลี่ยนเป็น editor library เมื่อต้องการ track changes
const exec = (cmd: string, val?: string) => { document.execCommand("styleWithCSS", false, "true"); document.execCommand(cmd, false, val); };

// ขนาดตัวอักษรแบบ pt: execCommand รองรับแค่ 1-7 จึงใส่ span เอง
const setSize = (pt: number) => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  span.style.fontSize = pt + "pt";
  span.appendChild(range.extractContents());
  range.insertNode(span);
};

const currentCell = () => {
  const n = window.getSelection()?.anchorNode;
  const el = n instanceof Element ? n : n?.parentElement;
  return el?.closest("td,th") as HTMLTableCellElement | null;
};

const tableOps = {
  insert: () => {
    const rows = Array.from({ length: 3 }, () => "<tr>" + "<td><br></td>".repeat(3) + "</tr>").join("");
    exec("insertHTML", "<table><tbody>" + rows + "</tbody></table><p><br></p>");
  },
  addRow: () => {
    const c = currentCell(); if (!c) return toast.info("คลิกในตารางก่อน");
    const tr = c.parentElement as HTMLTableRowElement;
    const n = tr.cloneNode(true) as HTMLTableRowElement;
    n.querySelectorAll("td,th").forEach((x) => (x.innerHTML = "<br>"));
    tr.after(n);
  },
  addCol: () => {
    const c = currentCell(); if (!c) return toast.info("คลิกในตารางก่อน");
    const i = c.cellIndex;
    c.closest("table")!.querySelectorAll("tr").forEach((tr) => {
      const td = document.createElement("td"); td.innerHTML = "<br>";
      (tr.children[i] ?? tr.lastElementChild)?.after(td);
    });
  },
  delRow: () => { const c = currentCell(); if (c) c.parentElement!.remove(); },
  delCol: () => {
    const c = currentCell(); if (!c) return;
    const i = c.cellIndex;
    c.closest("table")!.querySelectorAll("tr").forEach((tr) => tr.children[i]?.remove());
  },
  delTable: () => currentCell()?.closest("table")?.remove(),
};

const download = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function Tool({ label, icon: Icon, onClick }: { label: string; icon?: typeof Bold; onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant="ghost" title={label} aria-label={label} className="h-8 px-2"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}>
      {Icon ? <Icon className="w-4 h-4" /> : label}
    </Button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center border-r px-2 last:border-r-0">
      <div className="flex flex-wrap items-center gap-1">{children}</div>
      <span className="mt-1 text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";

function Ribbon() {
  return (
    <Tabs defaultValue="home" className="rounded-lg border bg-card">
      <TabsList className="m-1">
        <TabsTrigger value="home">หน้าแรก</TabsTrigger>
        <TabsTrigger value="insert">แทรก</TabsTrigger>
        <TabsTrigger value="layout">เค้าโครง</TabsTrigger>
      </TabsList>
      <TabsContent value="home" className="mt-0 flex flex-wrap items-stretch gap-y-2 border-t p-2">
        <Group label="ย้อนกลับ">
          <Tool label="เลิกทำ" icon={Undo2} onClick={() => exec("undo")} />
          <Tool label="ทำซ้ำ" icon={Redo2} onClick={() => exec("redo")} />
        </Group>
        <Group label="แบบอักษร">
          <select aria-label="ฟอนต์" className={selectCls} defaultValue="" onChange={(e) => { exec("fontName", e.target.value); e.target.value = ""; }}>
            <option value="" disabled>ฟอนต์</option>
            {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select>
          <select aria-label="ขนาด" className={selectCls} defaultValue="" onChange={(e) => { setSize(+e.target.value); e.target.value = ""; }}>
            <option value="" disabled>ขนาด</option>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Tool label="ตัวหนา" icon={Bold} onClick={() => exec("bold")} />
          <Tool label="ตัวเอียง" icon={Italic} onClick={() => exec("italic")} />
          <Tool label="ขีดเส้นใต้" icon={Underline} onClick={() => exec("underline")} />
          <Tool label="ขีดฆ่า" icon={Strikethrough} onClick={() => exec("strikeThrough")} />
          <label title="สีตัวอักษร" className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold hover:bg-accent">
            A<input type="color" aria-label="สีตัวอักษร" className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0" onChange={(e) => exec("foreColor", e.target.value)} />
          </label>
          <label title="ไฮไลต์" className="flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent">
            <Highlighter className="w-4 h-4" />
            <input type="color" aria-label="ไฮไลต์" defaultValue="#ffff00" className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0" onChange={(e) => exec("hiliteColor", e.target.value)} />
          </label>
        </Group>
        <Group label="ย่อหน้า">
          <Tool label="รายการจุด" icon={List} onClick={() => exec("insertUnorderedList")} />
          <Tool label="รายการตัวเลข" icon={ListOrdered} onClick={() => exec("insertOrderedList")} />
          <Tool label="ชิดซ้าย" icon={AlignLeft} onClick={() => exec("justifyLeft")} />
          <Tool label="กึ่งกลาง" icon={AlignCenter} onClick={() => exec("justifyCenter")} />
          <Tool label="ชิดขวา" icon={AlignRight} onClick={() => exec("justifyRight")} />
          <Tool label="เต็มแนว" icon={AlignJustify} onClick={() => exec("justifyFull")} />
        </Group>
        <Group label="ลักษณะ">
          <Tool label="ปกติ" onClick={() => exec("formatBlock", "p")} />
          <Tool label="หัวเรื่อง 1" onClick={() => exec("formatBlock", "h1")} />
          <Tool label="หัวเรื่อง 2" onClick={() => exec("formatBlock", "h2")} />
        </Group>
      </TabsContent>
      <TabsContent value="insert" className="mt-0 flex flex-wrap items-stretch gap-y-2 border-t p-2">
        <Group label="ตาราง">
          <Tool label="แทรกตาราง 3×3" icon={Table} onClick={tableOps.insert} />
          <Tool label="+ แถว" onClick={tableOps.addRow} />
          <Tool label="+ คอลัมน์" onClick={tableOps.addCol} />
          <Tool label="ลบแถว" onClick={tableOps.delRow} />
          <Tool label="ลบคอลัมน์" onClick={tableOps.delCol} />
          <Tool label="ลบตาราง" onClick={tableOps.delTable} />
        </Group>
        <Group label="อื่น ๆ">
          <Tool label="เส้นคั่น" onClick={() => exec("insertHorizontalRule")} />
          <Tool label="ขึ้นหน้าใหม่" onClick={() => exec("insertHTML", '<div class="page-break" style="page-break-after:always"></div><p><br></p>')} />
        </Group>
      </TabsContent>
      <TabsContent value="layout" className="mt-0 flex flex-wrap items-stretch gap-y-2 border-t p-2">
        <Group label="ระยะบรรทัด">
          {["1", "1.15", "1.5", "2"].map((v) => (
            <Tool key={v} label={v} onClick={() => {
              const n = window.getSelection()?.anchorNode;
              const el = (n instanceof Element ? n : n?.parentElement)?.closest("p,h1,h2,h3,li,td") as HTMLElement | null;
              if (el) el.style.lineHeight = v;
            }} />
          ))}
        </Group>
        <Group label="ล้างรูปแบบ">
          <Tool label="ล้างรูปแบบ" onClick={() => exec("removeFormat")} />
        </Group>
      </TabsContent>
    </Tabs>
  );
}

export default function DocumentManager() {
  const [docs, setDocs] = useState<Doc[]>(load);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [title, setTitle] = useState("");
  const editor = useRef<HTMLDivElement>(null);

  const save = (next: Doc[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setDocs(next); return true; }
    catch { toast.error("บันทึกไม่สำเร็จ พื้นที่เก็บเต็ม"); return false; }
  };
  const upsert = (d: Doc) => save([d, ...docs.filter((x) => x.id !== d.id)]);
  const open = (d: Doc) => { setCurrent(d); setTitle(d.title); };
  const newDoc = (t: string, html: string, source: Doc["source"]): Doc =>
    ({ id: crypto.randomUUID(), title: t, html, source, updatedAt: new Date().toISOString() });

  const importWord = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) return toast.error("รองรับเฉพาะไฟล์ .docx");
    try {
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const d = newDoc(file.name.replace(/\.docx$/i, ""), value, "นำเข้า Word");
      upsert(d); open(d); toast.success("นำเข้าเอกสารแล้ว");
    } catch { toast.error("แปลงไฟล์ Word ไม่สำเร็จ"); }
  };

  const remove = (d: Doc) => {
    if (!confirm('ลบ "' + d.title + '"?')) return;
    save(docs.filter((x) => x.id !== d.id));
  };

  const html = () => editor.current?.innerHTML ?? "";

  const exportDocx = async () => {
    try {
      const out = await HTMLtoDOCX(html(), null, {
        font: "TH Sarabun New", fontSize: 32, // half-points = 16pt
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        table: { row: { cantSplit: true } },
      });
      download(out instanceof Blob ? out : new Blob([out as BlobPart]), (title || "document") + ".docx");
    } catch { toast.error("ส่งออกไฟล์ Word ไม่สำเร็จ"); }
  };

  if (current) {
    return (
      <div className="space-y-3 doc-editor-shell">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => setCurrent(null)}>
            <ArrowLeft className="w-4 h-4" />รายการเอกสาร
          </Button>
          <Input aria-label="ชื่อเอกสาร" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 max-w-sm" />
          <div className="ml-auto flex gap-2">
            <Button size="sm" className="gap-1" onClick={() => {
              if (upsert({ ...current, title, html: html(), updatedAt: new Date().toISOString() })) toast.success("บันทึกแล้ว");
            }}><Save className="w-4 h-4" />บันทึก</Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={exportDocx}><Download className="w-4 h-4" />ส่งออก .docx</Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => window.print()}><Printer className="w-4 h-4" />พิมพ์</Button>
          </div>
        </div>
        <div className="sticky top-0 z-10 print:hidden"><Ribbon /></div>
        {/* พื้นที่หน้ากระดาษ: ใช้ขนาด A4 จริง (mm) เป็นข้อยกเว้นจาก design.md เพราะต้องเหมือนเอกสารพิมพ์ */}
        <div className="overflow-x-auto rounded-lg bg-muted py-6 print:bg-transparent print:p-0">
          <div ref={editor} key={current.id} contentEditable suppressContentEditableWarning aria-label="เนื้อหาเอกสาร"
            className="doc-page mx-auto bg-white text-black shadow-md focus:outline-none print:shadow-none"
            dangerouslySetInnerHTML={{ __html: current.html || "<p><br></p>" }} />
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <CardTitle className="text-base">เอกสาร ({docs.length} รายการ)</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => open(newDoc("เอกสารใหม่", "", "สร้างเอง"))}>
            <FilePlus className="w-4 h-4" />สร้างเอกสาร
          </Button>
          <Button asChild className="gap-2 cursor-pointer">
            <label>
              <FileUp className="w-4 h-4" />นำเข้า Word
              <input type="file" accept=".docx" className="sr-only" onChange={(e) => { importWord(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y rounded-lg border bg-card">
          {docs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีเอกสาร กด "นำเข้า Word" เพื่อเริ่มจากไฟล์ที่มีอยู่</p>}
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2 hover:bg-accent">
              <button className="flex-1 text-left font-medium" onClick={() => open(d)}>{d.title}</button>
              <span className="hidden text-xs text-muted-foreground sm:inline">{new Date(d.updatedAt).toLocaleString("th-TH")}</span>
              <Badge variant="secondary">{d.source}</Badge>
              <Button variant="ghost" size="icon" aria-label="ลบเอกสาร" onClick={() => remove(d)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
