import { useState } from "react";
import mammoth from "mammoth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FilePlus, FileUp, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Doc = { id: string; title: string; html: string; source: "สร้างเอง" | "นำเข้า Word"; updatedAt: string };

// ponytail: เก็บใน localStorage (เฉพาะเครื่องนี้, ~5MB). ย้ายไป API server เมื่อต้องแชร์เอกสารข้ามผู้ใช้
const KEY = "lis.documents";
const load = (): Doc[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };


const TOOLS: [string, string, string?][] = [
  ["bold", "B"], ["italic", "I"], ["underline", "U"],
  ["formatBlock", "H1", "h1"], ["formatBlock", "H2", "h2"], ["formatBlock", "ปกติ", "p"],
  ["insertUnorderedList", "• รายการ"], ["insertOrderedList", "1. รายการ"],
  ["justifyLeft", "ชิดซ้าย"], ["justifyCenter", "กึ่งกลาง"], ["justifyRight", "ชิดขวา"],
  ["undo", "เลิกทำ"], ["redo", "ทำซ้ำ"],
];
// ponytail: execCommand เป็น API เก่าแต่ทุกเบราว์เซอร์ยังรองรับ; เปลี่ยนเป็น editor library เมื่อต้องการ track changes/ตารางขั้นสูง
const exec = (cmd: string, val?: string) => document.execCommand(cmd, false, val);

const exportWord = (title: string, html: string) => {
  const blob = new Blob([`<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title || "document"}.doc`;
  a.click();
  URL.revokeObjectURL(a.href);
};

export default function DocumentManager() {
  const [docs, setDocs] = useState<Doc[]>(load);
  const [current, setCurrent] = useState<Doc | null>(null);

  const save = (next: Doc[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setDocs(next); }
    catch { toast.error("บันทึกไม่สำเร็จ พื้นที่เก็บเต็ม"); }
  };
  const upsert = (d: Doc) => save([d, ...docs.filter((x) => x.id !== d.id)]);
  const newDoc = (title: string, html: string, source: Doc["source"]): Doc =>
    ({ id: crypto.randomUUID(), title, html, source, updatedAt: new Date().toISOString() });

  const importWord = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) return toast.error("รองรับเฉพาะไฟล์ .docx");
    try {
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const d = newDoc(file.name.replace(/\.docx$/i, ""), value, "นำเข้า Word");
      upsert(d); setCurrent(d); toast.success("นำเข้าเอกสารแล้ว");
    } catch { toast.error("แปลงไฟล์ Word ไม่สำเร็จ"); }
  };

  const remove = (d: Doc) => {
    if (!confirm(`ลบ "${d.title}"?`)) return;
    save(docs.filter((x) => x.id !== d.id));
    if (current?.id === d.id) setCurrent(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base">เอกสาร ({docs.length} รายการ)</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setCurrent(newDoc("เอกสารใหม่", "", "สร้างเอง"))}>
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
            {docs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีเอกสาร</p>}
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-2 hover:bg-accent">
                <button className="flex-1 text-left font-medium" onClick={() => setCurrent(d)}>{d.title}</button>
                <Badge variant="secondary">{d.source}</Badge>
                <Button variant="ghost" size="icon" aria-label="ลบเอกสาร" onClick={() => remove(d)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {current && (
        <Card key={current.id}>
          <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <Input aria-label="ชื่อเอกสาร" defaultValue={current.title} onChange={(e) => (current.title = e.target.value)} />
            <Button onClick={() => {
              const html = document.getElementById("doc-editor")?.innerHTML ?? "";
              upsert({ ...current, html, updatedAt: new Date().toISOString() });
              toast.success("บันทึกแล้ว");
            }}>บันทึก</Button>
            <Button variant="outline" onClick={() => exportWord(current.title, document.getElementById("doc-editor")?.innerHTML ?? "")}>ส่งออก Word</Button>
            <Button variant="outline" onClick={() => window.print()}>พิมพ์</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div role="toolbar" aria-label="เครื่องมือจัดรูปแบบ" className="flex flex-wrap gap-1 rounded-lg border bg-muted p-1">
              {TOOLS.map(([cmd, label, val]) => (
                <Button key={label} type="button" size="sm" variant="ghost" onMouseDown={(e) => { e.preventDefault(); exec(cmd, val); }}>{label}</Button>
              ))}
            </div>
            <div id="doc-editor" contentEditable suppressContentEditableWarning aria-label="เนื้อหาเอกสาร"
              className="prose max-w-none min-h-[60vh] rounded-lg border bg-card p-8 focus:outline-none focus:ring-2 focus:ring-primary"
              dangerouslySetInnerHTML={{ __html: current.html }} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
