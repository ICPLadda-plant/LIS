import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PushEnablePrompt, { PUSH_PROMPT_DELAY_MS } from "../PushEnablePrompt";

const pushMocks = vi.hoisted(() => ({
  getPushDeviceStatus: vi.fn(),
  enablePushOnThisDevice: vi.fn(),
  readPushOptOut: vi.fn(() => false),
  isPushPromptSnoozed: vi.fn(() => false),
  snoozePushPrompt: vi.fn(),
}));

vi.mock("@/lib/pwaPush", () => ({
  ...pushMocks,
  PushPermissionDeniedError: class extends Error {},
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "lab@example.com", roles: ["lab"], approvalStatus: "approved" }, isProductionSession: false }),
}));

function setPermission(permission: NotificationPermission) {
  vi.stubGlobal("Notification", { permission });
}

async function renderAndWait() {
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <PushEnablePrompt />
    </MemoryRouter>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PUSH_PROMPT_DELAY_MS);
  });
}

describe("PushEnablePrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushMocks.getPushDeviceStatus.mockResolvedValue({ kind: "can-enable", publicKey: "key" });
    pushMocks.enablePushOnThisDevice.mockResolvedValue({});
    pushMocks.readPushOptOut.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("asks after the app loads and enables notifications when accepted", async () => {
    setPermission("default");
    await renderAndWait();

    expect(screen.getByText("เปิดรับการแจ้งเตือนบนเครื่องนี้ไหม")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "เปิดรับแจ้งเตือน" }));
    });

    expect(pushMocks.enablePushOnThisDevice).toHaveBeenCalledWith("key");
  });

  it("re-registers silently when this browser already allowed notifications", async () => {
    setPermission("granted");
    await renderAndWait();

    expect(pushMocks.enablePushOnThisDevice).toHaveBeenCalledWith("key");
    expect(screen.queryByText("เปิดรับการแจ้งเตือนบนเครื่องนี้ไหม")).not.toBeInTheDocument();
  });

  it("does not ask when the user turned notifications off on this device", async () => {
    setPermission("default");
    pushMocks.readPushOptOut.mockReturnValue(true);
    await renderAndWait();

    expect(pushMocks.getPushDeviceStatus).not.toHaveBeenCalled();
    expect(screen.queryByText("เปิดรับการแจ้งเตือนบนเครื่องนี้ไหม")).not.toBeInTheDocument();
  });
});
