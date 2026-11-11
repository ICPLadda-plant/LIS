import type { ReactNode } from "react";
import { displayMediaUrl, isVideoUrl, mediaUrlsFromText } from "@/lib/mediaUrls";

function fileNameFromUrl(url: string): string {
  const name = url.split(/[?#]/)[0].split("/").pop() || url;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * ช่องผลในเอกสารพิมพ์: ถ้าค่าเป็นไฟล์รูปที่อัปโหลด แสดงเป็นรูป (วิดีโอพิมพ์ไม่ได้ จึงแสดงชื่อไฟล์)
 * ค่าอื่นแสดง children หรือข้อความเดิม
 */
export function PrintMediaValue({ value, children }: { value: unknown; children?: ReactNode }) {
  const urls = mediaUrlsFromText(value);
  if (!urls.length) return <>{children ?? (value == null ? "" : String(value))}</>;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: "2mm", justifyContent: "center" }}>
      {urls.map((url, index) => (
        isVideoUrl(url) ? (
          <span key={`${url}-${index}`} style={{ fontSize: "9pt" }}>วิดีโอ: {fileNameFromUrl(url)}</span>
        ) : (
          <img
            key={`${url}-${index}`}
            src={displayMediaUrl(url)}
            alt="รูปผลการทดสอบ"
            style={{ display: "block", width: "38mm", maxWidth: "100%", maxHeight: "38mm", objectFit: "contain", border: "0.5pt solid #ccc", breakInside: "avoid", pageBreakInside: "avoid" }}
          />
        )
      ))}
    </span>
  );
}
