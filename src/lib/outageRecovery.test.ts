import { afterEach, describe, expect, it, vi } from "vitest";
import { isKioskRecoveryPath, startOutageRecoveryWatcher } from "./outageRecovery";

const ok = () => new Response("ok", { status: 200 });
const down = (status: number) => new Response("down", { status });

function startWatcher(fetcher: typeof fetch, pathname = "/LIS/scanner") {
  const reload = vi.fn();
  const stop = startOutageRecoveryWatcher({
    enabled: true,
    baseUrl: "/LIS/",
    intervalMs: 1_000,
    fetcher,
    reload,
    getPathname: () => pathname,
  });
  return { reload, stop };
}

describe("outage recovery watcher", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("matches kiosk pages under the production base path", () => {
    expect(isKioskRecoveryPath("/LIS/scanner", "/LIS/")).toBe(true);
    expect(isKioskRecoveryPath("/LIS/scanner/", "/LIS/")).toBe(true);
    expect(isKioskRecoveryPath("/LIS/queue/qc", "/LIS/")).toBe(true);
    expect(isKioskRecoveryPath("/LIS/petition", "/LIS/")).toBe(false);
  });

  it("reloads the scanner once the site comes back after an outage", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(down(530))
      .mockResolvedValueOnce(ok())
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(ok());
    const { reload, stop } = startWatcher(fetcher as unknown as typeof fetch);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^\/LIS\/api\/health\?lisHealthCheck=\d+$/),
      expect.objectContaining({ cache: "no-store" }),
    );

    stop();
  });

  it("ignores a single failed check", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(down(502)).mockResolvedValue(ok());
    const { reload, stop } = startWatcher(fetcher as unknown as typeof fetch);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(reload).not.toHaveBeenCalled();

    stop();
  });

  it("does not poll or reload pages with forms in progress", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(down(503));
    const { reload, stop } = startWatcher(fetcher as unknown as typeof fetch, "/LIS/petition");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    stop();
  });
});
