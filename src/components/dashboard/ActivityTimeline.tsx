import { usePetitionAuditLogList } from "@/hooks/usePetition";
import {
  PETITION_AUDIT_EVENT_LABELS,
  PETITION_STATUS_CONFIG,
  type PetitionAuditLogEntry,
} from "@/types/petition.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { formatTime } from "@/lib/dateTime";

function describe(e: PetitionAuditLogEntry): string {
  const base = PETITION_AUDIT_EVENT_LABELS[e.event] ?? e.event;
  if (e.event === "statusChanged" && e.toStatus) {
    return `${base} → ${PETITION_STATUS_CONFIG[e.toStatus]?.label ?? e.toStatus}`;
  }
  return base;
}

export default function ActivityTimeline({ kind }: { kind: "audit" | "statusChanges" }) {
  const { data } = usePetitionAuditLogList({ page: 1, limit: 20 });
  let items = data?.items ?? [];
  if (kind === "statusChanges") items = items.filter((e) => e.event === "statusChanged");
  items = items.slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" /> กิจกรรมล่าสุด
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีกิจกรรม</p>
        ) : (
          <ol className="relative space-y-3 pl-4">
            {items.map((e) => (
              <li key={e._id} className="relative">
                <span className="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-primary/60" />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm"><span className="font-medium text-primary">{e.petitionNo}</span> · {describe(e)}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {formatTime(e.createdAt)}
                  </span>
                </div>
                {e.actor ? <p className="text-[11px] text-muted-foreground">โดย {e.actor}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
