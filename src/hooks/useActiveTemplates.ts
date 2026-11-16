import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PaperSize } from "@/lib/documentRegistry";

export type ActiveTemplate = { id: string; html: string; paper: PaperSize; templateFor: string; title: string };

// แม่แบบสถานะ "ใช้งาน" ที่ผู้ใช้แก้ไว้ในหน้า "จัดการเอกสาร" แยกตามรหัสฟอร์ม
// โหลดไม่สำเร็จ/ไม่มี = คืน {} แล้วหน้าพิมพ์ใช้ฟอร์มเดิมของระบบ
export function useActiveTemplates(codes: string[], enabled = true) {
  const [map, setMap] = useState<Record<string, ActiveTemplate>>({});
  const key = codes.join("|");
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    Promise.all(key.split("|").map((code) =>
      api.get<{ data: ActiveTemplate[] }>("/documents?templateFor=" + encodeURIComponent(code) + "&active=1")
        .then((r) => [code, Array.isArray(r.data.data?.data) ? r.data.data.data[0] : undefined] as const)
        .catch(() => [code, undefined] as const),
    )).then((pairs) => {
      if (!alive) return;
      const next: Record<string, ActiveTemplate> = {};
      for (const [code, t] of pairs) if (t) next[code] = t;
      setMap(next);
    });
    return () => { alive = false; };
  }, [key, enabled]);
  return map;
}
