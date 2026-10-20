import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { api, type ParameterItem, type ParameterValueField, type SubstanceStandard } from "@/lib/api";
import ParameterSettings from "../ParameterSettings";

let mockUser: { role: string; roles: string[] } | null = { role: "admin", roles: ["admin"] };

vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/lis/PageHeader", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
  AuthContext: {
    Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
}));

type SubstanceStandardsDialogMockProps = {
  open: boolean;
  field: ParameterValueField;
  onSave: (next: SubstanceStandard[]) => void;
  onClose: () => void;
};

vi.mock("@/components/lis/SubstanceStandardsDialog", () => ({
  SubstanceStandardsDialog: ({ open, field, onSave, onClose }: SubstanceStandardsDialogMockProps) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onSave([
            ...(field.substanceStandards ?? []),
            { substance: "NEW", operator: "gte", value: 1 },
          ]);
          onClose();
        }}
      >
        save substance dialog
      </button>
    ) : null,
}));

vi.mock("@/components/lis/ConditionalStandardsDialog", () => ({
  ConditionalStandardsDialog: ({ open }: { open: boolean }) => (open ? <div>conditional dialog</div> : null),
}));

vi.mock("@/components/lis/LabelToleranceDialog", () => ({
  LabelToleranceDialog: ({ open }: { open: boolean }) => (open ? <div>label tolerance dialog</div> : null),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getParameters: vi.fn(),
      updateParameter: vi.fn(),
      createParameter: vi.fn(),
      deleteParameter: vi.fn(),
      get: vi.fn(),
    },
  };
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ParameterSettings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

const labLabelParameter = (
  id: string,
  name: string,
  substance: string,
  labelPercent: number,
): ParameterItem => ({
  _id: id,
  name,
  scope: "lab",
  status: "active",
  applyAll: true,
  valueFields: [
    {
      label: "%AI",
      type: "number",
      labelToleranceMode: true,
      labelToleranceStandards: [
        { substance, labelPercent, autoPct: 5, headPct: 10 },
      ],
    },
  ],
});

const openLabLabelToleranceTab = async () => {
  const scopeTabList = await waitFor(() => screen.getAllByRole("tablist")[0]);
  const labTab = within(scopeTabList).getByRole("tab", { name: /Lab/ });
  fireEvent.mouseDown(labTab);
  fireEvent.click(labTab);

  const criteriaTabList = await waitFor(() => screen.getAllByRole("tablist")[1]);
  const labelToleranceTab = within(criteriaTabList).getByRole("tab", { name: "ตาม %สาร" });
  fireEvent.mouseDown(labelToleranceTab);
  fireEvent.click(labelToleranceTab);

  return screen.findByRole("table");
};

describe("ParameterSettings criteria tabs", () => {
  const parameters: ParameterItem[] = [
    {
      _id: "p1",
      name: "เธชเธฒเธฃเธชเธณเธเธฑเธ",
      scope: "qc",
      status: "active",
      applyAll: true,
      valueFields: [
        {
          label: "เธเธฃเธดเธกเธฒเธ“",
          type: "number",
          substanceMode: true,
          substanceStandards: [{ substance: "ABAMECTIN", operator: "gte", value: 95 }],
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { role: "admin", roles: ["admin"] };
    api.get.mockResolvedValue({ data: { data: [] } });
    api.getParameters.mockResolvedValue(parameters);
    api.updateParameter.mockResolvedValue(undefined);
  });

  it("opens substance tab and saves a single-substance quick edit", async () => {
    renderPage();

    const criteriaTabList = await waitFor(() => {
      const tabList = screen.getAllByRole("tablist")[1];
      expect(within(tabList).getByRole("tab", { name: "แยกตามสาร" })).toBeInTheDocument();
      return tabList;
    });
    const criteriaTabs = within(criteriaTabList).getAllByRole("tab");
    expect(criteriaTabs.map((tab) => tab.textContent)).toEqual(["ทั้งหมด", "แยกตามสาร"]);
    expect(within(criteriaTabList).queryByRole("tab", { name: "ตาม %สาร" })).not.toBeInTheDocument();

    const substancesTab = within(criteriaTabList).getByRole("tab", { name: "แยกตามสาร" });
    fireEvent.mouseDown(substancesTab);
    fireEvent.click(substancesTab);

    expect(await screen.findByText("ABAMECTIN")).toBeInTheDocument();

    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("ABAMECTIN")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("ค่า"), { target: { value: "97" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(api.updateParameter).toHaveBeenCalledTimes(1));

    const [, payload] = api.updateParameter.mock.calls[0] as [string, ParameterItem];
    expect(api.updateParameter).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        valueFields: expect.arrayContaining([
          expect.objectContaining({
            substanceStandards: [
              expect.objectContaining({ substance: "ABAMECTIN", operator: "gte", value: 97 }),
            ],
          }),
        ]),
      }),
    );
    expect(payload?.valueFields?.[0]?.substanceStandards).toHaveLength(1);
  });

  it("keeps the quick-edit dialog open when save fails", async () => {
    renderPage();

    const criteriaTabList = await waitFor(() => {
      const tabList = screen.getAllByRole("tablist")[1];
      expect(within(tabList).getByRole("tab", { name: "แยกตามสาร" })).toBeInTheDocument();
      return tabList;
    });
    const substancesTab = within(criteriaTabList).getByRole("tab", { name: "แยกตามสาร" });
    fireEvent.mouseDown(substancesTab);
    fireEvent.click(substancesTab);

    expect(await screen.findByText("ABAMECTIN")).toBeInTheDocument();

    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    api.updateParameter.mockRejectedValueOnce(new Error("save failed"));

    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(api.updateParameter).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "บันทึก" })).toBeInTheDocument();
  });

  it("opens the full substance dialog from an unconfigured field's setup row", async () => {
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-setup",
        name: "Setup Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [
          { label: "ปริมาณ", type: "number", substanceMode: true, substanceStandards: [] },
        ],
      },
    ]);

    renderPage();

    const criteriaTabList = await waitFor(() => screen.getAllByRole("tablist")[1]);
    const substancesTab = within(criteriaTabList).getAllByRole("tab")[1];
    fireEvent.mouseDown(substancesTab);
    fireEvent.click(substancesTab);

    const table = await waitFor(() => screen.getByRole("table"));
    expect(within(table).getByText("Setup Parameter")).toBeInTheDocument();

    fireEvent.click(within(table).getByRole("button"));

    fireEvent.click(await screen.findByText("save substance dialog"));

    await waitFor(() => expect(api.updateParameter).toHaveBeenCalledTimes(1));
    const [, payload] = api.updateParameter.mock.calls[0] as [string, ParameterItem];
    expect(payload?.valueFields?.[0]?.substanceStandards).toHaveLength(1);
    expect(payload?.valueFields?.[0]?.substanceStandards?.[0]).toEqual(
      expect.objectContaining({ substance: "NEW" }),
    );
  });

  it("shows master item context in the substance criteria tab", async () => {
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-item-context",
        name: "Item Context Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [
          {
            label: "Purity",
            type: "number",
            unit: "%",
            substanceMode: true,
            substanceStandards: [
              {
                substance: "ABAMECTIN",
                operator: "gte",
                value: 95,
                itemNo: "RM-001",
                packSize: "100 ml",
                masterItemName: "ABAMECTIN A",
                masterCommonName: "ABAMECTIN 1.8 EC",
                masterRaw: { item_no: "RM-001", desc2: "100 ml" },
              },
            ],
          },
        ],
      },
    ]);

    renderPage();

    const criteriaTabList = await waitFor(() => screen.getAllByRole("tablist")[1]);
    const substancesTab = within(criteriaTabList).getAllByRole("tab")[1];
    fireEvent.mouseDown(substancesTab);
    fireEvent.click(substancesTab);

    expect(await screen.findByText("ABAMECTIN")).toBeInTheDocument();
    expect(screen.getByText("RM-001")).toBeInTheDocument();
    expect(screen.getByText("100 ml")).toBeInTheDocument();
    expect(screen.getByText("ABAMECTIN A")).toBeInTheDocument();
    expect(screen.getByText("item_no: RM-001 | desc2: 100 ml")).toBeInTheDocument();

    const searchBox = screen.getAllByRole("textbox")[0];
    fireEvent.change(searchBox, { target: { value: "RM-001" } });

    expect(screen.getByText("ABAMECTIN")).toBeInTheDocument();
    expect(screen.getByText("RM-001")).toBeInTheDocument();
  });

  it("filters the parameter list by substance names saved in criteria", async () => {
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-label",
        name: "Label Criteria Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [
          {
            label: "%AI",
            type: "number",
            labelToleranceMode: true,
            labelToleranceStandards: [
              { substance: "GLYPHOSATE", labelPercent: 1, autoPct: 25, headPct: 15 },
            ],
          },
        ],
      },
      {
        _id: "p-other",
        name: "Other Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [
          {
            label: "Amount",
            type: "number",
            substanceMode: true,
            substanceStandards: [{ substance: "ABAMECTIN", operator: "gte", value: 95 }],
          },
        ],
      },
    ]);

    renderPage();

    expect(await screen.findByText("Label Criteria Parameter")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาชื่อ/), { target: { value: "glyph" } });

    expect(screen.getByText("Label Criteria Parameter")).toBeInTheDocument();
    expect(screen.queryByText("Other Parameter")).not.toBeInTheDocument();
  });

  it("filters the lab parameter list by the Thai label-tolerance mode name", async () => {
    api.getParameters.mockResolvedValueOnce([
      labLabelParameter("p-lab-label-list", "Lab Label List", "GLYPHOSATE", 12.5),
      {
        _id: "p-lab-text-list",
        name: "Lab Text List",
        scope: "lab",
        status: "active",
        applyAll: true,
        valueFields: [{ label: "Remark", type: "text" }],
      },
    ]);

    renderPage();

    const scopeTabList = await waitFor(() => screen.getAllByRole("tablist")[0]);
    const labTab = within(scopeTabList).getByRole("tab", { name: /Lab/ });
    fireEvent.mouseDown(labTab);
    fireEvent.click(labTab);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Lab Label List")).toBeInTheDocument();
    expect(within(table).getByText("Lab Text List")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/ค้นหาชื่อ/), { target: { value: "ตาม % สาร" } });

    expect(within(table).getByText("Lab Label List")).toBeInTheDocument();
    expect(within(table).queryByText("Lab Text List")).not.toBeInTheDocument();
  });

  it("filters lab label-tolerance criteria by displayed drug percent", async () => {
    api.getParameters.mockResolvedValueOnce([
      labLabelParameter("p-lab-label-125", "Lab Label 12.5", "GLYPHOSATE", 12.5),
      labLabelParameter("p-lab-label-30", "Lab Label 30", "ABAMECTIN", 30),
    ]);

    renderPage();

    const table = await openLabLabelToleranceTab();
    expect(within(table).getByText("Lab Label 12.5")).toBeInTheDocument();
    expect(within(table).queryByText("Lab Label 30")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ค้นหาเกณฑ์"), { target: { value: "12.5%" } });

    expect(within(table).getByText("Lab Label 12.5")).toBeInTheDocument();
    expect(within(table).queryByText("Lab Label 30")).not.toBeInTheDocument();
  });

  it("filters lab label-tolerance criteria by the Thai label-tolerance mode name", async () => {
    api.getParameters.mockResolvedValueOnce([
      labLabelParameter("p-lab-label-mode", "Lab Label Mode", "GLYPHOSATE", 12.5),
      {
        _id: "p-lab-substance-mode",
        name: "Lab Substance Mode",
        scope: "lab",
        status: "active",
        applyAll: true,
        valueFields: [
          {
            label: "Amount",
            type: "number",
            substanceMode: true,
            substanceStandards: [{ substance: "ABAMECTIN", operator: "gte", value: 95 }],
          },
        ],
      },
    ]);

    renderPage();

    const table = await openLabLabelToleranceTab();
    fireEvent.change(screen.getByLabelText("ค้นหาเกณฑ์"), { target: { value: "ตาม % สาร" } });

    expect(within(table).getByText("Lab Label Mode")).toBeInTheDocument();
  });

  it("sorts lab label-tolerance criteria by drug percent by default", async () => {
    api.getParameters.mockResolvedValueOnce([
      labLabelParameter("p-lab-high", "Lab High Percent", "HIGH", 30),
      labLabelParameter("p-lab-low", "Lab Low Percent", "LOW", 5),
    ]);

    renderPage();

    const table = await openLabLabelToleranceTab();

    const sortSelect = screen.getByLabelText("เรียงลำดับ") as HTMLSelectElement;
    expect(sortSelect.value).toBe("drugPercentAsc");

    const tableText = table.textContent ?? "";
    expect(tableText.indexOf("Lab Low Percent")).toBeLessThan(tableText.indexOf("Lab High Percent"));
  });

  it("does not show advanced criteria preview text under setup controls", async () => {
    const advancedParameters: ParameterItem[] = [
      {
        _id: "p-advanced",
        name: "Advanced Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [
          {
            label: "Substance Field",
            type: "number",
            unit: "%",
            substanceMode: true,
            substanceStandards: [{ substance: "ABAMECTIN", operator: "gte", value: 95 }],
          },
          {
            label: "Conditional Field",
            type: "number",
            unit: "%",
            conditionalMode: true,
            conditionalStandards: [
              {
                label: "Rule A",
                conditions: [{ sourceFieldLabel: "Source", op: "gt", value: 10 }],
                operator: "gte",
                value: 20,
              },
            ],
          },
          {
            label: "Label Field",
            type: "number",
            unit: "%",
            labelToleranceMode: true,
            labelToleranceStandards: [
              { substance: "GLYPHOSATE", labelPercent: 1, autoPct: 25, headPct: 15 },
            ],
          },
        ],
      },
    ];
    api.getParameters.mockResolvedValueOnce(advancedParameters);

    renderPage();

    const parameterName = await screen.findByText("Advanced Parameter");
    const row = parameterName.closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLTableRowElement).getAllByRole("button")[0]);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Substance Field/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Conditional Field/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Label Field/ }));

    expect(within(dialog).queryByText(/ABAMECTIN.*95%/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Rule A.*Source.*20%/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/GLYPHOSATE.*25%/)).not.toBeInTheDocument();
  });

  it("inserts a newly added value field at the top of the dialog", async () => {
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-field-order",
        name: "Field Order Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [{ label: "Existing Field", type: "text" }],
      },
    ]);

    renderPage();

    const parameterName = await screen.findByText("Field Order Parameter");
    const row = parameterName.closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLTableRowElement).getByTitle("แก้ไข"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /เพิ่มช่อง/ }));

    const dialogText = dialog.textContent ?? "";
    expect(dialogText.indexOf("ยังไม่ได้ตั้งชื่อ")).toBeGreaterThanOrEqual(0);
    expect(dialogText.indexOf("Existing Field")).toBeGreaterThanOrEqual(0);
    expect(dialogText.indexOf("ยังไม่ได้ตั้งชื่อ")).toBeLessThan(dialogText.indexOf("Existing Field"));
  });

  it("confirms before discarding unsaved parameter dialog changes", async () => {
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-dirty",
        name: "Dirty Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [{ label: "Result", type: "text" }],
      },
    ]);

    renderPage();

    const parameterName = await screen.findByText("Dirty Parameter");
    const row = parameterName.closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLTableRowElement).getByTitle("แก้ไข"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getAllByRole("textbox")[0], { target: { value: "Changed Parameter" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิก" }));

    expect(await screen.findByText("บันทึกหรือไม่บันทึกสิ่งที่เปลี่ยนแปลง")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "กลับไปแก้ไข" }));
    expect(screen.getByText("แก้ไขพารามิเตอร์")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ยกเลิก" }));
    fireEvent.click(await screen.findByRole("button", { name: "ไม่บันทึก" }));

    expect(screen.queryByText("แก้ไขพารามิเตอร์")).not.toBeInTheDocument();
    expect(api.updateParameter).not.toHaveBeenCalled();
  });

  it("saves multiple apply rules as OR items", async () => {
    const masterItems = [
      { item_no: "R-001", item_name1: "ABAMECTIN 1.8% W/V EC", common_name: "ABAMECTIN 1.8% W/V EC" },
      { item_no: "R-002", item_name1: "METALAXYL 35% DS (PINK)", common_name: "METALAXYL 35% DS (PINK)" },
      { item_no: "R-003", item_name1: "CHLOROTHALONIL 50% W/V SC", common_name: "CHLOROTHALONIL 50% W/V SC" },
    ];
    vi.mocked(api.get).mockImplementation((path) => Promise.resolve({
      data: { data: path === "/master-items" ? masterItems : [] },
    } as Awaited<ReturnType<typeof api.get<unknown>>>));
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-rules",
        name: "parameter ทดสอบ",
        scope: "qc",
        status: "active",
        applyAll: false,
        valueFields: [{ label: "Result", type: "text" }],
      },
    ]);
    api.updateParameter.mockResolvedValueOnce({} as ParameterItem);

    renderPage();

    const parameterName = await screen.findByText("parameter ทดสอบ");
    const row = parameterName.closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLTableRowElement).getByTitle("แก้ไข"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "เพิ่มเงื่อนไข ประเภทสาร ในกฎ 1" }));
    const firstRule = within(dialog).getByRole("group", { name: "กฎ 1" });
    fireEvent.click(within(firstRule).getByRole("button", { name: "เลือกประเภทสาร (น้ำ / ทราย / ผง / ของเหลว / ของแข็ง)" }));
    fireEvent.click(await screen.findByRole("button", { name: "ผง" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "เพิ่มกฎ (หรือ)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "เพิ่มเงื่อนไข ประเภท Common Name ในกฎ 2" }));
    const secondRule = within(dialog).getByRole("group", { name: "กฎ 2" });
    fireEvent.click(within(secondRule).getByRole("button", { name: "เลือกประเภท common name (EC / SC / WP ...)" }));
    fireEvent.click(await screen.findByRole("button", { name: /EC - น้ำ/ }));

    expect(within(secondRule).getByText("ตรงกับ 1 item")).toBeInTheDocument();
    const preview = within(dialog).getByRole("region", { name: "ผลลัพธ์ใช้กับ" });
    expect(within(preview).getByText("R-001")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกการแก้ไข" }));

    await waitFor(() => expect(api.updateParameter).toHaveBeenCalledTimes(1));
    const [, payload] = api.updateParameter.mock.calls[0] as [string, ParameterItem];
    expect(payload.applyRules).toEqual([
      { productTypes: ["powder"] },
      { commonNames: ["EC"] },
    ]);
    expect(payload.productTypes).toEqual([]);
    expect(payload.commonNames).toEqual([]);
  });

  it("opens legacy parameter-level criteria as rule 1 and saves them as an apply rule", async () => {
    const masterItems = [
      { item_no: "R-001", item_name1: "ABAMECTIN 1.8% W/V EC", common_name: "ABAMECTIN 1.8% W/V EC" },
      { item_no: "F-002", item_name1: "ABAMECTIN 1.8% W/V EC FG", common_name: "ABAMECTIN 1.8% W/V EC" },
    ];
    vi.mocked(api.get).mockImplementation((path) => Promise.resolve({
      data: { data: path === "/master-items" ? masterItems : [] },
    } as Awaited<ReturnType<typeof api.get<unknown>>>));
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-legacy",
        name: "legacy parameter",
        scope: "qc",
        status: "active",
        applyAll: false,
        categories: ["RM"],
        commonNames: ["EC"],
        valueFields: [{ label: "Result", type: "text" }],
      },
    ]);
    api.updateParameter.mockResolvedValueOnce({} as ParameterItem);

    renderPage();

    const row = (await screen.findByText("legacy parameter")).closest("tr")!;
    fireEvent.click(within(row).getByTitle("แก้ไข"));
    const dialog = await screen.findByRole("dialog");
    const firstRule = within(dialog).getByRole("group", { name: "กฎ 1" });
    expect(await within(firstRule).findByText("ตรงกับ 1 item")).toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "กฎ 2" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกการแก้ไข" }));

    await waitFor(() => expect(api.updateParameter).toHaveBeenCalledTimes(1));
    const [, payload] = api.updateParameter.mock.calls[0] as [string, ParameterItem];
    expect(payload.applyRules).toEqual([{ commonNames: ["EC"], categories: ["RM"] }]);
    expect(payload.categories).toEqual([]);
    expect(payload.commonNames).toEqual([]);
  });

  it("ranks subcategory matches globally across warehouse groups and restores empty-query order", async () => {
    const prefixes = ["RI", "RXI", "RXXI", "FI", "FXXI"];
    vi.mocked(api.get).mockImplementation((path) => Promise.resolve({
      data: { data: path === "/master-items" ? prefixes.map((prefix) => ({ item_no: `${prefix}-001` })) : [] },
    } as Awaited<ReturnType<typeof api.get<unknown>>>));
    vi.mocked(api.getParameters).mockResolvedValueOnce([{
      _id: "p-group-ranking", name: "Grouped ranking", scope: "qc", status: "active",
      applyAll: false, categories: ["RM", "FG"], valueFields: [{ label: "Result", type: "text" }],
    }]);
    renderPage();
    const row = (await screen.findByText("Grouped ranking")).closest("tr")!;
    fireEvent.click(within(row).getByTitle("แก้ไข"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "เลือก prefix เช่น F, FC, RO, RC ..." }));
    const input = screen.getByPlaceholderText("ค้นหา...");
    const optionOrder = () => screen.getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((text) => prefixes.includes(text ?? ""));
    expect(optionOrder()).toEqual(prefixes);
    for (const query of ["I", "i"]) {
      fireEvent.change(input, { target: { value: query } });
      expect(optionOrder()).toEqual(["RI", "FI", "RXI", "RXXI", "FXXI"]);
      expect(screen.getAllByText("RM — หมวดย่อยจาก code").length).toBeGreaterThan(0);
      expect(screen.getAllByText("FG — หมวดย่อยจาก code").length).toBeGreaterThan(0);
    }
    fireEvent.change(input, { target: { value: "" } });
    expect(optionOrder()).toEqual(prefixes);
  });

  it("shows head criteria columns for admin in label tolerance tab", async () => {
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-label",
        name: "Label Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [
          {
            label: "%AI",
            type: "number",
            labelToleranceMode: true,
            labelToleranceStandards: [{ substance: "ABAMECTIN", labelPercent: 1, autoPct: 25, headPct: 15 }],
          },
        ],
      },
    ]);

    renderPage();

    const criteriaTabList = await waitFor(() => screen.getAllByRole("tablist")[1]);
    const labelToleranceTab = within(criteriaTabList).getByRole("tab", { name: "ตาม %สาร" });
    fireEvent.mouseDown(labelToleranceTab);
    fireEvent.click(labelToleranceTab);
    await screen.findByText("ABAMECTIN / 1%");

    const headerTexts = within(await screen.findByRole("table"))
      .getAllByRole("columnheader")
      .map((header) => header.textContent ?? "");
    expect(headerTexts).toContain("เกณฑ์กลาง");
    expect(headerTexts.some((text) => text.includes("(%,+-)"))).toBe(true);
    expect(headerTexts.filter((text) => text.includes("25%"))).toHaveLength(2);
  });

  it("hides head criteria columns for non-head roles in label tolerance tab", async () => {
    mockUser = { role: "viewer", roles: ["viewer"] };
    api.getParameters.mockResolvedValueOnce([
      {
        _id: "p-label",
        name: "Label Parameter",
        scope: "qc",
        status: "active",
        applyAll: true,
        valueFields: [
          {
            label: "%AI",
            type: "number",
            labelToleranceMode: true,
            labelToleranceStandards: [{ substance: "ABAMECTIN", labelPercent: 1, autoPct: 25, headPct: 15 }],
          },
        ],
      },
    ]);

    renderPage();

    const criteriaTabList = await waitFor(() => screen.getAllByRole("tablist")[1]);
    const labelToleranceTab = within(criteriaTabList).getByRole("tab", { name: "ตาม %สาร" });
    fireEvent.mouseDown(labelToleranceTab);
    fireEvent.click(labelToleranceTab);
    await screen.findByText("ABAMECTIN / 1%");

    const headerTexts = within(await screen.findByRole("table"))
      .getAllByRole("columnheader")
      .map((header) => header.textContent ?? "");
    expect(headerTexts).toContain("เกณฑ์กลาง");
    expect(headerTexts.some((text) => text.includes("(%,+-)"))).toBe(false);
    expect(headerTexts.some((text) => text.includes("25%"))).toBe(false);
  });
});
