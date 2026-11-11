import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LabScanAcceptModal from '../LabScanAcceptModal';

// กันเปิดกล้องจริง: start reject + ไม่มีกล้อง → phase 'no-camera'
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
  useAuth: () => ({ user: { name: 'Tester', email: 't@t.com' } }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

import { api } from '@/lib/api';
import { Html5Qrcode } from 'html5-qrcode';

const labPetition = {
  _id: 'pet1',
  petitionNo: 'P-2506-0001',
  dept: 'production',
  status: 'sampleSent',
  assignedTo: { name: 'Tester' },
  items: [{ seq: 1, sampleName: 'ตัวอย่าง A', batchNo: 'B1' }],
};

const rdLabPetition = {
  _id: 'pet-rd1',
  petitionNo: 'P-2609-0003',
  dept: 'production',
  status: 'sampleSent',
  submittedBy: { name: 'RD User', department: 'R&D' },
  assignedTo: { name: 'Tester' },
  items: [{ seq: 1, sampleName: 'R&D sample', batchNo: '' }],
};

function renderModal() {
  return render(
    <MemoryRouter>
      <LabScanAcceptModal open onClose={() => {}} onAccepted={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LabScanAcceptModal manual entry', () => {
  it('แสดงช่องกรอกเลขที่คำร้องเมื่อไม่มีกล้อง', async () => {
    renderModal();
    expect(
      await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/),
    ).toBeInTheDocument();
  });

  it('พิมพ์เลขที่คำร้องแล้ว submit → เข้าจอ confirm', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: labPetition },
    });
    renderModal();

    const input = await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2506-0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'รับงาน' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/petitions/scan/P-2506-0001'),
      ),
    );
    expect(await screen.findByText('P-2506-0001')).toBeInTheDocument();
  });
});

describe('LabScanAcceptModal camera failure fallback', () => {
  it('เปิดกล้องไม่ได้ (getCameras throw) → ยังมีช่องกรอกเลขให้รับงานต่อได้', async () => {
    (Html5Qrcode as unknown as { getCameras: ReturnType<typeof vi.fn> }).getCameras =
      vi.fn().mockRejectedValue(new Error('enumerate failed'));
    renderModal();

    // ต้อง fallback ไปกรอกเอง ไม่ใช่ค้างที่หน้า error
    expect(
      await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ไม่สามารถเปิดกล้องได้/)).not.toBeInTheDocument();
  });
});

describe('LabScanAcceptModal manualOnly mode', () => {
  function renderManual() {
    return render(
      <MemoryRouter>
        <LabScanAcceptModal open manualOnly onClose={() => {}} onAccepted={() => {}} />
      </MemoryRouter>,
    );
  }

  it('โชว์หัวข้อ "กรอกเลขรับงาน" + ช่องกรอกทันที ไม่ต้องรอกล้อง', async () => {
    renderManual();
    expect(screen.getByText('กรอกเลขรับงาน Lab')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/)).toBeInTheDocument();
    // โหมดนี้ไม่เปิดกล้อง → ไม่มีข้อความ "ไม่พบกล้อง"
    expect(screen.queryByText(/ไม่พบกล้อง/)).not.toBeInTheDocument();
  });

  it('submit เลขคำร้อง → เข้า confirm เหมือนโหมดสแกน', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: labPetition } });
    renderManual();
    const input = screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2506-0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'รับงาน' }));
    expect(await screen.findByText('P-2506-0001')).toBeInTheDocument();
  });

  it('รับคำร้อง R&D ที่ไม่มีเลขแบช Lab ได้หลัง assign แล้ว', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: rdLabPetition } });
    renderManual();
    const input = screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2609-0003' } });
    fireEvent.click(screen.getByRole('button', { name: 'รับงาน' }));
    expect(await screen.findByText('P-2609-0003')).toBeInTheDocument();
    expect(screen.getByText('1 รายการ')).toBeInTheDocument();
    expect(screen.queryByText('คำร้องนี้ไม่มีรายการ Lab')).not.toBeInTheDocument();
  });
});

describe('LabScanAcceptModal pending dropdown', () => {
  it('เลือกคำร้องจาก Dropdown → เข้าจอยืนยันเหมือนพิมพ์เลข', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: labPetition } });
    render(
      <MemoryRouter>
        <LabScanAcceptModal
          open
          manualOnly
          pendingPetitions={[labPetition as never]}
          onClose={() => {}}
          onAccepted={() => {}}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'เลือกคำร้องที่รอรับ' }));
    fireEvent.click(await screen.findByRole('option', { name: /P-2506-0001/ }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/petitions/scan/P-2506-0001')),
    );
    expect(await screen.findByRole('button', { name: 'กรอกใหม่' })).toBeInTheDocument();
  });

  it('ไม่มีคำร้องรอรับ → Dropdown ถูกปิดและบอกว่าไม่มีคำร้อง', () => {
    render(
      <MemoryRouter>
        <LabScanAcceptModal open manualOnly pendingPetitions={[]} onClose={() => {}} onAccepted={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('combobox', { name: 'เลือกคำร้องที่รอรับ' })).toBeDisabled();
    expect(screen.getByText('ไม่มีคำร้องที่รอรับ')).toBeInTheDocument();
  });
});
