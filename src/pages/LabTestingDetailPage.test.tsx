import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParameterItem } from "@/lib/api";
import type { Petition, QCTestResult } from "@/types/petition.types";
import LabTestingDetailPage from "./LabTestingDetailPage";

const mockNavigate = vi.hoisted(() => vi.fn());

const fixtures = vi.hoisted(() => {
  const petition: Petition = {
    _id: "petition-1",
    petitionNo: "LIS-001",
    dept: "rm",
    status: "inProgress",
    submittedBy: {
      name: "ผู้ส่งตัวอย่าง",
      submittedAt: "2026-07-13T01:00:00.000Z",
    },
    assignedTo: {
      employeeId: "11650",
      name: "พรหมพิริยะ ทองรุ่งรัตนกุล",
    },
    labReceivedAt: "2026-07-13T01:30:00.000Z",
    labReceivedBy: "พรหมพิริยะ ทองรุ่งรัตนกุล",
    items: [
      {
        seq: 1,
        sampleName: "ABAMECTIN 1.8% W/V EC",
        commonName: "ABAMECTIN 1.8% W/V EC",
        batchNo: "A1",
        testItems: "Active Ingredient",
      },
    ],
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T02:42:00.000Z",
  };

  const parameters: ParameterItem[] = [
    {
      _id: "param-1",
      name: "Active Ingredient",
      scope: "lab",
      applyAll: true,
      valueFields: [
        {
          label: "%AI",
          type: "number",
          unit: "%",
          labelToleranceMode: true,
          labelToleranceStandards: [
            { substance: "ABAMECTIN", autoPct: 2.5, headPct: 5 },
          ],
        },
      ],
    },
  ];

  const results: QCTestResult[] = [
    {
      petitionId: "petition-1",
      petitionNo: "LIS-001",
      itemSeq: 1,
      parameterId: "param-1",
      parameterName: "Active Ingredient",
      values: { "%AI::abamectin": "1.8" },
      updatedAt: "2026-07-13T02:42:00.000Z",
      updatedBy: { name: "พรหมพิริยะ ทองรุ่งรัตนกุล", email: "prompiriya.t@example.com" },
    },
  ];

  return { petition, parameters, results };
});

const researchFixtures = vi.hoisted(() => {
  const petition: Petition = {
    _id: "petition-rd",
    petitionNo: "LIS-RD-001",
    dept: "production",
    status: "inProgress",
    submittedBy: {
      name: "นักวิจัย",
      department: "R & D",
      submittedAt: "2026-07-13T01:00:00.000Z",
    },
    assignedTo: {
      employeeId: "11650",
      name: "พรหมพิริยะ ทองรุ่งรัตนกุล",
    },
    labReceivedAt: "2026-07-13T01:30:00.000Z",
    labReceivedBy: "พรหมพิริยะ ทองรุ่งรัตนกุล",
    items: [
      {
        seq: 1,
        sampleName: "R&D Sample",
        commonName: "R&D Active",
        batchNo: "",
      },
    ],
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T02:42:00.000Z",
  };

  const parameters: ParameterItem[] = [
    {
      _id: "lab-param",
      name: "Lab Assay",
      scope: "lab",
      applyAll: true,
      valueFields: [{ label: "Lab value", type: "text" }],
    },
    {
      _id: "qc-param",
      name: "QC Shared",
      scope: "qc",
      shareWithLab: true,
      applyAll: true,
      valueFields: [{ label: "QC value", type: "text" }],
    },
  ];

  return { petition, parameters, results: [] as QCTestResult[] };
});

const mockState = vi.hoisted(() => ({
  activeFixtures: fixtures,
  parametersError: false,
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "petition-1" }),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/lis/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/lis/PageHeader", () => ({
  default: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => (
    <header>
      <div>{title}</div>
      {actions}
    </header>
  ),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      name: "พรหมพิริยะ ทองรุ่งรัตนกุล",
      email: "prompiriya.t@example.com",
      roles: ["admin"],
    },
  }),
}));

vi.mock("@/hooks/useArrivalFlash", () => ({
  useArrivalFlash: () => "",
}));

vi.mock("@/context/ConfirmDialog", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@/hooks/useItemGroupMembership", () => ({
  useItemGroupMembership: () => ({
    get: () => [],
  }),
}));

vi.mock("@/hooks/usePetition", () => ({
  usePetition: () => ({ data: mockState.activeFixtures.petition, loading: false, error: null }),
  usePetitionList: () => ({ data: { items: [] }, loading: false, error: null }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getParameters: vi.fn().mockImplementation(() => mockState.parametersError
        ? Promise.reject(new Error('Parameter unavailable'))
        : Promise.resolve(mockState.activeFixtures.parameters)),
      getInstrumentSources: vi.fn().mockResolvedValue([]),
      getQCResults: vi.fn().mockImplementation(() => Promise.resolve(mockState.activeFixtures.results)),
      getReturnedFlags: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue({ data: { data: mockState.activeFixtures.petition } }),
    },
  };
});

