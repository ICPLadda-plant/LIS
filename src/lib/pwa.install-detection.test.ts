import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockStandalone(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

async function loadPwa() {
  vi.resetModules();
  return import("./pwa");
}

describe("PWA installed-on-device detection", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: originalMatchMedia });
  });

  it("remembers the app after it is opened as an installed app", async () => {
    mockStandalone(true);
    const appWindow = await loadPwa();
    appWindow.startPwaInstallPromptCapture(window);
    expect(appWindow.getPwaInstallState().installedOnDevice).toBe(true);

    // later the same user opens LIS from a normal Chrome tab
    mockStandalone(false);
    const browserTab = await loadPwa();
    expect(browserTab.getPwaInstallState().installedOnDevice).toBe(true);
  });

  it("forgets the app when the browser offers to install it again", async () => {
    localStorage.setItem("lis.pwa.installedOnDevice", "1");
    mockStandalone(false);
    const target = new EventTarget() as unknown as Window;
    const pwa = await loadPwa();
    pwa.startPwaInstallPromptCapture(target);
    expect(pwa.getPwaInstallState().installedOnDevice).toBe(true);

    target.dispatchEvent(new Event("beforeinstallprompt"));
    expect(pwa.getPwaInstallState()).toMatchObject({ canPrompt: true, installedOnDevice: false });
    expect(localStorage.getItem("lis.pwa.installedOnDevice")).toBeNull();
  });
});
