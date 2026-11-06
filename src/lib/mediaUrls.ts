const MEDIA_CACHE_BUSTER = "lis_media=1";
const VIDEO_EXT_RE = /\.(mp4|webm|mov)(?:$|[?#])/i;
const MEDIA_EXT_RE = /\.(jpe?g|png|webp|gif|mp4|webm|mov)(?:$|[?#])/i;

export function publicMediaUrl(url: string) {
  return url
    .replace(/^\/LIS\/api\/uploads\//, "/LIS/uploads/")
    .replace(/^\/api\/uploads\//, "/uploads/");
}

export function displayMediaUrl(url: string) {
  const publicUrl = publicMediaUrl(url);
  const separator = publicUrl.includes("?") ? "&" : "?";
  return `${publicUrl}${separator}${MEDIA_CACHE_BUSTER}`;
}

export function isVideoUrl(url: string) {
  return VIDEO_EXT_RE.test(url);
}

/** ดึง URL รูป/วิดีโอที่อัปโหลดจากค่าที่บันทึก (string หรือ array); คืน [] ถ้าไม่ใช่ไฟล์สื่อทั้งหมด */
export function mediaUrlsFromValue(raw: unknown): string[] {
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => v != null && v !== "");
  const urls = list
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => /\/uploads\//.test(v) && MEDIA_EXT_RE.test(v));
  return urls.length > 0 && urls.length === list.length ? urls : [];
}
