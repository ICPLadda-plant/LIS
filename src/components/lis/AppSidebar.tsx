import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDown, ChevronLeft, ChevronRight, Search,
} from "lucide-react";
import { LAB_ASSIGN_PATH, NAV_ITEMS, type NavItem } from "@/lib/navItems";
import { normalizeFavorites } from "@/lib/favorites";
import { rankSearchResults } from "@/lib/searchRanking";
import { useFavorites } from "@/hooks/useFavorites";
import NavItemContextMenu from "./NavItemContextMenu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import { TooltipProvider } from "@/components/ui/tooltip";
import { pathMatches, userCanAccessPath } from "@/lib/accessControl";
import { api } from "@/lib/api";
import { normalizeRoles, unionPermissions } from "@/lib/roles";
import { useIsTablet } from "@/hooks/use-mobile";
import { DEV_MODE } from "@/config/dev";

type RoleOption = {
  id: string;
  name: string;
};

type NavGroup = {
  id: string;
  name?: string;
  paths?: string[];
  sortOrder?: number;
};

type AccessControlState = {
  roles: RoleOption[];
  groups: NavGroup[];
  permissions?: Record<string, string[]>;
};

const STORAGE_KEY = "lis.sidebar.collapsed";
const GROUPS_STORAGE_KEY = "lis.sidebar.collapsedGroups";
const ACCESS_CONTROL_QUERY_KEY = ["access-control"];
const EMPTY_GROUPS: NavGroup[] = [];
// prefixed so it can never collide with a real (free-form, lowercase, admin-entered)
// AccessGroup id — see server/models/AccessGroup.js
const FAVORITES_SECTION_ID = "__favorites";
const NAV_PATHS = NAV_ITEMS.map((item) => item.path);

export type AppSidebarVariant = "desktop" | "drawer";

const NAV_SCROLL_STORAGE_KEY: Record<AppSidebarVariant, string> = {
  desktop: "lis.sidebar.navScrollTop.desktop",
  drawer: "lis.sidebar.navScrollTop.drawer",
};

function readNavScrollTop(key: string) {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(sessionStorage.getItem(key) ?? "0");
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveNavScrollTop(key: string, scrollTop: number) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, String(Math.max(0, Math.round(scrollTop))));
  } catch {
    // Ignore storage failures; navigation should still work normally.
  }
}

function normalizeSidebarPath(path: string) {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "");
}

function groupPathMatchesNavItem(groupPath: string, itemPath: string) {
  const normalizedGroupPath = normalizeSidebarPath(groupPath);
  const normalizedItemPath = normalizeSidebarPath(itemPath);
  if (normalizedGroupPath === normalizedItemPath) return true;
  if (normalizedGroupPath.split("/").some((part) => part.startsWith(":"))) return false;
  return pathMatches(groupPath, itemPath);
}

interface AppSidebarProps {
  variant?: AppSidebarVariant;
  /** Called when the user picks a nav item — useful for the drawer to close itself. */
  onNavigate?: () => void;
}

