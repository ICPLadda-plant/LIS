import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/context/NotificationContext";
import { isNotificationSoundEnabled } from "@/lib/appPreferences";
import { audiencesForUser, readSeeAll, SEE_ALL_EVENT } from "@/lib/petitionAudience";
import { normalizeRoles } from "@/lib/roles";
import {
  PETITION_NOTIFICATIONS_REFRESH_EVENT,
  cursorKey,
  effectiveSeeAll,
  markPetitionNotificationsBackfilled,
  nextCursor,
  petitionNotificationSince,
  shouldBackfillPetitionNotifications,
} from "@/lib/petitionFlowWatcher";

const FIRST_POLL_SOUND_GRACE_MS = 65_000;
const NOTIFICATION_REFETCH_INTERVAL_MS = 10_000;
const SAMPLE_ARRIVAL_SOUND_URL = `${import.meta.env.BASE_URL}sound/sample-arrival.mp3`;
const LAB_ASSIGNED_SOUND_URL = `${import.meta.env.BASE_URL}sound/lab-assigned.mp3`;
const SAMPLE_ARRIVAL_PLAY_COUNT = 3;
const SAMPLE_ARRIVAL_TONE_COUNT = 3;
const SAMPLE_ARRIVAL_TONE_INTERVAL_SEC = 0.27;
const SAMPLE_ARRIVAL_TONE_DURATION_SEC = 0.22;
const SAMPLE_ARRIVAL_TONE_ATTACK_SEC = 0.03;
const SAMPLE_ARRIVAL_TONE_PEAK_GAIN = 0.55;

const isScannerRoute = () => {
  if (typeof window === "undefined") return false;
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  return pathname === "/scanner" || pathname.endsWith("/scanner");
};

const isFreshOnFirstPoll = (createdAt: string | undefined, serverTime: string | undefined) => {
  const createdAtMs = Date.parse(createdAt || "");
  const serverTimeMs = Date.parse(serverTime || "");
  if (Number.isNaN(createdAtMs) || Number.isNaN(serverTimeMs)) return false;
  return serverTimeMs - createdAtMs <= FIRST_POLL_SOUND_GRACE_MS && createdAtMs <= serverTimeMs + 5_000;
};

const playSampleArrivalFallbackTone = () => {
  if (typeof window === "undefined") return;
  const AudioContextCtor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    const audioContext = new AudioContextCtor();
    const start = audioContext.currentTime;

    for (let toneIndex = 0; toneIndex < SAMPLE_ARRIVAL_TONE_COUNT; toneIndex += 1) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const toneStart = start + toneIndex * SAMPLE_ARRIVAL_TONE_INTERVAL_SEC;
      const toneEnd = toneStart + SAMPLE_ARRIVAL_TONE_DURATION_SEC;

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(1046.5, toneStart);
      oscillator.frequency.exponentialRampToValueAtTime(1760, toneStart + 0.08);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(SAMPLE_ARRIVAL_TONE_PEAK_GAIN, toneStart + SAMPLE_ARRIVAL_TONE_ATTACK_SEC);
      gain.gain.setValueAtTime(SAMPLE_ARRIVAL_TONE_PEAK_GAIN, toneEnd - 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd);

      if (toneIndex === SAMPLE_ARRIVAL_TONE_COUNT - 1) {
        oscillator.onended = () => {
          if (audioContext.state !== "closed") void audioContext.close().catch(() => undefined);
        };
      }
    }
  } catch {
    return;
  }
};

type PetitionNotificationSound = "sampleArrival" | "labAssigned";

const playAudioFile = ({ fallback, repeat = 1, url }: { fallback?: () => void; repeat?: number; url: string }) => {
  if (typeof window === "undefined") return;
  if (typeof window.Audio !== "function") {
    fallback?.();
    return;
  }

  try {
    const audio = new window.Audio(url);
    let playCount = 0;
    const playCurrentRound = () => {
      playCount += 1;
      audio.currentTime = 0;
      void audio.play().catch(() => fallback?.());
    };

    audio.preload = "auto";
    audio.volume = 1;
    audio.addEventListener("ended", () => {
      if (playCount < repeat) playCurrentRound();
    });
    playCurrentRound();
  } catch {
    fallback?.();
  }
};

const playNotificationSound = (sound: PetitionNotificationSound = "sampleArrival") => {
  if (!isNotificationSoundEnabled(sound)) return;
  if (sound === "labAssigned") {
    playAudioFile({ fallback: playSampleArrivalFallbackTone, url: LAB_ASSIGNED_SOUND_URL });
    return;
  }
  playAudioFile({ fallback: playSampleArrivalFallbackTone, repeat: SAMPLE_ARRIVAL_PLAY_COUNT, url: SAMPLE_ARRIVAL_SOUND_URL });
};

