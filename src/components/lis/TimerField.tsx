import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Play, RotateCcw, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ParameterValueField } from "@/lib/api";
import { isNotificationSoundEnabled } from "@/lib/appPreferences";
import { timerDurationMs, timerRemainingMs, isTimerDone, formatTimerHuman } from "@/lib/parameterValidation";
import { formatTime } from "@/lib/dateTime";

interface TimerFieldProps {
  field: ParameterValueField;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
}

function formatRemaining(ms: number): string {
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${d}d ${h}h`;
}

export function TimerField({ field, value, onChange, disabled = false }: TimerFieldProps) {
  const startedAt = typeof value === "string" && value ? value : null;
  const duration = timerDurationMs(field);

  if (!duration) {
    return (
      <p className="text-xs text-amber-700">
        พารามิเตอร์นี้ยังไม่ได้กำหนดระยะเวลา — กรุณาตั้งค่าใน Parameter Settings
      </p>
    );
  }

  if (!startedAt) {
    return (
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => onChange(new Date().toISOString())}
          disabled={disabled}
          className="h-8"
          type="button"
        >
          <Play className="h-3.5 w-3.5 mr-1" />
          เริ่มจับเวลา
        </Button>
        <span className="text-xs text-grey-500">
          ระยะเวลา {formatTimerHuman(field.timerDurationSec ?? 0)}
        </span>
      </div>
    );
  }

  if (isTimerDone(field, startedAt)) {
    return (
      <TimerDone
        field={field}
        startedAt={startedAt}
        onReset={() => onChange(null)}
        disabled={disabled}
      />
    );
  }

  return (
    <TimerRunning
      field={field}
      startedAt={startedAt}
      onReset={() => onChange(null)}
      disabled={disabled}
    />
  );
}

function TimerRunning({
  field,
  startedAt,
  onReset,
  disabled = false,
}: {
  field: ParameterValueField;
  startedAt: string;
  onReset: () => void;
  disabled?: boolean;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const isLong = field.timerUnit === "day" || field.timerUnit === "month";
    const intervalMs = isLong ? 60_000 : 1000;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [field.timerUnit]);

  const remainingNow = timerRemainingMs(field, startedAt) ?? 0;
  const total = timerDurationMs(field) ?? 0;
  const pct = total > 0
    ? Math.max(0, Math.min(100, ((total - remainingNow) / total) * 100))
    : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono">
          เหลือ {formatRemaining(remainingNow)} / {formatTimerHuman(field.timerDurationSec ?? 0)}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={onReset}
          disabled={disabled}
          className="h-7"
          type="button"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          รีเซ็ต
        </Button>
      </div>
      <div className="h-1.5 bg-grey-200 rounded overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TimerDone({
  field,
  startedAt,
  onReset,
  disabled = false,
}: {
  field: ParameterValueField;
  startedAt: string;
  onReset: () => void;
  disabled?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundPlaying, setSoundPlaying] = useState(() => isNotificationSoundEnabled("timerDone"));
  const endedAt = new Date(
    new Date(startedAt).getTime() + (timerDurationMs(field) ?? 0),
  );

  useEffect(() => {
    if (!soundPlaying) return;
    const url = `${import.meta.env.BASE_URL}sound/timer-done.mp3`;
    const audio = new Audio(url);
    audio.loop = true;
    audioRef.current = audio;
    audio.play().catch(() => {
      const fallback = new Audio(`${import.meta.env.BASE_URL}sound/new.mp3`);
      fallback.loop = true;
      audioRef.current = fallback;
      fallback.play().catch(() => {
        /* autoplay blocked or no sound files */
      });
    });
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
    };
  }, [soundPlaying]);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
        "bg-emerald-50 border-emerald-200",
      )}
    >
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      <span className="text-sm font-medium text-emerald-900">
        เสร็จเมื่อ {formatTime(endedAt)}
      </span>
      {soundPlaying && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSoundPlaying(false)}
          className="h-7"
          type="button"
        >
          <VolumeX className="h-3 w-3 mr-1" />
          หยุดเสียง
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={onReset}
        disabled={disabled}
        className="h-7"
        type="button"
      >
        <RotateCcw className="h-3 w-3 mr-1" />
        เริ่มใหม่
      </Button>
    </div>
  );
}
