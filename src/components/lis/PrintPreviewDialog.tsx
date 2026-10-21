import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Maximize2, Minus, Monitor, Plus, Printer, Server, ZoomIn, ZoomOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { printDocument } from "@/lib/print";
import {
  eligiblePrintersForDocument,
  getPrintDocType,
  paperSizeForPrinterDocument,
  pickPrinterAssignment,
  type PrintDocType,
  type PrintOutputMode,
} from "@/lib/printConfig";
import { normalizeRoles } from "@/lib/roles";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docType: PrintDocType;
  css?: string;
  children: React.ReactNode;
  onPrinted?: (meta: { copies: number; outputMode: PrintOutputMode }) => void;
  autoPrint?: boolean;
  autoPrintKey?: string | number;
  previewOnly?: boolean;
  headerActions?: React.ReactNode;
}

const MIN_PREVIEW_HEIGHT = 180;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
  );
}

function getSheetSize(printEl: HTMLDivElement | null, contentEl: HTMLDivElement) {
  const firstSheet = printEl?.querySelector<HTMLElement>(
    "section, .label-page, .stock-label-page, .lr-page, .pr-page1, .pr-page2, .rr-page, .gr-page1",
  );
  const target = firstSheet ?? printEl ?? contentEl;
  return {
    width: target.scrollWidth || target.offsetWidth || contentEl.scrollWidth,
    height: target.scrollHeight || target.offsetHeight || contentEl.scrollHeight,
  };
}

