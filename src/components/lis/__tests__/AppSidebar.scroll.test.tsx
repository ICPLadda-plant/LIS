import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AppSidebar from "../AppSidebar";
import { api } from "@/lib/api";

vi.mock("@/context/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: {
      email: "admin@example.com",
      name: "Admin",
      roles: ["admin"],
      status: "active",
    },
    logout: vi.fn(),
  })),
}));

const getUserFavorites = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    getUserFavorites: (...args: unknown[]) => getUserFavorites(...args),
    saveUserFavorites: vi.fn().mockResolvedValue({ email: "admin@example.com", paths: [] }),
  },
}));

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/home"]}>
        <AppSidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppSidebar scroll containment", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    getUserFavorites.mockResolvedValue({ email: "admin@example.com", paths: [] });
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          roles: [{ id: "admin", name: "Admin" }],
          groups: [],
          permissions: {},
        },
      },
    });
  });

  it("constrains the nav as the only vertical scroller inside the rail", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector("aside");
    const nav = container.querySelector("nav");

    expect(aside).toHaveClass("min-h-0", "overflow-visible");
    expect(nav).toHaveClass("min-h-0", "touch-pan-y", "overscroll-y-contain");
    expect(nav?.className).toContain("[-webkit-overflow-scrolling:touch]");
  });
});
