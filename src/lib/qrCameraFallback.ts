type CameraInfo = { id: string; label: string };

const BACK_RE = /back|environment|rear|หลัง|后|背面/i;
// กล้องอินฟราเรด (Windows Hello) ใช้สแกน QR ไม่ได้ → ลองเป็นลำดับท้ายสุด
const IR_RE = /\bir\b|infrared/i;

/** เรียงกล้องที่ควรลอง: กล้องหลัง → กล้องปกติ → กล้อง IR */
export function orderCamerasForScan<T extends CameraInfo>(cameras: T[]): T[] {
  const rank = (c: T) => (IR_RE.test(c.label) ? 2 : BACK_RE.test(c.label) ? 0 : 1);
  return [...cameras].sort((a, b) => rank(a) - rank(b));
}

/** ไล่เปิดกล้องทีละตัวจนกว่าจะเปิดได้ ถ้าไม่ได้สักตัวจะ throw error ตัวสุดท้าย */
export async function startFirstWorkingCamera<T extends CameraInfo>(
  cameras: T[],
  start: (cameraId: string) => Promise<unknown>,
): Promise<void> {
  let lastError: unknown = new Error('no camera');
  for (const cam of orderCamerasForScan(cameras)) {
    try {
      await start(cam.id);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** แปลง error จากกล้องเป็นข้อความที่ผู้ใช้เข้าใจ พร้อมรหัสไว้ไล่ปัญหา */
export function describeCameraError(err: unknown): string {
  const name = (err as { name?: string })?.name || '';
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  const code = name || msg.slice(0, 60);
  let reason = 'กรอกเลขคำร้องเองได้เลย';
  if (typeof window !== 'undefined' && !window.isSecureContext) reason = 'หน้าเว็บต้องเปิดผ่าน https';
  else if (/NotAllowed|Permission|denied/i.test(name + msg)) reason = 'เบราว์เซอร์บล็อกสิทธิ์กล้อง กดไอคอนแม่กุญแจ/กล้องที่ช่อง URL แล้วเลือก "อนุญาต"';
  else if (/NotReadable|TrackStart|in use|Could not start/i.test(name + msg)) reason = 'กล้องถูกโปรแกรมอื่นใช้อยู่ (เช่น Teams/Zoom/LINE) ปิดโปรแกรมนั้นแล้วลองใหม่';
  else if (/NotFound|no camera|DevicesNotFound/i.test(name + msg)) reason = 'ไม่พบกล้องในเครื่องนี้';
  return `เปิดกล้องไม่ได้ — ${reason}${code ? ` (${code})` : ''}`;
}


type ResettableScanner = { stop(): Promise<unknown>; clear(): void };

/** ปล่อยกล้องที่อาจค้างจากการเปิดที่ล้ม แล้วคืน scanner ตัวใหม่บน element เดิม */
export async function resetScanner<T extends ResettableScanner>(scanner: T): Promise<T> {
  try { await scanner.stop(); } catch { /* ไม่ได้ scan อยู่ */ }
  try { scanner.clear(); } catch { /* ignore */ }
  const Ctor = scanner.constructor as new (id: string) => T;
  const id = (scanner as unknown as { elementId?: string }).elementId;
  return id ? new Ctor(id) : scanner;
}
