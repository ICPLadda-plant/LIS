import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { NAV_ITEMS, type NavItem } from "@/lib/navItems";
import { activeNavPath, navItemCompact, useNavItemAccess } from "@/components/lis/AppSidebar";
import { cn } from "@/lib/utils";

/** ลำดับเมนูที่ใช้บ่อยตามบทบาท — ใช้เลือก 4 ปุ่มแรก เฉพาะเมนูที่ผู้ใช้มีสิทธิ์ */
const ROLE_PRIORITY_PATHS: Array<{ roles: string[]; paths: string[] }> = [
  { roles: ["admin"], paths: ["/home", "/petition", "/lab-testing", "/qc-testing"] },
  { roles: ["lab-head", "lab-analyze"], paths: ["/home", "/lab-testing", "/lab-results", "/petition"] },
  { roles: ["qc-head", "qc-staff"], paths: ["/home", "/qc-testing", "/qc-approval", "/petition"] },
];
const FALLBACK_PATHS = ["/home", "/petition", "/daily-check", "/stock"];
export const MOBILE_NAV_SLOTS = 4;

/** Pure: เลือกเมนูสำหรับแถบล่าง — ตามลำดับของบทบาท แล้วเติมด้วยเมนูอื่นที่มีสิทธิ์ตามลำดับใน NAV_ITEMS */
export function pickMobileNavItems(
  roles: string[],
  canAccess: (item: NavItem) => boolean,
  items: NavItem[] = NAV_ITEMS,
): NavItem[] {
  const preferred = ROLE_PRIORITY_PATHS.find((entry) => entry.roles.some((r) => roles.includes(r)))?.paths ?? FALLBACK_PATHS;
  const accessible = items.filter(canAccess);
  const picked: NavItem[] = [];
  for (const path of preferred) {
    const item = accessible.find((i) => i.path === path);
    if (item) picked.push(item);
  }
  for (const item of accessible) {
    if (picked.length >= MOBILE_NAV_SLOTS) break;
    if (!picked.includes(item) && item.path !== "/validation") picked.push(item);
  }
  return picked.slice(0, MOBILE_NAV_SLOTS);
}

interface MobileBottomNavProps {
  /** ปุ่ม "เพิ่มเติม" — เปิดเมนูเต็ม (sidebar sheet) */
  onMore: () => void;
  /** เมนูเต็มเปิดอยู่ — แสดง "เพิ่มเติม" เป็น active */
  moreOpen?: boolean;
}

const itemClass =
  "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** แถบเมนูล่างสำหรับมือถือ (< md) */
const MobileBottomNav = ({ onMore, moreOpen = false }: MobileBottomNavProps) => {
  const location = useLocation();
  const { roles, canAccess } = useNavItemAccess();
  const items = useMemo(() => pickMobileNavItems(roles, canAccess), [roles, canAccess]);
  const activePath = activeNavPath(location.pathname);

  return (
    <nav
      aria-label="เมนูลัด"
      className="md:hidden print:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const { short, icon: Icon } = navItemCompact(item);
          const active = !moreOpen && activePath === item.path;
          return (
            <li key={item.path} className="flex min-w-0 flex-1">
              <Link
                to={item.path}
                aria-current={active ? "page" : undefined}
                className={cn(itemClass, active ? "text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="max-w-full truncate">{short}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(itemClass, moreOpen ? "text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            <Menu className="h-5 w-5 shrink-0" aria-hidden />
            <span>เพิ่มเติม</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
