import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ParameterItem } from '@/lib/api';
import type { Petition, QCTestResult } from '@/types/petition.types';
import QCTestingDetailPage from './QCTestingDetailPage';

const state = vi.hoisted(() => ({ petition: null as Petition | null, parameters: [] as ParameterItem[], results: [] as QCTestResult[] }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useParams: () => ({ id: 'petition-1' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/qc-testing/petition-1', search: '', hash: '', state: null, key: 'test' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Navigate: () => null,
}));
vi.mock('@tanstack/react-query', () => ({ useQueries: () => [] }));
const machineDocs = vi.hoisted(() => ({ docs: [] as Record<string, unknown>[] }));
vi.mock('@/components/lis/DensitySyncButton', async () => {
  const { useEffect } = await import('react');
  function MockDensitySyncButton({ onOptions }: { onOptions?: (docs: Record<string, unknown>[]) => void }) {
    useEffect(() => { onOptions?.(machineDocs.docs); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }
  return { default: MockDensitySyncButton };
});
vi.mock('@/components/lis/AppLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/lis/PageHeader', () => ({ default: () => <header>คำร้อง</header> }));
vi.mock('@/hooks/usePetition', () => ({ usePetition: () => ({ data: state.petition, loading: false, error: null }), usePetitionList: () => ({ data: { items: [] } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { name: 'ผู้ตรวจ', email: 'tester@example.com', roles: ['admin'] } }) }));
vi.mock('@/hooks/useArrivalFlash', () => ({ useArrivalFlash: () => '' }));
vi.mock('@/hooks/useItemGroupMembership', () => ({ useItemGroupMembership: () => ({ get: () => [] }) }));
vi.mock('@/context/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/aiApi', () => ({ getAiStatus: () => Promise.resolve({ available: false }), checkOutlier: vi.fn(), streamAnalyzeQC: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: {
    getParameters: vi.fn(() => Promise.resolve(state.parameters)),
    getQCResults: vi.fn(() => Promise.resolve(state.results)),
    getInstrumentSources: vi.fn().mockResolvedValue([]),
    getReturnedFlags: vi.fn().mockResolvedValue({}),
    saveQCResult: vi.fn(), saveQCEntries: vi.fn(), completePetitionTrack: vi.fn(), post: vi.fn(), patch: vi.fn(),
  },
}));



describe('QC ค่า ถพ. typing while autosave reloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.petition = {
      _id: 'petition-1', petitionNo: 'LIS-001', dept: 'rm', status: 'inProgress',
      submittedBy: { name: 'ผู้ยื่น', submittedAt: '2026-09-19T01:00:00Z' },
      qcReceivedAt: '2026-09-19T01:00:00Z',
      items: [{ seq: 1, sampleName: 'ตัวอย่าง A', batchNo: '1231' }],
      createdAt: '2026-09-19T01:00:00Z', updatedAt: '2026-09-19T01:00:00Z',
    };
    state.parameters = [{ _id: 'sg', name: 'ค่า ถพ.', scope: 'qc', applyAll: true, multiEntry: true, valueFields: [{ label: 'ค่าถพ.', type: 'number' }] }];
    state.results = [{ petitionId: 'petition-1', itemSeq: 1, parameterId: 'sg', sampleRoundId: '', values: {}, entries: [{ 'ค่าถพ.': '1.2' }] }];
  });
  afterEach(cleanup);

  it('keeps a value typed while the previous autosave is still saving', async () => {
    let finishSave: () => void = () => {};
    vi.mocked(api.saveQCResult).mockImplementation((body) => new Promise((resolve) => {
      finishSave = () => {
        // server ได้ค่าของรอบที่ส่งไปเท่านั้น
        state.results = [{ ...state.results[0], entries: [{ 'ค่าถพ.': (body as { value: unknown }).value }] }];
        resolve(state.results[0]);
      };
    }));
    render(<QCTestingDetailPage />);
    const input = await screen.findByPlaceholderText('กรอกค่า ถพ. 3 ตำแหน่ง');
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: '1.1' } });
    await waitFor(() => expect(api.saveQCResult).toHaveBeenCalledTimes(1), { timeout: 2500 });
    fireEvent.change(input, { target: { value: '1.15' } });
    finishSave();

    await waitFor(() => expect(api.getQCResults).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByPlaceholderText('กรอกค่า ถพ. 3 ตำแหน่ง')).toHaveValue(1.15);
  });

  it('waits on "เลือก" until the user picks, even when the machine has readings', async () => {
    state.results = [];
    machineDocs.docs = [
      { _id: 'a', 'Sample name': 'Batch 1231 A', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '30.00' },
      { _id: 'b', 'Sample name': 'Batch 1231 B', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '30.10' },
    ];
    render(<QCTestingDetailPage />);
    expect(await screen.findByText(/มีค่าจากเครื่อง 1 ค่า/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveTextContent('— เลือก —');
    expect(screen.queryByPlaceholderText('กรอกค่า ถพ. 3 ตำแหน่ง')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1000));
    expect(api.saveQCResult).not.toHaveBeenCalled();
    expect(api.saveQCEntries).not.toHaveBeenCalled();
  });
});
