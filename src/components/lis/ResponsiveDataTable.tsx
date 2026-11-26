import { Fragment, useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EmptyState } from "./states/EmptyState";
import { ErrorState } from "./states/ErrorState";
import { TableSkeleton } from "./states/TableSkeleton";

export type ViewportBand = "mobile" | "tablet" | "desktop";

const MOBILE_MAX = 767;
const TABLET_MAX = 1023;

function readBand(): ViewportBand {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w <= MOBILE_MAX) return "mobile";
  if (w <= TABLET_MAX) return "tablet";
  return "desktop";
}

/** มือถือ < 768, iPad แนวตั้ง 768–1023, ตั้งแต่ 1024 ขึ้นไปเป็นตารางเต็ม */
export function useViewportBand(): ViewportBand {
  const [band, setBand] = useState<ViewportBand>(readBand);
  useEffect(() => {
    const update = () => setBand(readBand());
    const queries = [
      window.matchMedia(`(max-width: ${MOBILE_MAX}px)`),
      window.matchMedia(`(max-width: ${TABLET_MAX}px)`),
    ];
    queries.forEach((q) => q.addEventListener?.("change", update));
    window.addEventListener("resize", update);
    update();
    return () => {
      queries.forEach((q) => q.removeEventListener?.("change", update));
      window.removeEventListener("resize", update);
    };
  }, []);
  return band;
}

/**
 * บทบาทของคอลัมน์เมื่อแสดงเป็นการ์ดบนมือถือ
 * - title: บรรทัดแรก (ข้อมูลหลัก)
 * - status: Badge สถานะ ชิดขวาบรรทัดแรก
 * - meta: ข้อมูลรอง รวมเป็นบรรทัดเดียวคั่นด้วย ·
 * - body: แสดงเต็มใต้บรรทัดข้อมูลรอง (เช่น รายการตัวอย่าง, ช่องกรอก)
 * - actions: ปุ่มคำสั่ง เต็มความกว้าง สูงอย่างน้อย 44px
 * - hidden: ไม่แสดงบนการ์ด
 */
export type CardRole = "title" | "status" | "meta" | "body" | "actions" | "hidden";

export interface ResponsiveDataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** ใช้กับทั้ง th และ td (เหมือน DataTable เดิม) */
  className?: string;
  /** class เฉพาะ th */
  headerClassName?: string;
  /** บทบาทบนการ์ดมือถือ ค่าเริ่มต้น meta */
  card?: CardRole;
  /** แสดงผลบนการ์ดแทน cell (เช่น ปุ่มที่มีข้อความแทนปุ่มไอคอน) */
  cardCell?: (row: T) => ReactNode;
  /** ค่าแบบสั้นสำหรับบรรทัดข้อมูลรอง (การ์ดมือถือ / คอลัมน์ที่ถูกรวมบน iPad) */
  metaText?: (row: T) => ReactNode;
  /** iPad แนวตั้ง: ซ่อนคอลัมน์นี้แล้วนำค่าไปรวมใต้คอลัมน์แรก */
  hideOnTablet?: boolean;
}

interface ResponsiveDataTableProps<T> {
  columns: ResponsiveDataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  rowTitle?: (row: T) => string | undefined;
  rowClassName?: (row: T) => string | undefined;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  /** class ของกล่องนอก */
  className?: string;
  /** class ของ table เฉพาะ desktop (>= 1024) เช่น min-w-[800px] */
  tableClassName?: string;
  /** class ของ table บน iPad แนวตั้ง */
  tabletTableClassName?: string;
  /** แถวสลับสี (ค่าเริ่มต้น true เหมือน DataTable) */
  striped?: boolean;
  /** class ของ thead (ค่าเริ่มต้น sticky + bg-muted/50 เหมือน DataTable) */
  headerClassName?: string;
  /** false เมื่ออยู่ใน Card อยู่แล้ว ไม่ต้องมีกรอบซ้อน */
  bordered?: boolean;
  /** บังคับโหมด (ใช้ใน test) */
  band?: ViewportBand;
}

function isEmptyNode(node: ReactNode) {
  return node === null || node === undefined || node === false || node === "";
}

const STICKY_ACTION = "sticky right-0 z-[1] bg-card shadow-[-1px_0_0_0_hsl(var(--border))]";

