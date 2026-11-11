import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrivateRoute from "@/components/PrivateRoute";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@azure/msal-react", () => ({
  useIsAuthenticated: () => true,
  useMsal: () => ({ inProgress: "none" }),
}));
vi.mock("@/config/dev", () => ({ DEV_MODE: false }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/accessControlSource", () => ({
  loadAccessControl: () => Promise.resolve({ groups: [], permissions: {}, roles: [] }),
  invalidateAccessControl: () => undefined,
}));

const renderRoute = () =>
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <PrivateRoute><p>หน้าหลัก</p></PrivateRoute>
    </MemoryRouter>,
  );

describe("PrivateRoute account approval", () => {
  beforeEach(() => {
    auth.value = { logout: vi.fn(), accessError: null };
  });

  it("shows the waiting-for-admin page for a new Microsoft user", async () => {
    auth.value.user = { email: "new@icpladda.com", roles: ["viewer"], status: "active", approvalStatus: "pending" };
    renderRoute();
    expect(await screen.findByText("รอผู้ดูแลยืนยันการเข้าระบบ")).toBeInTheDocument();
    expect(screen.getByText("new@icpladda.com")).toBeInTheDocument();
    expect(screen.queryByText("หน้าหลัก")).not.toBeInTheDocument();
  });

  it("explains a failed account sync instead of rendering a blank page", async () => {
    auth.value.user = { email: "guest@gmail.com" };
    auth.value.accessError = { status: 403, code: "DOMAIN_NOT_ALLOWED", message: "x" };
    renderRoute();
    expect(await screen.findByText("บัญชีนี้ใช้เข้าระบบไม่ได้")).toBeInTheDocument();
  });
});
