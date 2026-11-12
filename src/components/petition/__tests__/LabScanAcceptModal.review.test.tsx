import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LabScanAcceptModal from '../LabScanAcceptModal';

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    start = vi.fn().mockRejectedValue(new Error('no camera'));
    stop = vi.fn().mockResolvedValue(undefined);
    getState = vi.fn().mockReturnValue(2);
    static getCameras = vi.fn().mockResolvedValue([]);
  },
  Html5QrcodeScannerState: { SCANNING: 2, PAUSED: 3 },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { name: 'หัวหน้า Lab', email: 'head@t.com', roles: ['lab-head'] } }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

vi.mock('@/hooks/usePetition', () => ({
  fetchLabRequestsByPetition: vi.fn(),
  saveLabAgreementReview: vi.fn(),
}));

import { api } from '@/lib/api';
import { fetchLabRequestsByPetition, saveLabAgreementReview } from '@/hooks/usePetition';

const petition = {
  _id: 'pet1',
  petitionNo: 'P-2611-0001',
  dept: 'production',
  status: 'sampleSent',
  submittedBy: { name: 'ผู้ส่ง' },
  items: [{ seq: 1, sampleName: 'ตัวอย่าง A', sendToLab: true }],
};
const reviewed = (acceptable: boolean) => ({
  reviewedAt: '2026-11-10T00:00:00.000Z', reviewedBy: 'หัวหน้า Lab', acceptable,
  ...(acceptable ? {} : { notAcceptableReason: 'เครื่องเสีย' }),
});

function renderModal() {
  return render(
    <MemoryRouter>
      <LabScanAcceptModal open manualOnly initialCode="P-2611-0001" onClose={() => {}} onAccepted={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { data: petition } } as never);
  vi.mocked(api.patch).mockResolvedValue({ data: { data: { ...petition, labReceivedAt: '2026-11-10' } } } as never);
});

describe('LabScanAcceptModal ทบทวนคำขอก่อนรับงาน', () => {
  it('ยังไม่ทบทวน → กดรับงานแล้วเปิดฟอร์มทบทวน และรับตัวอย่างหลังบันทึกว่าพร้อมรับงาน', async () => {
    vi.mocked(fetchLabRequestsByPetition).mockResolvedValue([{ _id: 'l1', serviceAgreement: { testMethod: 'standard' } }] as never);
    vi.mocked(saveLabAgreementReview).mockResolvedValue({ updated: 1, review: reviewed(true) } as never);
    renderModal();

    expect(await screen.findByText('ต้องทบทวนก่อนรับงาน')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'รับงาน' }));
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /บันทึกการทบทวน/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/petitions/pet1/receive', expect.objectContaining({ side: 'lab' })));
  });

  it('ทบทวนว่าไม่พร้อมรับงาน → ไม่รับตัวอย่าง', async () => {
    vi.mocked(fetchLabRequestsByPetition).mockResolvedValue([{ _id: 'l1', serviceAgreement: { testMethod: 'standard' } }] as never);
    vi.mocked(saveLabAgreementReview).mockResolvedValue({ updated: 1, review: reviewed(false) } as never);
    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'รับงาน' }));
    fireEvent.click(await screen.findByRole('button', { name: /บันทึกการทบทวน/ }));
    expect(await screen.findByText(/ไม่พร้อมรับงาน \(เครื่องเสีย\)/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('ทบทวนไว้แล้วว่าพร้อมรับงาน → กดรับงานแล้วรับตัวอย่างทันที', async () => {
    vi.mocked(fetchLabRequestsByPetition).mockResolvedValue([{ _id: 'l1', labAgreementReview: reviewed(true) }] as never);
    renderModal();

    expect(await screen.findByText('พร้อมรับงาน')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'รับงาน' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /บันทึกการทบทวน/ })).not.toBeInTheDocument();
  });
});
