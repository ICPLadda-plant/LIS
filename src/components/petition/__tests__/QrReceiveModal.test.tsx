import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QrReceiveModal from '../QrReceiveModal';

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

const qcPetition = {
  _id: 'pet1',
  petitionNo: 'P-2506-0002',
  dept: 'production',
  status: 'sampleSent',
  submittedBy: { name: 'ผู้ส่ง' },
  items: [{ seq: 1, sampleName: 'ตัวอย่าง A' }],
};

function renderModal() {
  return render(
    <MemoryRouter>
      <QrReceiveModal open onClose={() => {}} onReceived={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QrReceiveModal manual entry', () => {
  it('แสดงช่องกรอกเลขที่คำร้องเมื่อไม่มีกล้อง', async () => {
    renderModal();
    expect(
      await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/),
    ).toBeInTheDocument();
  });

  it('พิมพ์เลขที่คำร้องแล้ว submit → เข้าจอ confirm', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: qcPetition },
    });
    renderModal();

    const input = await screen.findByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2506-0002' } });
    fireEvent.click(screen.getByRole('button', { name: 'รับตัวอย่าง' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/petitions/scan/P-2506-0002'),
      ),
    );
    expect(await screen.findByText('P-2506-0002')).toBeInTheDocument();
  });
});

describe('QrReceiveModal camera failure fallback', () => {
  it('เปิดกล้องไม่ได้ (getCameras throw) → ยังมีช่องกรอกเลขให้รับตัวอย่างต่อได้', async () => {
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

describe('QrReceiveModal manualOnly mode', () => {
  function renderManual() {
    return render(
      <MemoryRouter>
        <QrReceiveModal open manualOnly onClose={() => {}} onReceived={() => {}} />
      </MemoryRouter>,
    );
  }

  it('โชว์หัวข้อ "กรอกเลขรับตัวอย่าง" + ช่องกรอกทันที ไม่ต้องรอกล้อง', async () => {
    renderManual();
    expect(screen.getByText('กรอกเลขรับตัวอย่าง')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/)).toBeInTheDocument();
    expect(screen.queryByText(/ไม่พบกล้อง/)).not.toBeInTheDocument();
  });

  it('submit เลขคำร้อง → เข้า confirm เหมือนโหมดสแกน', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: qcPetition } });
    renderManual();
    const input = screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2506-0002' } });
    fireEvent.click(screen.getByRole('button', { name: 'รับตัวอย่าง' }));
    expect(await screen.findByText('P-2506-0002')).toBeInTheDocument();
  });

  it('แสดงข้อความ error จาก backend เมื่อรับไม่ได้', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: qcPetition } });
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { error: { message: 'คำขอ R&D ไม่ต้องส่ง QC' } } },
    });
    renderManual();

    const input = screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/);
    fireEvent.change(input, { target: { value: 'P-2609-0003' } });
    fireEvent.click(screen.getByRole('button', { name: 'รับตัวอย่าง' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันรับตัวอย่าง' }));

    expect(await screen.findByText('คำขอ R&D ไม่ต้องส่ง QC')).toBeInTheDocument();
    expect(screen.queryByText('เกิดข้อผิดพลาด กรุณาลองใหม่')).not.toBeInTheDocument();
  });
});

describe('QrReceiveModal รับทีละป้าย', () => {
  const twoBatch = {
    ...qcPetition,
    routeTargets: ['qc'],
    items: [
      { seq: 1, sampleName: 'A', batchNo: '001', sampleQuantity: 2, labelQuantitySides: ['qc', 'qc'] },
      { seq: 2, sampleName: 'A', batchNo: '002', sampleQuantity: 1, labelQuantitySides: ['qc'] },
    ],
    sampleLabelNumbers: { year: 2569, qc: 'P01', groups: [{ key: '001|', qc: 'P01' }, { key: '002|', qc: 'P02' }] },
  };

  function renderManual() {
    return render(
      <MemoryRouter>
        <QrReceiveModal open manualOnly onClose={() => {}} onReceived={() => {}} />
      </MemoryRouter>,
    );
  }

  function scan(value: string) {
    fireEvent.change(screen.getByPlaceholderText(/พิมพ์เลขที่คำร้อง/), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'รับตัวอย่าง' }));
  }

  it('สแกน QR ป้ายรายการที่ 2 → เลือกเฉพาะ P02/69 และส่ง labelKeys ของป้ายนั้น', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: twoBatch } });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { ...twoBatch, labelReceipts: [{ key: '002|', side: 'qc' }] } } });
    renderManual();

    scan(JSON.stringify({ id: 'pet1', petitionNo: 'P-2506-0002', sampleId: '', itemSeq: 2 }));

    const p02 = await screen.findByRole('checkbox', { name: /P02\/69/ });
    expect(p02).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /P01\/69/ })).not.toBeChecked();
    expect(screen.getByText('รับแล้ว 1/2 ป้าย · รอป้ายที่เหลือ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันรับตัวอย่าง' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/petitions/pet1/receive', expect.objectContaining({ side: 'qc', labelKeys: ['002|'] })));
  });

  it('สแกนป้ายที่รับไปแล้ว → แจ้งว่ารับเลขนั้นแล้ว', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { ...twoBatch, labelReceipts: [{ key: '002|', side: 'qc' }] } } });
    renderManual();

    scan(JSON.stringify({ id: 'pet1', itemSeq: 2 }));

    expect(await screen.findByText('P-2506-0002: ป้าย P02/69 รับฝั่ง QC แล้ว')).toBeInTheDocument();
  });

  it('กรอกเลขคำขอเอง → เลือกทุกป้ายที่ยังไม่รับไว้ก่อน', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: twoBatch } });
    renderManual();

    scan('P-2506-0002');

    expect(await screen.findByRole('checkbox', { name: /P01\/69/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /P02\/69/ })).toBeChecked();
  });
});

