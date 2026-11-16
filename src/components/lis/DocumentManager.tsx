import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import mammoth from "mammoth";
import HTMLtoDOCX from "@turbodocx/html-to-docx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, FilePlus, FileUp, Highlighter, Italic,
  List, ListOrdered, Printer, Redo2, Save, Strikethrough, Table, Trash2, Underline, Undo2, Download, ArrowLeft, ExternalLink, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  FILL_FIELDS, TEMPLATE_SCHEMAS, fillFieldHtml, hasFillFields, starterTemplateHtml, variableHtml,
  type TemplateSchema,
} from "@/lib/formTemplate";
import FillFormView from "@/components/lis/FillFormView";
import { Link } from "react-router-dom";
import { Label } from "@/components/ui/label";
import {
  DOC_STATUSES, DOC_STATUS_VARIANT, PAPER_MM, PAPER_SIZES, PRINT_STAGES, SYSTEM_DOCS,
  type DocStatus, type PaperSize,
} from "@/lib/documentRegistry";

type Doc = {
  id: string; title: string; html: string; source: "สร้างเอง" | "นำเข้า Word"; updatedAt: string;
  // ข้อมูลกำกับ (เอกสารเก่าที่บันทึกก่อนมีฟิลด์เหล่านี้จะได้ค่า default จาก withMeta)
  code: string; rev: string; status: DocStatus; paper: PaperSize; stage: string; printWhen: string;
  viewers: string[]; managers: string[];
  // จาก server: ใครสร้าง / สิทธิ์แก้ของผู้ใช้ปัจจุบัน; id ว่าง = ยังไม่เคยบันทึก
  createdBy?: string; canEdit?: boolean;
  templateFor?: string;
};
type RoleOption = { id: string; name: string };
const DEFAULT_META = { code: "", rev: "", status: "ร่าง" as DocStatus, paper: "A4 แนวตั้ง" as PaperSize, stage: "พิมพ์ตามต้องการ", printWhen: "", viewers: [] as string[], managers: [] as string[] };
const withMeta = (d: Partial<Doc>): Doc => ({ ...DEFAULT_META, ...d } as Doc);

// เก็บที่ server (/api/documents) — server กรองตามสิทธิ์ผู้เห็น และตรวจสิทธิ์แก้/ลบ
// LEGACY_KEY: เอกสารรุ่นแรกที่เคยเก็บในเบราว์เซอร์ จะถูกย้ายขึ้น server อัตโนมัติครั้งเดียว
const LEGACY_KEY = "lis.documents";
const payloadOf = (d: Doc, html?: string) => ({
  title: d.title, source: d.source, code: d.code, rev: d.rev, status: d.status, paper: d.paper,
  stage: d.stage, printWhen: d.printWhen, viewers: d.viewers, managers: d.managers, templateFor: d.templateFor ?? "",
  ...(html !== undefined ? { html } : {}),
});
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "เกิดข้อผิดพลาด");

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

