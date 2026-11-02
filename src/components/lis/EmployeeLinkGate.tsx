import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

type LinkState = "linking" | "not-found" | "taken" | "error";

const stateFromError = (err: unknown): LinkState => {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return "not-found";
  if (status === 409) return "taken";
  return "error";
};

const MESSAGES: Record<LinkState, string> = {
  linking: "กำลังค้นหาข้อมูลพนักงานที่ใช้อีเมลนี้...",
  "not-found":
    "ไม่พบอีเมลนี้ในข้อมูลพนักงาน กรุณาแจ้ง HR ให้เพิ่มอีเมลในข้อมูลพนักงาน หรือติดต่อผู้ดูแลระบบเพื่อผูกรหัสให้",
  taken: "รหัสพนักงานของอีเมลนี้ถูกผูกกับบัญชีอื่นอยู่แล้ว กรุณาติดต่อผู้ดูแลระบบ",
  error: "เชื่อมต่อข้อมูลพนักงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
};

/**
 * Blocks a logged-in user whose account has no employeeId yet and links it
 * automatically: the server matches the account email against the HR employee
 * webhook (/webhook/api/employee). Users never pick or type an employee code.
 *
 * Login flows (Microsoft sync, production SSO, LIS session) already try the same
 * email match; this gate covers accounts restored from a stored session that
 * predates the link. Admins are exempt so an IT/system account without an HR
 * record is never locked out.
 */
const EmployeeLinkGate = () => {
  const { user, linkSelfEmployee } = useAuth();
  const isAdmin = (user?.roles ?? (user?.role ? [user.role] : [])).includes("admin");
  const isLogout = location.pathname === "/logout";
  const isPublicStockView = location.pathname === "/stock/view";
  const needsLink = !!user?.id && !user.employeeId && !isAdmin && !isLogout && !isPublicStockView;

  const [state, setState] = useState<LinkState>("linking");
  const attemptedFor = useRef<string | null>(null);

  const runLink = useCallback(async () => {
    setState("linking");
    try {
      await linkSelfEmployee();
      toast.success("ผูกรหัสพนักงานจากอีเมลเรียบร้อยแล้ว");
    } catch (err) {
      setState(stateFromError(err));
    }
  }, [linkSelfEmployee]);

  useEffect(() => {
    if (!needsLink || !user?.id || attemptedFor.current === user.id) return;
    attemptedFor.current = user.id;
    void runLink();
  }, [needsLink, user?.id, runLink]);

  if (!needsLink) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-lg">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">ผูกบัญชีกับข้อมูลพนักงาน</h2>
          <p className="text-sm text-muted-foreground">
            บัญชี <span className="font-medium text-foreground">{user?.email}</span>
          </p>
        </div>

        <p
          role={state === "linking" ? "status" : "alert"}
          className={state === "linking" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {MESSAGES[state]}
        </p>

        {state !== "linking" && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => void runLink()}>
              ลองใหม่
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeLinkGate;
