import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScannerPage from '../ScannerPage';
import QrReceiveModal from '@/components/petition/QrReceiveModal';
import LabScanAcceptModal from '@/components/petition/LabScanAcceptModal';
import { api } from '@/lib/api';

const auth = vi.hoisted(() => ({ user: { name: 'Tester', email: 'tester@test', role: 'admin' } }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('@/components/petition/wizard/SubmitterPicker', () => ({
  default: ({ onChange }: { onChange: (value: { employeeId: string; name: string }) => void }) => (
    <button type="button" onClick={() => onChange({ employeeId: 'E001', name: 'Delivery Tester' })}>เลือกผู้นำส่งทดสอบ</button>
  ),
}));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => navigate }));
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class { start = vi.fn().mockRejectedValue(new Error('no camera')); static getCameras = vi.fn().mockResolvedValue([]); },
  Html5QrcodeScannerState: { SCANNING: 2, PAUSED: 3 },
}));

function extraPetition(side = 'qc', status = 'requested') {
  const request = {
    _id: 'round-1', qrCode: 'LIS-EXTRA-11111111-1111-4111-8111-111111111111', side, status,
    reason: 'ตัวอย่างไม่พอ', items: [{ itemSeq: 1, quantity: 2 }],
    requestedAt: '2026-09-19T01:00:00Z', requestedBy: { name: 'Reviewer' },
  };
  return {
    _id: 'petition-1', petitionNo: 'P-2609-0001', dept: 'production', status: 'inProgress',
    submittedBy: { name: 'Requester' }, assignedTo: { name: 'Tester', email: 'tester@test' },
    qcReceivedAt: '2026-09-18T01:00:00Z', labReceivedAt: '2026-09-18T01:00:00Z',
    items: [{ seq: 1, sampleName: 'Sample A', batchNo: 'B1' }],
    additionalSampleRequests: [request], scannedAdditionalSampleId: request._id,
    scannedAdditionalSampleCode: request.qrCode,
  };
}

function openScanner(kind: 'deliver' | 'qc' | 'lab') {
  render(<MemoryRouter>{kind === 'deliver' ? <ScannerPage /> : kind === 'qc'
    ? <QrReceiveModal open manualOnly onClose={() => {}} onReceived={() => {}} />
    : <LabScanAcceptModal open manualOnly onClose={() => {}} onAccepted={() => {}} />}</MemoryRouter>);
}

function scan(code: string, kind: 'deliver' | 'qc' | 'lab') {
  fireEvent.change(screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: kind === 'deliver' ? 'ค้นหา' : kind === 'qc' ? 'รับตัวอย่าง' : 'รับงาน' }));
}

beforeEach(() => { vi.resetAllMocks(); auth.user.role = 'admin'; });

