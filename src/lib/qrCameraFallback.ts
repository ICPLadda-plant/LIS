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
