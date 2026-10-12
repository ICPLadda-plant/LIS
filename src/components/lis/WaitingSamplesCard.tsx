import { Hourglass, Inbox } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Petition } from "@/types/petition.types";
import { formatDateTime } from "@/lib/dateTime";

const MAX_VISIBLE = 6;

export default function WaitingSamplesCard({ petitions }: { petitions: Petition[] }) {
  const navigate = useNavigate();
  const visible = petitions.slice(0, MAX_VISIBLE);
  const remaining = Math.max(0, petitions.length - MAX_VISIBLE);

  return (
    <Card className="shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            ตัวอย่างรอรับเข้าระบบ
            {petitions.length > 0 ? (
              <Badge variant="primary-soft" className="tabular-nums">{petitions.length}</Badge>
            ) : null}
          </CardTitle>
          {petitions.length > 0 ? (
            <button
              type="button"
              onClick={() => navigate("/petition?status=sampleSent")}
              className="text-xs font-medium text-primary hover:underline"
            >
              รับเข้าทั้งหมด →
            </button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {petitions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium">ไม่มีตัวอย่างที่รอรับเข้าระบบ</p>
            <p className="text-xs text-muted-foreground">เคลียร์งานครบแล้ว ✨</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {visible.map((petition) => {
                const submittedAt = petition.submittedBy?.submittedAt ?? petition.updatedAt;
                const sampleNames = petition.items.map((i) => i.sampleName).filter(Boolean).join(", ") || "-";

                return (
                  <li key={petition._id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/petition/${petition._id}`)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Hourglass className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-primary text-sm">{petition.petitionNo}</span>
                        <p className="truncate text-xs text-foreground/80 mt-0.5">{sampleNames}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {petition.submittedBy?.name ?? "-"} · {formatDateTime(submittedAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {remaining > 0 ? (
              <button
                type="button"
                onClick={() => navigate("/petition?status=sampleSent")}
                className="block w-full border-t border-border px-4 py-2.5 text-center text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                + อีก {remaining} รายการ
              </button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
