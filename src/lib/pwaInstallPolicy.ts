import { normalizeRoles, type RoleHolder } from "@/lib/roles";
import { isLabRole, isQcRole } from "@/lib/petitionVisibility";
import { isProductionDepartment } from "@/lib/productionDepartment";

// หน้าที่เปิดค้างบนเครื่องเฉพาะ หรือเปิดได้โดยไม่ login — ห้ามบังคับติดตั้ง
const EXEMPT_PATHS = new Set([
  "/login",
  "/logout",
  "/scanner",
  "/stock/view",
  "/queue/lab",
  "/queue/qc",
  "/petitions/ProductionIntegrationPetitionNewPage",
  "/petitions-old/ProductionIntegrationPetitionNewPage",
]);

export type PwaInstallPolicyInput = {
  user: (RoleHolder & { department?: string; approvalStatus?: string }) | null;
  // เข้าระบบผ่าน SSO ของฝ่ายผลิต
  isProductionSession: boolean;
  pathname: string;
  isStandalone: boolean;
  // เครื่องนี้ติดตั้งแอปไว้แล้ว แต่ผู้ใช้เปิดจากแท็บเบราว์เซอร์
  isAppInstalled?: boolean;
  isDesktop: boolean;
};

/**
 * บังคับติดตั้ง LIS เป็นแอปเฉพาะผู้ใช้ฝ่าย Lab/QC ที่เปิดจากแท็บเบราว์เซอร์บนคอมที่ยังไม่มีแอป
 * คนที่มาจากฝ่ายผลิตไม่ถูกบังคับ แม้จะถือ role ฝั่ง Lab/QC ด้วย
 */
export function requiresPwaInstall({
  user,
  isProductionSession,
  pathname,
  isStandalone,
  isAppInstalled = false,
  isDesktop,
}: PwaInstallPolicyInput) {
  if (!user || isStandalone || isAppInstalled || !isDesktop) return false;
  if (EXEMPT_PATHS.has(pathname)) return false;
  if (user.approvalStatus && user.approvalStatus !== "approved") return false;
  if (isProductionSession || isProductionDepartment(user.department)) return false;
  return normalizeRoles(user).some((role) => isLabRole(role) || isQcRole(role));
}
