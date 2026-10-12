import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/context/ConfirmDialog";
import ChemicalRequisitionDialog from "./ChemicalRequisitionDialog";

const apiMock = vi.hoisted(() => ({ getSolvents: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "tester@example.com", name: "Tester" } }),
}));
vi.mock("@/components/lis/StockQrScanner", () => ({ default: () => null }));

describe("ChemicalRequisitionDialog search ranking", () => {
  it("ranks product names while preserving fuzzy filtering and reset order", async () => {
    const names = ["AA Methanol", "XMethanol", "Methanol Z", "Methanol A", "Methanol", "Water"];
    apiMock.getSolvents.mockResolvedValue(names.map((name) => ({ _id: name, name, qty: 5 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <ChemicalRequisitionDialog roomSlug="analysis" instruments={[]} onClose={vi.fn()} onSaved={vi.fn()} />
        </ConfirmProvider>
      </QueryClientProvider>,
    );

    const picker = await screen.findByRole("combobox");
    fireEvent.click(picker);
    const searchInput = await screen.findByPlaceholderText("ค้นหาชื่อสารเคมี");
    fireEvent.change(searchInput, { target: { value: "Methanol" } });
    const optionNames = () => screen.getAllByRole("option").map((option) => option.textContent?.replace(/คงเหลือ.*$/, ""));
    await waitFor(() => expect(optionNames()).toEqual([
      "Methanol", "Methanol Z", "Methanol A", "XMethanol", "AA Methanol",
    ]));

    fireEvent.change(searchInput, { target: { value: "mthnl" } });
    await waitFor(() => expect(optionNames()).toHaveLength(5));
    expect(screen.queryByRole("option", { name: /Water/ })).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "" } });
    await waitFor(() => expect(optionNames()).toEqual(names));
  });
});