/** เสียงเตือนงานด่วนรายชั่วโมง — ใช้เสียงและการตั้งค่าเปิด/ปิดเดียวกับตัวอย่างมาถึง */
// eslint-disable-next-line react-refresh/only-export-components
export const playUrgentReminderSound = () => {
  if (isScannerRoute()) return;
  playNotificationSound("sampleArrival");
};

/**
 * Poll ความเคลื่อนไหวของคำขอถี่พอสำหรับแจ้งเตือนงานใหม่ แล้วยิงเข้ากระดิ่ง
 * cursor เดินหน้าเฉพาะตอน query สำเร็จ — เน็ตกระตุกแล้วต้องไม่กลืน event ที่ยังไม่เคยแสดง
 */
const PetitionFlowWatcher = () => {
  const { user } = useAuth();
  const { push } = useNotifications();
  const playedSoundIdsRef = useRef<Set<string>>(new Set());
  const shouldMarkBackfilledRef = useRef(false);
  const [seeAllRaw, setSeeAllRaw] = useState(() => readSeeAll());
  const seeAll = effectiveSeeAll(user, seeAllRaw);

  useEffect(() => {
    const sync = () => setSeeAllRaw(readSeeAll());
    window.addEventListener(SEE_ALL_EVENT, sync);
    return () => window.removeEventListener(SEE_ALL_EVENT, sync);
  }, []);

  const audiences = useMemo(() => audiencesForUser(user), [user]);
  const roles = useMemo(() => normalizeRoles(user), [user]);
  const employeeId = user?.employeeId;
  const enabled = !!user && (audiences.length > 0 || !!employeeId || seeAll);

  const { data, refetch } = useQuery({
    queryKey: ["petition-notifications", employeeId ?? "", audiences.join(","), roles.join(","), seeAll],
    queryFn: () => {
      shouldMarkBackfilledRef.current = shouldBackfillPetitionNotifications(employeeId, user);
      return api.getPetitionNotifications({
        since: petitionNotificationSince(employeeId, user),
        audiences,
        roles,
        employeeId,
        all: seeAll,
      });
    },
    refetchInterval: NOTIFICATION_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    enabled,
  });

  useEffect(() => {
    if (!enabled) return;
    const refreshNow = () => {
      void refetch();
    };
    window.addEventListener(PETITION_NOTIFICATIONS_REFRESH_EVENT, refreshNow);
    return () => window.removeEventListener(PETITION_NOTIFICATIONS_REFRESH_EVENT, refreshNow);
  }, [enabled, refetch]);

  useEffect(() => {
    if (!data) return;
    const soundsToPlay = new Set<PetitionNotificationSound>();
    let hasExistingCursor = false;
    const key = cursorKey(employeeId);
    try {
      hasExistingCursor = !!localStorage.getItem(key);
    } catch {
      hasExistingCursor = false;
    }

    // server เรียงใหม่→เก่า; push ทีละอันแบบกลับด้าน เพื่อให้อันใหม่สุดไปอยู่หัวลิสต์
    for (const item of [...data.items].reverse()) {
      if (item.playSound && !playedSoundIdsRef.current.has(item.id)) {
        playedSoundIdsRef.current.add(item.id);
        if (hasExistingCursor || isFreshOnFirstPoll(item.createdAt, data.serverTime)) {
          soundsToPlay.add(item.sound ?? "sampleArrival");
        }
      }
      push({
        id: item.id,
        title: item.title,
        message: item.message,
        level: item.level,
        link: item.link,
        createdAt: new Date(item.createdAt).getTime(),
        persistent: true,
        group: "petition",
      });
    }
    if (!isScannerRoute()) {
      soundsToPlay.forEach((sound) => playNotificationSound(sound));
    }
    try {
      const stored = localStorage.getItem(key);
      localStorage.setItem(key, nextCursor(stored, data.serverTime));
      if (shouldMarkBackfilledRef.current) markPetitionNotificationsBackfilled(user);
      shouldMarkBackfilledRef.current = false;
    } catch {
      // private mode — รอบหน้าจะดึงย้อนหลัง 24 ชม.ใหม่ ซึ่ง push กันซ้ำด้วย id อยู่แล้ว
    }
  }, [data, employeeId, push, user]);

  return null;
};

export default PetitionFlowWatcher;
