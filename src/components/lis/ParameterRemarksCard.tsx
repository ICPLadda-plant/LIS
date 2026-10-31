import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ParameterItem } from "@/lib/api";
import { formatDateTime } from "@/lib/dateTime";
import type { Petition, QCTestResult } from "@/types/petition.types";

interface ParameterRemarksCardProps {
  petition: Pick<Petition, "items">;
  results: QCTestResult[];
  parameters: ParameterItem[];
}

/** หมายเหตุรายพารามิเตอร์ที่ผู้บันทึกผล QC / Lab กรอกไว้ (อ่านอย่างเดียว, ไม่พิมพ์ใน COA) */
export default function ParameterRemarksCard({ petition, results, parameters }: ParameterRemarksCardProps) {
  const scopeById = new Map(parameters.map((p) => [String(p._id), p.scope ?? "qc"]));
  const rows = results
    .filter((r) => String(r.remark ?? "").trim())
    .map((r) => ({ result: r, item: petition.items?.find((it) => it.seq === r.itemSeq) }))
    .sort((a, b) => a.result.itemSeq - b.result.itemSeq || String(a.result.parameterName).localeCompare(String(b.result.parameterName), "th"));
  if (!rows.length) return null;

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">หมายเหตุผลการทดสอบ</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto rounded-b-lg border-t">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">ตัวอย่าง</th>
                <th className="px-4 py-2 text-left font-medium">พารามิเตอร์</th>
                <th className="px-4 py-2 text-left font-medium">หมายเหตุ</th>
                <th className="px-4 py-2 text-left font-medium">ผู้บันทึก</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ result, item }) => (
                <tr key={`${result.itemSeq}-${result.parameterId}`} className="hover:bg-accent">
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium">{item?.sampleName || result.sampleName || `รายการที่ ${result.itemSeq}`}</div>
                    {item?.batchNo && <div className="text-xs text-muted-foreground">Batch: {item.batchNo}</div>}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{result.parameterName || "-"}</span>
                      <Badge variant={scopeById.get(String(result.parameterId)) === "lab" ? "primary-soft" : "gray-soft"}>
                        {scopeById.get(String(result.parameterId)) === "lab" ? "Lab" : "QC"}
                      </Badge>
                    </div>
                  </td>
                  <td className="whitespace-pre-wrap px-4 py-2 align-top">{result.remark}</td>
                  <td className="px-4 py-2 align-top text-muted-foreground">
                    <div>{result.remarkBy?.name || "-"}</div>
                    {result.remarkAt && <div className="text-xs">{formatDateTime(result.remarkAt)}</div>}
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
