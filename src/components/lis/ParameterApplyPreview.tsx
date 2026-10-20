import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApplyPreview } from "@/lib/parameterApplyPreview";

const COLLAPSED_ROWS = 8;
const EXPANDED_ROWS = 200;

type Props = {
  preview: ApplyPreview;
  applyAll: boolean;
  ready: boolean;
};

export function ParameterApplyPreview({ preview, applyAll, ready }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!ready) {
    return (
      <section aria-label="ผลลัพธ์ใช้กับ" className="mt-5 rounded-lg border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">กำลังโหลดรายการ Master Item...</p>
      </section>
    );
  }

  const total = preview.rows.length;
  const breakdown = [
    ...(applyAll
      ? []
      : preview.ruleCounts.flatMap((count, index) =>
          preview.emptyRules.includes(index) ? [] : [`กฎ ${index + 1}: ${count}`],
        )),
    ...(preview.excludedCount > 0 ? [`ยกเว้น ${preview.excludedCount}`] : []),
  ];
  const warnings = [
    ...preview.emptyRules.map((i) => `กฎ ${i + 1} ยังไม่ได้เลือกเงื่อนไข จะไม่ถูกบันทึก`),
    ...preview.unmatchedRules.map((i) => `กฎ ${i + 1} ไม่ตรงกับ item ไหนใน Master Item ลองตรวจเงื่อนไขอีกครั้ง`),
    ...preview.redundantRules.map((i) => `กฎ ${i + 1} ไม่ได้เพิ่ม item ใหม่ เพราะกฎอื่นครอบคลุมแล้ว`),
    ...(total === 0 && (applyAll || preview.emptyRules.length < preview.ruleCounts.length)
      ? ["ตอนนี้ parameter นี้จะไม่แสดงกับ item ไหนเลย"]
      : []),
  ];
  const visibleRows = preview.rows.slice(0, expanded ? EXPANDED_ROWS : COLLAPSED_ROWS);

  return (
    <section aria-label="ผลลัพธ์ใช้กับ" aria-live="polite" className="mt-5 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{total}</span>
        <span className="text-sm text-muted-foreground">item ใน Master Item จะเห็น parameter นี้</span>
      </div>
      {breakdown.length > 0 ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{breakdown.join(" · ")}</p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {warnings.map((warning) => (
            <li
              key={warning}
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {total > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border bg-card shadow-sm">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="w-48 text-muted-foreground">รหัสสินค้า</TableHead>
                <TableHead className="text-muted-foreground">ชื่อสินค้า</TableHead>
                {applyAll ? null : <TableHead className="w-28 text-muted-foreground">มาจาก</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.itemNo} className="hover:bg-accent">
                  <TableCell className="whitespace-nowrap font-mono text-xs">{row.itemNo}</TableCell>
                  <TableCell className="text-sm">{row.itemName || "—"}</TableCell>
                  {applyAll ? null : (
                    <TableCell className="text-xs text-muted-foreground">
                      {row.ruleIndexes.map((index) => `กฎ ${index + 1}`).join(", ")}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {total > COLLAPSED_ROWS ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "ย่อรายการ" : `ดูทั้งหมด ${total} item`}
          </Button>
          {expanded && total > EXPANDED_ROWS ? (
            <span className="text-xs text-muted-foreground">แสดง {EXPANDED_ROWS} รายการแรก</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
