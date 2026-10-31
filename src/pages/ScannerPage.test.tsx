import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Petition } from "@/types/petition.types";
import ScannerPage from "./ScannerPage";

const { patchMock, fetchPetitionMock } = vi.hoisted(() => ({
  patchMock: vi.fn(),
  fetchPetitionMock: vi.fn(),
}));

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: vi.fn(),
  Html5QrcodeScannerState: { SCANNING: 2, PAUSED: 3 },
}));
vi.mock("@/lib/api", () => ({ api: { patch: patchMock } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "เจ้าหน้าที่", email: "staff@example.com" } }) }));
vi.mock("@/components/petition/wizard/SubmitterPicker", () => ({
  default: () => <div data-testid="deliverer-picker" />,
}));
vi.mock("@/lib/additionalSampleQr", () => ({
  extractScannedCode: (raw: string) => raw.trim(),
  fetchPetitionByScannedCode: fetchPetitionMock,
  getScannedAdditionalSample: () => undefined,
  additionalSamplePayload: () => ({}),
}));

function petition(overrides: Partial<Petition> = {}): Petition {
  return {
    _id: "p1",
    petitionNo: "P-2611-0002",
    dept: "production",
    status: "deliveringQC",
    submittedBy: { name: "ผู้ขอ", submittedAt: "" },
    items: [{ seq: 1, sampleName: "OMETHOATE", batchNo: "B-1" }],
    ...overrides,
  } as Petition;
}

async function scan(code: string) {
  fireEvent.change(screen.getByPlaceholderText("พิมพ์เลขที่คำร้อง เช่น P-2506-0001"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
  await screen.findByText("รายการที่จะส่ง");
}

describe("ScannerPage ผู้นำส่ง", () => {
  beforeEach(() => {
    patchMock.mockReset();
    fetchPetitionMock.mockReset();
  });

  it("ใช้ชื่อสุ่มโดยจากฝ่ายผลิตเป็นผู้นำส่งอัตโนมัติ โดยไม่ต้องเลือก", async () => {
    const sampled = petition({ sampledBy: { employeeId: "7", name: "นายอติภัทร  จารุณ" } });
    fetchPetitionMock.mockResolvedValue(sampled);
    patchMock.mockResolvedValue({ data: { data: { ...sampled, status: "sampleSent", deliveredBy: sampled.sampledBy } } });
    render(<ScannerPage />);

    await scan("P-2611-0002");

    expect(screen.getByTestId("scanner-preset-deliverer")).toHaveTextContent("นายอติภัทร จารุณ");
    expect(screen.queryByTestId("deliverer-picker")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith(
      "/petitions/p1/deliver",
      expect.objectContaining({ deliveredBy: { employeeId: "7", name: "นายอติภัทร  จารุณ" } }),
    ));
  });

  it("คำร้องเก่าที่ไม่มีสุ่มโดยยังต้องเลือกผู้นำส่งแบบเดิม", async () => {
    fetchPetitionMock.mockResolvedValue(petition());
    render(<ScannerPage />);

    await scan("P-2611-0002");

    expect(screen.getByTestId("deliverer-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("scanner-preset-deliverer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยัน" })).toBeDisabled();
  });
});
