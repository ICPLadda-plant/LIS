import { describe, expect, it, vi } from "vitest";
import {
  getPwaAssetUrl,
  isStandalonePwa,
  registerPwaServiceWorker,
} from "./pwa";

describe("PWA helpers", () => {
  it("detects standalone display mode", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(display-mode: standalone)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    expect(isStandalonePwa()).toBe(true);

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it("detects iOS standalone PWAs", () => {
    Object.defineProperty(window.navigator, "standalone", {
      configurable: true,
      value: true,
    });

    expect(isStandalonePwa()).toBe(true);

    delete (window.navigator as Navigator & { standalone?: boolean }).standalone;
  });

  it("resolves service worker URLs under the configured app base", () => {
    expect(getPwaAssetUrl("sw.js", "/LIS/")).toBe("/LIS/sw.js");
    expect(getPwaAssetUrl("manifest.webmanifest", "/LIS")).toBe("/LIS/manifest.webmanifest");
  });

  it("registers the service worker only when explicitly enabled", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const serviceWorker = { register } as unknown as ServiceWorkerContainer;

    await registerPwaServiceWorker({
      enabled: false,
      baseUrl: "/LIS/",
      serviceWorker,
    });

    expect(register).not.toHaveBeenCalled();

    await registerPwaServiceWorker({
      enabled: true,
      baseUrl: "/LIS/",
      serviceWorker,
    });

    expect(register).toHaveBeenCalledWith("/LIS/sw.js?v=3", { scope: "/LIS/", updateViaCache: "none" });
  });
});
