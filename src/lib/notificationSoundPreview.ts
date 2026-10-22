import type { NotificationSoundPreference } from "@/lib/appPreferences";

const soundUrl = (file: string) => `${import.meta.env.BASE_URL}sound/${file}`;

const PREVIEW_SOUND_FILES: Record<NotificationSoundPreference, string> = {
  sampleArrival: "sample-arrival.mp3",
  labAssigned: "lab-assigned.mp3",
  queueNew: "new.mp3",
  timerDone: "timer-done.mp3",
};

const FALLBACK_SOUND_FILE = "new.mp3";
export const PREVIEW_MAX_DURATION_MS = 3_000;

let currentPreview: { audio: HTMLAudioElement; timer: ReturnType<typeof setTimeout> } | null = null;

const stopCurrentPreview = () => {
  if (!currentPreview) return;
  clearTimeout(currentPreview.timer);
  currentPreview.audio.pause();
  currentPreview.audio.currentTime = 0;
  currentPreview = null;
};

const startPreview = (file: string) => {
  const audio = new window.Audio(soundUrl(file));
  audio.preload = "auto";
  audio.volume = 1;
  audio.loop = false;
  const timer = setTimeout(stopCurrentPreview, PREVIEW_MAX_DURATION_MS);
  currentPreview = { audio, timer };
  audio.addEventListener("ended", () => {
    if (currentPreview?.audio === audio) stopCurrentPreview();
  });
  return audio.play();
};

/**
 * เล่นเสียงแจ้งเตือนตัวอย่างหนึ่งครั้ง (ไม่เกิน 3 วินาที) โดยไม่สนสวิตช์เปิด/ปิดเสียง
 * เพราะผู้ใช้ตั้งใจกดทดสอบเอง และไม่สร้างแจ้งเตือนในระบบ
 */
export const previewNotificationSound = async (sound: NotificationSoundPreference): Promise<boolean> => {
  if (typeof window === "undefined" || typeof window.Audio !== "function") return false;
  stopCurrentPreview();
  try {
    await startPreview(PREVIEW_SOUND_FILES[sound]);
    return true;
  } catch {
    stopCurrentPreview();
    if (PREVIEW_SOUND_FILES[sound] === FALLBACK_SOUND_FILE) return false;
    try {
      await startPreview(FALLBACK_SOUND_FILE);
      return true;
    } catch {
      stopCurrentPreview();
      return false;
    }
  }
};
