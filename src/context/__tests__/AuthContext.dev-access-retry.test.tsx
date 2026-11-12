import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMsal } from "@azure/msal-react";
import { setApiUserEmail } from "@/lib/api";
import { loadAccessControl } from "@/lib/accessControlSource";
import { AuthProvider, DEV_ACCESS_CONTROL_RETRY_MS, useAuth } from "../AuthContext";

vi.mock("@azure/msal-react", () => ({
  useMsal: vi.fn(),
}));

vi.mock("@/lib/msalConfig", () => ({
  loginRequest: { scopes: ["User.Read", "openid", "profile", "email"] },
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  setApiUserEmail: vi.fn(),
}));

vi.mock("@/lib/accessControlSource", () => ({
  loadAccessControl: vi.fn(),
}));

vi.mock("@/config/dev", () => ({
  DEV_MODE: true,
  DEV_DEFAULT_ROLE: "admin",
  synthesizeDevUser: vi.fn((roles: { id: string; name: string }[]) => ({
    id: "dev-admin",
    email: "admin.dev@icpladda.com",
    name: `Dev ${roles[0].name}`,
    role: roles[0].id,
    roles: roles.map((role) => role.id),
    permissions: [],
    department: "IT",
    position: roles[0].name,
    employeeId: "DEV-admin",
    status: "active",
  })),
  normalizeDevRoleSelection: vi.fn((roleIds: string[]) => roleIds),
  normalizeDevDepartment: vi.fn((department: string | null) => department ?? ""),
  toggleDevRoleSelection: vi.fn((roleIds: string[]) => roleIds),
}));

function CurrentUser() {
  const { user } = useAuth();
  return <output data-testid="user">{user?.name ?? "no-user"}</output>;
}

describe("AuthProvider dev access matrix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(useMsal).mockReturnValue({ accounts: [], instance: {} } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries loading the dev user after the backend was unavailable", async () => {
    vi.mocked(loadAccessControl)
      .mockRejectedValueOnce(new Error("backend restarting"))
      .mockResolvedValueOnce({
        groups: [],
        permissions: { admin: [] },
        roles: [{ id: "admin", name: "Administrator" }],
      });

    render(
      <AuthProvider>
        <CurrentUser />
      </AuthProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("user")).toHaveTextContent("no-user");
    expect(setApiUserEmail).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEV_ACCESS_CONTROL_RETRY_MS);
    });

    expect(loadAccessControl).toHaveBeenCalledTimes(2);
    expect(loadAccessControl).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("user")).toHaveTextContent("Dev Administrator");
    expect(setApiUserEmail).toHaveBeenLastCalledWith("admin.dev@icpladda.com");
  });
});