function Ribbon({ schema }: { schema?: TemplateSchema }) {
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
        <Group label="ช่องกรอก (ให้คนกรอกตอนพิมพ์)">
          {FILL_FIELDS.map((f) => (
            <Tool key={f.type} label={f.label} onClick={() => {
              const label = window.prompt("ชื่อช่อง เช่น ชื่อผู้รับ, วันที่รับ", f.label.replace("ช่อง", ""));
              if (label) exec("insertHTML", fillFieldHtml(f.type, label.trim()));
            }} />
          ))}
        </Group>
        {schema && (
          <Group label="ข้อมูลจากระบบ (เติมอัตโนมัติตอนพิมพ์)">
            <select aria-label="แทรกข้อมูลจากระบบ" className={selectCls} defaultValue="" onChange={(e) => {
              const v = [...schema.vars, ...schema.itemVars].find((x) => x.key === e.target.value);
              if (v) exec("insertHTML", variableHtml(v.key, v.label));
              e.target.value = "";
            }}>
              <option value="" disabled>แทรกข้อมูล</option>
              <optgroup label="ข้อมูลเอกสาร">{schema.vars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</optgroup>
              <optgroup label="ข้อมูลรายตัวอย่าง (ใส่ในแถวรายการ)">{schema.itemVars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</optgroup>
            </select>
            <Tool label="ตารางรายการตัวอย่าง" onClick={() => {
              const cols = schema.itemVars.slice(0, 4);
              exec("insertHTML", "<table><tbody><tr>" + cols.map((c) => "<th>" + c.label + "</th>").join("") + '</tr><tr data-fv-repeat="items">'
                + cols.map((c) => "<td>" + variableHtml(c.key, c.label) + "</td>").join("") + "</tr></tbody></table><p><br></p>");
            }} />
          </Group>
        )}
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

function RoleChips({ value, onChange, label, roles, disabled }: { value: string[]; onChange: (v: string[]) => void; label: string; roles: RoleOption[]; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {roles.length === 0 && <span className="text-sm text-muted-foreground">กำลังโหลดรายชื่อ role...</span>}
        {roles.map((r) => {
          const on = value.includes(r.id);
          return (
            <Button key={r.id} type="button" size="sm" variant={on ? "default" : "outline"} className="h-7 px-2 text-xs" aria-pressed={on} disabled={disabled}
              onClick={() => onChange(on ? value.filter((x) => x !== r.id) : [...value, r.id])}>{r.name}</Button>
          );
        })}
      </div>
    </div>
  );
}

function MetaPanel({ doc, onChange, roles }: { doc: Doc; onChange: (patch: Partial<Doc>) => void; roles: RoleOption[] }) {
  const ro = !doc.canEdit;
  return (
    <Card className="print:hidden">
      <fieldset disabled={ro} className="contents">
      <CardHeader className="pb-3">
        <CardTitle className="text-base inline-flex items-center gap-2"><Settings2 className="w-4 h-4" />ข้อมูลเอกสาร</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5"><Label htmlFor="doc-code">รหัสเอกสาร</Label>
          <Input id="doc-code" placeholder="เช่น FM-QP-07-01-003" value={doc.code} onChange={(e) => onChange({ code: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="doc-rev">ฉบับแก้ไข (Rev)</Label>
          <Input id="doc-rev" placeholder="เช่น R00 (16/11/69)" value={doc.rev} onChange={(e) => onChange({ rev: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="doc-status">สถานะเอกสาร</Label>
          <select id="doc-status" className={selectCls + " w-full h-10"} value={doc.status} onChange={(e) => onChange({ status: e.target.value as DocStatus })}>
            {DOC_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select></div>
        <div className="space-y-1.5"><Label htmlFor="doc-paper">ขนาดกระดาษ</Label>
          <select id="doc-paper" className={selectCls + " w-full h-10"} value={doc.paper} onChange={(e) => onChange({ paper: e.target.value as PaperSize })}>
            {PAPER_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select></div>
        <div className="space-y-1.5"><Label htmlFor="doc-stage">ใช้พิมพ์ขั้นตอนไหน</Label>
          <select id="doc-stage" className={selectCls + " w-full h-10"} value={doc.stage} onChange={(e) => onChange({ stage: e.target.value })}>
            {PRINT_STAGES.map((s) => <option key={s}>{s}</option>)}
          </select></div>
        <div className="space-y-1.5 sm:col-span-1 lg:col-span-3"><Label htmlFor="doc-when">พิมพ์เมื่อ (เงื่อนไข / สถานะงาน)</Label>
          <Input id="doc-when" placeholder="เช่น เมื่อคำร้องสถานะ ทดสอบเสร็จสิ้น และ QC Head อนุมัติ" value={doc.printWhen} onChange={(e) => onChange({ printWhen: e.target.value })} /></div>
        <div className="sm:col-span-2 space-y-1"><RoleChips label="ผู้ที่เห็น / พิมพ์ได้" roles={roles} disabled={ro} value={doc.viewers} onChange={(v) => onChange({ viewers: v })} />
          <p className="text-xs text-muted-foreground">ไม่เลือกเลย = ทุกคนที่เข้าระบบเห็น</p></div>
        <div className="sm:col-span-2 space-y-1"><RoleChips label="ผู้จัดการเอกสาร (แก้ไข / ลบ)" roles={roles} disabled={ro} value={doc.managers} onChange={(v) => onChange({ managers: v })} />
          <p className="text-xs text-muted-foreground">ผู้สร้าง{doc.createdBy ? " (" + doc.createdBy + ")" : ""} และผู้ดูแลระบบแก้ได้เสมอ</p></div>
      </CardContent>
      </fieldset>
    </Card>
  );
}

type SystemDocRow = (typeof SYSTEM_DOCS)[number];
const sysRoleText = (r: string[]) => (r.length ? r.join(", ") : "-");

function SystemDocsTable({ onEditTemplate }: { onEditTemplate: (d: SystemDocRow) => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">เอกสารในระบบ ({SYSTEM_DOCS.length} รายการ)</CardTitle>
        <p className="text-sm text-muted-foreground">แบบฟอร์มที่ LIS พิมพ์อยู่แล้ว ระบบกรอกข้อมูลให้อัตโนมัติจากหน้าที่ใช้งาน</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">รหัส / Rev</th>
                <th className="px-3 py-2 font-medium">ชื่อเอกสาร</th>
                <th className="px-3 py-2 font-medium">กระดาษ</th>
                <th className="px-3 py-2 font-medium">พิมพ์ตอน</th>
                <th className="px-3 py-2 font-medium">สถานะงานที่พิมพ์ได้</th>
                <th className="px-3 py-2 font-medium">ผู้เห็น</th>
                <th className="px-3 py-2 font-medium">ผู้จัดการ</th>
                <th className="px-3 py-2 font-medium">พิมพ์ที่</th>
                <th className="px-3 py-2"><span className="sr-only">แก้ฟอร์ม</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SYSTEM_DOCS.map((d) => (
                <tr key={d.code + d.name} className="align-top hover:bg-accent">
                  <td className="px-3 py-2 whitespace-nowrap"><div className="font-medium">{d.code}</div><div className="text-xs text-muted-foreground">{d.rev}</div></td>
                  <td className="px-3 py-2">{d.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><Badge variant="secondary">{d.paper}</Badge></td>
                  <td className="px-3 py-2">{d.stage}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">{sysRoleText(d.viewers)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{sysRoleText(d.managers)}</td>
                  <td className="px-3 py-2">
                    <Link to={d.page} className="inline-flex items-center gap-1 text-primary hover:underline">{d.pageLabel}<ExternalLink className="w-3 h-3" /></Link>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {TEMPLATE_SCHEMAS[d.code] && (
                      <Button size="sm" variant="outline" className="whitespace-nowrap" onClick={() => onEditTemplate(d)}>แก้ฟอร์มนี้</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DocumentManager() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [saving, setSaving] = useState(false);
  const [fillMode, setFillMode] = useState(false);
  const editor = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<Doc[]>("/documents");
      setDocs(res.data.data.map(withMeta)); setLoadError("");
    } catch (e) { setLoadError(errMsg(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      // ย้ายเอกสารเก่าจากเบราว์เซอร์ขึ้น server ครั้งเดียว
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]") as Partial<Doc>[];
        if (legacy.length) {
          for (const d of legacy) await api.post("/documents", payloadOf(withMeta(d), d.html ?? ""));
          localStorage.removeItem(LEGACY_KEY);
          toast.success("ย้ายเอกสาร " + legacy.length + " รายการจากเครื่องนี้ขึ้นระบบแล้ว");
        }
      } catch { /* ย้ายไม่สำเร็จ เก็บไว้ลองใหม่รอบหน้า */ }
      await refresh();
    })();
    api.get<RoleOption[]>("/documents/roles").then((r) => setRoles(r.data.data)).catch(() => setRoles([]));
  }, [refresh]);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const roleText = (r: string[], emptyText = "-") => (r.length ? r.map(roleName).join(", ") : emptyText);

  const newDoc = (t: string, html: string, source: Doc["source"]): Doc =>
    withMeta({ id: "", title: t, html, source, updatedAt: new Date().toISOString(), canEdit: true });
  const patch = (p: Partial<Doc>) => setCurrent((c) => (c ? { ...c, ...p } : c));

  const persist = async (d: Doc, html: string) => {
    setSaving(true);
    try {
      const res = d.id
        ? await api.put<Doc>("/documents/" + d.id, payloadOf(d, html))
        : await api.post<Doc>("/documents", payloadOf(d, html));
      const saved = withMeta(res.data.data);
      setCurrent(saved); await refresh();
      return saved;
    } catch (e) { toast.error("บันทึกไม่สำเร็จ: " + errMsg(e)); return null; }
    finally { setSaving(false); }
  };

  // แก้ฟอร์มระบบ: เปิดแม่แบบที่มีอยู่ หรือสร้างใหม่จากแม่แบบเริ่มต้น
  const editTemplate = async (sd: SystemDocRow) => {
    const existing = docs.find((d) => d.templateFor === sd.code);
    if (existing) return open(existing);
    const d = withMeta({
      id: "", title: "แม่แบบ " + sd.name, source: "สร้างเอง", updatedAt: new Date().toISOString(), canEdit: true,
      code: sd.code, rev: sd.rev, paper: sd.paper, stage: sd.stage, printWhen: sd.status, templateFor: sd.code,
    });
    const html = starterTemplateHtml(sd.name, sd.code, sd.rev, TEMPLATE_SCHEMAS[sd.code]);
    if (await persist(d, html)) toast.success('สร้างแม่แบบแล้ว ตั้งสถานะเป็น "ใช้งาน" เมื่อพร้อมให้ระบบพิมพ์ด้วยแม่แบบนี้');
  };

  const open = async (d: Doc) => {
    try {
      const res = await api.get<Doc>("/documents/" + d.id);
      setCurrent(withMeta(res.data.data)); setFillMode(false);
    } catch (e) { toast.error("เปิดเอกสารไม่สำเร็จ: " + errMsg(e)); }
  };

  const importWord = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) return toast.error("รองรับเฉพาะไฟล์ .docx");
    try {
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const d = newDoc(file.name.replace(/\.docx$/i, ""), value, "นำเข้า Word");
      if (await persist(d, value)) toast.success("นำเข้าแล้ว กรุณากรอกข้อมูลเอกสาร: พิมพ์ตอนไหน ใครเห็น ขนาดกระดาษ");
    } catch { toast.error("แปลงไฟล์ Word ไม่สำเร็จ"); }
  };

  const remove = async (d: Doc) => {
    if (!confirm('ลบ "' + d.title + '"?')) return;
    try { await api.delete("/documents/" + d.id); toast.success("ลบแล้ว"); await refresh(); }
    catch (e) { toast.error("ลบไม่สำเร็จ: " + errMsg(e)); }
  };

  const html = () => editor.current?.innerHTML ?? current?.html ?? "";

  const exportDocx = async () => {
    if (!current) return;
    const mm = PAPER_MM[current.paper];
    const twip = (v: number) => Math.round((v / 25.4) * 1440);
    try {
      const out = await HTMLtoDOCX(html(), null, {
        font: "TH Sarabun New", fontSize: 32, // half-points = 16pt
        orientation: mm.w > mm.h ? "landscape" : "portrait",
        pageSize: { width: twip(mm.w), height: twip(mm.h) },
        margins: { top: twip(mm.pad), right: twip(mm.pad), bottom: twip(mm.pad), left: twip(mm.pad) },
        table: { row: { cantSplit: true } },
      });
      download(out instanceof Blob ? out : new Blob([out as BlobPart]), (current.title || "document") + ".docx");
    } catch { toast.error("ส่งออกไฟล์ Word ไม่สำเร็จ"); }
  };

  if (current) {
    const mm = PAPER_MM[current.paper];
    const pageStyle = { "--page-w": mm.w + "mm", "--page-h": mm.h + "mm", "--page-pad": mm.pad + "mm" } as React.CSSProperties;
    return (
      <div className="space-y-3 doc-editor-shell">
        <style>{"@media print { @page { size: " + mm.w + "mm " + mm.h + "mm; margin: 0; } }"}</style>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => setCurrent(null)}>
            <ArrowLeft className="w-4 h-4" />รายการเอกสาร
          </Button>
          <Input aria-label="ชื่อเอกสาร" readOnly={!current.canEdit} value={current.title} onChange={(e) => patch({ title: e.target.value })} className="h-8 max-w-sm" />
          <Badge variant={DOC_STATUS_VARIANT[current.status]}>{current.status}</Badge>
          <div className="ml-auto flex gap-2">
            {current.canEdit ? (
              <Button size="sm" className="gap-1" disabled={saving} onClick={async () => {
                if (await persist(current, html())) toast.success("บันทึกแล้ว");
              }}><Save className="w-4 h-4" />{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
            ) : <Badge variant="secondary">อ่านอย่างเดียว</Badge>}
            {hasFillFields(current.html || "") && (
              <Button size="sm" variant={fillMode ? "default" : "outline"} onClick={() => {
                if (!fillMode && current.canEdit) patch({ html: html() }); // เก็บที่แก้ค้างไว้ก่อนสลับโหมด
                setFillMode(!fillMode);
              }}>{fillMode ? "กลับไปแก้ฟอร์ม" : "กรอกแบบฟอร์ม"}</Button>
            )}
            <Button size="sm" variant="outline" className="gap-1" onClick={exportDocx}><Download className="w-4 h-4" />ส่งออก .docx</Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => window.print()}><Printer className="w-4 h-4" />พิมพ์</Button>
          </div>
        </div>
        {!fillMode && <MetaPanel doc={current} onChange={patch} roles={roles} />}
        {current.templateFor && !fillMode && (
          <p className="text-sm text-muted-foreground print:hidden">
            แม่แบบนี้ใช้แทนฟอร์ม {current.templateFor} เมื่อสถานะเป็น "ใช้งาน" — ช่อง {"{{ ... }}"} ระบบจะเติมข้อมูลจริงตอนพิมพ์ แถวที่มีตัวแปรรายตัวอย่างจะถูกคัดลอกตามจำนวนตัวอย่าง
          </p>
        )}
        {current.canEdit && !fillMode && <div className="sticky top-0 z-10 print:hidden"><Ribbon schema={current.templateFor ? TEMPLATE_SCHEMAS[current.templateFor] : undefined} /></div>}
        {/* พื้นที่หน้ากระดาษ: ใช้ขนาดกระดาษจริง (mm) เป็นข้อยกเว้นจาก design.md เพราะต้องเหมือนเอกสารพิมพ์ */}
        <div className="overflow-x-auto rounded-lg bg-muted py-6 print:bg-transparent print:p-0">
          {fillMode ? <FillFormView html={current.html} style={pageStyle} /> : <div ref={editor} key={current.id || "new"} style={pageStyle} contentEditable={!!current.canEdit} suppressContentEditableWarning aria-label="เนื้อหาเอกสาร"
            className="doc-page mx-auto bg-white text-black shadow-md focus:outline-none print:shadow-none"
            dangerouslySetInnerHTML={{ __html: current.html || "<p><br></p>" }} />}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SystemDocsTable onEditTemplate={editTemplate} />
      <Card>
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">เอกสารที่สร้าง / นำเข้า ({docs.length} รายการ)</CardTitle>
            <p className="text-sm text-muted-foreground">นำเข้าไฟล์ Word แล้วกำหนดว่าพิมพ์ตอนไหน ใครเห็น ใครจัดการ และขนาดกระดาษ</p>
          </div>
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
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">รหัส / Rev</th>
                  <th className="px-3 py-2 font-medium">ชื่อเอกสาร</th>
                  <th className="px-3 py-2 font-medium">สถานะ</th>
                  <th className="px-3 py-2 font-medium">กระดาษ</th>
                  <th className="px-3 py-2 font-medium">พิมพ์ตอน</th>
                  <th className="px-3 py-2 font-medium">ผู้เห็น</th>
                  <th className="px-3 py-2 font-medium">ผู้จัดการ</th>
                  <th className="px-3 py-2"><span className="sr-only">จัดการ</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">กำลังโหลดเอกสาร...</td></tr>}
                {!loading && loadError && <tr><td colSpan={8} className="py-8 text-center text-destructive">โหลดเอกสารไม่สำเร็จ: {loadError}</td></tr>}
                {!loading && !loadError && docs.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">ยังไม่มีเอกสาร กด "นำเข้า Word" เพื่อเริ่มจากไฟล์ที่มีอยู่</td></tr>
                )}
                {docs.map((d) => (
                  <tr key={d.id} className="align-top hover:bg-accent">
                    <td className="px-3 py-2 whitespace-nowrap"><div className="font-medium">{d.code || "-"}</div><div className="text-xs text-muted-foreground">{d.rev}</div></td>
                    <td className="px-3 py-2">
                      <button className="text-left font-medium text-primary hover:underline" onClick={() => open(d)}>{d.title}</button>
                      <div className="text-xs text-muted-foreground">{d.source} · {new Date(d.updatedAt).toLocaleString("th-TH")}</div>
                    </td>
                    <td className="px-3 py-2"><Badge variant={DOC_STATUS_VARIANT[d.status]}>{d.status}</Badge></td>
                    <td className="px-3 py-2 whitespace-nowrap"><Badge variant="secondary">{d.paper}</Badge></td>
                    <td className="px-3 py-2">{d.stage}{d.printWhen && <div className="text-xs text-muted-foreground">{d.printWhen}</div>}</td>
                    <td className="px-3 py-2 text-muted-foreground">{roleText(d.viewers, "ทุกคน")}</td>
                    <td className="px-3 py-2 text-muted-foreground">{roleText(d.managers, d.createdBy || "-")}</td>
                    <td className="px-3 py-2 text-right">
                      {d.canEdit && <Button variant="ghost" size="icon" aria-label="ลบเอกสาร" onClick={() => remove(d)}><Trash2 className="w-4 h-4" /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
