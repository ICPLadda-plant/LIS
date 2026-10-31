import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ApprovalItemGroup } from "@/lib/qcApprovalRows";

interface Props {
  groups: ApprovalItemGroup[];
  /** ปุ่ม/สถานะเพิ่มเติมที่หัวการ์ดของแต่ละรายการ (เช่น อนุมัติรายรายการ) */
  renderGroupActions?: (group: ApprovalItemGroup) => ReactNode;
}

/**
 * ตารางสรุปผลการทดสอบแบบ read-only (ช่อง/ค่าที่บันทึก/เกณฑ์/สถานะ/หมายเหตุ) ต่อรายการตัวอย่าง.
 * ใช้ร่วมกันระหว่างหน้าออกผล Lab และ dialog ดูรายละเอียดผล Lab — โครงสร้าง groups มาจาก
 * buildApprovalGroups (parameters ถูก scope ก่อนส่งเข้ามา ที่นี่แค่ render).
 */
export default function LabResultGroups({ groups, renderGroupActions }: Props) {
  return (
    <>
      {groups.map((g) => (
        <Card key={g.seq} className="overflow-hidden">
          <CardHeader className="pb-3 bg-muted">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <span>รายการที่ {g.seq}: {g.sampleName}</span>
                {g.batchNo && <Badge variant="gray-soft" className="font-normal">Batch: {g.batchNo}</Badge>}
                {g.sampleId && <Badge variant="primary-soft" className="font-normal text-xs">{g.sampleId}</Badge>}
              </CardTitle>
              {renderGroupActions?.(g)}
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-5">
            {g.unmatched ? (
              <p className="text-sm text-muted-foreground italic">ไม่พบพารามิเตอร์ที่ตรงกับรายการทดสอบ</p>
            ) : (
              g.params.map((param) => (
                <div key={param.parameterId} className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">{param.parameterName}</h3>
                  {param.remark && (
                    <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">หมายเหตุ:</span> {param.remark}
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm table-fixed">
                      <colgroup>
                        <col style={{ width: "24%" }} />
                        <col style={{ width: "16%" }} />
                        <col style={{ width: "26%" }} />
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "20%" }} />
                      </colgroup>
                      <thead className="text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="py-1 pr-3 font-medium">ช่อง</th>
                          <th className="py-1 pr-3 font-medium">ค่าที่บันทึก</th>
                          <th className="py-1 pr-3 font-medium">เกณฑ์มาตรฐาน</th>
                          <th className="py-1 pr-3 font-medium">สถานะ</th>
                          <th className="py-1 font-medium">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {param.rows.map((row) => (
                          <tr key={row.key} className={cn("border-t border-border align-top", row.abnormal && "bg-destructive/10")}>
                            <td className="py-1.5 pr-3 break-words">
                              {row.label}{row.unit ? <span className="text-muted-foreground"> ({row.unit})</span> : null}
                            </td>
                            <td className="py-1.5 pr-3 font-mono font-semibold break-words">{row.value || "-"}</td>
                            <td className="py-1.5 pr-3 text-muted-foreground break-words">{row.standardText || "-"}</td>
                            <td className="py-1.5 pr-3">
                              {row.abnormal ? (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <AlertTriangle className="h-3.5 w-3.5" /> ผิดปกติ
                                </span>
                              ) : (
                                <span className="text-green-700 dark:text-green-300">ปกติ</span>
                              )}
                            </td>
                            <td className="py-1.5 text-muted-foreground break-words">{row.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