export function ResponsiveDataTable<T>({
  columns,
  data,
  rowKey,
  isLoading,
  isError,
  onRetry,
  onRowClick,
  onRowDoubleClick,
  rowTitle,
  rowClassName,
  emptyTitle,
  emptyDescription,
  emptyAction,
  className,
  tableClassName,
  tabletTableClassName,
  striped = true,
  headerClassName,
  bordered = true,
  band: forcedBand,
}: ResponsiveDataTableProps<T>) {
  const detectedBand = useViewportBand();
  const band = forcedBand ?? detectedBand;

  const wrapperClass = cn(
    bordered && "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
    className,
  );

  let overlay: ReactNode = null;
  if (isLoading) overlay = <TableSkeleton cols={Math.min(columns.length, band === "mobile" ? 2 : columns.length)} />;
  else if (isError) overlay = <ErrorState onRetry={onRetry} />;
  else if (data.length === 0)
    overlay = <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;

  if (overlay) return <div className={wrapperClass}>{overlay}</div>;

  if (band === "mobile") {
    const role = (c: ResponsiveDataTableColumn<T>) => c.card ?? "meta";
    const render = (c: ResponsiveDataTableColumn<T>, row: T) => (c.cardCell ?? c.cell)(row);
    return (
      <div className={cn("space-y-3", className)} role="list">
        {data.map((row) => {
          const titles = columns.filter((c) => role(c) === "title");
          const statuses = columns.filter((c) => role(c) === "status");
          const metas = columns
            .filter((c) => role(c) === "meta")
            .map((c) => ({ key: c.key, node: (c.metaText ?? c.cardCell ?? c.cell)(row) }))
            .filter((m) => !isEmptyNode(m.node) && m.node !== "-");
          const bodies = columns.filter((c) => role(c) === "body");
          const actions = columns.filter((c) => role(c) === "actions");
          return (
            <div
              key={rowKey(row)}
              role="listitem"
              title={rowTitle?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
              className={cn(
                "rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-sm",
                onRowClick && "cursor-pointer active:bg-accent",
                rowClassName?.(row),
              )}
            >
              {(titles.length > 0 || statuses.length > 0) && (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1 font-medium">
                    {titles.map((c) => (
                      <div key={c.key} className="min-w-0 break-words">{render(c, row)}</div>
                    ))}
                  </div>
                  {statuses.length > 0 && (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {statuses.map((c) => (
                        <div key={c.key}>{render(c, row)}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {metas.length > 0 && (
                <div className="mt-1 break-words text-sm text-muted-foreground">
                  {metas.map((m, i) => (
                    <Fragment key={m.key}>
                      {i > 0 && <span aria-hidden="true"> · </span>}
                      <span>{m.node}</span>
                    </Fragment>
                  ))}
                </div>
              )}
              {bodies.map((c) => (
                <div key={c.key} className="mt-3 min-w-0">{render(c, row)}</div>
              ))}
              {actions.map((c) => (
                <div
                  key={c.key}
                  className="mt-3 flex flex-wrap gap-2 [&_a]:min-h-11 [&_a]:flex-1 [&_button]:min-h-11 [&_button]:flex-1 [&>*]:flex-1"
                >
                  {render(c, row)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  const tablet = band === "tablet";
  const visible = tablet ? columns.filter((c) => !c.hideOnTablet) : columns;
  const merged = tablet ? columns.filter((c) => c.hideOnTablet) : [];
  const firstKey = visible[0]?.key;
  const isAction = (c: ResponsiveDataTableColumn<T>) => tablet && c.card === "actions";

  return (
    <div className={wrapperClass}>
      <Table className={tablet ? tabletTableClassName : tableClassName}>
        <TableHeader className={headerClassName ?? "sticky top-0 z-10 bg-muted/50"}>
          <TableRow>
            {visible.map((c) => (
              <TableHead
                key={c.key}
                className={cn(c.className, c.headerClassName, "align-middle", isAction(c) && STICKY_ACTION)}
              >
                {c.header}
                {tablet && c.key === firstKey && merged.length > 0 && (
                  <span className="block text-xs font-normal">
                    {merged.map((m) => m.header).filter((h) => typeof h === "string").join(" · ")}
                  </span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const extra = merged
              .map((m) => ({ key: m.key, node: (m.metaText ?? m.cell)(row) }))
              .filter((m) => !isEmptyNode(m.node));
            return (
              <TableRow
                key={rowKey(row)}
                title={rowTitle?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                className={cn(
                  striped && "even:bg-muted/30",
                  onRowClick && "cursor-pointer hover:bg-accent",
                  rowClassName?.(row),
                )}
              >
                {visible.map((c) => (
                  <TableCell key={c.key} className={cn(c.className, isAction(c) && STICKY_ACTION)}>
                    {c.cell(row)}
                    {c.key === firstKey && extra.length > 0 && (
                      <div className="mt-1 text-xs font-normal text-muted-foreground">
                        {extra.map((m, i) => (
                          <Fragment key={m.key}>
                            {i > 0 && <span aria-hidden="true"> · </span>}
                            <span>{m.node}</span>
                          </Fragment>
                        ))}
                      </div>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export type ResponsiveRowProps = HTMLAttributes<HTMLDivElement>;

export default ResponsiveDataTable;