function ScaledPreview({
  printRef,
  previewClassName,
  children,
}: {
  printRef: React.RefObject<HTMLDivElement>;
  previewClassName?: string;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const scale = fitScale * zoom;

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const content = contentRef.current;
    if (!outer || !content) return;

    const measure = () => {
      const styles = window.getComputedStyle(outer);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      // Keep a small rounding allowance so a sheet fitted exactly to the viewport
      // does not repeatedly show/hide a scrollbar on devices with fractional pixels.
      const availW = Math.max(0, outer.clientWidth - horizontalPadding - 1);
      const availH = Math.max(MIN_PREVIEW_HEIGHT, outer.clientHeight - verticalPadding - 1);
      const natW = content.scrollWidth;
      const natH = content.scrollHeight;
      const sheet = getSheetSize(printRef.current, content);
      const widthScale = sheet.width > 0 ? availW / sheet.width : 1;
      const heightScale = sheet.height > 0 ? availH / sheet.height : 1;
      setFitScale(Math.min(widthScale, heightScale, 1));
      setNaturalWidth(natW);
      setNaturalHeight(natH);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(content);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children, printRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isShortcut = event.ctrlKey || event.metaKey;
      const activeEditable = isEditableTarget(document.activeElement);
      if (!isShortcut && activeEditable) return;

      if (event.key === "+" || (isShortcut && event.key === "=")) {
        event.preventDefault();
        setZoom((value) => clampZoom(value + ZOOM_STEP));
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((value) => clampZoom(value - ZOOM_STEP));
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value) => clampZoom(value + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
    };

    outer.addEventListener("wheel", handleWheel, { passive: false });
    return () => outer.removeEventListener("wheel", handleWheel);
  }, []);

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
          disabled={zoom <= MIN_ZOOM}
          aria-label="ย่อ"
          title="ย่อ"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-sm tabular-nums text-muted-foreground">{zoomPercent}%</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
          disabled={zoom >= MAX_ZOOM}
          aria-label="ขยาย"
          title="ขยาย"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setZoom(1)}>
          <Maximize2 className="h-3.5 w-3.5" />
          พอดีหน้า
        </Button>
      </div>
      <div
        ref={outerRef}
        className={`min-h-0 flex-1 overflow-auto rounded border p-3 [scrollbar-gutter:stable] ${previewClassName ?? "bg-neutral-100"}`}
      >
        <div className="mx-auto" style={{ width: naturalWidth * scale, height: naturalHeight * scale }}>
          <div
            ref={contentRef}
            style={{
              width: "max-content",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <div ref={printRef}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrintPreviewDialog({
  open,
  onOpenChange,
  docType,
  css,
  children,
  onPrinted,
  autoPrint,
  autoPrintKey,
  previewOnly = false,
  headerActions,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const autoPrintDoneKeyRef = useRef<string | number | null>(null);
  const copies = 1;
  const [printing, setPrinting] = useState(false);
  const [outputMode, setOutputMode] = useState<PrintOutputMode | "">("");
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const { user } = useAuth();
  const meta = getPrintDocType(docType);
  const widthClass = docType === "sample-label" || docType === "stock-label" ? "sm:max-w-2xl" : "sm:max-w-4xl";
  const isAdmin = normalizeRoles(user).includes("admin");

  const { data: configs, isFetched: printerConfigsLoaded } = useQuery({
    queryKey: ["printer-configs"],
    queryFn: api.getPrinterConfigs,
    enabled: open,
  });
  const userDepartment = user?.department?.trim() ?? "";
  const serverPrinters = useMemo(
    () => eligiblePrintersForDocument(configs, docType, userDepartment, { includeAnyDepartment: isAdmin })
      .filter((printer) => printer.cupsPrinterUrl?.trim()),
    [configs, docType, isAdmin, userDepartment],
  );
  const assignmentRoute = useMemo(() => pickPrinterAssignment(configs, docType, userDepartment), [configs, docType, userDepartment]);
  const cfg = selectedPrinterId ? serverPrinters.find((printer) => printer.id === selectedPrinterId) : undefined;
  const paperSize = cfg
    ? paperSizeForPrinterDocument(cfg, docType, userDepartment, { includeAnyDepartment: isAdmin }) ?? meta?.defaultPaper
    : assignmentRoute?.paperSize ?? meta?.defaultPaper;
  const serverConfigured = outputMode === "server" && Boolean(cfg?.cupsPrinterUrl?.trim());
  const configured = outputMode === "local" || serverConfigured;
  const printerTarget = outputMode === "local" ? "เครื่องนี้" : (cfg?.label?.trim() || cfg?.cupsPrinterUrl?.trim());

  useEffect(() => {
    if (!open) {
      setOutputMode("");
      setSelectedPrinterId("");
      autoPrintDoneKeyRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || previewOnly || !printerConfigsLoaded || outputMode) return;
    setOutputMode(serverPrinters.length > 0 ? "server" : "local");
  }, [open, outputMode, previewOnly, printerConfigsLoaded, serverPrinters.length]);

  useEffect(() => {
    if (!open || outputMode !== "server") return;
    if (selectedPrinterId && serverPrinters.some((printer) => printer.id === selectedPrinterId)) return;
    setSelectedPrinterId(serverPrinters.length === 1 ? serverPrinters[0].id : "");
  }, [open, outputMode, selectedPrinterId, serverPrinters]);

  const handlePrint = useCallback(async (mode: PrintOutputMode | "" = outputMode) => {
    if (!mode) {
      toast.error("กรุณาเลือกว่าจะพิมพ์จากเครื่องนี้หรือผ่าน Server/CUPS");
      return;
    }
    if (mode === "server" && !cfg?.id) {
      toast.error(serverPrinters.length > 0 ? "กรุณาเลือกเครื่องพิมพ์ Server" : "ยังไม่ได้ตั้งค่าเครื่องพิมพ์ Server สำหรับเอกสารนี้");
      return;
    }
    setPrinting(true);
    try {
      const res = await printDocument(docType, printRef.current, {
        css,
        copies,
        outputMode: mode,
        printerConfigId: mode === "server" ? cfg?.id : undefined,
        department: userDepartment,
        paperSize,
      });
      onPrinted?.({ copies, outputMode: mode });
      if (mode === "local") {
        toast.success("เปิด print dialog ของเครื่องนี้แล้ว");
      } else {
        toast.success(`ส่งพิมพ์ไปยัง ${res.printer} (${res.copies} ชุด)`);
      }
      if (mode === "server") onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "พิมพ์ไม่สำเร็จ");
    } finally {
      setPrinting(false);
    }
  }, [cfg?.id, copies, css, docType, onOpenChange, onPrinted, outputMode, paperSize, serverPrinters.length, userDepartment]);

  useEffect(() => {
    if (!open) {
      autoPrintDoneKeyRef.current = null;
      return;
    }
    if (!autoPrint || !configured || printing) return;
    const key = autoPrintKey ?? "default";
    if (autoPrintDoneKeyRef.current === key) return;
    autoPrintDoneKeyRef.current = key;
    void handlePrint();
  }, [autoPrint, autoPrintKey, configured, handlePrint, open, printing]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${widthClass} flex max-h-[90vh] min-h-[70vh] flex-col overflow-hidden`}>
        <DialogHeader className="shrink-0 gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle>{previewOnly ? "ตัวอย่างเอกสาร" : "ตัวอย่างก่อนพิมพ์"} — {meta?.label ?? docType}</DialogTitle>
            {headerActions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{headerActions}</div>}
          </div>
          {previewOnly ? (
            <DialogDescription className="sr-only">ตรวจสอบรายละเอียดเอกสารก่อนดำเนินการ</DialogDescription>
          ) : (
            <DialogDescription>
              เลือกพิมพ์จากเครื่องนี้เพื่อเปิด print dialog หรือเลือก Server/CUPS เพื่อส่งไปเครื่องที่ตั้งค่าไว้
            </DialogDescription>
          )}
        </DialogHeader>

        <ScaledPreview printRef={printRef} previewClassName={docType === "coa" ? "bg-muted" : undefined}>{children}</ScaledPreview>

        {!previewOnly && outputMode === "server" && !serverConfigured && (
          <p className="shrink-0 text-sm text-red-600">
            {serverPrinters.length > 0 ? "กรุณาเลือกเครื่องพิมพ์ Server" : "ยังไม่ได้ตั้งค่าเครื่องพิมพ์ Server สำหรับเอกสารนี้"}{" "}
            {serverPrinters.length === 0 && (
              <Link to="/settings" className="underline" onClick={() => onOpenChange(false)}>
                ไปหน้าตั้งค่าระบบ
              </Link>
            )}
          </p>
        )}

        {!previewOnly && !outputMode && (
          <p className="shrink-0 text-sm text-muted-foreground">เลือกแหล่งพิมพ์ก่อนกดพิมพ์</p>
        )}

        <DialogFooter className="shrink-0 items-center gap-3 sm:justify-between">
          {previewOnly ? (
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                ปิด
              </Button>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="flex gap-2 rounded-md border bg-muted/30 p-1">
                  <Button
                    type="button"
                    variant={outputMode === "local" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => {
                      setOutputMode("local");
                      setSelectedPrinterId("");
                    }}
                  >
                    <Monitor className="h-4 w-4" />
                    เครื่องนี้
                  </Button>
                  <Button
                    type="button"
                    variant={outputMode === "server" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setOutputMode("server")}
                  >
                    <Server className="h-4 w-4" />
                    Server/CUPS
                  </Button>
                </div>
                {outputMode === "server" && serverPrinters.length > 0 && (
                  <Select value={cfg?.id ?? ""} onValueChange={setSelectedPrinterId}>
                    <SelectTrigger className="h-9 w-[220px]">
                      <SelectValue placeholder="เลือกเครื่องพิมพ์" />
                    </SelectTrigger>
                    <SelectContent>
                      {serverPrinters.map((printer) => (
                        <SelectItem key={printer.id} value={printer.id}>
                          {printer.label?.trim() || printer.cupsPrinterUrl}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {configured && <span className="break-all text-sm text-muted-foreground">→ {printerTarget}</span>}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  ปิด
                </Button>
                <Button onClick={() => void handlePrint()} disabled={!configured || printing} className="gap-2">
                  <Printer className="h-4 w-4" />
                  {printing ? "กำลังพิมพ์..." : outputMode === "local" ? "พิมพ์จากเครื่องนี้" : outputMode === "server" ? "พิมพ์ผ่าน Server" : "พิมพ์"}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
