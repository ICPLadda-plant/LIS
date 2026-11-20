import type { ReactNode } from "react";
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

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  /** Extra className per row — e.g. a one-shot highlight for a just-navigated-to row. */
  rowClassName?: (row: T) => string | undefined;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  className?: string;
  /** Applied to the inner <table> — e.g. "min-w-[700px]" to keep columns from squishing on mobile. */
  tableClassName?: string;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  isLoading,
  isError,
  onRetry,
  onRowClick,
  rowClassName,
  emptyTitle,
  emptyDescription,
  emptyAction,
  className,
  tableClassName,
}: DataTableProps<T>) {
  const body = () => {
    if (isLoading) return <TableSkeleton cols={columns.length} />;
    if (isError) return <ErrorState onRetry={onRetry} />;
    if (data.length === 0)
      return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
    return null;
  };

  const overlay = body();

  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {overlay ? (
        overlay
      ) : (
        <Table className={tableClassName}>
          <TableHeader className="sticky top-0 z-10 bg-muted/50">
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(c.className, "align-middle")}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "even:bg-muted/30",
                  onRowClick && "cursor-pointer hover:bg-accent",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default DataTable;
