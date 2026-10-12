import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dateTime";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  API_OUTCOME_LABEL,
  API_REASON_LABEL,
  type ApiRequestLogItem,
} from "@/lib/apiKeys";

interface Props {
  logs: ApiRequestLogItem[];
  loading: boolean;
  outcomeFilter: string;
  onOutcomeFilterChange: (value: string) => void;
}

const OUTCOMES = ["all", "audit-pass", "allowed", "legacy-token", "denied", "rate-limited"];

const tone = (outcome: string) =>
  outcome === "denied" || outcome === "rate-limited" ? "destructive" : "outline";

export default function ApiRequestLogTable({
  logs,
  loading,
  outcomeFilter,
  onOutcomeFilterChange,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">กรองผลลัพธ์</span>
        <Select value={outcomeFilter} onValueChange={onOutcomeFilterChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {o === "all" ? "ทั้งหมด" : API_OUTCOME_LABEL[o] ?? o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : logs.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          ยังไม่มีการเรียกเข้ามาที่ endpoint ที่ถูกคุม
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left">เวลา</th>
                <th className="p-2 text-left">endpoint</th>
                <th className="p-2 text-left">key</th>
                <th className="p-2 text-left">ผลลัพธ์</th>
                <th className="p-2 text-left">เหตุผล</th>
                <th className="p-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t">
                  <td className="p-2 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(log.at)}
                  </td>
                  <td className="p-2">
                    <code className="text-xs">{log.method} {log.path}</code>
                  </td>
                  <td className="p-2">{log.keyName || "—"}</td>
                  <td className="p-2">
                    <Badge variant={tone(log.outcome)}>
                      {API_OUTCOME_LABEL[log.outcome] ?? log.outcome}
                    </Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {API_REASON_LABEL[log.reason] ?? log.reason}
                  </td>
                  <td className="p-2 text-muted-foreground">{log.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
