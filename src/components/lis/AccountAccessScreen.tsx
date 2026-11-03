import { Clock3, ShieldAlert, ShieldX, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import { cn } from "@/lib/utils";

export type AccountAccessVariant = "pending" | "rejected" | "inactive" | "domain" | "forbidden" | "error";

type ScreenCopy = {
  icon: LucideIcon;
  tone: "warning" | "danger" | "muted";
  title: string;
  description: string;
  retryLabel?: string;
};

const COPY: Record<AccountAccessVariant, ScreenCopy> = {
  pending: {
    icon: Clock3,
    tone: "warning",
    title: "รอผู้ดูแลยืนยันการเข้าระบบ",
    description:
      "บัญชีของคุณลงทะเบียนเข้าระบบ LIS แล้ว ผู้ดูแลระบบต้องยืนยันและกำหนดสิทธิ์ก่อน คุณจึงจะใช้งานได้ เมื่อได้รับการยืนยันแล้วให้กดตรวจสอบสถานะอีกครั้ง",
    retryLabel: "ตรวจสอบสถานะอีกครั้ง",
  },
  rejected: {
    icon: ShieldX,
    tone: "danger",
    title: "บัญชีไม่ได้รับอนุญาตให้เข้าระบบ",
    description: "ผู้ดูแลระบบไม่ได้อนุมัติคำขอเข้าระบบของบัญชีนี้ หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบ",
  },
  inactive: {
    icon: ShieldX,
    tone: "danger",
    title: "บัญชีถูกปิดใช้งาน",
    description: "บัญชีนี้ถูกปิดใช้งานในระบบ LIS กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานอีกครั้ง",
  },
  domain: {
    icon: ShieldX,
    tone: "danger",
    title: "บัญชีนี้ใช้เข้าระบบไม่ได้",
    description: "ระบบ LIS รับเฉพาะบัญชี Microsoft ขององค์กร (@icpladda.com) กรุณาออกจากระบบแล้วเข้าใหม่ด้วยบัญชีองค์กร",
  },
  forbidden: {
    icon: ShieldAlert,
    tone: "muted",
    title: "คุณไม่มีสิทธิ์เข้าถึงหน้านี้",
    description: "บทบาทของคุณยังไม่ได้รับสิทธิ์ใช้งานหน้านี้ หากต้องใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
  },
  error: {
    icon: WifiOff,
    tone: "muted",
    title: "เชื่อมต่อระบบไม่สำเร็จ",
    description: "ตรวจสอบบัญชีของคุณกับระบบ LIS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังไม่ได้ให้ติดต่อผู้ดูแลระบบ",
    retryLabel: "ลองใหม่",
  },
};

const TONE_CLASS: Record<ScreenCopy["tone"], string> = {
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

export function accessVariantForError(code?: string, status?: number): AccountAccessVariant {
  if (code === "ACCOUNT_PENDING_APPROVAL") return "pending";
  if (code === "ACCOUNT_REJECTED") return "rejected";
  if (code === "USER_INACTIVE" || (status === 403 && !code)) return "inactive";
  if (code === "DOMAIN_NOT_ALLOWED") return "domain";
  return "error";
}

interface AccountAccessScreenProps {
  variant: AccountAccessVariant;
  // หน้า forbidden ให้ผู้ใช้กลับหน้าหลักได้ แทนการบังคับออกจากระบบ
  onBack?: () => void;
}

export default function AccountAccessScreen({ variant, onBack }: AccountAccessScreenProps) {
  const { user, logout } = useAuth();
  const copy = COPY[variant];
  const Icon = copy.icon;

  return (
    <div className="flex min-h-screen min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <img src={ICP_LADDA_LOGO_URL} alt="ICP Logo" className="h-10 w-10 rounded-full object-contain" />
          <div>
            <p className="text-base font-semibold text-foreground">LIS</p>
            <p className="text-[10px] tracking-widest text-muted-foreground">LAB INFORMATION SYSTEM</p>
          </div>
        </div>

        <div className="space-y-3" role={variant === "pending" ? "status" : "alert"}>
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-full", TONE_CLASS[copy.tone])}>
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.description}</p>
        </div>

        {user?.email && (
          <div className="rounded-md border bg-muted/50 px-3 py-2">
            <p className="text-xs text-muted-foreground">บัญชีที่เข้าสู่ระบบ</p>
            <p className="truncate text-sm font-medium text-foreground">{user.email}</p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => void logout()}>
            ออกจากระบบ
          </Button>
          {onBack && <Button onClick={onBack}>กลับหน้าหลัก</Button>}
          {copy.retryLabel && <Button onClick={() => window.location.reload()}>{copy.retryLabel}</Button>}
        </div>
      </div>
    </div>
  );
}
