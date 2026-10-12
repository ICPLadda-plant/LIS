import { Ban, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/dateTime";
import {
  API_KEY_STATUS_LABEL,
  isExpiringSoon,
  type ApiKeyItem,
  type ApiScope,
} from "@/lib/apiKeys";

interface Props {
  items: ApiKeyItem[];
  scopes: ApiScope[];
  onEdit: (item: ApiKeyItem) => void;
  onRevoke: (item: ApiKeyItem) => void;
  onDelete: (item: ApiKeyItem) => void;
}

const fmt = (iso: string | null) => formatDateTime(iso, "—");

const fmtDate = (iso: string | null) => formatDate(iso, "ไม่หมดอายุ");

const statusVariant = (status: ApiKeyItem["status"]) =>
  status === "active" ? "default" : status === "expired" ? "secondary" : "destructive";

export default function ApiKeyList({ items, scopes, onEdit, onRevoke, onDelete }: Props) {
  const scopeLabel = (id: string) => scopes.find((s) => s.id === id)?.label ?? id;

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        ยังไม่มี API key — กด "สร้าง API key" เพื่อออกใบแรก
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="p-2 text-left">ชื่อ</th>
            <th className="p-2 text-left">key</th>
            <th className="p-2 text-left">scope</th>
            <th className="p-2 text-left">หมดอายุ</th>
            <th className="p-2 text-left">ใช้ล่าสุด</th>
            <th className="p-2 text-right">ครั้ง</th>
            <th className="p-2 text-left">สถานะ</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="p-2 font-medium">{item.name}</td>
              <td className="p-2 font-mono text-xs text-muted-foreground">{item.keyPrefix}…</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-1">
                  {item.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="text-[11px]">
                      {scopeLabel(s)}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="p-2">
                {fmtDate(item.expiresAt)}
                {item.status === "active" && isExpiringSoon(item.expiresAt) && (
                  <Badge variant="secondary" className="ml-1 text-[11px]">
                    ใกล้หมดอายุ
                  </Badge>
                )}
              </td>
              <td className="p-2 text-muted-foreground">{fmt(item.lastUsedAt)}</td>
              <td className="p-2 text-right tabular-nums">{item.usageCount}</td>
              <td className="p-2">
                <Badge variant={statusVariant(item.status)}>{API_KEY_STATUS_LABEL[item.status]}</Badge>
              </td>
              <td className="p-2">
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" title="แก้ไข" onClick={() => onEdit(item)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="เพิกถอน"
                    disabled={item.status === "revoked"}
                    onClick={() => onRevoke(item)}
                  >
                    <Ban className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title="ลบ" onClick={() => onDelete(item)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
