import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScannerPage from '../ScannerPage';

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

const petition = {
  _id: 'pet1',
  petitionNo: 'P-2506-0003',
  dept: 'production',
  status: 'pending',
  submittedBy: { name: 'ผู้ส่ง' },
  items: [{ seq: 1, sampleName: 'ตัวอย่าง A' }],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ScannerPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (Html5Qrcode as unknown as { getCameras: ReturnType<typeof vi.fn> }).getCameras =
    vi.fn().mockResolvedValue([]);
});

describe('ScannerPage camera failure fallback', () => {
  it('เปิดกล้องไม่ได้ → ยังมีช่องกรอกเลขให้ส่งตัวอย่างต่อได้ (ไม่ค้างหน้า error ทางตัน)', async () => {
    renderPage();
    // เริ่มสแกน → กล้องเปิดไม่ได้
    fireEvent.click(screen.getByRole('button', { name: /สแกน QR Code/ }));

    // ต้อง fallback ไปกรอกเอง ไม่ใช่ขึ้นข้อความ "กรุณาอนุญาตการเข้าถึงกล้อง"
    expect(
      await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/กรุณาอนุญาตการเข้าถึงกล้อง/)).not.toBeInTheDocument();
  });

  it('พิมพ์เลขที่คำร้องแล้ว submit → เข้าจอ confirm', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: petition } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /สแกน QR Code/ }));

    const input = await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2506-0003' } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/petitions/scan/P-2506-0003'),
      ),
    );
    expect(await screen.findByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();
    expect(screen.getAllByText('P-2506-0003').length).toBeGreaterThan(0);
  });

  it('กดเพิ่มรายการแล้วเปิด popup โดยยังคงหน้าตรวจสอบรายการเดิมไว้', async () => {
    const secondPetition = {
      ...petition,
      _id: 'pet2',
      petitionNo: 'P-2506-0004',
      submittedBy: { name: 'ผู้ส่งคนที่สอง' },
    };
    (api.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { data: petition } })
      .mockResolvedValueOnce({ data: { data: secondPetition } });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /สแกน QR Code/ }));
    const input = await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2506-0003' } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));

    expect(await screen.findByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();

    const addInput = screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(addInput, { target: { value: 'P-2506-0004' } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));

    await waitFor(() => expect(screen.getByText('ทั้งหมด 2 ตัวอย่าง')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('P-2506-0004')).toBeInTheDocument();
  });

  it('สแกนด้วยเครื่องสแกนเนอร์ได้ทันทีโดยไม่ต้องโฟกัสช่องเลขคำร้อง', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: petition } });
    renderPage();

    expect(document.activeElement).not.toBe(screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/));

    for (const key of 'P-2506-0003') {
      fireEvent.keyDown(window, { key });
    }
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/petitions/scan/P-2506-0003'),
      ),
    );
    expect(await screen.findByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();
  });

  it('อยู่หน้ายืนยันแล้วยิงเครื่องสแกนต่อ → เพิ่มเข้าคิวทันทีโดยไม่ต้องกดเพิ่มรายการ', async () => {
    const secondPetition = { ...petition, _id: 'pet2', petitionNo: 'P-2506-0004' };
    (api.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { data: petition } })
      .mockResolvedValueOnce({ data: { data: secondPetition } });
    renderPage();

    const typeScan = (code: string) => {
      for (const key of code) fireEvent.keyDown(window, { key });
      fireEvent.keyDown(window, { key: 'Enter' });
    };

    typeScan('P-2506-0003');
    expect(await screen.findByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();
    typeScan('P-2506-0004');

    await waitFor(() => expect(screen.getByText('ทั้งหมด 2 ตัวอย่าง')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('เพิ่ม P-2506-0004 เข้าคิวแล้ว');
  });

  it('ยิงรายการที่อยู่ในคิวซ้ำ → แจ้งเตือนในหน้ายืนยันโดยไม่ล้างคิว', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: petition } });
    renderPage();
    const typeScan = (code: string) => {
      for (const key of code) fireEvent.keyDown(window, { key });
      fireEvent.keyDown(window, { key: 'Enter' });
    };

    typeScan('P-2506-0003');
    expect(await screen.findByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();
    typeScan('P-2506-0003');

    expect(await screen.findByRole('alert')).toHaveTextContent('รายการนี้อยู่ในคิวแล้ว');
    expect(screen.getByText('ทั้งหมด 1 ตัวอย่าง')).toBeInTheDocument();
  });

  it('ส่งสำเร็จแล้วยิงเครื่องสแกนต่อ → เริ่มคิวใหม่ทันทีโดยไม่ต้องกดสแกนคำร้องถัดไป', async () => {
    const sampled = { ...petition, sampledBy: { employeeId: '7', name: 'ผู้สุ่ม' } };
    const next = { ...sampled, _id: 'pet2', petitionNo: 'P-2506-0004' };
    (api.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { data: sampled } })
      .mockResolvedValueOnce({ data: { data: next } });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { ...sampled, status: 'sampleSent' } } });
    renderPage();
    const typeScan = (code: string) => {
      for (const key of code) fireEvent.keyDown(window, { key });
      fireEvent.keyDown(window, { key: 'Enter' });
    };

    typeScan('P-2506-0003');
    expect(await screen.findByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    expect(await screen.findByRole('button', { name: 'สแกนคำร้องถัดไป' })).toBeInTheDocument();

    typeScan('P-2506-0004');
    expect(await screen.findByText('ตรวจสอบคำร้องก่อนยืนยัน')).toBeInTheDocument();
    expect(screen.getByText('ทั้งหมด 1 ตัวอย่าง')).toBeInTheDocument();
    expect(screen.getByText('P-2506-0004')).toBeInTheDocument();
  });
});