const AppSidebar = ({ variant = "desktop", onNavigate }: AppSidebarProps) => {
  const location = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isTablet = useIsTablet();
  const isDrawer = variant === "drawer";
  const navRef = useRef<HTMLElement | null>(null);
  const navScrollStorageKey = NAV_SCROLL_STORAGE_KEY[variant];
  const roles = normalizeRoles(user);
  const { favorites, isFavorite, toggle: toggleFavoritePath, move: moveFavoritePath } = useFavorites(NAV_PATHS);

  const { data: accessControl } = useQuery({
    queryKey: ACCESS_CONTROL_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<AccessControlState>("/access-control");
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const navGroups = accessControl?.groups?.length ? accessControl.groups : EMPTY_GROUPS;
  const effectiveUser = useMemo(
    () =>
      user
        ? {
            ...user,
            roles,
            permissions: unionPermissions(roles, accessControl?.permissions ?? {}),
          }
        : user,
    [user, roles, accessControl?.permissions],
  );

  const [storedCollapsed, setStoredCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  });

  // Manual expand from auto-collapsed state lasts the session only
  const [manualExpand, setManualExpand] = useState(false);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(GROUPS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [menuQuery, setMenuQuery] = useState("");

  // Drawer variant: always expanded, no collapse mechanics
  // Desktop variant: auto-collapse on tablet width unless user manually expanded this session
  const collapsed = isDrawer
    ? false
    : isTablet
      ? !manualExpand
      : storedCollapsed;

  const toggleCollapsed = () => {
    if (isDrawer) return;
    if (isTablet) {
      setManualExpand((v) => !v);
      return;
    }
    setStoredCollapsed((v) => !v);
  };

  useEffect(() => {
    if (isDrawer) return;
    localStorage.setItem(STORAGE_KEY, storedCollapsed ? "1" : "0");
  }, [storedCollapsed, isDrawer]);

  useEffect(() => {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(collapsedGroups));
  }, [collapsedGroups]);

  const persistNavScroll = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    saveNavScrollTop(navScrollStorageKey, nav.scrollTop);
  }, [navScrollStorageKey]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollTop = readNavScrollTop(navScrollStorageKey);
    return () => {
      saveNavScrollTop(navScrollStorageKey, nav.scrollTop);
    };
  }, [navScrollStorageKey]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let lastTouchY = 0;

    const handleTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? 0;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (nav.scrollHeight <= nav.clientHeight) return;
      const nextTouchY = event.touches[0]?.clientY ?? lastTouchY;
      const deltaY = lastTouchY - nextTouchY;
      lastTouchY = nextTouchY;
      const atTop = nav.scrollTop <= 0;
      const atBottom = nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 1;
      if ((atTop && deltaY < 0) || (atBottom && deltaY > 0)) event.preventDefault();
    };

    nav.addEventListener("touchstart", handleTouchStart, { passive: true });
    nav.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      nav.removeEventListener("touchstart", handleTouchStart);
      nav.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ACCESS_CONTROL_QUERY_KEY });
    window.addEventListener("lis-access-groups-changed", handler);
    return () => window.removeEventListener("lis-access-groups-changed", handler);
  }, [queryClient]);

  const sections = useMemo(() => {
    const sorted = [...navGroups].sort((a, b) => {
      if (a.id === "others") return 1;
      if (b.id === "others") return -1;
      return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
    });
    if (sorted.length === 0) return [{ id: "all", label: "เมนู", items: [...NAV_ITEMS] }];

    const coveredPaths = sorted
      .filter((g) => g.id !== "others")
      .flatMap((g) => g.paths ?? []);
    const assignedPaths = new Set<string>();

    const result = sorted
      .map((group) => {
        let items: typeof NAV_ITEMS;
        if (group.id === "others") {
          const uncovered = NAV_ITEMS.filter(
            (item) => !coveredPaths.some((p) => groupPathMatchesNavItem(p, item.path)),
          );
          items = [];
          for (const p of group.paths ?? []) {
            const match = uncovered.find((item) => groupPathMatchesNavItem(p, item.path));
            if (match && !items.includes(match) && !assignedPaths.has(match.path)) {
              items.push(match);
              assignedPaths.add(match.path);
            }
          }
          for (const item of uncovered) {
            if (!items.includes(item) && !assignedPaths.has(item.path)) {
              items.push(item);
              assignedPaths.add(item.path);
            }
          }
        } else {
          items = [];
          for (const p of group.paths ?? []) {
            for (const item of NAV_ITEMS) {
              if (
                groupPathMatchesNavItem(p, item.path) &&
                !items.includes(item) &&
                !assignedPaths.has(item.path)
              ) {
                items.push(item);
                assignedPaths.add(item.path);
              }
            }
          }
        }
        return { id: group.id, label: group.name || group.id, items };
      })
      .filter((g) => g.items.length > 0);

    return result;
  }, [navGroups]);

  // ลำดับยึดตาม favorites ที่เก็บไว้ ไม่ใช่ลำดับใน NAV_ITEMS
  const favoritePaths = useMemo(() => normalizeFavorites(favorites, NAV_PATHS), [favorites]);

  const allSections = useMemo(() => {
    // Assign Lab เห็นได้เฉพาะหัวหน้า Lab / admin
    const canSeeLabAssign = roles.some((r) => r === "admin" || r === "lab-head");
    const visible = (item: NavItem) => canSeeLabAssign || item.path !== LAB_ASSIGN_PATH;
    const baseSections = sections
      .map((s) => ({ ...s, items: s.items.filter(visible) }))
      .filter((s) => s.items.length > 0);
    if (favoritePaths.length === 0) return baseSections;
    const items = favoritePaths
      .map((path) => NAV_ITEMS.find((item) => item.path === path))
      .filter((item): item is NavItem => !!item && visible(item));
    if (items.length === 0) return baseSections;
    return [{ id: FAVORITES_SECTION_ID, label: "รายการโปรด", items }, ...baseSections];
  }, [favoritePaths, sections, roles]);

  // The active nav item is the one whose path is the longest prefix of the
  // current pathname — so /daily-check stays active on /daily-check/balance,
  // while /petitions/assign still wins over /petitions on its own page.
  const activePath = useMemo(() => {
    const matches = NAV_ITEMS.filter(
      (item) =>
        location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`),
    );
    matches.sort((a, b) => b.path.length - a.path.length);
    return matches[0]?.path;
  }, [location.pathname]);

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "relative flex min-h-0 flex-col bg-card border-r border-border",
          isDrawer
            ? "w-full h-full overflow-hidden"
            : cn(
                // h-screen (not min-h-screen) keeps the rail exactly viewport-tall
                // so its <nav> scrolls internally instead of the whole rail growing
                // and scrolling away with the page.
                "h-screen min-h-0 overflow-visible transition-[width] duration-200 ease-out",
                // Collapsed rail is w-20 (not w-16) so the centered logo clears
                // the collapse toggle button, which pokes -right-4 into the rail
                // (at w-16 the 40px logo and 32px button overlap ~5px).
                collapsed ? "w-20" : "w-72",
              ),
        )}
      >
        {/* Desktop-only toggle button — drawer does not need it */}
        {!isDrawer && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "ขยายเมนู" : "ซ่อนเมนู"}
            className="absolute -right-4 top-7 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-md ring-4 ring-background backdrop-blur transition-[background-color,border-color,color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent hover:text-foreground hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-0"
          >
            {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        )}

        {/* Header */}
        <div className={cn(
          "flex shrink-0 items-center border-b border-border transition-all",
          collapsed ? "justify-center px-0 py-4" : "gap-3 px-5 py-6"
        )}>
          <img
            src={ICP_LADDA_LOGO_URL}
            alt="ICP Logo"
            className={cn(
              "rounded-full object-contain transition-all",
              collapsed ? "w-10 h-10" : "w-14 h-14"
            )}
          />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-foreground text-lg leading-tight">LIS</h1>
              <p className="text-[10px] text-muted-foreground leading-tight tracking-wider">
                LAB INFORMATION<br />SYSTEM
              </p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav
          ref={navRef}
          onScroll={persistNavScroll}
          className={cn("min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] scrollbar-hide py-3", collapsed ? "px-2" : "px-3")}
        >
          {!collapsed && (
            <div className="px-1 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={menuQuery}
                  onChange={(e) => setMenuQuery(e.target.value)}
                  placeholder="ค้นหาเมนู..."
                  className="w-full h-9 pl-8 pr-2 rounded-lg bg-accent/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          )}
          {allSections.map((section, sIdx) => {
            const q = menuQuery.trim().toLowerCase();
            const visibleItems = rankSearchResults(section.items.filter(
              (item) =>
                ((DEV_MODE && item.path === "/validation") || userCanAccessPath(effectiveUser, item.path, navGroups)) &&
                (q === "" || item.label.toLowerCase().includes(q)),
            ), q, (item) => ({ primary: [item.label] }));
            if (visibleItems.length === 0) return null;

            const isGroupCollapsed = !collapsed && !!collapsedGroups[section.id];
            return (
            <div
              key={section.id}
              className={cn(
                sIdx > 0 &&
                  (collapsed
                    ? "mt-3 pt-3 border-t border-border"
                    : isGroupCollapsed
                      ? "mt-3 pt-3 border-t border-border"
                      : "mt-4")
              )}
            >
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(section.id)}
                  aria-expanded={!isGroupCollapsed}
                  className="group flex w-full items-center justify-between px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="truncate">{section.label}</span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
                      isGroupCollapsed && "-rotate-90"
                    )}
                  />
                </button>
              )}
              <div className={cn("space-y-1 overflow-hidden", isGroupCollapsed && "hidden")}>
                {visibleItems.map((item) => {
                  const targetPath = item.path === "/" ? "/home" : item.path;
                  const isActive =
                    item.path === activePath ||
                    (item.path === "/" &&
                      (location.pathname === "/home" || location.pathname.startsWith("/dashboard/")));
                  const inFavorites = section.id === FAVORITES_SECTION_ID;
                  // ตำแหน่งอ้างจากรายการเต็มที่เก็บไว้ ไม่ใช่รายการที่ผ่านตัวกรอง —
                  // ไม่งั้นสิทธิ์/ช่องค้นหาจะทำให้ย้ายผิดตำแหน่ง
                  const favIndex = favoritePaths.indexOf(item.path);
                  const link = (
                    <Link
                      to={targetPath}
                      aria-label={item.label}
                      aria-current={isActive ? "page" : undefined}
                      onClick={(e) => {
                        persistNavScroll();
                        // Let the browser handle modifier/middle clicks natively
                        // (open in new tab/window) — only run SPA side effects on
                        // a plain left click.
                        if (
                          e.button === 0 &&
                          !e.metaKey &&
                          !e.ctrlKey &&
                          !e.shiftKey &&
                          !e.altKey
                        ) {
                          onNavigate?.();
                        }
                      }}
                      className={cn(
                        "flex items-center w-full rounded-lg text-sm font-medium transition-colors no-underline",
                        collapsed ? "justify-center h-10 px-0" : "gap-3 px-3 py-2.5",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                  return (
                    // path เดียวโผล่ได้สองที่ (กลุ่มโปรด + กลุ่มเดิม) — key ต้องผูก section ด้วย
                    <NavItemContextMenu
                      key={`${section.id}:${item.path}`}
                      path={item.path}
                      isFavorite={isFavorite(item.path)}
                      inFavorites={inFavorites}
                      canMoveUp={inFavorites && favIndex > 0}
                      canMoveDown={inFavorites && favIndex >= 0 && favIndex < favoritePaths.length - 1}
                      tooltip={collapsed ? item.label : undefined}
                      onToggleFavorite={() => toggleFavoritePath(item.path)}
                      onMove={(direction) => moveFavoritePath(item.path, direction)}
                    >
                      {link}
                    </NavItemContextMenu>
                  );
                })}
              </div>
            </div>
          );
          })}
          {!collapsed &&
            menuQuery.trim() !== "" &&
            allSections.every(
              (s) =>
                s.items.filter(
                  (item) =>
                    ((DEV_MODE && item.path === "/validation") || userCanAccessPath(effectiveUser, item.path, navGroups)) &&
                    item.label.toLowerCase().includes(menuQuery.trim().toLowerCase()),
                ).length === 0,
            ) && (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                ไม่พบเมนู "{menuQuery}"
              </p>
            )}
        </nav>
      </aside>
    </TooltipProvider>
  );
};

export default AppSidebar;
