import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { ICP_LADDA_LOGO_URL } from "@/lib/branding";
import AppSidebar from "@/components/lis/AppSidebar";
import MobileBottomNav from "@/components/lis/MobileBottomNav";
import NotificationBell from "@/components/lis/NotificationBell";
import UserProfileMenu from "@/components/lis/UserProfileMenu";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
  /** Optional page title to show in the mobile topbar */
  title?: string;
  /** Extra classes on the outer wrapper (e.g. for print styles) */
  className?: string;
  /** Extra classes on the inner <main> element (replaces default `p-6` padding if you want) */
  mainClassName?: string;
  /** Use `h-screen` (fixed height) instead of `min-h-screen` — for pages that manage their own internal scroll */
  fixedHeight?: boolean;
}

/**
 * Single shell for every protected page. Replaces the previous inline pattern:
 *   <div className="flex min-h-screen"><AppSidebar /><main>...</main></div>
 *
 * - Desktop (>=md): static sidebar on the left
 * - Mobile (<md): hamburger topbar + Sheet drawer + แถบเมนูล่าง (MobileBottomNav)
 */
const AppLayout = ({
  children,
  title,
  className,
  mainClassName,
  fixedHeight = false,
}: AppLayoutProps) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div
      className={cn(
        "flex bg-background",
        fixedHeight ? "h-screen" : "min-h-screen",
        className,
      )}
    >
      {/* Desktop sidebar — pinned to the viewport so it doesn't scroll away with
          the page; only its own nav list scrolls (see AppSidebar's <nav>).
          z-40: position:sticky makes this a stacking context, which traps the
          collapse toggle's own z-40 inside it. Without a z-index here the whole
          rail sits at z:auto(0) and the page's sticky header (z-30) paints over
          the toggle button's overhang — making the arrow look "sunk". Keep
          overflow visible so the overhanging round toggle is not clipped. */}
      <div className="hidden md:flex print:hidden sticky top-0 z-40 h-dvh self-start overflow-visible">
        <AppSidebar variant="desktop" />
      </div>

      {/* Mobile topbar — fixed at top, only on <md */}
      <header className="md:hidden print:hidden fixed top-0 inset-x-0 z-40 h-14 bg-card border-b border-border flex items-center gap-3 px-3 shadow-sm">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="เปิดเมนู"
              className="inline-flex items-center justify-center h-11 w-11 rounded-md text-foreground hover:bg-accent transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="p-0 w-[280px] max-w-[85vw]"
            // Don't auto-focus the menu search input on open — on mobile that
            // pops up the on-screen keyboard. Let the user tap it themselves.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetTitle className="sr-only">เมนูหลัก</SheetTitle>
            <AppSidebar variant="drawer" onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>

        <img
          src={ICP_LADDA_LOGO_URL}
          alt="ICP Logo"
          className="h-8 w-8 rounded-full object-contain"
        />
        <div className="min-w-0 flex-1">
          {title ? (
            <h1 className="text-sm font-semibold text-foreground truncate">{title}</h1>
          ) : (
            <h1 className="text-sm font-bold text-foreground tracking-wide">LIS</h1>
          )}
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <UserProfileMenu />
        </div>
      </header>

      {/* Right column — desktop topbar + main; push down to clear the fixed mobile topbar
          and up to clear the fixed mobile bottom nav (52px + safe area) */}
      <div
        className={cn(
          "flex-1 min-w-0 flex flex-col pt-14 pb-[calc(52px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0 print:pb-0",
          fixedHeight && "overflow-hidden",
        )}
      >
        {/* Desktop topbar — only on >=md, holds the notification bell on the right */}
        <header className="hidden md:flex print:hidden sticky top-0 z-30 h-12 items-center justify-end gap-2 px-4 lg:px-6 bg-background/80 backdrop-blur-sm">
          <NotificationBell />
          <UserProfileMenu />
        </header>

        <main
          className={cn(
            "flex-1 min-w-0",
            fixedHeight && "flex flex-col overflow-hidden",
            mainClassName ?? "p-4 sm:p-6 overflow-auto",
          )}
        >
          {children}
        </main>
      </div>

      <MobileBottomNav onMore={() => setDrawerOpen(true)} moreOpen={drawerOpen} />
    </div>
  );
};

export default AppLayout;
