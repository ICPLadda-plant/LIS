import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppPreferencesProvider } from "@/context/AppPreferencesContext";
import AppLayout from "../AppLayout";

vi.mock("@/components/lis/AppSidebar", () => ({
  default: () => <aside data-testid="app-sidebar" />,
}));

vi.mock("@/components/lis/MobileBottomNav", () => ({
  default: () => <nav data-testid="mobile-bottom-nav" />,
}));

vi.mock("@/components/lis/NotificationBell", () => ({
  default: () => <button type="button" aria-label="Notifications" />,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      email: "admin@example.com",
      name: "Admin User",
      roles: ["admin"],
      department: "Lab",
      position: "Manager",
      status: "active",
    },
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      data: {
        data: {
          roles: [{ id: "admin", name: "Administrator" }],
          groups: [],
          permissions: {},
        },
      },
    }),
  },
}));

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppPreferencesProvider>
        <MemoryRouter initialEntries={["/home"]}>
          <AppLayout>
            <div>Page content</div>
          </AppLayout>
        </MemoryRouter>
      </AppPreferencesProvider>
    </QueryClientProvider>,
  );
}

describe("AppLayout profile placement", () => {
  it("renders the user profile from the topbar", async () => {
    renderLayout();

    const profileButtons = screen.getAllByRole("button", { name: "User profile" });
    expect(profileButtons.length).toBeGreaterThan(0);

    fireEvent.click(profileButtons[0]);

    expect(await screen.findByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  });

  it("raises the desktop sidebar rail above the sticky page header so the collapse toggle isn't sunk", () => {
    renderLayout();

    // position:sticky makes the rail wrapper its own stacking context, trapping
    // the collapse toggle's z-40 inside it. The wrapper must carry a z-index that
    // beats the page's sticky header (z-30) or the toggle's overhang gets painted
    // over — the "sunk arrow" bug.
    const wrapper = screen
      .getAllByTestId("app-sidebar")
      .map((s) => s.parentElement)
      .find((el) => el?.className.includes("sticky"));
    if (!wrapper) throw new Error("Desktop sidebar rail wrapper not found");

    expect(wrapper).toHaveClass("sticky", "z-40");
  });

  it("lets the desktop sidebar collapse toggle overhang render as a full circle", () => {
    renderLayout();

    const wrapper = screen
      .getAllByTestId("app-sidebar")
      .map((s) => s.parentElement)
      .find((el) => el?.className.includes("sticky"));
    if (!wrapper) throw new Error("Desktop sidebar rail wrapper not found");

    expect(wrapper).toHaveClass("overflow-visible");
    expect(wrapper).not.toHaveClass("overflow-hidden");
  });
});