describe("LabTestingDetailPage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockState.activeFixtures = fixtures;
    mockState.parametersError = false;
  });

  it("shows label-tolerance criteria and saved-by metadata beside the parameter field name", async () => {
    render(<LabTestingDetailPage />);

    const fieldName = await screen.findByText(/%AI — ABAMECTIN/);

    await waitFor(() => {
      expect(screen.getByText(/เกณฑ์กรม 1\.7100–1\.8900 %/)).toBeInTheDocument();
    });

    const headerRow = fieldName.closest("div");
    expect(headerRow).not.toBeNull();
    expect(within(headerRow as HTMLElement).getByText(/เกณฑ์กรม 1\.7100–1\.8900 %/)).toBeInTheDocument();
    expect(within(headerRow as HTMLElement).getByText(/กรอกโดย พรหมพิริยะ ทองรุ่งรัตนกุล เมื่อ/)).toBeInTheDocument();
    expect(screen.queryByText(/เกณฑ์กลาง 1\.7100–1\.8900 %/)).not.toBeInTheDocument();
  });

  it("shows the FG %AI parameter for a production petition without an item code", async () => {
    mockState.activeFixtures = {
      ...fixtures,
      petition: {
        ...fixtures.petition,
        dept: "production",
        items: (fixtures.petition.items ?? []).map((item) => ({ ...item, itemNo: "", sampleId: "P-2610-0003", testItems: "" })),
      },
      parameters: fixtures.parameters.map((parameter) => ({ ...parameter, name: "%AI", applyAll: false, categories: ["FG"] })),
    };

    render(<LabTestingDetailPage />);

    expect(await screen.findByText("Area Inj.1")).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่มีพารามิเตอร์ Lab ที่ตรงกับตัวอย่างนี้/)).not.toBeInTheDocument();
  });

  it("expands a legacy %AI parameter into input, average, and RSD fields", async () => {
    render(<LabTestingDetailPage />);

    expect(await screen.findByText("Area Inj.1")).toBeInTheDocument();
    expect(screen.getByText("Area Inj.3")).toBeInTheDocument();
    expect(screen.getByText("% Sample 1")).toBeInTheDocument();
    expect(screen.getByText("% Sample 3")).toBeInTheDocument();
    expect(screen.getByText("Area Average")).toBeInTheDocument();
    expect(screen.getByText("% Sample %RSD")).toBeInTheDocument();
  });

  it("shows only Lab-scope parameters for R&D petitions", async () => {
    mockState.activeFixtures = researchFixtures;

    render(<LabTestingDetailPage />);

    expect(await screen.findByText("Lab value")).toBeInTheDocument();
    expect(screen.queryByText("QC value")).not.toBeInTheDocument();
  });

  it("allows an assigned Lab user to edit a Lab result after Lab approval", async () => {
    mockState.activeFixtures = {
      ...fixtures,
      petition: {
        ...fixtures.petition,
        status: "success",
        labCompletedAt: "2026-07-13T03:00:00.000Z",
        labApprovedAt: "2026-07-13T04:00:00.000Z",
      },
    };

    render(<LabTestingDetailPage />);

    expect((await screen.findAllByRole("spinbutton"))[0]).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /บันทึกการแก้ไข/ })).toBeEnabled();
  });

  it("keeps an assigned Lab item visible and prevents completion when no parameter matches", async () => {
    mockState.activeFixtures = { ...fixtures, parameters: [] };

    render(<LabTestingDetailPage />);

    expect(await screen.findByText(/ยังไม่มีพารามิเตอร์ Lab ที่ตรงกับตัวอย่างนี้/)).toBeInTheDocument();
    expect(screen.getByText(/รายการที่ 1: ABAMECTIN/)).toBeInTheDocument();
    expect(screen.queryByText("ไม่มีตัวอย่างที่ส่งเข้า Lab ในคำร้องนี้")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึก" })).not.toBeInTheDocument();
  });

  it("explains a parameter loading failure without hiding the assigned item", async () => {
    mockState.parametersError = true;

    render(<LabTestingDetailPage />);

    expect(await screen.findByText(/โหลดพารามิเตอร์ Lab ไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getByText(/รายการที่ 1: ABAMECTIN/)).toBeInTheDocument();
  });

  it("does not complete Lab while another routed item has no Lab parameter", async () => {
    mockState.activeFixtures = {
      ...fixtures,
      petition: {
        ...fixtures.petition,
        items: [
          ...(fixtures.petition.items ?? []),
          { seq: 2, sampleName: "FIPRONIL 0.3% GR", batchNo: "26S-FPNO.3-156", testItems: "Unconfigured" },
        ],
      },
    };

    render(<LabTestingDetailPage />);

    expect(await screen.findByText(/ยังไม่มีพารามิเตอร์ Lab ที่ตรงกับตัวอย่างนี้/)).toBeInTheDocument();
    expect(screen.getByText(/รายการที่ 2: FIPRONIL/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึก" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกแบบร่าง" })).toBeInTheDocument();
  });
});
