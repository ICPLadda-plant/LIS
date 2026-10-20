import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MasterItems from "../MasterItems";
import { api, uploadQcPhoto } from "@/lib/api";

vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/lis/ItemGroupManagerDialog", () => ({
  default: () => null,
}));

vi.mock("@/hooks/useItemGroupMembership", () => ({
  useItemGroupMembership: () => new Map<string, string[]>(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    getParameters: vi.fn(),
    exportMasterItems: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
  uploadQcPhoto: vi.fn(),
  deleteQcPhoto: vi.fn(),
}));

const masterItem = {
  item_no: "FG-001",
  item_name1: "Test Product",
  common_name: "Cypermethrin",
  inventory_posting_group: "FINISHED",
  base_unit_of_mea: "BTL",
  kg_per_carton: 12,
  unitsPerCarton: 24,
  measureSize: 1,
  measureUnit: "L",
};

function renderMasterItems() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MasterItems />
    </QueryClientProvider>,
  );
}

describe("MasterItems interactions", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/master-items") return { data: { data: [masterItem] } };
      if (path === "/master-item-meta") return { data: { data: [] } };
      if (path === "/common-name-overrides") return { data: { data: [] } };
      if (path === "/item-groups") return { data: { data: [] } };
      return { data: { data: [] } };
    });
    vi.mocked(api.getParameters).mockResolvedValue([]);
    vi.mocked(uploadQcPhoto).mockResolvedValue({ url: "/LIS/uploads/qc-photos/master-item.webp" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["R", "Ri", "ri"])("ranks %s codes ahead of name/details matches before pagination", async (search) => {
    const code = search.toUpperCase();
    const earlierItems = Array.from({ length: 55 }, (_, index) => ({
      item_no: `AA-${index}`,
      item_name1: index % 2 === 0 ? `${search} name match` : "Alpha",
      remark: index % 2 === 1 ? `${search} hidden detail` : "",
    }));
    const priorityCodes = [code, `${code}-100`, `${code}-200`, `X${code}-001`, `XX${code}-001`];
    vi.mocked(api.get).mockImplementation(async (path: string) => ({
      data: { data: path === "/master-items" ? [
        ...earlierItems,
        ...[...priorityCodes].reverse().map((item_no) => ({ item_no, item_name1: "Alpha" })),
      ] : [] },
    }));
    renderMasterItems();

    await screen.findByText("AA-0");
    const input = screen.getByPlaceholderText("ค้นหารหัสสินค้า ชื่อสินค้า หรือชื่อสามัญ");
    fireEvent.change(input, { target: { value: search } });

    await waitFor(() => {
      const rows = screen.getByRole("table").querySelectorAll("tbody tr");
      expect(rows).toHaveLength(50);
      const codes = Array.from(rows).map((row) => row.querySelector("td")?.textContent);
      expect(codes.slice(0, 5)).toEqual([code, `${code}-200`, `${code}-100`, `X${code}-001`, `XX${code}-001`]);
    });

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("table").querySelector("tbody tr td")).toHaveTextContent("AA-0");
  });

  it("opens item details on row single click", async () => {
    renderMasterItems();

    const codeCell = await screen.findByText("FG-001");
    const row = codeCell.closest("tr");
    expect(row).not.toBeNull();

    vi.useFakeTimers();
    fireEvent.click(row!);
    expect(screen.queryByText("น้ำหนักต่อหน่วยย่อย (kg)")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByText("น้ำหนักต่อหน่วยย่อย (kg)")).toBeInTheDocument();
  });

  it("ranks alternate code fields ahead of hidden detail matches without dropping them", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => ({
      data: { data: path === "/master-items" ? [
        { item_no: "AA", item_name1: "Alpha", extra: { detail: "Ri" } },
        { item_no: "ZZ", itemCode: "RI", item_name1: "Beta" },
        { item_no: "BB", ITEM_CODE: "rI", item_name1: "Gamma" },
        { item_no: "CC", item_name1: "Delta" },
      ] : [] },
    }));
    renderMasterItems();
    await screen.findByText("AA");
    fireEvent.change(screen.getByPlaceholderText("ค้นหารหัสสินค้า ชื่อสินค้า หรือชื่อสามัญ"), { target: { value: "ri" } });
    const rows = screen.getByRole("table").querySelectorAll("tbody tr");
    expect(Array.from(rows).map((row) => row.querySelector("td")?.textContent)).toEqual(["ZZ", "BB", "AA"]);
  });

  it("shows MF_Before and MF_Lasted in additional info", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("item-MF-CLOSE")) {
        return new Response(JSON.stringify([
          { item_no: "FG-001", create_date: "2026-09-12T00:00:00Z" },
        ]), { status: 200 });
      }
      if (url.includes("/api/item-MF")) {
        return new Response(JSON.stringify([
          { item_no: "FG-001", create_date: "2026-09-14T00:00:00Z" },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    renderMasterItems();

    const row = (await screen.findByText("FG-001")).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row!);

    expect(await screen.findByText("ข้อมูลเพิ่มเติม")).toBeInTheDocument();
    expect(await screen.findByText("MF_Before")).toBeInTheDocument();
    expect(screen.getByText("2026-09-12")).toBeInTheDocument();
    expect(screen.getByText("MF_Lasted")).toBeInTheDocument();
    expect(screen.getByText("2026-09-14")).toBeInTheDocument();
  });

  it("opens item details after a real double-click sequence", async () => {
    renderMasterItems();

    const codeCell = await screen.findByText("FG-001");
    const row = codeCell.closest("tr");
    expect(row).not.toBeNull();

    vi.useFakeTimers();
    fireEvent.click(row!, { detail: 1 });
    expect(screen.queryByText("น้ำหนักต่อหน่วยย่อย (kg)")).not.toBeInTheDocument();

    fireEvent.click(row!, { detail: 2 });
    fireEvent.doubleClick(row!);
    expect(screen.getByText("น้ำหนักต่อหน่วยย่อย (kg)")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText("น้ำหนักต่อหน่วยย่อย (kg)")).toBeInTheDocument();
  });

  it("opens the edit form from the detail header pencil action", async () => {
    renderMasterItems();

    const row = (await screen.findByText("FG-001")).closest("tr");
    expect(row).not.toBeNull();

    fireEvent.doubleClick(row!);
    const editButton = await screen.findByLabelText("แก้ไขสินค้าจากแถบรายละเอียด");
    fireEvent.click(editButton);

    expect(await screen.findByDisplayValue("FG-001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cypermethrin")).toBeDisabled();
  });

  it("keeps the ERP common name when meta holds a stale type code, and edits never overwrite it", async () => {
    const erpItem = {
      ...masterItem,
      common_name: "CYPERMETHRIN 35% EC",
      item_name2: "CYPERMETHRIN 35% EC",
      item_name3: "12*1 L",
      // server merges meta into the item: these came from an earlier buggy edit
      itemType: "EC",
      description: "CYPERMETHRIN 35% EC",
    };
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/master-items") return { data: { data: [erpItem] } };
      if (path === "/master-item-meta") {
        return { data: { data: [{ itemNo: "FG-001", itemType: "EC", description: "CYPERMETHRIN 35% EC" }] } };
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.put).mockResolvedValue({ data: { data: {} } } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: { data: {} } } as never);
    renderMasterItems();

    const row = (await screen.findByText("FG-001")).closest("tr");
    fireEvent.doubleClick(row!);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("CYPERMETHRIN 35% EC")).toBeInTheDocument();
    expect(within(drawer).getByText("EC - น้ำ (อีซี)")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByLabelText("แก้ไขสินค้าจากแถบรายละเอียด"));
    expect(await screen.findByDisplayValue("CYPERMETHRIN 35% EC")).toBeDisabled();
    expect(screen.getByDisplayValue("EC - น้ำ (อีซี)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [metaPath, metaPayload] = vi.mocked(api.put).mock.calls[0];
    expect(metaPath).toBe("/master-item-meta/FG-001");
    expect(metaPayload).not.toHaveProperty("itemType");
    expect(metaPayload).not.toHaveProperty("description");
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const webhookPayload = vi.mocked(api.patch).mock.calls[0][1] as Record<string, unknown>;
    expect(webhookPayload.common_name).toBe("CYPERMETHRIN 35% EC");
  });

  it("saves the typed common name when creating an item", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { data: {} } } as never);
    vi.mocked(api.post).mockResolvedValue({ data: { data: {} } } as never);
    renderMasterItems();
    await screen.findByText("FG-001");

    fireEvent.click(screen.getByRole("button", { name: /เพิ่มสินค้า/ }));
    fireEvent.change(await screen.findByLabelText("รหัสสินค้า"), { target: { value: "FG-NEW" } });
    fireEvent.change(screen.getByLabelText("ชื่อสินค้า"), { target: { value: "New Product" } });
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("ชื่อสามัญ"), { target: { value: "ABAMECTIN 1.8% EC" } });
    expect(screen.getByDisplayValue("EC - น้ำ (อีซี)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [metaPath, metaPayload] = vi.mocked(api.put).mock.calls[0];
    expect(metaPath).toBe("/master-item-meta/FG-NEW");
    expect(metaPayload).toMatchObject({ itemType: "ABAMECTIN 1.8% EC" });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ common_name: "ABAMECTIN 1.8% EC" });
  });

  it("collects split common names in a dedicated master common name item tab", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/master-items") {
        return {
          data: {
            data: [
              { ...masterItem, item_no: "FG-001", common_name: "DIURON 46.8% WG + HEXAZINONE 13.2% WG" },
              { ...masterItem, item_no: "FG-002", common_name: "DIURON 46.8% WG" },
              { ...masterItem, item_no: "FG-003", common_name: "ABAMECTIN 1.8% EC" },
            ],
          },
        };
      }
      if (path === "/common-name-overrides") {
        return {
          data: {
            data: [
              { raw: "DIURON 46.8% WG + HEXAZINONE 13.2% WG", canonical: "SHOULD NOT DISPLAY" },
            ],
          },
        };
      }
      if (path === "/master-item-meta") return { data: { data: [] } };
      if (path === "/item-groups") return { data: { data: [] } };
      return { data: { data: [] } };
    });

    renderMasterItems();

    fireEvent.mouseDown(await screen.findByRole("tab", { name: "ชื่อสามัญ" }), { button: 0, ctrlKey: false });
    const commonNameTable = screen.getByRole("columnheader", { name: "จำนวนที่พบ" }).closest("table");
    expect(commonNameTable).not.toBeNull();

    expect(within(commonNameTable!).getByText("ABAMECTIN 1.8% EC")).toBeInTheDocument();
    expect(within(commonNameTable!).getByText("DIURON 46.8% WG + HEXAZINONE 13.2% WG")).toBeInTheDocument();
    expect(within(commonNameTable!).getByText("DIURON 46.8% WG")).toBeInTheDocument();
    expect(within(commonNameTable!).getByText("HEXAZINONE 13.2% WG")).toBeInTheDocument();
    expect(within(commonNameTable!).getByText("พบ 2 ครั้ง")).toBeInTheDocument();
    expect(within(commonNameTable!).getAllByText("พบ 1 ครั้ง")).toHaveLength(3);
    expect(within(commonNameTable!).queryByText("SHOULD NOT DISPLAY")).not.toBeInTheDocument();
    expect(screen.queryByText("รวบรวมจาก common_name ของ Master Item และแยกชื่อที่คั่นด้วย +")).not.toBeInTheDocument();
  });

  it("opens common name details and saves uploaded photos for an item", async () => {
    vi.mocked(uploadQcPhoto).mockResolvedValueOnce({ url: "/LIS/uploads/qc-photos/common-name-item.webp" });
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/master-items") {
        return {
          data: {
            data: [
              { ...masterItem, item_no: "FG-001", common_name: "DIURON 80% WP", item_name1: "Diuron 1L" },
              { ...masterItem, item_no: "FG-002", common_name: "DIURON 80% WP", item_name1: "Diuron 5L" },
            ],
          },
        };
      }
      if (path === "/master-item-meta") return { data: { data: [] } };
      if (path === "/common-name-overrides") return { data: { data: [] } };
      if (path === "/item-groups") return { data: { data: [] } };
      return { data: { data: [] } };
    });

    renderMasterItems();

    fireEvent.mouseDown(await screen.findByRole("tab", { name: "ชื่อสามัญ" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด DIURON 80% WP" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("รายละเอียดชื่อสามัญ")).toBeInTheDocument();
    expect(within(dialog).getByText("FG-001")).toBeInTheDocument();
    expect(within(dialog).getByText("FG-002")).toBeInTheDocument();

    const photoInputs = dialog.querySelectorAll('input[type="file"]');
    expect(photoInputs).toHaveLength(2);
    fireEvent.change(photoInputs[0], {
      target: {
        files: [new File(["photo"], "common-name-item.webp", { type: "image/webp" })],
      },
    });

    await waitFor(() => expect(uploadQcPhoto).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        "/master-item-meta/FG-001",
        {
          imageUrl: "/LIS/uploads/qc-photos/common-name-item.webp",
          imageUrls: ["/LIS/uploads/qc-photos/common-name-item.webp"],
        },
      );
    });
  });

  it("calculates gross kg per unit from kg and units per carton", async () => {
    renderMasterItems();

    await screen.findByText("FG-001");
    const addButton = screen.getAllByRole("button").find((button) => button.querySelector(".lucide-plus"));
    expect(addButton).toBeDefined();
    fireEvent.click(addButton!);

    fireEvent.change(await screen.findByLabelText("น้ำหนักต่อลัง (kg)"), { target: { value: "18" } });
    fireEvent.change(await screen.findByLabelText("จำนวนต่อลัง"), { target: { value: "12" } });

    expect(screen.getByLabelText("น้ำหนักต่อหน่วยย่อย (kg)")).toHaveValue(1.5);
  });

  it("saves uploaded product image URLs with the master item metadata", async () => {
    vi.mocked(uploadQcPhoto)
      .mockResolvedValueOnce({ url: "/LIS/uploads/qc-photos/master-item-1.webp" })
      .mockResolvedValueOnce({ url: "/LIS/uploads/qc-photos/master-item-2.webp" });

    renderMasterItems();

    await screen.findByText("FG-001");
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มสินค้า/ }));

    fireEvent.change(await screen.findByLabelText("รหัสสินค้า"), { target: { value: "FG-002" } });
    fireEvent.change(screen.getByLabelText("ชื่อสินค้า"), { target: { value: "Product With Photo" } });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: {
        files: [
          new File(["photo-1"], "product-1.webp", { type: "image/webp" }),
          new File(["photo-2"], "product-2.webp", { type: "image/webp" }),
        ],
      },
    });

    await waitFor(() => expect(uploadQcPhoto).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        "/master-item-meta/FG-002",
        expect.objectContaining({
          imageUrl: "/LIS/uploads/qc-photos/master-item-1.webp",
          imageUrls: [
            "/LIS/uploads/qc-photos/master-item-1.webp",
            "/LIS/uploads/qc-photos/master-item-2.webp",
          ],
        }),
      );
    });
  });
});