describe('round-specific scanners', () => {
  it('QC remembers received round locally but allows next round on same petition', async () => {
    const found = extraPetition();
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: { data: found } } as never);
    openScanner('qc'); scan(found.scannedAdditionalSampleCode, 'qc');
    await screen.findByText(/ตัวอย่างเพิ่ม.*QC/);
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันรับตัวอย่าง' }));
    await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    scan(found.scannedAdditionalSampleCode, 'qc');
    await screen.findByText(/รับไปแล้วใน session นี้/);
    expect(api.patch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    const next = { ...found.additionalSampleRequests[0], _id: 'round-2', qrCode: 'LIS-EXTRA-22222222-2222-4222-8222-222222222222' };
    vi.mocked(api.get).mockResolvedValue({ data: { data: { ...found, additionalSampleRequests: [...found.additionalSampleRequests, next], scannedAdditionalSampleId: next._id, scannedAdditionalSampleCode: next.qrCode } } } as never);
    scan(next.qrCode, 'qc');
    await screen.findByText(/ตัวอย่างเพิ่ม.*QC/);
    expect(screen.getByRole('button', { name: 'ยืนยันรับตัวอย่าง' })).toBeInTheDocument();
  });

  it('never falls back to legacy lookup for an invalid extra QR', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('invalid extra code'));
    openScanner('deliver'); scan('LIS-EXTRA-invalid', 'deliver');
    await screen.findByText('invalid extra code');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/petitions/scan/LIS-EXTRA-invalid');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('rejects delivered round without a second delivery request', async () => {
    const found = extraPetition('qc', 'sent');
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    openScanner('deliver'); scan(found.scannedAdditionalSampleCode, 'deliver');
    await screen.findByText(/นำส่งแล้ว/);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('QC rejects an unauthorized receiver even with valid pending round code', async () => {
    auth.user.role = 'viewer';
    const found = extraPetition();
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    openScanner('qc'); scan(found.scannedAdditionalSampleCode, 'qc');
    await screen.findByText(/ไม่มีสิทธิ์รับตัวอย่างฝั่ง QC/);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it.each(['deliver', 'qc', 'lab'] as const)('%s sends round ID and unmodified code exactly once', async (kind) => {
    const found = extraPetition(kind === 'lab' ? 'lab' : 'qc');
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: { data: { ...found, additionalSampleRequests: [{ ...found.additionalSampleRequests[0], status: 'received' }] } } } as never);
    openScanner(kind);
    scan(found.scannedAdditionalSampleCode, kind);
    await screen.findAllByText(/ตัวอย่างเพิ่ม.*QC|ตัวอย่างเพิ่ม.*LAB/);
    if (kind === 'deliver') fireEvent.click(screen.getByRole('button', { name: 'เลือกผู้นำส่งทดสอบ' }));
    const confirm = screen.getByRole('button', { name: kind === 'deliver' ? 'ยืนยัน' : kind === 'qc' ? 'ยืนยันรับตัวอย่าง' : 'รับงาน' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/petitions/petition-1/' + (kind === 'deliver' ? 'deliver' : 'receive'), expect.objectContaining({
      actor: 'Tester', side: kind === 'lab' ? 'lab' : 'qc',
      additionalSampleId: found.scannedAdditionalSampleId, additionalSampleCode: found.scannedAdditionalSampleCode,
    }));
  });

  it.each(['qc', 'lab'] as const)('%s rejects opposite-side QR before confirmation', async (kind) => {
    const found = extraPetition(kind === 'qc' ? 'lab' : 'qc');
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    openScanner(kind);
    scan(found.scannedAdditionalSampleCode, kind);
    expect(await screen.findByText(/สำหรับฝั่ง/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['deliver', 'qc', 'lab'] as const)('%s rejects old QR while its extra round is pending', async (kind) => {
    const found = { ...extraPetition(kind === 'lab' ? 'lab' : 'qc'), scannedAdditionalSampleId: undefined, scannedAdditionalSampleCode: undefined };
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    openScanner(kind);
    scan(found._id, kind);
    expect(await screen.findByText(/QR.*รอบเพิ่ม/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['qc', 'lab'] as const)('%s rejects already received round', async (kind) => {
    const found = extraPetition(kind, 'received');
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    openScanner(kind);
    scan(found.scannedAdditionalSampleCode, kind);
    expect(await screen.findByText(/รับ.*แล้ว/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('never falls back to generic PATCH after extra delivery failure', async () => {
    const found = extraPetition();
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    vi.mocked(api.patch).mockRejectedValue(new Error('delivery blocked'));
    openScanner('deliver'); scan(found.scannedAdditionalSampleCode, 'deliver');
    await screen.findAllByText(/ตัวอย่างเพิ่ม.*QC/);
    fireEvent.click(screen.getByRole('button', { name: 'เลือกผู้นำส่งทดสอบ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await screen.findByText(/delivery blocked|เกิดข้อผิดพลาด/);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('keeps LAB assignment restriction on extra rounds', async () => {
    auth.user.role = 'lab-analyze';
    const found = { ...extraPetition('lab'), assignedTo: { name: 'Other', email: 'other@test' } };
    vi.mocked(api.get).mockResolvedValue({ data: { data: found } } as never);
    openScanner('lab'); scan(found.scannedAdditionalSampleCode, 'lab');
    expect(await screen.findByText(/ไม่ได้ถูก assign/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
