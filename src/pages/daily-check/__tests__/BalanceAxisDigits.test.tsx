import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BalanceRoomPage from "../BalanceRoomPage";

const apiMock = vi.hoisted(() => ({
  getDailyChecks: vi.fn().mockResolvedValue([]),
  createDailyCheck: vi.fn(),
  getBalanceControlConfigs: vi.fn().mockResolvedValue([]),
  updateBalanceControlConfig: vi.fn(),
  updateBalanceWeightCode: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/aiApi", () => ({
  getDailyCheckTrend: vi.fn().mockResolvedValue(null),
  readBalanceDisplayValueFromImage: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { name: "Dev", id: "d", email: "d@e.com" } }) }));

describe("LD-005 axis digits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders every axis tick with two decimals", async () => {
    apiMock.getBalanceControlConfigs.mockResolvedValue([
      { scaleId: "scale-1", brand: "", model: "", weightCode: "", nominal: 10, mean: 9.9995, sd: 0.0051, mpe: 0.5, updatedDate: "2026-11-17" },
    ]);
    const month = new Date().toISOString().slice(0, 7);
    apiMock.getDailyChecks.mockResolvedValue([
      { id: "1", scaleId: "scale-1", date: `${month}-01`, checkedAt: `${month}-01T08:00:00Z`, weights10: ["10.00", "10.01", "10.00"], weights100: ["500.00", "500.01", "500.00"], avg10: 10.0032, avg100: 500.0025, status10: "pass", status100: "pass" },
    ]);
    const { container, findAllByText } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BalanceRoomPage />
      </QueryClientProvider>,
    );
    await findAllByText("10.00");
    const long = Array.from(container.querySelectorAll("text"))
      .map((n) => n.textContent ?? "")
      .filter((t) => /^\d+\.\d{3,}$/.test(t));
    expect(long).toEqual([]);
  });
});
