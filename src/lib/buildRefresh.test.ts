import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_RELOAD_STORAGE_KEY, extractBuildSignature, startBuildRefreshWatcher } from "./buildRefresh";

describe("build refresh watcher", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.head.innerHTML = "";
    sessionStorage.clear();
  });

  it("extracts a normalized signature from built asset references", () => {
    const html = `
      <link rel="modulepreload" crossorigin href="./assets/vendor-react.js">
      <script type="module" crossorigin src="./assets/index.js"></script>
    `;

    expect(extractBuildSignature(html, "https://example.test/LIS/app.html")).toBe(
      "/LIS/assets/vendor-react.js\n/LIS/assets/index.js",
    );
  });

  it("reloads the page when the latest app entry points change", async () => {
    vi.useFakeTimers();
    document.head.innerHTML = `<script type="module" crossorigin src="/LIS/assets/index-old.js"></script>`;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(`<script type="module" crossorigin src="./assets/index-new.js"></script>`),
    );
    const reload = vi.fn();

    const stop = startBuildRefreshWatcher({
      enabled: true,
      baseUrl: "/LIS/",
      intervalMs: 1_000,
      fetcher,
      reload,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^\/LIS\/app\.html\?lisBuildCheck=\d+$/),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(reload).toHaveBeenCalledTimes(1);

    stop();
  });

  it("keeps the page open when the app entry points are unchanged", async () => {
    vi.useFakeTimers();
    document.head.innerHTML = `<script type="module" crossorigin src="/LIS/assets/index-same.js"></script>`;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(`<script type="module" crossorigin src="./assets/index-same.js"></script>`),
    );
    const reload = vi.fn();

    const stop = startBuildRefreshWatcher({
      enabled: true,
      baseUrl: "/LIS/",
      intervalMs: 1_000,
      fetcher,
      reload,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(reload).not.toHaveBeenCalled();

    stop();
  });

  it("keeps the page open when runtime adds extra route assets", async () => {
    vi.useFakeTimers();
    document.head.innerHTML = `
      <script type="module" crossorigin src="/LIS/assets/index-same.js"></script>
      <link rel="modulepreload" crossorigin href="/LIS/assets/route-home.js">
    `;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(`<script type="module" crossorigin src="./assets/index-same.js"></script>`),
    );
    const reload = vi.fn();

    const stop = startBuildRefreshWatcher({
      enabled: true,
      baseUrl: "/LIS/",
      intervalMs: 1_000,
      fetcher,
      reload,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(reload).not.toHaveBeenCalled();

    stop();
  });

  it("checks right away when the app window comes back into focus", async () => {
    document.head.innerHTML = `<script type="module" crossorigin src="/LIS/assets/index-old.js"></script>`;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(`<script type="module" crossorigin src="./assets/index-new.js"></script>`),
    );
    const reload = vi.fn();

    const stop = startBuildRefreshWatcher({ enabled: true, baseUrl: "/LIS/", intervalMs: 60_000, fetcher, reload });

    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    stop();
  });

  it("reloads when a page from an old build cannot load a removed file", () => {
    document.head.innerHTML = `<script type="module" crossorigin src="/LIS/assets/index-old.js"></script>`;
    const reload = vi.fn();
    const stop = startBuildRefreshWatcher({ enabled: true, baseUrl: "/LIS/", fetcher: vi.fn(), reload });

    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    stop();
  });

  it("does not reload again right after a recent reload", () => {
    document.head.innerHTML = `<script type="module" crossorigin src="/LIS/assets/index-old.js"></script>`;
    sessionStorage.setItem(BUILD_RELOAD_STORAGE_KEY, String(Date.now()));
    const reload = vi.fn();
    const stop = startBuildRefreshWatcher({ enabled: true, baseUrl: "/LIS/", fetcher: vi.fn(), reload });

    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});
