import { PenLine, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useAppPreferences } from "@/context/AppPreferencesContext";
import { FONT_SIZE_OPTIONS } from "@/lib/appPreferences";
import { previewNotificationSound } from "@/lib/notificationSoundPreview";
import PwaPushSettings from "@/components/lis/PwaPushSettings";
import type {
  AppFontFamilyPreference,
  AppFontSizePreference,
  AppLanguagePreference,
  AppThemePreference,
  NotificationSoundPreference,
} from "@/lib/appPreferences";

interface ProfileSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showSignatureAction: boolean;
  onAddSignature: () => void;
  canTestSounds?: boolean;
}

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const notificationSoundOptions: Array<{
  key: NotificationSoundPreference;
  label: string;
  description: string;
}> = [
  {
    key: "sampleArrival",
    label: "ตัวอย่างใหม่เข้าระบบ",
    description: "เสียงเตือนเมื่อมีตัวอย่างส่งถึง QC/Lab",
  },
  {
    key: "labAssigned",
    label: "งาน Lab ใหม่",
    description: "เสียงเตือนเมื่องานถูก assign ให้ Lab",
  },
  {
    key: "queueNew",
    label: "หน้าคิวมีรายการใหม่",
    description: "เสียง loop บนจอ Queue เมื่อมีงานใหม่",
  },
  {
    key: "timerDone",
    label: "จับเวลาครบกำหนด",
    description: "เสียงเตือน timer ในหน้ากรอกผล",
  },
];

const ProfileSettingsDialog = ({
  open,
  onOpenChange,
  showSignatureAction,
  onAddSignature,
  canTestSounds = false,
}: ProfileSettingsDialogProps) => {
  const { preferences, setPreference, setNotificationSound } = useAppPreferences();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        overlayClassName="bg-background/60 backdrop-blur-sm"
        overlayTestId="profile-settings-blur-backdrop"
      >
        <DialogHeader>
          <DialogTitle>ตั้งค่าโปรไฟล์</DialogTitle>
          <DialogDescription>ตั้งค่าการแสดงผล ภาษา ฟ้อนต์ และเสียงแจ้งเตือนของผู้ใช้นี้</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">ลายเซ็น</h3>
                <p className="text-sm text-muted-foreground">จัดการลายเซ็นสำหรับการอนุมัติเอกสาร</p>
              </div>
              {showSignatureAction ? (
                <Button type="button" variant="outline" onClick={onAddSignature}>
                  <PenLine />
                  เพิ่มลายเซ็น
                </Button>
              ) : null}
            </div>
            {!showSignatureAction ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                บัญชีนี้ยังไม่มีสิทธิ์จัดการลายเซ็น
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-foreground">การแสดงผล</h3>
              <p className="text-sm text-muted-foreground">ตั้งค่าหน้าตาเว็บให้เหมาะกับการใช้งาน</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5" htmlFor="profile-theme-mode">
                <span className="text-sm font-medium text-foreground">โหมดการแสดงผล</span>
                <select
                  id="profile-theme-mode"
                  aria-label="โหมดการแสดงผล"
                  className={selectClassName}
                  value={preferences.theme}
                  onChange={(event) => setPreference("theme", event.target.value as AppThemePreference)}
                >
                  <option value="light">สว่าง</option>
                  <option value="dark">มืด</option>
                </select>
              </label>

              <label className="grid gap-1.5" htmlFor="profile-language">
                <span className="text-sm font-medium text-foreground">ภาษาเว็บ</span>
                <select
                  id="profile-language"
                  aria-label="ภาษาเว็บ"
                  className={selectClassName}
                  value={preferences.language}
                  onChange={(event) => setPreference("language", event.target.value as AppLanguagePreference)}
                >
                  <option value="th">ไทย</option>
                  <option value="en">Eng</option>
                </select>
              </label>

              <label className="grid gap-1.5" htmlFor="profile-font-family">
                <span className="text-sm font-medium text-foreground">ฟ้อนต์</span>
                <select
                  id="profile-font-family"
                  aria-label="ฟ้อนต์"
                  className={selectClassName}
                  value={preferences.fontFamily}
                  onChange={(event) => setPreference("fontFamily", event.target.value as AppFontFamilyPreference)}
                >
                  <option value="kanit">Kanit</option>
                  <option value="sarabun">Sarabun</option>
                  <option value="system">System</option>
                </select>
              </label>

              <label className="grid gap-1.5" htmlFor="profile-font-size">
                <span className="text-sm font-medium text-foreground">ขนาดฟ้อนต์</span>
                <select
                  id="profile-font-size"
                  aria-label="ขนาดฟ้อนต์"
                  className={selectClassName}
                  value={preferences.fontSize}
                  onChange={(event) => setPreference("fontSize", event.target.value as AppFontSizePreference)}
                >
                  {FONT_SIZE_OPTIONS.map((fontSize) => (
                    <option key={fontSize} value={fontSize}>
                      {fontSize.replace("px", " px")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-foreground">เสียงแจ้งเตือน</h3>
              <p className="text-sm text-muted-foreground">เลือกเปิดหรือปิดเสียงแยกตามประเภท หรือปิดทั้งหมด</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                <label htmlFor="profile-sound-all" className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">เสียงแจ้งเตือนทั้งหมด</span>
                  <span className="block text-xs text-muted-foreground">ปิดเพื่อ mute ทุกเสียงในระบบ</span>
                </label>
                <Switch
                  id="profile-sound-all"
                  aria-label="เสียงแจ้งเตือนทั้งหมด"
                  checked={preferences.soundEnabled}
                  onCheckedChange={(checked) => setPreference("soundEnabled", checked)}
                />
              </div>

              {notificationSoundOptions.map((option) => (
                <div key={option.key} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                  <label htmlFor={`profile-sound-${option.key}`} className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  </label>
                  <div className="flex shrink-0 items-center gap-3">
                    {canTestSounds ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`ทดสอบเสียง ${option.label}`}
                        onClick={() => void previewNotificationSound(option.key)}
                      >
                        <Volume2 />
                        ทดสอบ
                      </Button>
                    ) : null}
                    <Switch
                      id={`profile-sound-${option.key}`}
                      aria-label={option.label}
                      checked={preferences.soundEnabled && preferences.notificationSounds[option.key]}
                      disabled={!preferences.soundEnabled}
                      onCheckedChange={(checked) => setNotificationSound(option.key, checked)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <PwaPushSettings />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProfileSettingsDialog;
