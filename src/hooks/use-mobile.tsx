import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const DESKTOP_BREAKPOINT = 1024;
const WIDE_DESKTOP_BREAKPOINT = 1280;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

// iPad portrait band: sidebar should auto-collapse to icon rail
export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(
      `(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${DESKTOP_BREAKPOINT - 1}px)`,
    );
    const onChange = () => {
      const w = window.innerWidth;
      setIsTablet(w >= MOBILE_BREAKPOINT && w < DESKTOP_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    const w = window.innerWidth;
    setIsTablet(w >= MOBILE_BREAKPOINT && w < DESKTOP_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isTablet;
}

// iPad landscape band (1024–1279) — ข้อ 7 จะใช้ร่วมกับ AppSidebar labeledRail/autoCollapse
export function useIsTabletLandscape() {
  const [isLandscape, setIsLandscape] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(
      `(min-width: ${DESKTOP_BREAKPOINT}px) and (max-width: ${WIDE_DESKTOP_BREAKPOINT - 1}px)`,
    );
    const onChange = () => {
      const w = window.innerWidth;
      setIsLandscape(w >= DESKTOP_BREAKPOINT && w < WIDE_DESKTOP_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isLandscape;
}
